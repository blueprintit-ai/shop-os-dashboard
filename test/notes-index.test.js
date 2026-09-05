import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { LinkIndex } from "../src/notes/index.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "vault");

test("build resolves basenames and computes backlinks", () => {
  const idx = new LinkIndex(FIX);
  idx.build();
  assert.equal(idx.resolve("Pricing Sheet"), "Resources/Pricing Sheet.md");
  assert.equal(idx.resolve("pricing sheet"), "Resources/Pricing Sheet.md");
  assert.equal(idx.resolve("layout.png"), "Projects/layout.png");
  assert.equal(idx.resolve("Nowhere"), null);
  assert.deepEqual(idx.backlinks("Context/organization.md").sort(), ["Daily/2026-09-04.md", "Projects/Acme Kitchen.md"]);
  assert.ok(idx.notes().some((n) => n.path === "Projects/Acme Kitchen.md" && n.title === "Acme Kitchen"));
  assert.ok(!idx.notes().some((n) => n.path.startsWith(".obsidian")), "hidden dirs are not indexed");
});

test("watch picks up a new note within the debounce window", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sod-idx-"));
  cpSync(FIX, dir, { recursive: true });
  const idx = new LinkIndex(dir);
  idx.build();
  let changes = 0;
  idx.watch(() => changes++);
  writeFileSync(join(dir, "Projects", "New Job.md"), "# New Job\n\nLinks [[Pricing Sheet]].");
  await sleep(1500);
  assert.equal(idx.resolve("New Job"), "Projects/New Job.md");
  assert.ok(changes >= 1);
  idx.close();
  rmSync(dir, { recursive: true, force: true });
});
