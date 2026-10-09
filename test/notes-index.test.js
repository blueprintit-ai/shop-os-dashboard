import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
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

// The debounce/rescan path is tested with an injected watcher and mocked timers: real fs.watch events on macOS
// arrive late or coalesced under parallel load, so no wall-clock wait can make a real-fs assertion reliable.
function fakeWatch() {
  const w = new EventEmitter();
  w.closed = false; w.close = () => { w.closed = true; };
  const impl = (path, opts, cb) => { w.args = { path, opts }; w.fire = cb; return w; };
  return { w, impl };
}

function tmpVault() {
  const dir = mkdtempSync(join(tmpdir(), "sod-idx-"));
  cpSync(FIX, dir, { recursive: true });
  return dir;
}

test("watch: a change event rebuilds the index once, after the debounce and not before", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const dir = tmpVault();
  const idx = new LinkIndex(dir);
  const { w, impl } = fakeWatch();
  try {
    idx.build();
    let changes = 0;
    idx.watch(() => changes++, { watchImpl: impl });
    assert.equal(w.args.path, dir);
    assert.equal(w.args.opts.recursive, true);
    writeFileSync(join(dir, "Projects", "New Job.md"), "# New Job\n\nLinks [[Pricing Sheet]].");
    w.fire();
    t.mock.timers.tick(749);
    assert.equal(idx.resolve("New Job"), null, "not rebuilt before the debounce");
    assert.equal(changes, 0);
    t.mock.timers.tick(1);
    assert.equal(idx.resolve("New Job"), "Projects/New Job.md");
    assert.equal(changes, 1);
    assert.ok(idx.backlinks("Resources/Pricing Sheet.md").includes("Projects/New Job.md"));
  } finally { idx.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("watch: a burst of events restarts the debounce and rebuilds once", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const dir = tmpVault();
  const idx = new LinkIndex(dir);
  const { w, impl } = fakeWatch();
  try {
    idx.build();
    let changes = 0;
    idx.watch(() => changes++, { watchImpl: impl, debounceMs: 100 });
    writeFileSync(join(dir, "Projects", "A.md"), "# A");
    w.fire(); t.mock.timers.tick(80);
    w.fire(); t.mock.timers.tick(80);
    w.fire(); t.mock.timers.tick(99);
    assert.equal(changes, 0, "each event pushed the rebuild back");
    t.mock.timers.tick(1);
    assert.equal(changes, 1);
    assert.equal(idx.resolve("A"), "Projects/A.md");
    t.mock.timers.tick(1000);
    assert.equal(changes, 1, "nothing pending afterwards");
  } finally { idx.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("close: stops the watcher and cancels a pending rebuild", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const dir = tmpVault();
  const idx = new LinkIndex(dir);
  const { w, impl } = fakeWatch();
  try {
    idx.build();
    let changes = 0;
    idx.watch(() => changes++, { watchImpl: impl });
    writeFileSync(join(dir, "Projects", "Late.md"), "# Late");
    w.fire();
    idx.close();
    assert.equal(w.closed, true);
    t.mock.timers.tick(5000);
    assert.equal(changes, 0);
    assert.equal(idx.resolve("Late"), null);
  } finally { idx.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("watch: a watcher that cannot start is reported, not thrown", () => {
  const idx = new LinkIndex(FIX);
  const orig = console.error; const msgs = [];
  console.error = (...a) => msgs.push(a.join(" "));
  try { idx.watch(undefined, { watchImpl: () => { throw new Error("no inotify"); } }); } finally { console.error = orig; }
  assert.match(msgs.join(), /watch unavailable.*no inotify/);
});

test("watch: the real fs watcher starts and closes cleanly (events themselves are not asserted: platform timing)", () => {
  const dir = tmpVault();
  const idx = new LinkIndex(dir);
  try { idx.build(); idx.watch(); assert.ok(idx.watcher); idx.close(); assert.equal(idx.watcher, null); }
  finally { idx.close(); rmSync(dir, { recursive: true, force: true }); }
});
