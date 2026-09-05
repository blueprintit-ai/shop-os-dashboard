import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTree } from "../src/notes/tree.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "vault");
const owner = { role: "owner", switches: { folders: [], teamFolder: null } };
const staff = { role: "staff", switches: { folders: ["Projects", "Resources"], teamFolder: null } };

test("owner tree shows all visible top-level entries, hidden dirs excluded, dirs first", () => {
  const tree = buildTree(FIX, owner);
  const names = tree.map((n) => n.name);
  assert.ok(names.includes("Context") && names.includes("Projects") && names.includes("CLAUDE.md"));
  assert.ok(!names.includes(".obsidian") && !names.includes(".claude"));
  const firstFileIdx = tree.findIndex((n) => n.type === "file");
  assert.ok(tree.slice(firstFileIdx).every((n) => n.type === "file"), "folders sort before files");
});

test("staff tree is limited to allowed roots and nests children", () => {
  const tree = buildTree(FIX, staff);
  assert.deepEqual(tree.map((n) => n.name), ["Projects", "Resources"]);
  const proj = tree[0];
  assert.equal(proj.type, "dir");
  assert.ok(proj.children.some((c) => c.path === "Projects/Acme Kitchen.md"));
});
