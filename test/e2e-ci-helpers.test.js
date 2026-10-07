// Offline tests for the CI helpers: the fake license server and the install assertions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createFakeLicenseServer } from "./helpers/fake-license-server.js";
import { homeLeaks, checkOkReports, checkFailGithubReports } from "./e2e/assert-install.mjs";

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
    for (const body of [{ status: "progress", step: "a" }, { status: "success", note: "line1\nline2" }]) {
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

test("the CLI reads a reports file and exits 0/1 for fail-github", async () => {
  const { spawnSync } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "assert-cli-"));
  const good = join(dir, "good.jsonl"), bad = join(dir, "bad.jsonl");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(good, failReports().map((r) => JSON.stringify(r)).join("\n") + "\n");
  writeFileSync(bad, okReports().map((r) => JSON.stringify(r)).join("\n") + "\n");
  const script = fileURLToPath(new URL("./e2e/assert-install.mjs", import.meta.url));
  assert.equal(spawnSync(process.execPath, [script, dir, good, "fail-github"]).status, 0);
  assert.notEqual(spawnSync(process.execPath, [script, dir, bad, "fail-github"]).status, 0);
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
