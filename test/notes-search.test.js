import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LinkIndex } from "../src/notes/index.js";
import { searchNotes } from "../src/notes/search.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "vault");
const owner = { role: "owner", switches: { folders: [], teamFolder: null } };
const staff = { role: "staff", switches: { folders: ["Projects"], teamFolder: null } };
const idx = new LinkIndex(FIX); idx.build();

test("title match outranks body match and returns a snippet", () => {
  const r = searchNotes(FIX, owner, idx, "pricing", {});
  assert.equal(r[0].path, "Resources/Pricing Sheet.md");
  assert.ok(r[0].score >= 60);
  const kitchen = searchNotes(FIX, owner, idx, "quartz", {});
  assert.equal(kitchen[0].path, "Resources/Pricing Sheet.md");
  assert.match(kitchen[0].snippet, /Quartz/);
});

test("search respects scope", () => {
  const r = searchNotes(FIX, staff, idx, "Big Box", {});
  assert.equal(r.length, 0);
  const r2 = searchNotes(FIX, staff, idx, "kitchen", {});
  assert.ok(r2.every((x) => x.path.startsWith("Projects/")));
});

test("tag query matches literal tag", () => {
  const r = searchNotes(FIX, owner, idx, "#kitchen", {});
  assert.equal(r[0].path, "Projects/Acme Kitchen.md");
});
