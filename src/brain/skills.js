import { readdirSync, readFileSync, openSync, readSync, closeSync, lstatSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { homedir } from "node:os";
import { SKILLS } from "../runs.js";

// Where the Second Brain's Skills ring comes from. Order = priority when two sources name the same skill:
//   1. the vault's own skills        <vault>/Skills/<name>/SKILL.md and <vault>/.claude/skills/<name>/SKILL.md
//   2. user-level skills             <claude home>/skills/<name>/SKILL.md
//   3. installed plugins (user scope) <installPath>/skills/<name>/SKILL.md, installPaths from <claude home>/plugins/installed_plugins.json
//   4. the product's own run list    src/runs.js SKILLS (so the Digest / Briefing / Optimizer skills always appear)
// Only names and the first lines of each SKILL.md are read here; the viewer reads one file on demand.
export const MAX_SKILLS = 200;
const HEAD_BYTES = 4096;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function claudeHome() { return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"); }

function head(abs) {
  let fd;
  try {
    fd = openSync(abs, "r");
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = readSync(fd, buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, n).toString("utf8");
  } catch { return null; } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* ignore */ } }
}

function describe(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const front = m ? m[1] : "";
  const d = /^description:\s*(.*)$/m.exec(front);
  let desc = d ? d[1].trim().replace(/^["']|["']$/g, "") : "";
  desc = desc.replace(/[<>"`\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  return desc.length > 240 ? desc.slice(0, 237) + "..." : desc;
}

const realOrNull = (p) => { try { return realpathSync.native(p); } catch { return null; } };
export const insideDir = (rootReal, p) => { const r = realOrNull(p); return !!(r && rootReal && (r === rootReal || r.startsWith(rootReal + sep))); };

// `dir` is a skills folder; every SKILL.md must be a regular file (not a link or junction) whose real path stays inside it.
// `within` = the real path the folder must stay inside (the vault for vault sources, the Claude home for the rest).
function fromDir(dir, source, out, seen, within) {
  try { if (lstatSync(dir).isSymbolicLink()) return; } catch { return; } // a linked or junctioned skills folder is refused
  const rootReal = realOrNull(dir);
  if (!rootReal || !insideDir(realOrNull(within), rootReal)) return;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  entries.sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const e of entries) {
    if (out.length >= MAX_SKILLS) return;
    if (!e.isDirectory() || !SAFE_NAME.test(e.name) || seen.has(e.name)) continue;
    const file = join(dir, e.name, "SKILL.md");
    let st;
    try { st = lstatSync(file); } catch { continue; }
    if (!st.isFile() || st.isSymbolicLink() || !insideDir(rootReal, file)) continue;
    const text = head(file);
    if (text === null) continue;
    seen.add(e.name);
    out.push({ name: e.name, desc: describe(text), file, root: rootReal, source, size: st.size, mtime: st.mtimeMs });
  }
}

// installPath values come from a JSON file: only those that really live under <claude home>/plugins are used.
export function installedPluginPaths(home) {
  try {
    const j = JSON.parse(readFileSync(join(home, "plugins", "installed_plugins.json"), "utf8"));
    const pluginsReal = realOrNull(join(home, "plugins"));
    const out = [];
    for (const list of Object.values(j.plugins ?? {})) {
      for (const inst of Array.isArray(list) ? list : []) if (inst && typeof inst.installPath === "string" && insideDir(pluginsReal, inst.installPath)) out.push(inst.installPath);
    }
    return out;
  } catch { return []; }
}

export function listSkills(vaultPath, { home = claudeHome(), productSkills = SKILLS } = {}) {
  const out = [], seen = new Set();
  fromDir(join(vaultPath, "Skills"), "vault", out, seen, vaultPath);
  fromDir(join(vaultPath, ".claude", "skills"), "vault", out, seen, vaultPath);
  fromDir(join(home, "skills"), "user", out, seen, home);
  for (const p of installedPluginPaths(home)) fromDir(join(p, "skills"), "plugin", out, seen, home);
  for (const s of productSkills) {
    if (out.length >= MAX_SKILLS) break;
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push({ name: s.id, desc: s.label ?? "", file: null, source: "product", size: 0, mtime: 0 });
  }
  return out;
}
