import { readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { HIDDEN_DIRS, allowedRoots, toVaultRelative } from "../scope.js";

function children(vaultPath, dir) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch {}
  const nodes = entries.filter((e) => !HIDDEN_DIRS.includes(e.name)).map((e) => {
    const abs = join(dir, e.name);
    const node = { name: e.name, path: toVaultRelative(vaultPath, abs), type: e.isDirectory() ? "dir" : "file" };
    if (node.type === "dir") node.children = children(vaultPath, abs);
    return node;
  });
  return nodes.sort((a, b) => (a.type !== b.type ? (a.type === "dir" ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: "base" })));
}

export function buildTree(vaultPath, user) {
  const roots = allowedRoots(vaultPath, user);
  if (user.role === "owner") return children(vaultPath, vaultPath);
  return roots.map((r) => ({ name: basename(r), path: toVaultRelative(vaultPath, r), type: "dir", children: children(vaultPath, r) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
