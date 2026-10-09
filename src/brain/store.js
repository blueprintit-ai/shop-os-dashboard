import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildGraph, expandDir, search, scanVault, LIMITS } from "./scan.js";
import { LAYERS, mergeConfig } from "./defaults.js";
import { listSkills } from "./skills.js";
import { readApps } from "../apps.js";
import { readRoutines } from "../snapshots.js";

export const MIN_REFRESH_MS = 3000;   // a rescan sooner than this after the last one is refused
export const STALE_MS = 30 * 1000;    // GET /graph?fresh=1 rescans when the cached scan is older
export const MAX_HIDDEN = 2000;
export const MAX_EDITS = 500;
const MAX_ROUTINES = 60;
const BAKE_MAX_BYTES = 64 * 1024;

const brainDir = (vault) => join(vault, "Dashboard", "brain");
const plain = (s, max) => String(s ?? "").replace(/[<>"`\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJsonAtomic(file, value) {
  mkdirSync(join(file, ".."), { recursive: true });
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, file);
}

export class BrainStore {
  constructor(vaultPath, { limits = LIMITS, skillsFor = listSkills, now = () => Date.now() } = {}) {
    this.vaultPath = vaultPath; this.limits = limits; this.skillsFor = skillsFor; this.now = now;
    this.model = null; this.skills = []; this.dirty = true; this.lastRefresh = 0;
  }

  // Called by the notes index's file watcher: the next graph request rescans (still subject to MIN_REFRESH_MS).
  invalidate() { this.dirty = true; }

  config() {
    const merged = mergeConfig(readJson(join(brainDir(this.vaultPath), "departments.json"), null));
    return { ...merged, layers: LAYERS };
  }

  tweaks() {
    const raw = readJson(join(brainDir(this.vaultPath), "tweaks.json"), null);
    const hidden = Array.isArray(raw?.hidden) ? raw.hidden.filter((x) => typeof x === "string" && x.length <= 300).slice(0, MAX_HIDDEN) : [];
    const edits = {};
    if (raw?.edits && typeof raw.edits === "object" && !Array.isArray(raw.edits)) {
      for (const [id, e] of Object.entries(raw.edits).slice(0, MAX_EDITS)) {
        if (id.length > 300 || !e || typeof e !== "object") continue;
        const label = typeof e.label === "string" ? plain(e.label, 120) : "", desc = typeof e.desc === "string" ? plain(e.desc, 500) : undefined;
        edits[id] = { ...(label ? { label } : {}), ...(desc !== undefined ? { desc } : {}) };
      }
    }
    return { hidden, edits };
  }

  // Scans when there is no model yet, when the notes watcher marked it dirty (and the last scan is not brand new),
  // when the page asked for a fresh one and the cached scan is stale, or on an explicit rescan (refused, with
  // throttled: true, inside MIN_REFRESH_MS of the previous scan). Returns { refreshed, throttled }.
  ensure({ force = false, fresh = false } = {}) {
    const age = this.now() - this.lastRefresh;
    if (this.model && force && age < MIN_REFRESH_MS) return { refreshed: false, throttled: true };
    const wanted = !this.model || force || (this.dirty && age >= MIN_REFRESH_MS) || (fresh && age > STALE_MS);
    if (!wanted) return { refreshed: false, throttled: false };
    this.model = scanVault(this.vaultPath, this.model?.cache, this.limits);
    this.skills = this.skillsFor(this.vaultPath);
    this.dirty = false; this.lastRefresh = this.now();
    return { refreshed: true, throttled: false };
  }

  extras() {
    const feed = readRoutines(this.vaultPath);
    const routines = (Array.isArray(feed.routines) ? feed.routines : []).filter((r) => r && typeof r === "object" && typeof r.n === "string" && typeof r.d === "string" && typeof r.t === "string").slice(0, MAX_ROUTINES);
    const apps = readApps(this.vaultPath).filter((a) => a.id !== "sbRow" && !/^\/brain\b/.test(a.url));
    return { apps, routines, skills: this.skills, tweaks: this.tweaks() };
  }

  graph({ fresh = false } = {}) {
    this.ensure({ fresh });
    const cfg = this.config();
    const g = buildGraph(this.model, cfg, this.extras(), this.limits);
    const m = this.model;
    return {
      meta: {
        scannedAt: m.scannedAt, scanMs: m.scanMs, totalFiles: m.files.length, totalDirs: m.dirs.size,
        mdParsed: m.scanStats.mdParsed, mdRead: m.scanStats.read, mdCached: m.scanStats.cached,
        visibleNodes: g.nodes.length, mdLinks: m.mdLinks.length, hiddenCount: g.hiddenCount,
        truncated: m.truncated, skippedUnsafe: m.skippedUnsafe, hiddenFiles: g.capped.hiddenFiles, hiddenDirs: g.capped.hiddenDirs,
      },
      departments: cfg.departments, layers: cfg.layers, nodes: g.nodes, links: g.links, mdLinks: m.mdLinks,
    };
  }

  meta() { const g = this.graph(); return g.meta; }
  expand(rel) { this.ensure(); return expandDir(this.model, this.config(), rel, this.limits); }
  search(q) { this.ensure(); return search(this.model, this.config(), q, this.skills, this.limits.searchLimit); }
  skill(name) { this.ensure(); return this.skills.find((s) => s.name === name) ?? null; }

  rescan() { return this.ensure({ force: true }); }

  knownIds() {
    this.ensure();
    const ids = new Set(buildGraph(this.model, this.config(), { ...this.extras(), tweaks: { hidden: [], edits: {} } }, this.limits).nodes.map((n) => n.id));
    for (const f of this.model.files) ids.add(f.rel);
    for (const d of this.model.dirs.keys()) if (d) ids.add(d);
    return ids;
  }

  // action: hide{id} | unhide-all | edit{id,label,desc}. Returns { error } or { ok, hidden }.
  applyTweak(body) {
    const tw = this.tweaks();
    const a = body?.action;
    if (a === "unhide-all") tw.hidden = [];
    else if (a === "hide" || a === "edit") {
      const id = body.id;
      if (typeof id !== "string" || !id || id.length > 300) return { error: "bad id" };
      if (!this.knownIds().has(id)) return { error: "unknown item" };
      if (a === "hide") {
        if (!tw.hidden.includes(id)) { if (tw.hidden.length >= MAX_HIDDEN) return { error: "too many hidden items" }; tw.hidden.push(id); }
      } else {
        if (!tw.edits[id] && Object.keys(tw.edits).length >= MAX_EDITS) return { error: "too many edits" };
        const label = plain(body.label, 120);
        const e = {};
        if (label) e.label = label;
        if (typeof body.desc === "string") e.desc = plain(body.desc, 500);
        tw.edits[id] = e;
      }
    } else return { error: "bad action" };
    writeJsonAtomic(join(brainDir(this.vaultPath), "tweaks.json"), tw);
    return { ok: true, hidden: tw.hidden.length };
  }

  // Bake = the page's "Bake settings" snapshot, kept in the vault so it can be restored or handed to support.
  // Only a fixed set of top-level keys, primitives and small plain objects survive; anything else is dropped.
  saveBake(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "bad body" };
    const clean = {};
    if (typeof body.skin === "string" && /^[a-z0-9-]{1,40}$/.test(body.skin)) clean.skin = body.skin;
    if (body.theme === "dark" || body.theme === "light") clean.theme = body.theme;
    for (const k of ["settings", "colors", "overridesOnly"]) {
      if (body[k] !== undefined) { const v = sanitizeValue(body[k], 0, { n: 0 }); if (v !== undefined) clean[k] = v; }
    }
    const text = JSON.stringify(clean, null, 2);
    if (Buffer.byteLength(text) > BAKE_MAX_BYTES) return { error: "settings too large" };
    writeJsonAtomic(join(brainDir(this.vaultPath), "bake.json"), clean);
    return { ok: true, path: "Dashboard/brain/bake.json" };
  }
}

const KEY_RE = /^[A-Za-z0-9_:.-]{1,60}$/;
// Keeps booleans, finite numbers, short plain strings, and plain objects/arrays of those (depth 3, 400 values in all).
function sanitizeValue(v, depth, budget) {
  if (++budget.n > 400) return undefined;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") return /[<>`\u0000-\u001f]/.test(v) || v.length > 120 ? undefined : v;
  if (v === null) return null;
  if (depth >= 3) return undefined;
  if (Array.isArray(v)) return v.slice(0, 40).map((x) => sanitizeValue(x, depth + 1, budget)).filter((x) => x !== undefined);
  if (typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (!KEY_RE.test(k) || k === "__proto__" || k === "constructor" || k === "prototype") continue;
      const s = sanitizeValue(x, depth + 1, budget);
      if (s !== undefined) out[k] = s;
    }
    return out;
  }
  return undefined;
}
