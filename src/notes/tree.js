import { readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { HIDDEN_DIRS, allowedRoots, toVaultRelative, isPathAllowed } from "../scope.js";

function children(vaultPath, dir, user) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch {}
  // Staff never get an entry they cannot open: private files and folders are not listed and their names are not revealed.
  const visible = (e) => !HIDDEN_DIRS.includes(e.name) && (user.role === "owner" || isPathAllowed(vaultPath, user, join(dir, e.name)));
  const nodes = entries.filter(visible).map((e) => {
    const abs = join(dir, e.name);
    const node = { name: e.name, path: toVaultRelative(vaultPath, abs), type: e.isDirectory() ? "dir" : "file" };
    if (node.type === "dir") node.children = children(vaultPath, abs, user);
    return node;
  });
  return nodes.sort((a, b) => (a.type !== b.type ? (a.type === "dir" ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: "base" })));
}

export function buildTree(vaultPath, user) {
  const roots = allowedRoots(vaultPath, user);
  if (user.role === "owner") return children(vaultPath, vaultPath, user);
  return roots.map((r) => ({ name: basename(r), path: toVaultRelative(vaultPath, r), type: "dir", children: children(vaultPath, r, user) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
