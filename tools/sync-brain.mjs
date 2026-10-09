#!/usr/bin/env node
// Syncs the product's Second Brain page (/brain) from the RoboNuggets "Second Brain" kit
// (a modified Rubric Second Brain, CC BY 4.0, see NOTICE.md). Same method as tools/sync-kit.mjs
// (the owner dashboard page), kept in its own module so the two syncs never touch each other's rules:
// the kit page is the design; this script copies it and applies ONLY the named rules in RULES
// below. Each rule is anchored to exact kit text and the script FAILS loudly if an anchor is not
// found exactly once, so a kit change that moves one is noticed instead of silently skipped.
//
//   node tools/sync-brain.mjs [kit-folder]         write the files and tools/sync-brain.lock.json
//   node tools/sync-brain.mjs --check [kit-folder] exit 1 if the committed files differ
//
// The kit folder is required: the first argument, else $BRAIN_KIT_DIR (no default path is baked in).
// It is the folder that holds public/index.html, public/_core.js, ... (the second-brain kit root).
// Only the public/ page files are used; the kit's own server.js / scan.js / brain.js are NOT ported
// (src/brain/ + src/routes/brain-routes.js are the product's own engine).
// The kit files use CRLF line ends; the sync normalizes text to LF first (so anchors are plain \n)
// and the lock records the sha256 of the RAW bytes. tools/sync-brain.lock.json lets
// test/brain-lock.test.js prove in CI (without the kit) that the committed files are exactly what
// these rules produced; test/brain-parity.test.js re-runs syncBrain() when BRAIN_KIT_DIR is set.
//
// (applyRule is the same machinery as sync-kit.mjs's, copied rather than imported because sync-kit.mjs
// does not export it and is being edited on another branch.)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const LOCK_FILE = join(ROOT, "tools", "sync-brain.lock.json");

// kit file (relative to the kit folder) -> product file
export const FILES = [
  { src: "public/index.html", dest: "public/brain.html" },
  { src: "public/_core.js", dest: "public/brain/_core.js" },
  { src: "public/_core.css", dest: "public/brain/_core.css" },
  { src: "public/_flows2.js", dest: "public/brain/_flows2.js" },
  { src: "public/_icons.js", dest: "public/brain/_icons.js" },
];

const FONT_LINK = '<link rel="stylesheet" href="/static/css/brain-fonts.css">';

// kit API literal -> product literal. The kit calls absolute '/api/...' paths from a page served at '/';
// the product serves the same JSON under /api/brain/ (src/routes/brain-routes.js). One rule per literal.
const API = [
  ["graph", "fetch('/api/graph?fresh=1')", "fetch('/api/brain/graph?fresh=1')", "first load (rescans when the cached graph is over 30 s old)"],
  ["expand-a", "fetch('/api/expand?path=' + encodeURIComponent(id))", "fetch('/api/brain/expand?path=' + encodeURIComponent(id))", "expanding a folded folder"],
  ["expand-b", "fetch('/api/expand?path=' + encodeURIComponent(d.id))", "fetch('/api/brain/expand?path=' + encodeURIComponent(d.id))", "expanding all folders"],
  ["tweak-edit", "await fetch('/api/tweak', { method: 'POST', body: JSON.stringify({ action: 'edit'", "await fetch('/api/brain/tweak', { method: 'POST', body: JSON.stringify({ action: 'edit'", "Edit on a card"],
  ["tweak-hide", "await fetch('/api/tweak', { method: 'POST', body: JSON.stringify({ action: 'hide'", "await fetch('/api/brain/tweak', { method: 'POST', body: JSON.stringify({ action: 'hide'", "Remove from the map"],
  ["tweak-unhide", "await fetch('/api/tweak', { method: 'POST', body: JSON.stringify({ action: 'unhide-all'", "await fetch('/api/brain/tweak', { method: 'POST', body: JSON.stringify({ action: 'unhide-all'", "Restore removed items"],
  ["file", "fetch('/api/file?path='", "fetch('/api/brain/file?path='", "the in-page file viewer"],
  ["bake", "fetch('/api/bake'", "fetch('/api/brain/bake'", "Bake settings"],
  ["rescan", "await fetch('/api/rescan'", "await fetch('/api/brain/rescan'", "Rescan"],
  ["graph-after-rescan", "await fetch('/api/graph');", "await fetch('/api/brain/graph');", "graph reload after a rescan"],
  ["search", "fetch('/api/search?q='", "fetch('/api/brain/search?q='", "the search box"],
];

// ---- rule machinery --------------------------------------------------------

// A rule is { id, file (kit file), doc, find: string|RegExp, replace: string|() => string }
// or { id, file, doc, between: [startText, endText], maxBytes, replace } which swaps
// everything from startText up to (not including) the first endText after it, and
// fails if that span is larger than maxBytes (a runaway match would eat kit code).
// The start anchor must be found exactly once.
export const RULES = [
  // ---- index.html -> public/brain.html
  { id: "title", file: "public/index.html",
    doc: "<title> 'Blueprint IT - Shop OS AI Brain' -> 'Blueprint OS - <shop name> . AI Brain'; __SHOP_NAME__ is filled server-side (src/routes/pages.js, HTML-escaped), like the owner page title.",
    find: "<title>Blueprint IT - Shop OS AI Brain</title>", replace: "<title>Blueprint OS — __SHOP_NAME__ · AI Brain</title>" },
  { id: "fonts-link", file: "public/index.html",
    doc: "Google Fonts preconnect + stylesheet <link>s (Outfit, Source Serif 4 italic) -> local /static/css/brain-fonts.css (fonts in public/vendor/fonts, SIL OFL).",
    find: /<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\n<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>\n<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*" rel="stylesheet">/, replace: FONT_LINK },
  { id: "core-css-path", file: "public/index.html",
    doc: "relative <link href=\"_core.css\"> -> /static/brain/_core.css (the page is served at /brain, the product serves public/ under /static).",
    find: '<link rel="stylesheet" href="_core.css">', replace: '<link rel="stylesheet" href="/static/brain/_core.css">' },
  { id: "d3-cdn", file: "public/index.html",
    doc: "d3@7 jsdelivr CDN <script> -> vendored /static/vendor/d3.min.js (d3 7.9.0, ISC, LICENSE-d3.txt).",
    find: '<script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>', replace: '<script src="/static/vendor/d3.min.js"></script>' },
  { id: "marked-cdn", file: "public/index.html",
    doc: "marked@11.1.1 jsdelivr CDN <script> -> the product's vendored /static/vendor/marked.min.js, plus /static/js/brain-safe.js (module: window.brainSafeFragment, the sanitizer the viewer uses, see rule viewer-sanitize).",
    find: '<script src="https://cdn.jsdelivr.net/npm/marked@11.1.1/marked.min.js"></script>',
    replace: '<script src="/static/vendor/marked.min.js"></script>\n<script type="module" src="/static/js/brain-safe.js"></script>' },
  { id: "icons-path", file: "public/index.html",
    doc: "relative <script src=\"_icons.js\"> -> /static/brain/_icons.js.",
    find: '<script src="_icons.js"></script>', replace: '<script src="/static/brain/_icons.js"></script>' },
  { id: "flows-path", file: "public/index.html",
    doc: "relative <script src=\"_flows2.js\"> -> /static/brain/_flows2.js.",
    find: '<script src="_flows2.js"></script>', replace: '<script src="/static/brain/_flows2.js"></script>' },
  { id: "core-path", file: "public/index.html",
    doc: "relative <script src=\"_core.js\"> -> /static/brain/_core.js.",
    find: '<script src="_core.js"></script>', replace: '<script src="/static/brain/_core.js"></script>' },
  { id: "tagline-shop-name", file: "public/index.html",
    doc: "the HUD subtitle (empty in the kit) carries the shop name in the serif-italic accent the kit's CSS already styles (.hud-tag em, Source Serif 4). __BRAIN_TAGLINE_JS__ is replaced by src/routes/pages.js with a JSON string (shop name HTML-escaped, '<' as \\u003c).",
    find: "    tagline: '',", replace: "    tagline: __BRAIN_TAGLINE_JS__," },
  { id: "dashboard-link", file: "public/index.html",
    doc: "the top bar's '<- DASHBOARD' button sent the browser to the kit dashboard on port 50000; the product's owner page is /owner.",
    find: "fabH.onclick = () => { location.href = location.protocol + '//' + location.hostname + ':50000/'; };", replace: "fabH.onclick = () => { location.href = '/owner'; };" },

  // ---- _core.js -> public/brain/_core.js
  ...API.map(([k, find, replace, what]) => ({ id: "api-" + k, file: "public/_core.js", doc: `API base: ${what} calls /api/brain/... instead of /api/... (same JSON, served by src/routes/brain-routes.js).`, find, replace })),
  { id: "brand-name", file: "public/_core.js",
    doc: "HUD brand word 'SHOP OS' -> 'BLUEPRINT OS' (the product is named Blueprint OS; the shop name sits under it as the subtitle).",
    find: '<span class="hud-rubric">SHOP OS</span>', replace: '<span class="hud-rubric">BLUEPRINT OS</span>' },
  { id: "scan-failed-hint", file: "public/_core.js",
    doc: "splash text 'is server.js running?' named a kit process; the product has none.",
    find: "' - is server.js running?'", replace: "' - reload the page to try again'" },
  { id: "copy-path-card", file: "public/_core.js",
    doc: "'Copy path' on a card copied 'C:/ROBO/<path>' (the kit author's drive); the product copies the vault-relative path.",
    find: "navigator.clipboard.writeText('C:/ROBO/' + (n.path || ''))", replace: "navigator.clipboard.writeText(n.path || '')" },
  { id: "copy-path-viewer", file: "public/_core.js",
    doc: "same for the viewer drawer's copy button.",
    find: "navigator.clipboard.writeText('C:/ROBO/' + path)", replace: "navigator.clipboard.writeText(path)" },
  { id: "open-in-notes", file: "public/_core.js",
    doc: "'Open' called POST /api/open, which shelled out `open <path>` on the server; the product's /api/brain/open runs no process and returns the notes viewer URL, which opens in a new tab.",
    between: ["      const r = await fetch('/api/open', { method: 'POST', body: JSON.stringify({ path }) });", "    } catch (e) { toast('Open failed'); }"], maxBytes: 400,
    replace: "      const r = await fetch('/api/brain/open', { method: 'POST', body: JSON.stringify({ path }) });\n      const d = await r.json();\n      if (d.ok && d.url) window.open(d.url, '_blank', 'noopener');\n      toast(d.ok ? 'Opened in the notes viewer' : (d.error || 'Could not open'));\n" },
  { id: "binary-hint", file: "public/_core.js",
    doc: "viewer message for non-text files: 'opening on device' -> the notes viewer.",
    find: "Binary file - opening on device instead.", replace: "Binary file - opening it in a new tab instead." },
  { id: "viewer-sanitize", file: "public/_core.js",
    doc: "the viewer put marked's raw HTML into the page (innerHTML string concat); notes can be written by staff and this is the owner's session. Now (1) every '<' in the note is escaped BEFORE markdown runs (wikilink anchors are inserted after the escape), exactly like src/notes/render.js, and (2) marked's output is a backstop-sanitized, inert DOM fragment (public/js/brain-safe.js, window.brainSafeFragment) appended into a .md-body element: nothing is re-serialized and re-parsed.",
    find: "body.innerHTML = '<div class=\"md-body\">' + marked.parse(resolveWikilinks(d.content, path)) + '</div>';",
    replace: "body.innerHTML = ''; const mdBody = document.createElement('div'); mdBody.className = 'md-body';\n        mdBody.appendChild(brainSafeFragment(marked.parse(resolveWikilinks(d.content.replace(/</g, '&lt;'), path)))); body.appendChild(mdBody);" },
  { id: "no-icon-cdn", file: "public/_core.js",
    doc: "apps without a baked brand path fetched their icon from the simple-icons jsdelivr CDN at runtime; the product makes no external requests, so the fetch rejects immediately and the node keeps its fallback glyph.",
    find: "fetch('https://cdn.jsdelivr.net/npm/simple-icons@13/icons/' + n.iconSlug + '.svg')", replace: "Promise.reject(new Error('no external icon fetch'))" },

  { id: "app-status-undefined", file: "public/_core.js",
    doc: "the app card stats line printed '<KIND> · undefined' for apps without a status (the product's apps have none).",
    find: "stats = `${n.kind.toUpperCase()} · ${n.status}`;", replace: "stats = `${n.kind.toUpperCase()}${n.status ? ' · ' + n.status : ''}`;" },
  { id: "slider-defaults-dept-keys", file: "public/index.html",
    doc: "the skin's default gravity/distance sliders were keyed by the kit author's own department keys (content, community, product, personal); the product's departments are business, context, intelligence, projects, team (same values).",
    between: ["      grav_content: 0.86,", "\n      grav_S: 0.4"], maxBytes: 200,
    replace: "      grav_business: 0.84, grav_context: 0.85, grav_intelligence: 0.84, grav_projects: 0.84, grav_team: 0.85," },
  { id: "slider-dist-dept-keys", file: "public/index.html",
    doc: "same for the distance sliders.",
    find: "dist_content: 0, dist_community: 0, dist_product: 0, dist_personal: 0, dist_business: 0,", replace: "dist_business: 0, dist_context: 0, dist_intelligence: 0, dist_projects: 0, dist_team: 0," },

  // ---- _icons.js -> public/brain/_icons.js
  { id: "icons-brand-paths-generic", file: "public/_icons.js",
    doc: "window.BRAIN_ICON_PATHS held brand marks for the kit author's own tool inventory; only the generic set a shop's apps could plausibly use is kept (the rest cannot match a product node and name tools that are not ours).",
    keepKeys: ["app:telegram", "app:gcal", "app:gdrive", "app:gh", "app:git", "app:slack", "app:stripe", "app:canva"], object: "window.BRAIN_ICON_PATHS = " },
  { id: "icons-drop-author-set", file: "public/_icons.js",
    doc: "window.BRAIN_ICONS is a set of hand-drawn icons keyed by the kit author's own routine/app ids; no product node has those ids, so the set is emptied (the baked brand paths in BRAIN_ICON_PATHS stay).",
    between: ["window.BRAIN_ICONS = {", "\n};\n"], maxBytes: 40000, replace: "window.BRAIN_ICONS = {" },
];

function applyRule(rule, text) {
  let start, end;
  if (rule.keepKeys) {
    const a = rule.object;
    start = text.indexOf(a);
    if (start < 0 || text.indexOf(a, start + 1) >= 0) throw new Error(`sync-brain: anchor not found exactly once for rule ${rule.id} (${JSON.stringify(a)}) in ${rule.file}`);
    const objStart = start + a.length;
    const objEnd = text.indexOf("};", objStart);
    if (objEnd < 0) throw new Error(`sync-brain: end of object not found for rule ${rule.id}`);
    let obj;
    try { obj = JSON.parse(text.slice(objStart, objEnd + 1)); } catch { throw new Error(`sync-brain: rule ${rule.id}: the object is not plain JSON any more`); }
    const kept = {};
    for (const k of rule.keepKeys) { if (!(k in obj)) throw new Error(`sync-brain: rule ${rule.id}: key ${k} no longer in the kit object`); kept[k] = obj[k]; }
    const before = text.slice(objStart, objEnd + 1), after = JSON.stringify(kept);
    return { text: text.slice(0, objStart) + after + text.slice(objEnd + 1), before, after };
  }
  if (rule.between) {
    const [a, b] = rule.between;
    start = text.indexOf(a);
    if (start < 0 || text.indexOf(a, start + 1) >= 0) throw new Error(`sync-brain: anchor not found exactly once for rule ${rule.id} (start: ${JSON.stringify(a.slice(0, 60))}) in ${rule.file}`);
    end = text.indexOf(b, start + a.length);
    if (end < 0) throw new Error(`sync-brain: anchor not found for rule ${rule.id} (end: ${JSON.stringify(b.slice(0, 60))}) in ${rule.file}`);
    if (!Number.isInteger(rule.maxBytes)) throw new Error(`sync-brain: rule ${rule.id} is a between-rule without maxBytes`);
    if (Buffer.byteLength(text.slice(start, end)) > rule.maxBytes) throw new Error(`sync-brain: rule ${rule.id} would replace ${Buffer.byteLength(text.slice(start, end))} bytes, over its ${rule.maxBytes}-byte cap (did an anchor move?)`);
  } else if (rule.find instanceof RegExp) {
    const g = new RegExp(rule.find.source, "g");
    const hits = [...text.matchAll(g)];
    if (hits.length !== 1) throw new Error(`sync-brain: anchor not found exactly once (${hits.length} matches) for rule ${rule.id} in ${rule.file}: ${rule.find}`);
    start = hits[0].index; end = start + hits[0][0].length;
  } else {
    start = text.indexOf(rule.find);
    if (start < 0 || text.indexOf(rule.find, start + 1) >= 0) throw new Error(`sync-brain: anchor not found exactly once for rule ${rule.id} in ${rule.file}: ${JSON.stringify(rule.find.slice(0, 80))}`);
    end = start + rule.find.length;
  }
  const before = text.slice(start, end);
  const after = typeof rule.replace === "function" ? rule.replace() : rule.replace;
  return { text: text.slice(0, start) + after + text.slice(end), before, after };
}

export const normalize = (buf) => buf.toString("utf8").replace(/\r\n/g, "\n");

// Pure: reads the kit folder, returns what the product's files should contain.
// `raw` = the kit bytes as found; `norm` = the same text with LF line ends (what the rules ran on).
export function syncBrain(kitDir) {
  const outputs = new Map(), raw = new Map(), norm = new Map(), applied = [];
  for (const f of FILES) {
    const p = join(kitDir, f.src);
    if (!existsSync(p)) throw new Error(`sync-brain: kit file missing: ${p}`);
    const buf = readFileSync(p);
    raw.set(f.dest, buf);
    let text = normalize(buf);
    norm.set(f.dest, text);
    for (const rule of RULES.filter((r) => r.file === f.src)) {
      const r = applyRule(rule, text);
      text = r.text;
      applied.push({ rule: rule.id, dest: f.dest, before: r.before, after: r.after });
    }
    outputs.set(f.dest, Buffer.from(text, "utf8"));
  }
  return { outputs, raw, norm, applied };
}

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

// The rule set as data (functions evaluated), so any change to a rule changes the digest.
export function rulesDigest() {
  const ser = RULES.map((r) => ({
    id: r.id, file: r.file, doc: r.doc, maxBytes: r.maxBytes ?? null,
    find: r.find instanceof RegExp ? { regex: r.find.source } : (r.find ?? null),
    between: r.between ?? null,
    keepKeys: r.keepKeys ?? null, object: r.object ?? null,
    replace: typeof r.replace === "function" ? r.replace() : r.replace,
  }));
  return sha(JSON.stringify(ser));
}

export function buildLock({ outputs, raw }) {
  const files = Object.fromEntries(FILES.map((f) => [f.dest, { kitSource: f.src, input: sha(raw.get(f.dest)), output: sha(outputs.get(f.dest)) }]));
  return { note: "Generated by tools/sync-brain.mjs; do not edit. Hashes are sha256 of raw kit inputs, the committed outputs and the rule set.", rules: rulesDigest(), files };
}

// Problems between the lock and the committed outputs (and the current rule set); [] when consistent.
export function checkLock(lock, readOutput) {
  const problems = [];
  if (lock.rules !== rulesDigest()) problems.push("the rule set changed since the lock was written: run node tools/sync-brain.mjs");
  for (const f of FILES) {
    const want = lock.files?.[f.dest]?.output;
    let got = null;
    try { got = sha(readOutput(f.dest)); } catch { /* missing */ }
    if (!want || got !== want) problems.push(`${f.dest} does not match the lock (hand-edited or out of sync): run node tools/sync-brain.mjs`);
  }
  return problems;
}

// Kit inputs whose hash differs from the lock: the kit moved on, re-sync.
export function changedInputs(lock, raw) {
  return FILES.filter((f) => lock.files?.[f.dest]?.input !== sha(raw.get(f.dest))).map((f) => f.src);
}

function main(argv) {
  const check = argv.includes("--check");
  const arg = argv.find((a) => !a.startsWith("--"));
  const kit = arg || process.env.BRAIN_KIT_DIR;
  if (!kit) throw new Error("sync-brain: pass the kit folder (node tools/sync-brain.mjs <kit-folder>) or set BRAIN_KIT_DIR");
  const { outputs, raw, applied } = syncBrain(kit);
  let dirty = 0;
  for (const [rel, buf] of outputs) {
    const dest = join(ROOT, rel);
    const same = existsSync(dest) && Buffer.compare(readFileSync(dest), buf) === 0;
    if (check) { if (!same) { dirty++; console.error(`out of sync: ${rel}`); } continue; }
    if (!same) { mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, buf); }
    console.log(`${same ? "unchanged" : "wrote    "} ${rel}`);
  }
  const lock = JSON.stringify(buildLock({ outputs, raw }), null, 2) + "\n";
  const lockSame = existsSync(LOCK_FILE) && readFileSync(LOCK_FILE, "utf8") === lock;
  if (check) { if (!lockSame) { dirty++; console.error("out of sync: tools/sync-brain.lock.json"); } }
  else { if (!lockSame) writeFileSync(LOCK_FILE, lock); console.log(`${lockSame ? "unchanged" : "wrote    "} tools/sync-brain.lock.json`); }
  console.log(`${applied.length} rule applications from ${kit}`);
  if (check && dirty) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(1); }
}
