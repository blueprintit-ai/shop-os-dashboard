import { closeSync, lstatSync, openSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const HIDDEN_DIRS = Object.freeze([".claude", ".obsidian", ".git", ".shopos", "node_modules", ".trash"]);

// ---------------------------------------------------------------------------------------------------------
// Private material. Staff (anyone whose role is not "owner") must never read, list, search, link to or have
// the AI read anything private, by any path the dashboard offers. isPathAllowed below is the single choke
// point; every consumer asks it (or a scope from createScope, which is the same code). Private means:
//   (a) any vault-relative path segment equal to `private` (case-insensitive; trailing dots/spaces and an NTFS
//       ":stream" suffix ignored, as Windows does; Unicode compared in NFC) at any depth,
//   (b) a markdown note whose front matter says private: true (yes / "true" / on / 1), or whose front matter
//       is opened but never closed within the first 64 KB (fail closed),
//   (c) paths and name patterns the owner lists in <vault>/Dashboard/private-paths.json,
//   (d) the vault's top-level Chats/ folder (transcripts of other people's conversations).
// Every rule is applied to the lexical path AND to the real path (realpath, so links and junctions into
// Private are denied, and 8.3 short names are expanded by realpath.native on Windows).
// If private-paths.json exists but cannot be used and there is no earlier good list, staff are denied EVERY path
// until it is fixed (privateListStatus() says so).
// ---------------------------------------------------------------------------------------------------------

export const PRIVATE_CONFIG_FILE = ["Dashboard", "private-paths.json"];
const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_ENTRIES = 500;
const MAX_ENTRY_LENGTH = 200;
const MAX_PATTERN_LENGTH = 100;
const MAX_IGNORED_EVENTS = 50;
const FM_SCAN_BYTES = 64 * 1024;
const FM_CACHE_MAX = 20000;
const FM_CACHE_EVICT = 2000;
const NOTE_EXT = /\.(md|markdown|mdx)$/i;
const TRUTHY = new Set(["true", "yes", "y", "on", "1"]);

let auditSink = null;
// The server wires its Audit here so an unusable private-paths.json is recorded (once per change of the file).
export function configurePrivateAudit(sink) { auditSink = sink ?? null; }
function auditLog(event, fields) { try { auditSink?.log(event, fields); } catch { /* auditing never breaks a check */ } }

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

// How a name compares: Unicode in NFC, what Windows would make of it (stream suffix and trailing dots/spaces dropped), case-folded.
function normSeg(seg) {
  let s = String(seg).normalize("NFC");
  const colon = s.indexOf(":");
  if (colon >= 0) s = s.slice(0, colon);
  return s.replace(/[. \t]+$/, "").trim().toLowerCase();
}

function splitSegs(rel) { return String(rel).split(/[\\/]+/).filter((s) => s !== "" && s !== "."); }

// ---- the owner's list -----------------------------------------------------------------------------------

const EMPTY_CONFIG = Object.freeze({ paths: [], patterns: [], failClosed: false, ignored: 0 });
const FAIL_CLOSED = Object.freeze({ paths: [], patterns: [], failClosed: true, ignored: 0 });
const configCache = new Map(); // real vault root -> { key, config, lastGood, status }

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

// Throws when the file cannot be used at all; otherwise returns the list plus the entries it had to drop.
function parseConfig(text) {
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("expected an object with paths and patterns");
  for (const k of ["paths", "patterns"]) if (raw[k] !== undefined && !Array.isArray(raw[k])) throw new Error(`${k} must be a list`);
  const dropped = [];
  for (const k of Object.keys(raw)) if (k !== "paths" && k !== "patterns") dropped.push({ entry: k, reason: "unknown top-level key (only paths and patterns are read)" });
  const paths = [];
  const rawPaths = raw.paths ?? [];
  if (rawPaths.length > MAX_ENTRIES) dropped.push({ entry: `${rawPaths.length - MAX_ENTRIES} entries`, reason: `paths is over the ${MAX_ENTRIES}-entry limit` });
  for (const e of rawPaths.slice(0, MAX_ENTRIES)) {
    if (typeof e !== "string") { dropped.push({ entry: typeof e, reason: "path is not text" }); continue; }
    if (e.length > MAX_ENTRY_LENGTH) { dropped.push({ entry: e.slice(0, 40) + "...", reason: "path is too long" }); continue; }
    const segs = splitSegs(e);
    if (segs.length === 0) { dropped.push({ entry: e, reason: "path is empty" }); continue; }
    if (segs.includes("..")) { dropped.push({ entry: e, reason: "path contains .." }); continue; }
    if (/^[a-zA-Z]:$/.test(segs[0])) { dropped.push({ entry: e, reason: "path starts with a drive letter (use a vault-relative path)" }); continue; }
    paths.push(segs.map(normSeg));
  }
  const patterns = [];
  const rawPatterns = raw.patterns ?? [];
  if (rawPatterns.length > MAX_ENTRIES) dropped.push({ entry: `${rawPatterns.length - MAX_ENTRIES} entries`, reason: `patterns is over the ${MAX_ENTRIES}-entry limit` });
  for (const e of rawPatterns.slice(0, MAX_ENTRIES)) {
    if (typeof e !== "string") { dropped.push({ entry: typeof e, reason: "pattern is not text" }); continue; }
    if (e.length > MAX_PATTERN_LENGTH) { dropped.push({ entry: e.slice(0, 40) + "...", reason: "pattern is too long" }); continue; }
    const p = e.normalize("NFC").trim().toLowerCase();
    if (!p) { dropped.push({ entry: e, reason: "pattern is empty" }); continue; }
    if (/[\\/]/.test(p)) { dropped.push({ entry: e, reason: "pattern contains a slash (patterns match one name; use paths for folders)" }); continue; }
    if (!/[^*]/.test(p)) { dropped.push({ entry: e, reason: "pattern would match everything" }); continue; }
    patterns.push(p.replace(/\*+/g, "*"));
  }
  return { config: { paths, patterns, failClosed: false, ignored: dropped.length }, dropped };
}

const statusOf = (config, extra = {}) => ({ state: config.failClosed ? "invalid-fail-closed" : "ok", ignoredEntries: config.ignored, ...extra });

function loadEntry(root) {
  const file = join(root, ...PRIVATE_CONFIG_FILE);
  let st;
  try { st = statSync(file); } catch {
    const c = configCache.get(root);
    if (c?.key === "missing") return c;
    const e = { key: "missing", config: EMPTY_CONFIG, lastGood: EMPTY_CONFIG, status: { state: "none", ignoredEntries: 0 } };
    configCache.set(root, e);
    return e;
  }
  const key = `${st.mtimeMs}:${st.ctimeMs}:${st.size}:${st.ino}`;
  const cached = configCache.get(root);
  if (cached?.key === key) return cached;
  const prev = cached?.lastGood ?? EMPTY_CONFIG;
  let entry;
  try {
    if (st.size > MAX_CONFIG_BYTES) throw new Error("file is over 256 KB");
    const { config, dropped } = parseConfig(readFileSync(file, "utf8").replace(/^﻿/, ""));
    entry = { key, config, lastGood: config, status: statusOf(config) };
    dropped.slice(0, MAX_IGNORED_EVENTS).forEach((d) => auditLog("private.config-entry-ignored", { file: PRIVATE_CONFIG_FILE.join("/"), entry: String(d.entry).slice(0, 80), reason: d.reason }));
    if (dropped.length > MAX_IGNORED_EVENTS) auditLog("private.config-entry-ignored", { file: PRIVATE_CONFIG_FILE.join("/"), entry: `${dropped.length - MAX_IGNORED_EVENTS} more`, reason: "further ignored entries not listed" });
  } catch (e) {
    // The file exists but cannot be used. With an earlier good list that list stays in force; with none, staff are
    // denied every path (fail closed) until the owner fixes the file, because we cannot know what it meant to hide.
    const kept = prev !== EMPTY_CONFIG;
    const config = kept ? prev : FAIL_CLOSED;
    const error = String(e?.message ?? e).slice(0, 200);
    entry = { key, config, lastGood: prev, status: { state: kept ? "invalid-kept-previous" : "invalid-fail-closed", ignoredEntries: config.ignored, error } };
    auditLog("private.config-invalid", { file: PRIVATE_CONFIG_FILE.join("/"), error, keptPreviousList: kept, failClosed: !kept });
  }
  configCache.set(root, entry);
  return entry;
}

function loadConfig(root) { return loadEntry(root).config; }

// For the Users page: whether the owner's list is working, and how many of its entries were ignored.
export function privateListStatus(vaultPath) {
  const root = real(vaultPath);
  const e = loadEntry(root);
  return { ...e.status, file: PRIVATE_CONFIG_FILE.join("/"), staffBlocked: e.config.failClosed };
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

const fmCache = new Map(); // real file -> { key, value }   (insertion order = least recently used first)

function frontMatterPrivate(abs) {
  if (!NOTE_EXT.test(abs)) return false;
  let st;
  try { st = statSync(abs); } catch { return false; }
  if (!st.isFile()) return false;
  const key = `${st.mtimeMs}:${st.ctimeMs}:${st.size}:${st.ino}`;
  const hit = fmCache.get(abs);
  if (hit && hit.key === key) { fmCache.delete(abs); fmCache.set(abs, hit); return hit.value; }
  let value = true; // unreadable = not shown
  let fd;
  try {
    fd = openSync(abs, "r");
    const buf = Buffer.alloc(Math.min(FM_SCAN_BYTES, st.size));
    const n = readSync(fd, buf, 0, buf.length, 0);
    value = textFrontMatterPrivate(buf.subarray(0, n).toString("utf8"));
  } catch { value = true; } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* ignore */ } }
  if (fmCache.size >= FM_CACHE_MAX) { let k = 0; for (const old of fmCache.keys()) { fmCache.delete(old); if (++k >= FM_CACHE_EVICT) break; } }
  fmCache.set(abs, { key, value });
  return value;
}

// true when the note's front matter marks it private. An opening fence with no closing fence inside the scanned
// window counts as private (we cannot tell where the metadata ends, so we do not show the note).
export function textFrontMatterPrivate(text) {
  const m = /^﻿?\s*---[ \t]*\r?\n/.exec(text);
  if (!m) return false;
  const rest = text.slice(m[0].length);
  const end = /^(?:---|\.\.\.)[ \t]*\r?$/m.exec(rest);
  if (!end) return true;
  for (const line of rest.slice(0, end.index).split(/\r?\n/)) {
    const k = /^\s*(["']?)private\1\s*:\s*(.*)$/i.exec(line);
    if (!k) continue;
    const v = k[2].replace(/\s+#.*$/, "").trim().replace(/^(["'])(.*)\1$/, "$2").trim().toLowerCase();
    if (TRUTHY.has(v)) return true;
  }
  return false;
}

// ---- the scope: one object per request or walk ----------------------------------------------------------

function relSegs(root, abs) {
  if (!insideOf(root, abs)) return null;
  return splitSegs(relative(root, abs));
}

function segsPrivate(config, segs) {
  if (segs.some((s) => normSeg(s) === "private")) return true;
  if (segs.length > 0 && normSeg(segs[0]) === "chats") return true; // other people's chat transcripts
  const cfgFile = PRIVATE_CONFIG_FILE.map((x) => x.toLowerCase());
  if (segs.length === cfgFile.length && segs.every((x, i) => normSeg(x) === cfgFile[i])) return true;
  return listedPrivate(config, segs);
}

// Resolves the vault root, the user's folder grants and the owner's list ONCE; every question after that is cheap.
// Make one per request (or per tree/search/index walk) so changes to the list are picked up on the next request.
export function createScope(vaultPath, user) {
  const root = real(vaultPath);
  const lexRoot = resolve(vaultPath);
  const config = loadConfig(root);
  const owner = user?.role === "owner";
  const dirReal = new Map();

  // realpath of a candidate. Plain files and folders cost one lstat, parents are resolved once and remembered;
  // anything that might not be what its name says (a link, a Windows ~ short name, a missing parent) takes the full route.
  function realOf(p) {
    const abs = resolve(p);
    const parent = dirname(abs);
    const base = basename(abs);
    if (parent === abs || base.includes("~")) return realDeep(abs);
    let rp = dirReal.get(parent);
    if (rp === undefined) { rp = realNative(parent); dirReal.set(parent, rp); }
    if (rp === null) return realDeep(abs);
    try { if (lstatSync(abs).isSymbolicLink()) return realDeep(abs); } catch { /* not there yet: judged by its parent */ }
    return join(rp, base);
  }

  function isPrivate(lexAbs, realAbs) {
    if (config.failClosed) return true;
    const views = [];
    const l1 = relSegs(lexRoot, lexAbs); if (l1) views.push(l1);
    const l2 = relSegs(root, lexAbs); if (l2) views.push(l2);
    const r = relSegs(root, realAbs); if (r) views.push(r);
    if (views.length === 0) return false;
    if (views.some((s) => segsPrivate(config, s))) return true;
    return r !== null && frontMatterPrivate(realAbs);
  }

  let roots = null;
  function grants() {
    if (roots) return roots;
    if (owner) return (roots = [root]);
    roots = [];
    if (config.failClosed) return roots;
    const wanted = [...(user?.switches?.folders ?? [])];
    if (user?.switches?.teamFolder) wanted.push(user.switches.teamFolder);
    for (const f of wanted) {
      const lex = resolve(root, f);
      const abs = real(lex);
      if (!insideOf(root, abs)) continue;
      if (isPrivate(lex, abs)) continue;
      if (isDir(abs) && !roots.includes(abs)) roots.push(abs);
    }
    return roots;
  }

  function allowed(candidatePath) {
    const lex = resolve(candidatePath);
    const abs = realOf(lex);
    if (!insideOf(root, abs)) return false;
    const segments = relative(root, abs).split(sep).filter(Boolean);
    if (segments.some((s) => HIDDEN_DIRS.includes(s))) return false;
    if (owner) return true;
    if (!grants().some((r) => insideOf(r, abs))) return false; // the cheap test first
    return !isPrivate(lex, abs); // deny wins over every folder grant
  }

  return { root, roots: grants, allowed, isPrivate: (p) => { const lex = resolve(p); return isPrivate(lex, realOf(lex)); }, failClosed: config.failClosed };
}

// True when the file or folder is private under the rules above. Role-blind: callers decide who it applies to.
export function isPrivatePath(vaultPath, absPath) {
  return createScope(vaultPath, { role: "staff", switches: {} }).isPrivate(absPath);
}

// Name-only version for stores that live outside the vault (e.g. the business-assets folder): rules (a) and (c)
// against a path relative to that store's root. No file system access beyond the owner list of `vaultPath`.
export function isPrivateRelPath(vaultPath, relPath) {
  const config = loadConfig(real(vaultPath));
  if (config.failClosed) return true;
  const segs = splitSegs(relPath);
  if (segs.some((s) => s === "..")) return true;
  return segs.some((s) => normSeg(s) === "private") || listedPrivate(config, segs);
}

export function allowedRoots(vaultPath, user) { return createScope(vaultPath, user).roots(); }

export function isPathAllowed(vaultPath, user, candidatePath) { return createScope(vaultPath, user).allowed(candidatePath); }

export function toVaultRelative(vaultPath, absPath) {
  return relative(real(vaultPath), real(absPath)).split(sep).join("/");
}
