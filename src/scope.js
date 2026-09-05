import { existsSync, realpathSync, statSync } from "node:fs";
import { resolve, relative, sep, isAbsolute } from "node:path";

export const HIDDEN_DIRS = Object.freeze([".claude", ".obsidian", ".git", ".shopos", "node_modules", ".trash"]);

function real(p) {
  try { return realpathSync(p); } catch { return resolve(p); }
}

function isDir(p) { try { return statSync(p).isDirectory(); } catch { return false; } }

export function allowedRoots(vaultPath, user) {
  const root = real(vaultPath);
  if (user.role === "owner") return [root];
  const out = [];
  const wanted = [...(user.switches?.folders ?? [])];
  if (user.switches?.teamFolder) wanted.push(user.switches.teamFolder);
  for (const f of wanted) {
    const abs = real(resolve(root, f));
    if (!insideOf(root, abs)) continue;
    if (isDir(abs) && !out.includes(abs)) out.push(abs);
  }
  return out;
}

function insideOf(root, abs) {
  const rel = relative(root, abs);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function isPathAllowed(vaultPath, user, candidatePath) {
  const root = real(vaultPath);
  const abs = real(resolve(candidatePath));
  if (!insideOf(root, abs)) return false;
  const segments = relative(root, abs).split(sep).filter(Boolean);
  if (segments.some((s) => HIDDEN_DIRS.includes(s))) return false;
  return allowedRoots(vaultPath, user).some((r) => insideOf(r, abs));
}

export function toVaultRelative(vaultPath, absPath) {
  return relative(real(vaultPath), real(absPath)).split(sep).join("/");
}
