import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonStore } from "../src/lib/store.js";

test("JsonStore returns defaults when file missing and creates parent dir on save", () => {
  const dir = mkdtempSync(join(tmpdir(), "sod-"));
  const store = new JsonStore(join(dir, "nested", "x.json"), { items: [] });
  assert.deepEqual(store.load(), { items: [] });
  store.save({ items: [1] });
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "nested", "x.json"), "utf8")), { items: [1] });
  assert.equal(existsSync(join(dir, "nested", "x.json.tmp")), false, "tmp file removed after rename");
  rmSync(dir, { recursive: true, force: true });
});

test("JsonStore returns a fresh copy of defaults, not the shared object", () => {
  const dir = mkdtempSync(join(tmpdir(), "sod-"));
  const store = new JsonStore(join(dir, "x.json"), { items: [] });
  store.load().items.push("mutated");
  assert.deepEqual(store.load(), { items: [] });
  rmSync(dir, { recursive: true, force: true });
});
