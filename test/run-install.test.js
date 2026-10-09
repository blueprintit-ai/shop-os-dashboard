import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
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

// A fake clock: sleep(ms) advances now() instantly, so a 60 s budget costs no real time.
function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}

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
    ...fakeClock(),
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
  const deps = { findPort: async () => 50022, spawnImpl: () => ({ kill: () => killed++, on() {} }), ...fakeClock(), budgetMs: 1500 };
  await assert.rejects(() => healthStep(deps).action(healthCtx({ fetchImpl: async () => ({ status: 500 }) })), /did not answer within 2 seconds/);
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
  const deps = { findPort: async () => 50023, spawnImpl: () => ({ kill() {}, on() {} }), ...fakeClock(), budgetMs: 500 };
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
  await assert.rejects(() => healthStep({ findPort: async () => 50024, spawnImpl: () => { throw new Error("ENOENT node"); }, ...fakeClock() }).action(healthCtx()), /could not be started \(ENOENT node\)/);
  let killed = 0;
  const spawnImpl = () => ({ kill: () => killed++, on(ev, cb) { if (ev === "error") cb(new Error("spawn EACCES")); } });
  await assert.rejects(() => healthStep({ findPort: async () => 50025, spawnImpl, ...fakeClock() }).action(healthCtx()), /could not be started \(spawn EACCES\)/);
  assert.equal(killed, 1);
});

test("health: passes --home temp dir to the throwaway dashboard", async () => {
  let args;
  const deps = { findPort: async () => 50026, spawnImpl: (c, a) => { args = a; return { kill() {}, on() {} }; }, ...fakeClock() };
  await healthStep(deps).action(healthCtx({ vaultPath: process.cwd() })).catch(() => {});
  assert.ok(args.includes("--home"));
});

test("console prints '  > <title>...' when a step starts, before its 'ok' line; none for skipped steps", async () => {
  const printed = [];
  const mk = (id, title, extra = {}) => ({ id, title, severity: "stop", action: async () => { printed.push(`<action ${id}>`); }, ...extra });
  const steps = [mk("a", "Doing A"), mk("b", "Doing B", { check: async () => true })];
  const { exitCode } = await runInstall({
    argv: ["--license", "SHOP-AB12-CD34-EF56"], env: {}, steps,
    ctxOverrides: {
      platform: "darwin", homeDir: home(), print: (m) => printed.push(m), snapshot: async () => ({}),
      fetchImpl: async () => ({ ok: true }),
    },
  });
  assert.equal(exitCode, 0);
  const i = printed.indexOf("  > Doing A...");
  assert.ok(i >= 0);
  assert.deepEqual(printed.slice(i, i + 3), ["  > Doing A...", "<action a>", "  ok Doing A"]);
  assert.ok(printed.includes("  - Doing B"));
  assert.ok(!printed.some((m) => m.includes("> Doing B")));
});

// ---- health budget (60 s), captured dashboard output, early exit ----
const HEALTH_VAULT = mkdtempSync(join(tmpdir(), "bp-hv-"));
writeFileSync(join(HEALTH_VAULT, "CLAUDE.md"), "x");
function fakeChild() {
  const h = {}; let killed = 0;
  const stream = () => { const l = []; return { on: (ev, cb) => { if (ev === "data") l.push(cb); }, emit: (d) => l.forEach((cb) => cb(Buffer.from(d))) }; };
  const out = stream(), err = stream();
  const child = { stdout: out, stderr: err, kill: () => { killed++; }, on: (ev, cb) => { (h[ev] ??= []).push(cb); } };
  return { child, out, err, emit: (ev, ...a) => (h[ev] ?? []).forEach((cb) => cb(...a)), killed: () => killed };
}
const healthDeps = (extra) => ({ findPort: async () => 50030, ...fakeClock(), ...extra });
const dashMsg = async (deps, ctx = healthCtx({ vaultPath: HEALTH_VAULT })) => {
  try { await healthStep(deps).action(ctx); return null; } catch (e) { return e; }
};

test("health: answers at poll 1 passes without waiting out the budget", async () => {
  const f = fakeChild(); const clock = fakeClock();
  const e = await dashMsg({ findPort: async () => 50030, spawnImpl: () => f.child, ...clock });
  assert.equal(e, null);
  assert.equal(clock.now(), 500, "returned after the first poll");
  assert.equal(f.killed(), 1);
});

test("health: a dashboard that answers late (poll 50 of 120) passes with no warning", async () => {
  const f = fakeChild(); let n = 0;
  const e = await dashMsg(healthDeps({ spawnImpl: () => f.child }), healthCtx({ vaultPath: HEALTH_VAULT, fetchImpl: async () => { if (++n < 50) throw new Error("ECONNREFUSED"); return { status: 200 }; } }));
  assert.equal(e, null);
  assert.equal(n, 50);
  assert.equal(f.killed(), 1);
});

test("health: answering at second 30 passes; the budget is 60 s at ~500 ms polls", async () => {
  const f = fakeChild(); const clock = fakeClock(); let polls = 0;
  const ctx = healthCtx({ vaultPath: HEALTH_VAULT, fetchImpl: async () => { polls++; if (clock.now() < 30000) throw new Error("down"); return { status: 200 }; } });
  assert.equal(await dashMsg({ findPort: async () => 50030, spawnImpl: () => f.child, ...clock }, ctx), null);
  const g = fakeChild(); const c2 = fakeClock(); let p2 = 0;
  const e = await dashMsg({ findPort: async () => 50030, spawnImpl: () => g.child, ...c2 }, healthCtx({ vaultPath: HEALTH_VAULT, fetchImpl: async () => { p2++; throw new Error("down"); } }));
  assert.ok(e);
  assert.equal(p2, 120);
  assert.ok(c2.now() >= 60000 && c2.now() < 61000);
});

test("health: never answers - exact message, redacted bounded tail, child killed", async () => {
  const g = fakeChild(); const clock = fakeClock(); let first = true;
  const sleep = async (ms) => {
    if (first) { first = false; g.out.emit("x".repeat(5000) + "\nindexing /Users/alice/Vault key sk-abcdefghijklmnopqrstuvwxyz\n"); g.err.emit("warn: slow disk\n"); }
    return clock.sleep(ms);
  };
  const e = await dashMsg({ findPort: async () => 50030, spawnImpl: () => g.child, now: clock.now, sleep }, healthCtx({ homeDir: "/Users/alice", vaultPath: HEALTH_VAULT, fetchImpl: async () => { throw new Error("down"); } }));
  assert.equal(e.message, "Health check found: the dashboard did not answer within 60 seconds.");
  assert.ok(!/alice/.test(e.outTail), e.outTail);
  assert.ok(!/sk-abcdefghij/.test(e.outTail));
  assert.match(e.outTail, /indexing (~|%USERPROFILE%)\/Vault/);
  assert.match(e.outTail, /slow disk/);
  assert.ok(e.outTail.length <= 2048, String(e.outTail.length));
  assert.equal(g.killed(), 1);
});

test("health: child that exits early fails fast with the exit code and its output", async () => {
  const f = fakeChild(); const clock = fakeClock(); let polls = 0;
  const spawnImpl = () => { setImmediate(() => {}); return f.child; };
  const sleep = async (ms) => { await clock.sleep(ms); if (clock.now() === 500) { f.err.emit("Error: EADDRINUSE\n"); f.emit("exit", 1, null); } };
  const e = await dashMsg({ findPort: async () => 50030, spawnImpl, now: clock.now, sleep }, healthCtx({ vaultPath: HEALTH_VAULT, fetchImpl: async () => { polls++; throw new Error("down"); } }));
  assert.match(e.message, /the dashboard exited with code 1 before it answered/);
  assert.ok(!/within/.test(e.message));
  assert.match(e.outTail, /EADDRINUSE/);
  assert.equal(e.exitCode, 1);
  assert.ok(clock.now() < 2000, "did not wait out the budget");
  assert.equal(f.killed(), 1);
});

test("health: child killed by a signal is reported as such", async () => {
  const f = fakeChild(); const clock = fakeClock();
  const sleep = async (ms) => { await clock.sleep(ms); if (clock.now() === 500) f.emit("exit", null, "SIGKILL"); };
  const e = await dashMsg({ findPort: async () => 50030, spawnImpl: () => f.child, now: clock.now, sleep }, healthCtx({ vaultPath: HEALTH_VAULT, fetchImpl: async () => { throw new Error("down"); } }));
  assert.match(e.message, /the dashboard was stopped by signal SIGKILL before it answered/);
});

test("health: fetch that throws keeps polling and is not fatal on its own", async () => {
  const f = fakeChild(); let n = 0;
  const e = await dashMsg(healthDeps({ spawnImpl: () => f.child }), healthCtx({ vaultPath: HEALTH_VAULT, fetchImpl: async () => { if (++n === 1) throw new TypeError("fetch failed"); if (n === 2) throw Object.assign(new Error("x"), { name: "TimeoutError" }); return { status: 200 }; } }));
  assert.equal(e, null);
  assert.equal(n, 3);
});
