import { closeSync, openSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const HIDDEN_DIRS = Object.freeze([".claude", ".obsidian", ".git", ".shopos", "node_modules", ".trash"]);

// ---------------------------------------------------------------------------------------------------------
// Private material. Staff (anyone whose role is not "owner") must never read, list, search, link to or have
// the AI read anything private, by any path the dashboard offers. isPathAllowed below is the single choke
// point; every consumer asks it. Private means:
//   (a) any vault-relative path segment equal to `private` (case-insensitive; trailing dots/spaces and an NTFS
//       ":stream" suffix ignored, as Windows does) at any depth,
//   (b) a markdown note whose front matter says private: true (yes / "true" / on / 1),
//   (c) paths and name patterns the owner lists in <vault>/Dashboard/private-paths.json.
// Every rule is applied to the lexical path AND to the real path (realpath, so links and junctions into
// Private are denied, and 8.3 short names are expanded by realpath.native on Windows).
// ---------------------------------------------------------------------------------------------------------

export const PRIVATE_CONFIG_FILE = ["Dashboard", "private-paths.json"];
const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_ENTRIES = 500;
const MAX_ENTRY_LENGTH = 200;
const MAX_PATTERN_LENGTH = 100;
const FM_SCAN_BYTES = 64 * 1024;
const FM_CACHE_MAX = 5000;
const NOTE_EXT = /\.(md|markdown|mdx)$/i;
const TRUTHY = new Set(["true", "yes", "y", "on", "1"]);

let auditSink = null;
// The server wires its Audit here so a corrupt private-paths.json is recorded (once per change of the file).
export function configurePrivateAudit(sink) { auditSink = sink ?? null; }

function realNative(p) {
  try { return realpathSync.native(p); } catch { /* fall through */ }
  try { return realpathSync(p); } catch { return null; }
}

function real(p) { return realNative(p) ?? resolve(p); }

// realpath of the deepest part that exists, plus the not-yet-existing tail: a name that does not exist yet
// behind a link into Private is still judged by where the link points.
function realDeep(p) {
  const abs = resolve(p);
  let cur = abs;
  const tail = [];
  for (;;) {
    const r = realNative(cur);
    if (r !== null) return tail.length ? join(r, ...tail.reverse()) : r;
    const parent = dirname(cur);
    if (parent === cur) return abs;
    tail.push(basename(cur));
    cur = parent;
  }
}

function isDir(p) { try { return statSync(p).isDirectory(); } catch { return false; } }

function insideOf(root, abs) {
  const rel = relative(root, abs);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// How a name compares: what Windows would make of it (stream suffix and trailing dots/spaces dropped), case-folded.
function normSeg(seg) {
  let s = String(seg);
  const colon = s.indexOf(":");
  if (colon >= 0) s = s.slice(0, colon);
  return s.replace(/[. \t]+$/, "").trim().toLowerCase();
}

function splitSegs(rel) { return String(rel).split(/[\\/]+/).filter((s) => s !== "" && s !== "."); }

// ---- the owner's list -----------------------------------------------------------------------------------

const EMPTY_CONFIG = Object.freeze({ paths: [], patterns: [] });
const configCache = new Map(); // real vault root -> { key, config, lastGood }

// Linear-time glob where `*` is the only wildcard (everything else is literal, including . [ ] ? ( ) etc.).
function globMatch(pattern, text) {
  let p = 0, t = 0, star = -1, mark = 0;
  while (t < text.length) {
    if (p < pattern.length && pattern[p] === "*") { star = p++; mark = t; }
    else if (p < pattern.length && pattern[p] === text[t]) { p++; t++; }
    else if (star >= 0) { p = star + 1; t = ++mark; }
    else return false;
  }
  while (p < pattern.length && pattern[p] === "*") p++;
  return p === pattern.length;
}

function parseConfig(text) {
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("expected an object with paths and patterns");
  for (const k of ["paths", "patterns"]) if (raw[k] !== undefined && !Array.isArray(raw[k])) throw new Error(`${k} must be a list`);
  const paths = [];
  for (const e of (raw.paths ?? []).slice(0, MAX_ENTRIES)) {
    if (typeof e !== "string" || e.length > MAX_ENTRY_LENGTH) continue;
    const segs = splitSegs(e);
    if (segs.length === 0 || segs.includes("..") || /^[a-zA-Z]:$/.test(segs[0])) continue;
    paths.push(segs.map(normSeg));
  }
  const patterns = [];
  for (const e of (raw.patterns ?? []).slice(0, MAX_ENTRIES)) {
    if (typeof e !== "string" || e.length > MAX_PATTERN_LENGTH) continue;
    const p = e.trim().toLowerCase();
    if (!p || /[\\/]/.test(p) || !/[^*]/.test(p)) continue;
    patterns.push(p.replace(/\*+/g, "*"));
  }
  return { paths, patterns };
}

function loadConfig(root) {
  const file = join(root, ...PRIVATE_CONFIG_FILE);
  let st;
  try { st = statSync(file); } catch {
    const c = configCache.get(root);
    if (c?.key === "missing") return c.config;
    configCache.set(root, { key: "missing", config: EMPTY_CONFIG, lastGood: EMPTY_CONFIG });
    return EMPTY_CONFIG;
  }
  const key = `${st.mtimeMs}:${st.size}:${st.ino}`;
  const cached = configCache.get(root);
  if (cached?.key === key) return cached.config;
  const lastGood = cached?.lastGood ?? EMPTY_CONFIG;
  try {
    if (st.size > MAX_CONFIG_BYTES) throw new Error("file is over 256 KB");
    const config = parseConfig(readFileSync(file, "utf8").replace(/^﻿/, ""));
    configCache.set(root, { key, config, lastGood: config });
    return config;
  } catch (e) {
    // Missing or unusable list = no list, but a good list that is later saved half-written keeps protecting.
    configCache.set(root, { key, config: lastGood, lastGood });
    try { auditSink?.log("private.config-invalid", { file: PRIVATE_CONFIG_FILE.join("/"), error: String(e?.message ?? e).slice(0, 200), keptPreviousList: lastGood !== EMPTY_CONFIG }); } catch { /* auditing never breaks a check */ }
    return lastGood;
  }
}

function listedPrivate(config, segs) {
  const norm = segs.map(normSeg);
  for (const entry of config.paths) {
    if (entry.length <= norm.length && entry.every((s, i) => s === norm[i])) return true;
  }
  if (config.patterns.length) {
    for (let i = 0; i < segs.length; i++) {
      const names = [norm[i]];
      if (i === segs.length - 1) { const stem = norm[i].replace(/\.[^.]*$/, ""); if (stem && stem !== norm[i]) names.push(stem); }
      for (const n of names) for (const pat of config.patterns) if (globMatch(pat, n)) return true;
    }
  }
  return false;
}

// ---- front matter ----------------------------------------------------------------------------------------

const fmCache = new Map(); // real file -> { mtimeMs, size, value }

function frontMatterPrivate(abs) {
  if (!NOTE_EXT.test(abs)) return false;
  let st;
  try { st = statSync(abs); } catch { return false; }
  if (!st.isFile()) return false;
  const hit = fmCache.get(abs);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.value;
  let value = false;
  let fd;
  try {
    fd = openSync(abs, "r");
    const buf = Buffer.alloc(Math.min(FM_SCAN_BYTES, st.size));
    const n = readSync(fd, buf, 0, buf.length, 0);
    value = textFrontMatterPrivate(buf.subarray(0, n).toString("utf8"));
  } catch { value = false; } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* ignore */ } }
  if (fmCache.size >= FM_CACHE_MAX) fmCache.clear();
  fmCache.set(abs, { mtimeMs: st.mtimeMs, size: st.size, value });
  return value;
}

export function textFrontMatterPrivate(text) {
  const m = /^﻿?\s*---[ \t]*\r?\n/.exec(text);
  if (!m) return false;
  const rest = text.slice(m[0].length);
  // up to the closing fence; if the chunk ends before one, the whole chunk counts (the strict reading)
  const end = /^(?:---|\.\.\.)[ \t]*\r?$/m.exec(rest);
  const block = end ? rest.slice(0, end.index) : rest;
  for (const line of block.split(/\r?\n/)) {
    const k = /^\s*(["']?)private\1\s*:\s*(.*)$/i.exec(line);
    if (!k) continue;
    const v = k[2].replace(/\s+#.*$/, "").trim().replace(/^(["'])(.*)\1$/, "$2").trim().toLowerCase();
    if (TRUTHY.has(v)) return true;
  }
  return false;
}

// ---- the public predicates -------------------------------------------------------------------------------

function relSegs(root, abs) {
  if (!insideOf(root, abs)) return null;
  return splitSegs(relative(root, abs));
}

function segsPrivate(config, segs) {
  if (segs.some((s) => normSeg(s) === "private")) return true;
  const cfgFile = PRIVATE_CONFIG_FILE.map((s) => s.toLowerCase());
  if (segs.length === cfgFile.length && segs.every((s, i) => normSeg(s) === cfgFile[i])) return true;
  return listedPrivate(config, segs);
}

// The list itself and Private folders are judged without touching the file system; this adds the real path and
// front matter. `lexAbs` is the path as asked for, `realAbs` where it really is.
function privateCheck(vaultPath, root, lexAbs, realAbs) {
  const config = loadConfig(root);
  const views = [];
  const l1 = relSegs(resolve(vaultPath), lexAbs); if (l1) views.push(l1);
  const l2 = relSegs(root, lexAbs); if (l2) views.push(l2);
  const r = relSegs(root, realAbs); if (r) views.push(r);
  if (views.length === 0) return false;
  if (views.some((s) => segsPrivate(config, s))) return true;
  return r !== null && frontMatterPrivate(realAbs);
}

// True when the file or folder is private under rules (a), (b) or (c) above. Role-blind: callers decide who it applies to.
export function isPrivatePath(vaultPath, absPath) {
  const root = real(vaultPath);
  const lex = resolve(absPath);
  return privateCheck(vaultPath, root, lex, realDeep(lex));
}

// Name-only version for stores that live outside the vault (e.g. the business-assets folder): rules (a) and (c)
// against a path relative to that store's root. No file system access beyond the owner list of `vaultPath`.
export function isPrivateRelPath(vaultPath, relPath) {
  const segs = splitSegs(relPath);
  if (segs.some((s) => s === "..")) return true;
  return segs.some((s) => normSeg(s) === "private") || listedPrivate(loadConfig(real(vaultPath)), segs);
}

export function allowedRoots(vaultPath, user) {
  const root = real(vaultPath);
  if (user.role === "owner") return [root];
  const out = [];
  const wanted = [...(user.switches?.folders ?? [])];
  if (user.switches?.teamFolder) wanted.push(user.switches.teamFolder);
  for (const f of wanted) {
    const abs = real(resolve(root, f));
    if (!insideOf(root, abs)) continue;
    if (privateCheck(vaultPath, root, resolve(root, f), abs)) continue;
    if (isDir(abs) && !out.includes(abs)) out.push(abs);
  }
  return out;
}

export function isPathAllowed(vaultPath, user, candidatePath) {
  const root = real(vaultPath);
  const lex = resolve(candidatePath);
  const abs = realDeep(lex);
  if (!insideOf(root, abs)) return false;
  const segments = relative(root, abs).split(sep).filter(Boolean);
  if (segments.some((s) => HIDDEN_DIRS.includes(s))) return false;
  if (user.role === "owner") return true;
  // deny wins over every folder grant
  if (privateCheck(vaultPath, root, lex, abs)) return false;
  return allowedRoots(vaultPath, user).some((r) => insideOf(r, abs));
}

export function toVaultRelative(vaultPath, absPath) {
  return relative(real(vaultPath), real(absPath)).split(sep).join("/");
}
