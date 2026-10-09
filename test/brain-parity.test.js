// Parity between the Second Brain page the product serves (/brain) and the kit it is synced from
// (tools/sync-brain.mjs). Needs the kit folder (BRAIN_KIT_DIR, the second-brain kit root that holds public/index.html);
// skipped with a message when it is absent, e.g. in CI. test/brain-lock.test.js still guards the committed files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { syncBrain, RULES, FILES, LOCK_FILE, changedInputs } from "../tools/sync-brain.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KIT = process.env.BRAIN_KIT_DIR || "";
const kitMissing = KIT && existsSync(join(KIT, "public", "index.html")) ? false : "BRAIN_KIT_DIR is not set (or has no public/index.html): skipping the byte-for-byte parity check; test/brain-lock.test.js still guards the committed files";

test("committed brain files equal a fresh sync of the kit", { skip: kitMissing }, () => {
  const { outputs } = syncBrain(KIT);
  assert.deepEqual([...outputs.keys()].sort(), FILES.map((f) => f.dest).sort());
  for (const [rel, want] of outputs) {
    assert.ok(Buffer.compare(readFileSync(join(ROOT, rel)), want) === 0, `${rel} is out of sync with the kit: run node tools/sync-brain.mjs`);
  }
});

test("output differs from the raw kit only inside the rules' anchored regions", { skip: kitMissing }, () => {
  const { outputs, applied, norm } = syncBrain(KIT);
  for (const [rel, want] of norm) {
    // Undo every rule's replacement (last first); what is left must be the kit file (LF-normalized), byte for byte.
    let text = outputs.get(rel).toString("utf8");
    for (const a of applied.filter((x) => x.dest === rel).reverse()) {
      assert.equal(text.split(a.after).length - 1, 1, `${a.rule}: replacement text must appear exactly once in ${rel}`);
      text = text.replace(a.after, () => a.before);
    }
    assert.equal(text, want, `${rel}: changes outside the declared rules`);
  }
  for (const r of RULES) assert.equal(applied.filter((a) => a.rule === r.id).length, 1, `${r.id} applied once`);
});

test("the kit has not moved on since the lock was written", { skip: kitMissing }, () => {
  const { raw } = syncBrain(KIT);
  const lock = JSON.parse(readFileSync(LOCK_FILE, "utf8"));
  assert.deepEqual(changedInputs(lock, raw), [], "kit changed, re-sync: node tools/sync-brain.mjs <kit-folder>");
});

test("the flows and css files are verbatim copies (no rule touches them)", { skip: kitMissing }, () => {
  const { outputs, norm } = syncBrain(KIT);
  for (const dest of ["public/brain/_flows2.js", "public/brain/_core.css"]) assert.equal(outputs.get(dest).toString("utf8"), norm.get(dest), dest);
});

test("sync fails loudly when a rule's anchor has moved", () => {
  const dir = mkdtempSync(join(tmpdir(), "brain-kit-"));
  try {
    mkdirSync(join(dir, "public"));
    writeFileSync(join(dir, "public", "index.html"), "<html><title>Something else</title></html>");
    for (const f of ["_core.js", "_core.css", "_flows2.js", "_icons.js"]) writeFileSync(join(dir, "public", f), "x");
    assert.throws(() => syncBrain(dir), /anchor not found.*title/s);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("sync fails loudly when a kit file is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "brain-kit-"));
  try { assert.throws(() => syncBrain(dir), /kit file missing/); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
