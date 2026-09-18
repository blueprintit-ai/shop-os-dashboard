import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { allowedRoots, isPathAllowed, toVaultRelative, HIDDEN_DIRS } from "../src/scope.js";

const VAULT = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "vault");
const owner = { role: "owner", switches: { folders: [], teamFolder: null } };
const staff = { role: "staff", switches: { folders: ["Projects", "Resources", "Processes"], teamFolder: "Team/acme/Profiles/marco" } };

test("owner sees the whole vault", () => {
  assert.deepEqual(allowedRoots(VAULT, owner), [VAULT]);
  assert.equal(isPathAllowed(VAULT, owner, join(VAULT, "Intelligence", "competitors", "Big Box.md")), true);
});

test("staff sees only switched folders and their team folder", () => {
  const roots = allowedRoots(VAULT, staff);
  assert.equal(roots.length, 4);
  assert.equal(isPathAllowed(VAULT, staff, join(VAULT, "Projects", "Acme Kitchen.md")), true);
  assert.equal(isPathAllowed(VAULT, staff, join(VAULT, "Team", "acme", "Profiles", "marco", "Marco.md")), true);
  assert.equal(isPathAllowed(VAULT, staff, join(VAULT, "Intelligence", "competitors", "Big Box.md")), false);
  assert.equal(isPathAllowed(VAULT, staff, join(VAULT, "Context", "organization.md")), false);
  assert.equal(isPathAllowed(VAULT, staff, join(VAULT, "Daily", "2026-09-04.md")), false);
});

test("traversal and hidden dirs are refused for everyone", () => {
  assert.equal(isPathAllowed(VAULT, staff, join(VAULT, "Projects", "..", "Context", "operator.md")), false);
  assert.equal(isPathAllowed(VAULT, owner, join(VAULT, "..", "..", "etc", "passwd")), false);
  assert.equal(isPathAllowed(VAULT, owner, join(VAULT, ".obsidian", "app.json")), false);
  assert.equal(isPathAllowed(VAULT, owner, join(VAULT, ".claude", "settings.json")), false);
  assert.ok(HIDDEN_DIRS.includes(".obsidian"));
});

test("switched folder that does not exist is ignored, not an error", () => {
  const u = { role: "staff", switches: { folders: ["Projects", "Nope"], teamFolder: null } };
  assert.deepEqual(allowedRoots(VAULT, u), [join(VAULT, "Projects")]);
});

test("toVaultRelative uses forward slashes", () => {
  assert.equal(toVaultRelative(VAULT, join(VAULT, "Projects", "Acme Kitchen.md")), "Projects/Acme Kitchen.md");
});
