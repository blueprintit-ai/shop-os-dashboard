// Second Brain scanner, ported from the kit's scan.js (RoboNuggets Second Brain, CC BY 4.0, see NOTICE.md) and
// rewritten for the product: it takes an explicit vault root, never follows symlinks, skips hidden/system folders,
// and every dimension is capped (files, folders, depth, scan time, bytes read per note, links, visible nodes).
// Two stages, so cheap things stay live without a disk walk:
//   scanVault()  walks the vault once and extracts note links (cached; refreshed by BrainStore on a rescan/watch)
//   buildGraph() assembles nodes + links from that model plus apps, routines, skills and the owner's tweaks
import { readdirSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join, extname, posix } from "node:path";
import { HIDDEN_DIRS } from "../scope.js";

export const LIMITS = Object.freeze({
  maxFiles: 20000,        // files recorded; the walk stops past this (meta.truncated)
  maxDirs: 6000,
  maxDepth: 12,
  budgetMs: 4000,         // wall-clock budget for the walk
  mdReadBytes: 256 * 1024, // bytes read from the head of one note to find its links
  maxMdReads: 4000,       // notes parsed per scan (the rest still appear on the map, without link edges)
  maxMdLinks: 6000,       // link edges sent to the page
  perDirVisible: 60,      // files shown per folder on the map (newest first); the rest stay searchable
  perDirFolded: 80,       // sub-folders shown per folder
  maxVisibleFiles: 700,
  expandFiles: 250,
  expandDirs: 100,
  searchLimit: 40,
  nameMax: 200,
});

const EXCLUDE_DIRS = new Set(["node_modules", ".git", ".venv", "venv", "__pycache__", ".next", ".cache", "dist", "coverage", ".turbo", ".pytest_cache", ".idea", ".obsidian", ...HIDDEN_DIRS]);
const EXCLUDE_TOP = new Set(["Dashboard"]); // the dashboard's own generated data
const EXCLUDE_FILES = /^(thumbs\.db|desktop\.ini|\.ds_store|~\$|\.syncthing\.)/i;
// Names the page would put into innerHTML unescaped (search rows, cards): such entries are left off the map.
const UNSAFE_NAME = /[<>"`\u0000-\u001f]/;
const SECRET_RE = /(^|\/)\.env(\.|$)|\.pem$|\.key$|(^|[-_.])secrets?([-_.]|$)|credential|token\.json$|apikey/i;
export const isSecret = (rel) => SECRET_RE.test(rel);

const topOf = (rel) => (rel.includes("/") ? rel.split("/")[0] : "(root)");

// ---------- filesystem walk ----------
export function walk(root, limits = LIMITS) {
  const files = [];   // { rel, name, ext, size, mtime, parent }
  const dirs = new Map();
  dirs.set("", { rel: "", name: "", parent: null, files: 0, mdFiles: 0, bytes: 0, childDirs: [], childFiles: [] });
  const t0 = Date.now();
  let truncated = false, skippedUnsafe = 0;

  function rec(abs, rel, depth) {
    if (truncated) return;
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const dnode = dirs.get(rel);
    for (const e of entries) {
      if (truncated) return;
      const name = e.name;
      if (name.length > limits.nameMax || UNSAFE_NAME.test(name)) { skippedUnsafe++; continue; }
      if (Date.now() - t0 > limits.budgetMs || files.length >= limits.maxFiles || dirs.size >= limits.maxDirs) { truncated = true; return; }
      if (e.isDirectory()) { // a symlink is neither isDirectory nor isFile here, so links are never followed
        if (name.startsWith(".") || EXCLUDE_DIRS.has(name) || (rel === "" && EXCLUDE_TOP.has(name)) || depth >= limits.maxDepth) continue;
        const crel = rel ? rel + "/" + name : name;
        dirs.set(crel, { rel: crel, name, parent: rel, files: 0, mdFiles: 0, bytes: 0, childDirs: [], childFiles: [] });
        dnode.childDirs.push(crel);
        rec(join(abs, name), crel, depth + 1);
      } else if (e.isFile()) {
        if (name.startsWith(".") || EXCLUDE_FILES.test(name)) continue;
        let st; try { st = statSync(join(abs, name)); } catch { continue; }
        const crel = rel ? rel + "/" + name : name;
        files.push({ rel: crel, name, ext: extname(name).toLowerCase(), size: st.size, mtime: st.mtimeMs, parent: rel });
        dnode.childFiles.push(files.length - 1);
      }
    }
  }
  rec(root, "", 0);

  // roll up recursive counts, deepest first
  const byDepth = [...dirs.values()].sort((a, b) => b.rel.split("/").length - a.rel.split("/").length);
  for (const d of byDepth) {
    for (const fi of d.childFiles) { const f = files[fi]; d.files++; d.bytes += f.size; if (f.ext === ".md") d.mdFiles++; }
    if (d.parent !== null) { const p = dirs.get(d.parent); p.files += d.files; p.bytes += d.bytes; p.mdFiles += d.mdFiles; }
  }
  return { files, dirs, truncated, skippedUnsafe };
}

// ---------- markdown link extraction (cache keyed by path+mtime+size; holds raw references, resolved every scan) ----------
function readHead(abs, bytes) {
  let fd;
  try {
    fd = openSync(abs, "r");
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString("utf8");
  } catch { return null; } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* ignore */ } }
}

function refsOf(txt) {
  const wiki = new Set(), paths = new Set();
  for (const m of txt.matchAll(/\[\[([^\]|#\n]+)/g)) wiki.add(m[1].trim().replace(/\.md$/i, "").toLowerCase());
  for (const m of txt.matchAll(/\]\(([^)#?\s]+\.(?:md|pdf|html?))(?:[#?][^)]*)?\)/gi)) {
    const t = m[1];
    if (/^[a-z]+:\/\//i.test(t) || t.startsWith("mailto:")) continue;
    paths.add(t);
  }
  return { wiki: [...wiki].slice(0, 200), paths: [...paths].slice(0, 200) };
}

function pickClosest(fromRel, candidates) {
  if (candidates.length === 1) return candidates[0];
  const a = fromRel.split("/").slice(0, -1);
  let best = candidates[0], bestScore = -1;
  for (const c of candidates) {
    const b = c.split("/").slice(0, -1);
    let score = 0;
    while (score < a.length && score < b.length && a[score] === b[score]) score++;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

export function extractLinks(root, files, cache, limits = LIMITS) {
  const mdFiles = files.filter((f) => f.ext === ".md");
  const base = new Map();
  for (const f of mdFiles) {
    const key = f.name.slice(0, -3).toLowerCase();
    if (!base.has(key)) base.set(key, []);
    base.get(key).push(f.rel);
  }
  const relSet = new Set(files.map((f) => f.rel));
  const out = [], newCache = new Map();
  let read = 0, cached = 0, parsed = 0;
  for (const f of mdFiles) {
    if (out.length >= limits.maxMdLinks) break;
    const key = f.rel;
    let c = cache.get(key);
    if (c && c.m === f.mtime && c.s === f.size) { cached++; }
    else {
      if (read >= limits.maxMdReads) continue;
      const txt = readHead(join(root, f.rel), limits.mdReadBytes);
      if (txt === null) continue;
      read++;
      c = { m: f.mtime, s: f.size, ...refsOf(txt) };
    }
    newCache.set(key, c);
    parsed++;
    const targets = new Set();
    for (const w of c.wiki) { const hits = base.get(w); if (hits && hits.length) targets.add(pickClosest(f.rel, hits)); }
    for (const t0 of c.paths) {
      let t = t0.replace(/\\/g, "/");
      let resolved = t.startsWith("/") ? t.slice(1) : posix.normalize(posix.join(posix.dirname(f.rel), t));
      if (resolved.startsWith("..")) continue;
      try { resolved = decodeURIComponent(resolved); } catch { /* keep as is */ }
      if (relSet.has(resolved)) targets.add(resolved);
    }
    targets.delete(f.rel);
    for (const t of targets) { if (out.length >= limits.maxMdLinks) break; out.push([f.rel, t]); }
  }
  return { links: out, newCache, stats: { mdParsed: parsed, read, cached } };
}

// ---------- classification ----------
export function deptOf(rel, cfg) {
  let best = null;
  for (const r of cfg.pathRules) if (rel.startsWith(r.prefix) && (!best || r.prefix.length > best.prefix.length)) best = r;
  return best ? best.dept : cfg.default;
}

export function scanVault(root, cache = new Map(), limits = LIMITS) {
  const t0 = Date.now();
  const model = walk(root, limits);
  const { links, newCache, stats } = extractLinks(root, model.files, cache, limits);
  return { ...model, mdLinks: links, cache: newCache, scanStats: stats, scanMs: Date.now() - t0, scannedAt: new Date().toISOString() };
}

// ---------- graph ----------
const plainText = (s, max) => String(s ?? "").replace(/[<>"`\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

function fileNode(f, cfg) {
  const n = { id: f.rel, type: "file", layer: "M", label: f.name, dept: deptOf(f.rel, cfg), access: "claude", size: f.size, mtime: f.mtime, ext: f.ext, path: f.rel, top: topOf(f.rel) };
  if (isSecret(f.rel)) n.secret = true;
  return n;
}
function dirNode(d, cfg) {
  return { id: d.rel, type: "dir", layer: "M", label: d.name, folded: true, dept: deptOf(d.rel + "/", cfg), access: "claude", size: d.bytes, files: d.files, mdFiles: d.mdFiles, path: d.rel, top: topOf(d.rel) };
}
function skillNode(s, cfg) {
  return { id: "skill:" + s.name, type: "file", layer: "S", label: s.name, dept: cfg.default, access: "claude", size: s.size, mtime: s.mtime, ext: ".md", path: "skill:" + s.name, top: "skills", desc: s.desc || undefined };
}

// `extras` = { apps: [{id,name,sub,url}], routines: [{t,d,src,n,desc}], skills: [...], tweaks: {hidden,edits} }
export function buildGraph(model, cfg, extras = {}, limits = LIMITS) {
  const { files, dirs } = model;
  const nodes = [];
  const push = (n) => { nodes.push(n); return n; };
  const routerFile = files.find((f) => f.rel === "CLAUDE.md");
  push({ id: "CLAUDE.md", type: "router", layer: "M", label: "CLAUDE.md", dept: cfg.default, access: "claude", size: routerFile ? routerFile.size : 0, path: "CLAUDE.md" });
  for (const d of cfg.departments) push({ id: "hub:" + d.key, type: "hub", hubKind: "dept", layer: "M", label: d.label, dept: d.key, access: "claude" });
  for (const l of cfg.layers) if (l.key !== "M") push({ id: "lhub:" + l.key, type: "hub", hubKind: "layer", layer: l.key, label: l.label, dept: null, access: "claude" });

  // spine = the vault root + every top-level folder; their files show, deeper folders fold into one node each
  const spine = new Set([""]);
  for (const cd of dirs.get("").childDirs) spine.add(cd);
  let visibleFiles = 0, hiddenFiles = 0, hiddenDirs = 0;
  for (const spineRel of spine) {
    const d = dirs.get(spineRel);
    if (!d) continue;
    const kids = d.childFiles.map((i) => files[i]).filter((f) => f.rel !== "CLAUDE.md").sort((a, b) => b.mtime - a.mtime);
    const room = Math.max(0, Math.min(limits.perDirVisible, limits.maxVisibleFiles - visibleFiles));
    for (const f of kids.slice(0, room)) { push(fileNode(f, cfg)); visibleFiles++; }
    hiddenFiles += Math.max(0, kids.length - room);
    const sub = d.childDirs.filter((cd) => !spine.has(cd)).map((cd) => dirs.get(cd)).sort((a, b) => b.files - a.files);
    for (const c of sub.slice(0, limits.perDirFolded)) push(dirNode(c, cfg));
    hiddenDirs += Math.max(0, sub.length - limits.perDirFolded);
  }

  for (const s of extras.skills ?? []) push(skillNode(s, cfg));
  for (const a of extras.apps ?? []) push({ id: "app:" + a.id, type: "app", layer: "A", label: plainText(a.name, 80), dept: null, access: "claude", kind: "app", desc: plainText(a.sub, 120) || undefined, links: [] });
  (extras.routines ?? []).forEach((r, i) => {
    push({ id: `rt:${i}-${plainText(r.n, 40).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`, type: "routine", layer: "R", label: plainText(r.n, 80), dept: null, access: "claude", schedule: plainText(`${r.d} ${r.t}`, 40), runner: plainText(r.src, 30), desc: plainText(r.desc, 200) || undefined, links: [] });
  });

  const links = [];
  for (const d of cfg.departments) links.push({ s: "CLAUDE.md", t: "hub:" + d.key, k: "route" });
  for (const l of cfg.layers) if (l.key !== "M") links.push({ s: "CLAUDE.md", t: "lhub:" + l.key, k: "route" });
  for (const n of nodes) {
    if (n.type === "file" || n.type === "dir") links.push(n.layer === "S" ? { s: n.id, t: "lhub:S", k: "spoke" } : { s: n.id, t: "hub:" + n.dept, k: "spoke" });
    if (n.type === "app") links.push({ s: n.id, t: "lhub:A", k: "spoke" });
    if (n.type === "routine") links.push({ s: n.id, t: "lhub:R", k: "spoke" });
  }

  // the owner's Remove / Edit actions
  const tw = extras.tweaks ?? { hidden: [], edits: {} };
  const hid = new Set(tw.hidden ?? []);
  let nodesOut = nodes, linksOut = links;
  if (hid.size) { nodesOut = nodes.filter((n) => !hid.has(n.id)); linksOut = links.filter((l) => !hid.has(l.s) && !hid.has(l.t)); }
  const byId = new Map(nodesOut.map((n) => [n.id, n]));
  for (const [id, e] of Object.entries(tw.edits ?? {})) {
    const n = byId.get(id);
    if (n) { if (e.label) n.label = e.label; if (e.desc !== undefined) n.desc = e.desc; }
  }
  return { nodes: nodesOut, links: linksOut, hiddenCount: hid.size, capped: { hiddenFiles, hiddenDirs } };
}

// ---------- lazy expand + search ----------
export function expandDir(model, cfg, rel, limits = LIMITS) {
  const d = model.dirs.get(rel);
  if (!d) return null;
  const files = d.childFiles.map((i) => model.files[i]).sort((a, b) => b.mtime - a.mtime).slice(0, limits.expandFiles).map((f) => fileNode(f, cfg));
  const dirsOut = d.childDirs.map((cd) => model.dirs.get(cd)).sort((a, b) => b.files - a.files).slice(0, limits.expandDirs).map((c) => dirNode(c, cfg));
  return [...files, ...dirsOut];
}

export function search(model, cfg, q, skills = [], limit = LIMITS.searchLimit) {
  const s = String(q ?? "").trim().toLowerCase().slice(0, 100);
  if (!s) return [];
  const scored = [];
  for (const f of model.files) {
    const name = f.name.toLowerCase();
    let score = -1;
    if (name === s) score = 100; else if (name.startsWith(s)) score = 80; else if (name.includes(s)) score = 60; else if (f.rel.toLowerCase().includes(s)) score = 30;
    if (score >= 0) scored.push({ score: score - Math.min(20, f.rel.split("/").length), f });
  }
  for (const [rel, d] of model.dirs) {
    if (!rel) continue;
    const name = d.name.toLowerCase();
    let score = -1;
    if (name === s) score = 95; else if (name.startsWith(s)) score = 75; else if (name.includes(s)) score = 55;
    if (score >= 0) scored.push({ score, dir: d });
  }
  for (const k of skills) {
    const name = k.name.toLowerCase();
    let score = -1;
    if (name === s) score = 98; else if (name.startsWith(s)) score = 78; else if (name.includes(s)) score = 58;
    if (score >= 0) scored.push({ score, skill: k });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => {
    if (x.f) return { path: x.f.rel, name: x.f.name, type: "file", ext: x.f.ext, size: x.f.size, dept: deptOf(x.f.rel, cfg), layer: "M", access: "claude" };
    if (x.dir) return { path: x.dir.rel, name: x.dir.name, type: "dir", files: x.dir.files, dept: deptOf(x.dir.rel + "/", cfg), layer: "M", access: "claude" };
    return { path: "skill:" + x.skill.name, name: x.skill.name, type: "file", ext: ".md", size: x.skill.size, dept: cfg.default, layer: "S", access: "claude" };
  });
}
