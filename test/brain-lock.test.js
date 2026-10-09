// Always-on (no kit folder needed): tools/sync-brain.lock.json pins the sha256 of every file tools/sync-brain.mjs
// produces and of its rule set, so a hand edit of a generated /brain file, or a rule change without a re-sync,
// fails in CI even though the kit itself is not there. (Same guard as test/kit-lock.test.js for the owner page.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkLock, rulesDigest, FILES, LOCK_FILE, RULES } from "../tools/sync-brain.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(readFileSync(LOCK_FILE, "utf8"));
const read = (rel) => readFileSync(join(ROOT, rel));

test("committed brain files and the rule set match the lock", () => {
  assert.deepEqual(checkLock(lock, read), []);
  assert.equal(Object.keys(lock.files).length, FILES.length);
  for (const f of FILES) assert.match(lock.files[f.dest].input, /^[0-9a-f]{64}$/);
});

test("a one-byte hand edit of any generated brain file fails the lock", () => {
  for (const f of FILES) {
    const flipped = (rel) => { const b = Buffer.from(read(rel)); if (rel === f.dest) b[Math.floor(b.length / 2)] ^= 1; return b; };
    const problems = checkLock(lock, flipped);
    assert.equal(problems.length, 1, f.dest);
    assert.match(problems[0], new RegExp(f.dest.replace(/[.]/g, "\\.") + " does not match the lock"));
  }
});

test("a deleted output fails the lock", () => {
  assert.equal(checkLock(lock, (rel) => { if (rel === "public/brain/_core.js") throw new Error("gone"); return read(rel); }).length, 1);
});

test("changing a rule without re-syncing fails the lock", () => {
  const before = rulesDigest();
  const r = RULES[0];
  const saved = r.doc;
  try { r.doc = saved + " (edited)"; assert.notEqual(rulesDigest(), before); assert.ok(checkLock(lock, read).length >= 1); }
  finally { r.doc = saved; }
  assert.equal(rulesDigest(), before);
});

test("the sync tool carries no personal kit path", () => {
  assert.doesNotMatch(readFileSync(join(ROOT, "tools", "sync-brain.mjs"), "utf8"), /\/Users\/|Robonuggets\/|Documents and Settings/);
});

test("the generated page makes no external requests and names no kit-only port", () => {
  for (const f of FILES) {
    const t = read(f.dest).toString("utf8");
    assert.doesNotMatch(t, /fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com/, f.dest);
    assert.doesNotMatch(t, /localhost:\d+|:50000|:5210|C:\/ROBO/, f.dest);
  }
});

test("every brain page asset path the HTML references exists", async () => {
  const { existsSync } = await import("node:fs");
  const html = read("public/brain.html").toString("utf8");
  const refs = [...html.matchAll(/(?:src|href)="(\/static\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 8, refs.join(","));
  for (const r of refs) assert.ok(existsSync(join(ROOT, "public", r.replace("/static/", ""))), r);
});
