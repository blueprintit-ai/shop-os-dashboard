import { readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { HIDDEN_DIRS, createScope, toVaultRelative } from "../scope.js";

function children(scope, owner, dir, dirRel, dirSegs) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch {}
  // Staff never get an entry they cannot open: private files and folders are not listed and their names are not revealed.
  const nodes = [];
  for (const e of entries) {
    if (HIDDEN_DIRS.includes(e.name)) continue;
    const c = owner ? { ok: true, segs: [] } : scope.child(dir, e, dirSegs);
    if (!c.ok) continue;
    const abs = join(dir, e.name);
    const path = dirRel ? `${dirRel}/${e.name}` : e.name;
    const node = { name: e.name, path, type: e.isDirectory() ? "dir" : "file" };
    if (node.type === "dir") node.children = children(scope, owner, abs, path, c.segs);
    nodes.push(node);
  }
  return nodes.sort((a, b) => (a.type !== b.type ? (a.type === "dir" ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: "base" })));
}

export function buildTree(vaultPath, user) {
  const scope = createScope(vaultPath, user);
  const owner = user.role === "owner";
  if (owner) return children(scope, true, vaultPath, "", []);
  return scope.roots().map((r) => { const rel = toVaultRelative(vaultPath, r); return { name: basename(r), path: rel, type: "dir", children: children(scope, false, r, rel, scope.segsOf(r)) }; })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
