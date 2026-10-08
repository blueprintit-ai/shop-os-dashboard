// Offline tests for the CI helpers: the fake license server and the install assertions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createFakeLicenseServer } from "./helpers/fake-license-server.js";
import { homeLeaks, checkOkReports, checkFailGithubReports, STRICT_STEPS } from "./e2e/assert-install.mjs";

async function withServer(fn) {
  const dir = mkdtempSync(join(tmpdir(), "fake-lic-"));
  const out = join(dir, "reports.jsonl");
  const server = createFakeLicenseServer(out);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base, out); } finally { await new Promise((r) => server.close(r)); }
}

test("fake server answers GET /validate with a valid blueprint-os license", async () => {
  await withServer(async (base) => {
    const r = await fetch(`${base}/validate?key=SHOP-CI12-TEST-0001`);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.valid, true);
    assert.equal(j.product, "blueprint-os");
    assert.equal(j.customer, "CI Test");
  });
});

test("fake server appends each POST /install-log body as one JSON line", async () => {
  await withServer(async (base, out) => {
    for (const body of [{ license_key: "SHOP-AB12-CD34-EF56", status: "progress", step: "a" }, { license_key: "SHOP-AB12-CD34-EF56", status: "success", note: "line1\nline2" }]) {
      const r = await fetch(`${base}/install-log`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { ok: true });
    }
    const lines = readFileSync(out, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].step, "a");
    assert.equal(lines[1].note, "line1\nline2");
  });
});

test("fake server returns 404 for everything else and writes nothing", async () => {
  await withServer(async (base, out) => {
    assert.equal((await fetch(`${base}/nope`)).status, 404);
    assert.equal((await fetch(`${base}/install-log`)).status, 404);
    assert.equal((await fetch(`${base}/validate`, { method: "POST" })).status, 404);
    assert.equal(existsSync(out), false);
  });
});

// ---- home-leak check ----
test("homeLeaks catches the raw home dir, its JSON-escaped form and lowercase variants", () => {
  const winHome = "C:\\Users\\runneradmin";
  const posix = "/Users/alice";
  assert.equal(homeLeaks(JSON.stringify({ p: `${winHome}\\x` }), winHome), true, "JSON-escaped Windows path");
  assert.equal(homeLeaks(`log at ${winHome}\\x`, winHome), true, "raw text");
  assert.equal(homeLeaks(JSON.stringify({ p: "c:\\users\\runneradmin\\x" }), winHome), true, "lowercased + escaped");
  assert.equal(homeLeaks("c:/users/runneradmin/x", winHome), true, "forward slashes, lowercased");
  assert.equal(homeLeaks(JSON.stringify({ p: `${posix}/x` }), posix), true);
  assert.equal(homeLeaks(JSON.stringify({ p: "%USERPROFILE%\\x ~/y" }), winHome), false, "tokens are fine");
  assert.equal(homeLeaks("", ""), false, "empty home never matches");
});

// ---- report assertions ----
const entry = (id, status = "ok", extra = {}) => ({ id, title: id, status, attempts: 1, durationMs: 5, ...extra });
const okReports = (over = {}) => [
  { status: "progress", step: "machine-check", run_id: "r", support_code: "BP-ABCD" },
  { status: "progress", step: "claude-code", run_id: "r", support_code: "BP-ABCD" },
  { status: "success", step: "complete", run_id: "r", support_code: "BP-ABCD", timeline: [entry("machine-check"), entry("claude-code", "skipped", { retried: true })],
    notes: [], duration_ms: 10, snapshot: { os: "Darwin 23" }, ...over },
];

test("checkOkReports accepts a well-formed two-phase success run", () => {
  assert.doesNotThrow(() => checkOkReports(okReports(), { home: "/Users/alice" }));
});
test("checkOkReports rejects: no reports, last not success, late progress (launch), bad code, missing fields", () => {
  const home = "/Users/alice";
  assert.throws(() => checkOkReports([], { home }));
  assert.throws(() => checkOkReports([...okReports(), { status: "progress", step: "launch" }], { home }), /last report/i);
  assert.throws(() => checkOkReports(okReports({ support_code: "XX-1" }), { home }), /support_code/);
  assert.throws(() => checkOkReports(okReports({ timeline: undefined }), { home }), /timeline/);
  assert.throws(() => checkOkReports(okReports({ snapshot: undefined }), { home }), /snapshot/);
  assert.throws(() => checkOkReports(okReports({ notes: "x" }), { home }), /notes/);
  assert.throws(() => checkOkReports(okReports({ duration_ms: undefined }), { home }), /duration_ms/);
  assert.throws(() => checkOkReports(okReports({ timeline: [entry("machine-check", "failed")] }), { home }), /failed/);
  assert.throws(() => checkOkReports(okReports().slice(2), { home }), /progress/);
});
test("checkOkReports fails when a report leaks the home dir (JSON-escaped Windows form)", () => {
  const home = "C:\\Users\\runneradmin";
  const leaky = okReports({ notes: [`saved in ${home}\\Desktop`] });
  assert.throws(() => checkOkReports(leaky, { home }), /home directory leaked/);
  assert.doesNotThrow(() => checkOkReports(okReports({ notes: ["saved in %USERPROFILE%\\Desktop"] }), { home }));
});

const failReports = (over = {}) => [
  { status: "progress", step: "machine-check", run_id: "r", support_code: "BP-ABCD" },
  { status: "error", step: "machine-check", step_title: "Checking this computer", error_message: "Cannot reach github.com", hint: "GitHub unreachable, likely a firewall or proxy.",
    run_id: "r", support_code: "BP-ABCD", timeline: [entry("machine-check", "failed")], notes: [], duration_ms: 3, snapshot: { reach: { github: false, claude_ai: true } }, ...over },
];
test("checkFailGithubReports accepts the deliberate GitHub-blocked failure", () => {
  assert.doesNotThrow(() => checkFailGithubReports(failReports(), { home: "/Users/alice" }));
});
test("checkFailGithubReports rejects a wrong step, missing hint, success report, or reachable github", () => {
  const home = "/Users/alice";
  assert.throws(() => checkFailGithubReports(failReports({ step: "plugins" }), { home }), /step/);
  assert.throws(() => checkFailGithubReports(failReports({ hint: undefined }), { home }), /hint/);
  assert.throws(() => checkFailGithubReports([...failReports(), { status: "success", step: "complete" }], { home }));
  assert.throws(() => checkFailGithubReports(failReports({ snapshot: { reach: { github: true } } }), { home }), /github/);
  assert.throws(() => checkFailGithubReports(failReports({ support_code: "nope" }), { home }), /support_code/);
});

test("checkOkReports strictSteps flags a warn or missing step", () => {
  const home = "/Users/alice";
  const withTl = (tl) => okReports({ timeline: tl });
  assert.doesNotThrow(() => checkOkReports(withTl([entry("plugins"), entry("dashboard", "skipped")]), { home, strictSteps: ["plugins", "dashboard"] }));
  assert.throws(() => checkOkReports(withTl([entry("plugins"), entry("dashboard", "warn", { error: "x" })]), { home, strictSteps: ["plugins", "dashboard"] }), /dashboard finished warn/);
  assert.throws(() => checkOkReports(withTl([entry("plugins")]), { home, strictSteps: ["plugins", "dashboard"] }), /timeline has step dashboard/);
});

test("STRICT_STEPS includes obsidian: a warn there fails CI, ok and skipped pass", () => {
  assert.ok(STRICT_STEPS.includes("obsidian"));
  const home = "/Users/alice";
  const run = (status) => checkOkReports(okReports({ timeline: [entry("obsidian", status, status === "warn" ? { error: "HTTP 403" } : {})] }), { home, strictSteps: ["obsidian"] });
  assert.doesNotThrow(() => run("ok"));
  assert.doesNotThrow(() => run("skipped"));
  assert.throws(() => run("warn"), /obsidian finished warn/);
});

test("the CLI reads a reports file and exits 0/1 for fail-github", async () => {
  const { spawnSync } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "assert-cli-"));
  const good = join(dir, "good.jsonl"), bad = join(dir, "bad.jsonl");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(good, failReports().map((r) => JSON.stringify(r)).join("\n") + "\n");
  writeFileSync(bad, okReports().map((r) => JSON.stringify(r)).join("\n") + "\n");
  const script = fileURLToPath(new URL("./e2e/assert-install.mjs", import.meta.url));
  assert.equal(spawnSync(process.execPath, [script, dir, good, "fail-github"], { env: { ...process.env, SHOPOS_LOGS: dir } }).status, 0);
  assert.notEqual(spawnSync(process.execPath, [script, dir, bad, "fail-github"], { env: { ...process.env, SHOPOS_LOGS: dir } }).status, 0);
  // a rejected (400) report recorded next to the reports file fails the run even when the reports themselves are fine
  writeFileSync(`${good}.rejected`, '{"reason":"x"}\n');
  assert.notEqual(spawnSync(process.execPath, [script, dir, good, "fail-github"], { env: { ...process.env, SHOPOS_LOGS: dir } }).status, 0);
});

// ---- workflow guard rails (the real proof is a run on GitHub Actions) ----
test("installer-e2e workflow: ASCII only, majors pinned, no unexpanded ~ paths, Git is hidden on Windows", () => {
  const raw = readFileSync(new URL("../.github/workflows/installer-e2e.yml", import.meta.url));
  for (const [i, b] of raw.entries()) assert.ok(b < 128, `non-ASCII byte at ${i}`);
  const t = raw.toString("utf8");
  for (const m of t.matchAll(/uses:\s*(\S+)/g)) assert.match(m[1], /@v\d+$/, `${m[1]} must be pinned to a major`);
  assert.doesNotMatch(t, /path:\s*"?~/, "actions do not expand ~");
  assert.doesNotMatch(t, /shell:\s*bash/, "bash is Git's bash on Windows; the job uses pwsh");
  assert.match(t, /Program Files\\Git/);
  assert.match(t, /SHOPOS_NO_LAUNCH/);
  assert.match(t, /SHOPOS_VAULT_PATH/);
  assert.match(t, /fail-github/);
  assert.match(t, /Remove-Item Env:PSModulePath/);
  // one shared root for the artifact: only the collected folder is uploaded
  assert.match(t, /path: \$\{\{ runner\.temp \}\}\/install-artifacts/);
  assert.doesNotMatch(t, /path:\s*\|/, "multi-path uploads break on Windows (two drives)");
});

// ---- fake server mirrors the real server's validation ----
const post = (base, body, raw) => fetch(`${base}/install-log`, { method: "POST", headers: { "Content-Type": "application/json" }, body: raw ?? JSON.stringify(body) });

test("fake server rejects what the real server rejects: 400 and the body is recorded to <out>.rejected, not <out>", async () => {
  await withServer(async (base, out) => {
    const bad = [
      { status: "progress" },                                              // missing license_key
      { license_key: null, status: "progress" },                          // JSON null (the PowerShell starter bug)
      { license_key: 12345, status: "progress" },                         // not a string
      { license_key: "   ", status: "progress" },                         // empty after trim
      { license_key: "SHOP AB12", status: "progress" },                   // bad characters
      { license_key: "A".repeat(65), status: "progress" },                // too long
      { license_key: "SHOP-AB12-CD34-EF56", status: "weird" },            // status not allowed
      { license_key: "SHOP-AB12-CD34-EF56" },                             // no status
      { license_key: "SHOP-AB12-CD34-EF56", status: "progress", run_id: "has space" },
      { license_key: "SHOP-AB12-CD34-EF56", status: "progress", run_id: "x".repeat(65) },
    ];
    for (const b of bad) assert.equal((await post(base, b)).status, 400, JSON.stringify(b));
    for (const raw of ["[1,2]", "null", '"str"', "42", "{not json"]) assert.equal((await post(base, null, raw)).status, 400, raw);
    assert.equal(existsSync(out), false, "rejected bodies must not land in the reports file");
    const rejected = readFileSync(`${out}.rejected`, "utf8").split("\n").filter(Boolean);
    assert.equal(rejected.length, bad.length + 5);
  });
});
test("fake server accepts every valid status, trims the key, and run_id of the allowed shape", async () => {
  await withServer(async (base, out) => {
    for (const status of ["success", "error", "retry", "progress"]) {
      assert.equal((await post(base, { license_key: "  SHOP-ab12-CD34-EF56 ", status, run_id: "3f2b8c1e-aaaa-4bbb-8ccc-123456789abc" })).status, 200, status);
    }
    assert.equal((await post(base, { license_key: "unknown", status: "error" })).status, 200);
    assert.equal(readFileSync(out, "utf8").split("\n").filter(Boolean).length, 5);
    assert.equal(existsSync(`${out}.rejected`), false);
  });
});

import { writeFileSync } from "node:fs";
import { checkNoRejected, findLeaks, licenseKeyLeaks, readLogs, shortHomeDir } from "./e2e/assert-install.mjs";

test("checkNoRejected fails when the rejected file has content, passes when missing or empty", () => {
  const dir = mkdtempSync(join(tmpdir(), "rej-"));
  const f = join(dir, "reports.jsonl.rejected");
  assert.doesNotThrow(() => checkNoRejected(f));
  writeFileSync(f, "");
  assert.doesNotThrow(() => checkNoRejected(f));
  writeFileSync(f, '{"status":"weird"}\n');
  assert.throws(() => checkNoRejected(f), /rejected/);
});

// ---- stronger leak checks ----
test("findLeaks: home path variants, bare username (whole word, case-insensitive), 8.3 short home", () => {
  const o = { home: "C:\\Users\\runneradmin", username: "runneradmin", shortHome: "C:\\Users\\RUNNER~1" };
  assert.deepEqual(findLeaks("all clean %USERPROFILE%\\x", o), []);
  assert.ok(findLeaks("C:\\\\Users\\\\runneradmin\\\\x", o).includes("home"));
  assert.ok(findLeaks("hello RunnerAdmin!", o).includes("username"));
  assert.ok(findLeaks("saved in C:\\Users\\RUNNER~1\\Desktop", o).includes("short-home"));
  assert.ok(findLeaks('{"p":"C:\\\\Users\\\\RUNNER~1\\\\Desktop"}', o).includes("short-home"));
  // negatives: the username inside a longer word is not a leak; tiny usernames are ignored
  assert.deepEqual(findLeaks("runneradministrator group", o), []);
  assert.deepEqual(findLeaks("ab is fine", { home: "/Users/ab", username: "ab" }), []);
  assert.deepEqual(findLeaks("nothing", { home: "/Users/alice", username: "alice", shortHome: null }), []);
  assert.ok(findLeaks("owner alice", { home: "/Users/alice", username: "alice" }).includes("username"));
});
test("shortHomeDir is null off Windows and never throws", () => {
  if (process.platform !== "win32") assert.equal(shortHomeDir("/Users/alice"), null);
});

const KEY = "SHOP-CI12-TEST-0001";
test("licenseKeyLeaks: the full key may sit in license_key only", () => {
  const ok = [{ license_key: KEY, status: "progress", error_message: "key SHOP-CI12-...-0001 bad", timeline: [{ error: "x" }] }];
  assert.deepEqual(licenseKeyLeaks(ok, [], KEY), []);
  const inMsg = [{ license_key: KEY, error_message: `License check failed for ${KEY}` }];
  assert.equal(licenseKeyLeaks(inMsg, [], KEY).length, 1);
  const nested = [{ license_key: KEY, timeline: [{ id: "license", outTail: `got ${KEY.toLowerCase()}` }] }];
  assert.equal(licenseKeyLeaks(nested, [], KEY).length, 1, "case-insensitive, nested");
  const partial = [{ license_key: KEY, notes: ["used CI12-TEST and TEST-0001"] }];
  assert.equal(licenseKeyLeaks(partial, [], KEY).length, 1, "unshortened block pairs count");
  const nestedLicenseKey = [{ license_key: KEY, snapshot: { license_key: KEY } }];
  assert.equal(licenseKeyLeaks(nestedLicenseKey, [], KEY).length, 1, "only the TOP-LEVEL license_key is exempt");
  const logs = [{ name: "install.jsonl", text: `{"license_key":"${KEY}"}` }];
  assert.equal(licenseKeyLeaks([], logs, KEY).length, 1, "never in local logs");
  assert.deepEqual(licenseKeyLeaks([], [{ name: "a", text: "SHOP-CI12-...-0001" }], KEY), []);
  assert.deepEqual(licenseKeyLeaks(ok, [], ""), [], "no key configured: nothing to check");
});

test("checkOkReports applies the extended checks: username, logs, license key", () => {
  const home = "/Users/alice";
  const base = okReports();
  assert.doesNotThrow(() => checkOkReports(base, { home, username: "alice", logs: [{ name: "l", text: "ok" }], licenseKey: KEY }));
  assert.throws(() => checkOkReports(okReports({ notes: ["hello alice"] }), { home, username: "alice" }), /username/);
  assert.throws(() => checkOkReports(base, { home, username: "alice", logs: [{ name: "install.jsonl", text: "see /Users/alice/x" }] }), /install\.jsonl/);
  assert.throws(() => checkOkReports(okReports({ notes: [`k ${KEY}`] }), { home, licenseKey: KEY }), /license key/);
  assert.throws(() => checkFailGithubReports(failReports({ error_message: `bad ${KEY}` }), { home, licenseKey: KEY }), /license key/);
});

test("readLogs reads every file under a folder recursively; a missing folder gives []", () => {
  const dir = mkdtempSync(join(tmpdir(), "logs-"));
  const { mkdirSync } = require_fs();
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "a.jsonl"), "one");
  writeFileSync(join(dir, "sub", "b.log"), "two");
  assert.deepEqual(readLogs(dir).map((l) => l.text).sort(), ["one", "two"]);
  assert.deepEqual(readLogs(join(dir, "nope")), []);
});
import * as fsAll from "node:fs";
function require_fs() { return fsAll; }
