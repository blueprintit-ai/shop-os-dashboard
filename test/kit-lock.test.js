// Always-on (no kit folder needed): tools/sync-kit.lock.json pins the sha256 of every file the sync
// produces and of the rule set, so a hand edit of a generated page, or a rule change without a re-sync,
// fails in CI even though the kit itself is not there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkLock, rulesDigest, FILES, LOCK_FILE, RULES } from "../tools/sync-kit.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(readFileSync(LOCK_FILE, "utf8"));
const read = (rel) => readFileSync(join(ROOT, rel));

test("committed pages and the rule set match the lock", () => {
  assert.deepEqual(checkLock(lock, read), []);
  assert.equal(Object.keys(lock.files).length, FILES.length);
  for (const f of FILES) assert.match(lock.files[f.dest].input, /^[0-9a-f]{64}$/);
});

test("a one-byte hand edit of public/owner.html fails the lock", () => {
  const tampered = (rel) => {
    const b = Buffer.from(read(rel));
    if (rel === "public/owner.html") b[Math.floor(b.length / 2)] ^= 1;
    return b;
  };
  const problems = checkLock(lock, tampered);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /public\/owner\.html does not match the lock/);
});

test("deleting an output, or editing any other generated file by a byte, fails the lock", () => {
  for (const f of FILES) {
    const flipped = (rel) => { const b = Buffer.from(read(rel)); if (rel === f.dest) b[0] ^= 1; return b; };
    assert.equal(checkLock(lock, flipped).length, 1, f.dest);
  }
  assert.equal(checkLock(lock, (rel) => { if (rel === "public/widgets.html") throw new Error("gone"); return read(rel); }).length, 1);
});

test("changing a rule without re-syncing fails the lock", () => {
  const before = rulesDigest();
  const r = RULES[0];
  const saved = r.doc;
  try { r.doc = saved + " (edited)"; assert.notEqual(rulesDigest(), before); assert.ok(checkLock(lock, read).length >= 1); }
  finally { r.doc = saved; }
  assert.equal(rulesDigest(), before);
});

test("the repo carries no personal kit path", () => {
  assert.doesNotMatch(readFileSync(join(ROOT, "tools", "sync-kit.mjs"), "utf8"), /\/Users\/|Robonuggets\/|Documents and Settings/);
});

test("no personal data anywhere in the repo: no @blueprintit.ai address except the public info@ one, and no owner first name", async () => {
  const { execFileSync } = await import("node:child_process");
  const { readFileSync: rf, readdirSync, statSync } = await import("node:fs");
  const tracked = (() => {
    try { return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean); }
    catch { // no git (tarball): walk the tree instead
      const out = [];
      (function walk(d) { for (const e of readdirSync(join(ROOT, d))) { if (e === "node_modules" || e === ".git") continue; const r = join(d, e); statSync(join(ROOT, r)).isDirectory() ? walk(r) : out.push(r); } })("");
      return out;
    }
  })();
  const FIRST = new RegExp("gl" + "enn", "i");             // the owner's first name (built so this file does not match itself)
  const MAIL = /[a-z0-9._-]+@blueprintit\.ai/gi;
  const SKIP = new Set(["LICENSE", "NOTICE.md", "package-lock.json"]);
  const bad = [];
  for (const rel of tracked) {
    if (SKIP.has(rel) || /\.(png|jpg|woff2|ico|gif)$/i.test(rel)) continue;
    let text; try { text = rf(join(ROOT, rel), "utf8"); } catch { continue; }
    for (const m of text.match(MAIL) || []) if (m.toLowerCase() !== "info@blueprintit.ai") bad.push(`${rel}: ${m}`);
    // the license server's workers.dev subdomain is a live endpoint the installer must call; it is the one allowed hit
    const scrubbed = text.replace(/shop-os-license-server\.gl[e]nn-15d\.workers\.dev/gi, "");
    if (FIRST.test(scrubbed)) bad.push(`${rel}: owner first name`);
  }
  assert.deepEqual(bad, []);
});
