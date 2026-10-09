import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, buildSteps, runInstall, withTestFaults, splitSteps } from "../installer/run-install.js";
import { healthStep } from "../installer/steps/health.js";
import { launchStep } from "../installer/steps/launch.js";

const home = () => mkdtempSync(join(tmpdir(), "bp-ri-"));
const snap = async () => ({ os: "x", free_disk_mb: 1, reach: { github: true, npm: true, claude_ai: true }, desktop: false });

test("parseArgs reads flags and env, flags win", () => {
  const a = parseArgs(["--vault", "V", "--no-launch"], { SHOPOS_LICENSE_KEY: "K", SHOPOS_LICENSE_SERVER: "http://x" });
  assert.deepEqual(a, { licenseKey: "K", vaultPath: "V", noLaunch: true, licenseServer: "http://x", testMode: false, chooseFolder: false });
  assert.equal(parseArgs(["--license", "FLAG"], { SHOPOS_LICENSE_KEY: "ENV" }).licenseKey, "FLAG");
});

test("steps run in the spec's order", () => {
  assert.deepEqual(buildSteps().map((s) => s.id), ["machine-check", "license", "vault-location", "claude-code", "plugins", "obsidian", "vault", "dashboard", "health", "launch"]);
});

test("a failing step prints the exact customer message, reports an error with timeline, exits 1", async () => {
  const sent = [];
  const printed = [];
  const { exitCode } = await runInstall({
    argv: ["--vault", "/v", "--no-launch"],
    env: { SHOPOS_LICENSE_KEY: "SHOP-AB12-CD34-EF56" },
    ctxOverrides: {
      platform: "darwin", homeDir: home(), print: (m) => printed.push(m), snapshot: snap,
      fetchImpl: async (url, init) => { if (init?.method === "POST") { sent.push(JSON.parse(init.body)); return { ok: true }; } throw new Error("offline"); },
    },
  });
  assert.equal(exitCode, 1);
  assert.match(printed.join("\n"), /Setup hit a problem at "Checking this computer"\. We've been notified and will email you shortly\. If you contact us, quote support code BP-[A-Z0-9]{4}\./);
  const final = sent.filter((b) => b.status === "error").pop();
  assert.equal(final.step, "machine-check");
  assert.ok(Array.isArray(final.timeline));
  assert.ok(Array.isArray(final.notes));
  assert.equal(typeof final.duration_ms, "number");
  assert.ok(final.support_code.startsWith("BP-"));
});

test("a prompted license key is used for every report; notes and warn steps reach the customer, retried-ok steps do not", async () => {
  const sent = [];
  const printed = [];
  let tries = 0;
  const steps = [
    { id: "a", title: "Flaky", severity: "stop", retries: 1, action: async () => { if (++tries === 1) throw new Error("once"); } },
    { id: "b", title: "Noted", severity: "stop", action: async (ctx) => { ctx.notes = [...(ctx.notes ?? []), "a short note"]; } },
    { id: "c", title: "Soft", severity: "warn", action: async () => { throw new Error("soft problem"); } },
  ];
  const answers = ["nope", " shop-ab12-cd34-ef56 "];
  const { exitCode, result } = await runInstall({
    argv: [], env: {}, steps,
    ctxOverrides: {
      platform: "darwin", homeDir: home(), print: (m) => printed.push(m), snapshot: snap,
      prompt: async () => answers.shift(),
      fetchImpl: async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true }; },
    },
  });
  assert.equal(exitCode, 0);
  assert.ok(sent.length > 0 && sent.every((b) => b.license_key === "SHOP-AB12-CD34-EF56"));
  const final = sent.find((b) => b.status === "success");
  assert.deepEqual(final.notes, ["a short note"]);
  assert.equal(final.timeline[0].retried, true);
  assert.equal(typeof final.duration_ms, "number");
  const text = printed.join("\n");
  assert.match(text, /Note: a short note/);
  assert.match(text, /Note: Soft: soft problem/);
  assert.doesNotMatch(text, /Flaky: /);
  assert.equal(result.retried.length, 1);
});

test("no key at all reports license_key unknown and lets the license step fail", async () => {
  const sent = [];
  const { exitCode } = await runInstall({
    argv: [], env: {}, steps: buildSteps().filter((s) => s.id === "license"),
    ctxOverrides: {
      platform: "darwin", homeDir: home(), print: () => {}, snapshot: snap, prompt: async () => "",
      fetchImpl: async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true }; },
    },
  });
  assert.equal(exitCode, 1);
  assert.equal(sent.at(-1).license_key, "unknown");
  assert.equal(sent.at(-1).step, "license");
});

test("runInstall never throws: an exception from buildSteps still prints the failure message and reports", async () => {
  const sent = [];
  const printed = [];
  const steps = { [Symbol.iterator]() { throw new Error("boom"); } };
  const { exitCode } = await runInstall({
    argv: [], env: { SHOPOS_LICENSE_KEY: "SHOP-AB12-CD34-EF56" }, steps,
    ctxOverrides: {
      platform: "darwin", homeDir: home(), print: (m) => printed.push(m), snapshot: snap,
      fetchImpl: async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true }; },
    },
  });
  assert.equal(exitCode, 1);
  assert.match(printed.join("\n"), /Setup hit a problem at ".+"\. We've been notified .*support code BP-[A-Z0-9]{4}\./);
  const e = sent.find((b) => b.status === "error");
  assert.equal(e.step, "orchestrator");
});

test("fault injection blocks listed hosts only when TEST_MODE and FAIL_HOSTS are both set", async () => {
  const pass = async (u) => ({ ok: true, url: String(u) });
  const on = withTestFaults(pass, { SHOPOS_TEST_MODE: "1", SHOPOS_TEST_FAIL_HOSTS: "github.com" });
  await assert.rejects(() => on("https://codeload.github.com/x"), (e) => e.code === "ENOTFOUND" && e.message === "getaddrinfo ENOTFOUND codeload.github.com");
  assert.equal((await on("https://example.com/")).ok, true);
  assert.equal(withTestFaults(pass, { SHOPOS_TEST_FAIL_HOSTS: "github.com" }), pass);
  assert.equal(withTestFaults(pass, { SHOPOS_TEST_MODE: "1" }), pass);
});

function healthCtx(over = {}) {
  return {
    homeDir: "/h", platform: "darwin", exists: () => false, childEnv: () => ({}), vaultPath: "/nonexistent-vault", dashboardBin: "/d.js", nodeBin: "node", print: () => {},
    run: async (cmd, args) => args[0] === "--version" ? { ok: true, stdout: "1.0\n" } : { ok: true, stdout: JSON.stringify([{ id: "obsidian@blueprint-skills", enabled: true }, { id: "superpowers@claude-plugins-official", enabled: true }]) },
    fetchImpl: async () => ({ status: 200 }),
    ...over,
  };
}

test("health: dashboard check spawns on the found port, polls, and always kills the child", async () => {
  const spawned = []; let killed = 0; const urls = [];
  const deps = {
    findPort: async (a, b, h) => { assert.deepEqual([a, b, h], [50020, 50040, "127.0.0.1"]); return 50021; },
    spawnImpl: (cmd, args) => { spawned.push(args); return { kill: () => killed++, on() {} }; },
    sleep: async () => {},
  };
  let n = 0;
  const ctx = healthCtx({ fetchImpl: async (u) => { urls.push(u); if (++n < 3) throw new Error("down"); return { status: 404 }; } });
  await assert.rejects(() => healthStep(deps).action(ctx), (e) => /CLAUDE\.md/.test(e.message) && !/dashboard/.test(e.message));
  assert.deepEqual(urls[0], "http://127.0.0.1:50021/");
  assert.ok(spawned[0].includes("50021"));
  assert.equal(killed, 1);
});

test("health: a 500 never counts, timeout reports and still kills", async () => {
  let killed = 0;
  const deps = { findPort: async () => 50022, spawnImpl: () => ({ kill: () => killed++, on() {} }), sleep: async () => {}, tries: 3 };
  await assert.rejects(() => healthStep(deps).action(healthCtx({ fetchImpl: async () => ({ status: 500 }) })), /did not answer within 20 seconds/);
  assert.equal(killed, 1);
});

test("launch: skipped with noLaunch; otherwise runs interactive twice when signed in, once with guidance when not", async () => {
  const step = launchStep();
  assert.equal(await step.check({ flags: { noLaunch: true } }), true);
  assert.equal(await step.check({ flags: { noLaunch: false } }), false);
  const printed = [];
  let runs = 0;
  const base = { print: (m) => printed.push(m), interactive: async () => { runs++; }, homeDir: "/h", platform: "darwin", exists: () => false, childEnv: () => ({}), vaultPath: "/v" };
  await step.action({ ...base, run: async () => ({ ok: true }) });
  assert.equal(runs, 2);
  runs = 0; printed.length = 0;
  await step.action({ ...base, run: async () => ({ ok: false }) });
  assert.equal(runs, 1);
  assert.match(printed.join("\n"), /not signed in yet/);
});

test("parseArgs: missing values never swallow flags or wipe env; --flag=value works; unknown flags ignored", () => {
  const env = { SHOPOS_VAULT_PATH: "ENVV", SHOPOS_LICENSE_KEY: "ENVK" };
  assert.equal(parseArgs(["--vault"], env).vaultPath, "ENVV");
  const a = parseArgs(["--license", "--no-launch", "--bogus"], env);
  assert.equal(a.licenseKey, "ENVK");
  assert.equal(a.noLaunch, true);
  const b = parseArgs(["--vault=/x/y", "--license=SHOP-A"], {});
  assert.equal(b.vaultPath, "/x/y");
  assert.equal(b.licenseKey, "SHOP-A");
});

test("splitSteps splits launch off", () => {
  const { main, launch } = splitSteps(buildSteps());
  assert.equal(main.length, 9);
  assert.equal(launch.id, "launch");
  assert.equal(splitSteps([{ id: "a" }]).launch, null);
});

function twoPhase({ launchAction, failMain = false, wait = 0 }) {
  const events = []; const sent = [];
  const steps = [
    { id: "a", title: "A", severity: failMain ? "stop" : "stop", action: async () => { if (failMain) throw new Error("bad"); } },
    { id: "launch", title: "Opening Claude Code", severity: "warn", action: launchAction(events, sent) },
  ];
  const run = () => runInstall({
    argv: [], env: { SHOPOS_LICENSE_KEY: "SHOP-AB12-CD34-EF56" }, steps,
    ctxOverrides: {
      platform: "darwin", homeDir: home(), print: () => {}, snapshot: snap,
      fetchImpl: async (u, init) => { const b = JSON.parse(init.body); sent.push(b); events.push(`report:${b.status}:${b.step}`); return { ok: true }; },
    },
  });
  return { run, events, sent };
}

test("launch phase: success report is sent before launch, no launch progress report, duration excludes launch, launch failure keeps exit 0", async () => {
  const t = twoPhase({ launchAction: (events, sent) => async () => {
    assert.ok(sent.some((b) => b.status === "success"), "success report must precede launch");
    events.push("launch-start");
    await new Promise((r) => setTimeout(r, 300));
    throw new Error("launch broke");
  } });
  const { exitCode } = await t.run();
  assert.equal(exitCode, 0);
  assert.ok(t.events.indexOf("report:success:complete") < t.events.indexOf("launch-start"));
  assert.ok(!t.sent.some((b) => b.step === "launch"));
  assert.equal(t.sent.at(-1).status, "success");
  assert.ok(t.sent.find((b) => b.status === "success").duration_ms < 250);
  assert.ok(!t.sent.some((b) => b.status === "error"));
});

test("a phase 1 failure never runs launch", async () => {
  let ran = false;
  const t = twoPhase({ failMain: true, launchAction: () => async () => { ran = true; } });
  const { exitCode } = await t.run();
  assert.equal(exitCode, 1);
  assert.equal(ran, false);
});

test("health: stalled fetch is aborted by the per-poll timeout signal", async () => {
  let signalSeen = false;
  const deps = { findPort: async () => 50023, spawnImpl: () => ({ kill() {}, on() {} }), sleep: async () => {}, tries: 1 };
  const ctx = healthCtx({ fetchImpl: (u, init) => { signalSeen = init?.signal instanceof AbortSignal; return new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted")))); } });
  // AbortSignal.timeout timers are unref'd and this fake fetch holds no socket: keep the loop alive (Node 22 cancels otherwise).
  const keepAlive = setInterval(() => {}, 20);
  try {
    await assert.rejects(() => healthStep(deps).action(ctx), /did not answer/);
  } finally {
    clearInterval(keepAlive);
  }
  assert.ok(signalSeen);
});

test("health: spawn that throws and child error event give a clear message and kill/clean up", async () => {
  await assert.rejects(() => healthStep({ findPort: async () => 50024, spawnImpl: () => { throw new Error("ENOENT node"); }, sleep: async () => {} }).action(healthCtx()), /could not be started \(ENOENT node\)/);
  let killed = 0;
  const spawnImpl = () => ({ kill: () => killed++, on(ev, cb) { if (ev === "error") cb(new Error("spawn EACCES")); } });
  await assert.rejects(() => healthStep({ findPort: async () => 50025, spawnImpl, sleep: async () => {} }).action(healthCtx()), /could not be started \(spawn EACCES\)/);
  assert.equal(killed, 1);
});

test("health: passes --home temp dir to the throwaway dashboard", async () => {
  let args;
  const deps = { findPort: async () => 50026, spawnImpl: (c, a) => { args = a; return { kill() {}, on() {} }; }, sleep: async () => {} };
  await healthStep(deps).action(healthCtx({ vaultPath: process.cwd() })).catch(() => {});
  assert.ok(args.includes("--home"));
});
