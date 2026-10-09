// Parity between the owner page the product serves and the RoboNuggets kit page
// it is synced from (tools/sync-kit.mjs). Two jobs:
//   1. the committed public/owner.html (+ widgets, assets, orbs lib) equals what a fresh sync of the kit produces
//   2. that output differs from the raw kit ONLY inside the rules' anchored regions
// The kit folder lives on the owner's machine, so the suite skips (with a message) when it is absent, e.g. in CI.
// Set KIT_DIR to the kit folder to run them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { syncKit, RULES, LOCK_FILE, changedInputs } from "../tools/sync-kit.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KIT = process.env.KIT_DIR || "";
const kitMissing = KIT && existsSync(join(KIT, "dashboard.html")) ? false : "KIT_DIR is not set (or has no dashboard.html): skipping the byte-for-byte parity check; test/kit-lock.test.js still guards the committed files";

test("committed owner/widgets/assets pages and orbs lib equal a fresh sync of the kit", { skip: kitMissing }, () => {
  const { outputs } = syncKit(KIT);
  assert.deepEqual([...outputs.keys()].sort(), ["public/assets.html", "public/owner.html", "public/vendor/thinking-orbs.js", "public/widgets.html"]);
  for (const [rel, want] of outputs) {
    const got = readFileSync(join(ROOT, rel));
    assert.ok(Buffer.compare(got, want) === 0, `${rel} is out of sync with the kit: run node tools/sync-kit.mjs`);
  }
});

test("output differs from the raw kit only inside the rules' anchored regions", { skip: kitMissing }, () => {
  const { outputs, applied, raw } = syncKit(KIT);
  for (const [rel, rawBuf] of raw) {
    // Undo every rule's replacement (last first); what is left must be the raw kit file, byte for byte.
    let text = outputs.get(rel).toString("utf8");
    for (const a of applied.filter((x) => x.dest === rel).reverse()) {
      assert.equal(text.split(a.after).length - 1, 1, `${a.rule}: replacement text must appear exactly once in ${rel}`);
      text = text.replace(a.after, () => a.before);
    }
    assert.equal(text, rawBuf.toString("utf8"), `${rel}: changes outside the declared rules`);
  }
  // every rule fired exactly once on its file
  for (const r of RULES) assert.equal(applied.filter((a) => a.rule === r.id).length, 1, `${r.id} applied once`);
});

test("the kit has not moved on since the lock was written", { skip: kitMissing }, () => {
  const { raw } = syncKit(KIT);
  const lock = JSON.parse(readFileSync(LOCK_FILE, "utf8"));
  assert.deepEqual(changedInputs(lock, raw), [], "kit changed, re-sync: node tools/sync-kit.mjs <kit-folder>");
});

test("the orbs library is a verbatim copy", { skip: kitMissing }, () => {
  const { outputs, raw } = syncKit(KIT);
  assert.ok(Buffer.compare(outputs.get("public/vendor/thinking-orbs.js"), raw.get("public/vendor/thinking-orbs.js")) === 0);
});

test("sync fails loudly when a rule's anchor has moved", () => {
  const dir = mkdtempSync(join(tmpdir(), "kit-"));
  try {
    mkdirSync(join(dir, "vendor"));
    writeFileSync(join(dir, "dashboard.html"), "<html><title>Something else</title></html>");
    writeFileSync(join(dir, "widgets.html"), "x");
    writeFileSync(join(dir, "assets.html"), "x");
    writeFileSync(join(dir, "vendor", "thinking-orbs.js"), "x");
    assert.throws(() => syncKit(dir), /anchor not found.*fonts-link-owner/s);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("no output reaches a font or script CDN", { skip: kitMissing }, () => {
  const { outputs } = syncKit(KIT);
  for (const [rel, buf] of outputs) {
    const t = buf.toString("utf8");
    assert.doesNotMatch(t, /fonts\.googleapis\.com|cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com/, rel);
  }
});
