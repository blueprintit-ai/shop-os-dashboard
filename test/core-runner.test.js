// test/core-runner.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { runSteps } from "../installer/core/runner.js";
import { StepError } from "../installer/core/errors.js";

const fakeReporter = () => { const sent = []; return { sent, send: (e) => { sent.push(e); return Promise.resolve(); } }; };
const opts = (rep) => ({ reporter: rep, sleep: async () => {}, now: (() => { let t = 0; return () => (t += 10); })() });

test("runs steps in order, reports progress at each start", async () => {
  const order = [];
  const rep = fakeReporter();
  const steps = [
    { id: "a", title: "A", severity: "stop", action: async () => order.push("a") },
    { id: "b", title: "B", severity: "stop", action: async () => order.push("b") },
  ];
  const r = await runSteps(steps, {}, opts(rep));
  assert.equal(r.ok, true);
  assert.deepEqual(order, ["a", "b"]);
  assert.deepEqual(rep.sent.filter((e) => e.status === "progress").map((e) => e.step), ["a", "b"]);
});

test("check() true skips the action (safe to re-run)", async () => {
  let ran = false;
  const r = await runSteps([{ id: "a", title: "A", severity: "stop", check: async () => true, action: async () => { ran = true; } }], {}, opts(fakeReporter()));
  assert.equal(ran, false);
  assert.equal(r.timeline[0].status, "skipped");
});

test("retries then succeeds; attempts and a retry report are recorded", async () => {
  let n = 0;
  const rep = fakeReporter();
  const step = { id: "net", title: "Net", severity: "stop", retries: 2, action: async () => { if (++n < 3) throw new Error("ETIMEDOUT"); } };
  const r = await runSteps([step], {}, opts(rep));
  assert.equal(r.ok, true);
  assert.equal(r.timeline[0].attempts, 3);
  assert.equal(rep.sent.filter((e) => e.status === "retry").length, 2);
});

test("a step that cannot prove it worked counts as failed", async () => {
  const r = await runSteps([{ id: "a", title: "A", severity: "stop", action: async () => {}, verify: async () => "claude --version did not work" }], {}, opts(fakeReporter()));
  assert.equal(r.ok, false);
  assert.equal(r.failed.error, "claude --version did not work");
});

test("StepError details land on the entry, with a hint", async () => {
  const err = new StepError("download failed", { command: "curl x", exitCode: 6, outTail: "getaddrinfo ENOTFOUND codeload.github.com" });
  const r = await runSteps([{ id: "a", title: "A", severity: "stop", action: async () => { throw err; } }], {}, opts(fakeReporter()));
  assert.equal(r.failed.command, "curl x");
  assert.equal(r.failed.exitCode, 6);
  assert.match(r.failed.hint, /GitHub unreachable/);
});

test("stop failure halts later steps; warn failure continues", async () => {
  const ran = [];
  const mk = (id, severity, fail) => ({ id, title: id, severity, action: async () => { ran.push(id); if (fail) throw new Error("x"); } });
  const r1 = await runSteps([mk("a", "warn", true), mk("b", "stop", false)], {}, opts(fakeReporter()));
  assert.equal(r1.ok, true);
  assert.equal(r1.warnings.length, 1);
  assert.deepEqual(ran, ["a", "b"]);
  ran.length = 0;
  const r2 = await runSteps([mk("a", "stop", true), mk("b", "stop", false)], {}, opts(fakeReporter()));
  assert.equal(r2.ok, false);
  assert.deepEqual(ran, ["a"]);
});

test("verify returning anything but true fails the step", async () => {
  for (const v of [false, undefined, null, 1, "nope"]) {
    const r = await runSteps([{ id: "a", title: "A", severity: "stop", action: async () => {}, verify: async () => v }], {}, opts(fakeReporter()));
    assert.equal(r.ok, false, `verify=${String(v)}`);
  }
});

test("a throwing check() is a step failure, not an escape", async () => {
  let ran = false;
  const step = { id: "a", title: "A", severity: "stop", check: async () => { throw new Error("check blew up"); }, action: async () => { ran = true; } };
  const r = await runSteps([step], {}, opts(fakeReporter()));
  assert.equal(r.ok, false);
  assert.equal(r.failed.error, "check blew up");
  assert.equal(ran, false);
});

test("a reporter whose send throws or rejects never breaks the run", async () => {
  const bad = { send: () => { throw new Error("boom"); } };
  const rejecting = { send: () => Promise.reject(new Error("nope")) };
  let n = 0;
  const step = { id: "a", title: "A", severity: "stop", retries: 1, action: async () => { if (++n < 2) throw new Error("x"); } };
  for (const rep of [bad, rejecting]) {
    n = 0;
    const r = await runSteps([step], {}, opts(rep));
    assert.equal(r.ok, true);
    assert.equal(r.timeline[0].attempts, 2);
  }
});

test("retry report is sent between attempts only, not after the last", async () => {
  const rep = fakeReporter();
  const r = await runSteps([{ id: "a", title: "A", severity: "stop", retries: 1, action: async () => { throw new Error("x"); } }], {}, opts(rep));
  assert.equal(r.ok, false);
  assert.equal(r.failed.attempts, 2);
  assert.equal(rep.sent.filter((e) => e.status === "retry").length, 1);
});

test("a throwing onStepDone does not break the run", async () => {
  const seen = [];
  const steps = [
    { id: "a", title: "A", severity: "stop", action: async () => {} },
    { id: "b", title: "B", severity: "stop", action: async () => {} },
  ];
  const r = await runSteps(steps, {}, { ...opts(fakeReporter()), onStepDone: (e) => { seen.push(e.id); throw new Error("cb"); } });
  assert.equal(r.ok, true);
  assert.deepEqual(seen, ["a", "b"]);
});

test("durationMs uses the injected now", async () => {
  const r = await runSteps([{ id: "a", title: "A", severity: "stop", action: async () => {} }], {}, opts(fakeReporter()));
  assert.equal(r.timeline[0].durationMs, 10);
});

test("retry-then-success is marked retried but stays ok, not a warning", async () => {
  let n = 0;
  const step = { id: "net", title: "Net", severity: "stop", retries: 2, action: async () => { if (++n < 3) throw new Error("ETIMEDOUT"); } };
  const r = await runSteps([step], {}, opts(fakeReporter()));
  const e = r.timeline[0];
  assert.equal(e.status, "ok");
  assert.equal(e.attempts, 3);
  assert.equal(e.retried, true);
  assert.deepEqual(r.retried, [e]);
  assert.equal(r.warnings.length, 0);
});

test("first-try success has no retried key; failed after retries is not retried", async () => {
  const r1 = await runSteps([{ id: "a", title: "A", severity: "stop", action: async () => {} }], {}, opts(fakeReporter()));
  assert.equal("retried" in r1.timeline[0], false);
  assert.deepEqual(r1.retried, []);
  const r2 = await runSteps([{ id: "a", title: "A", severity: "stop", retries: 2, action: async () => { throw new Error("x"); } }], {}, opts(fakeReporter()));
  assert.equal(r2.failed.status, "failed");
  assert.equal("retried" in r2.failed, false);
  assert.deepEqual(r2.retried, []);
});

test("empty or non-string verify results give the generic message", async () => {
  for (const v of ["", false, 0]) {
    const r = await runSteps([{ id: "a", title: "A", severity: "stop", action: async () => {}, verify: async () => v }], {}, opts(fakeReporter()));
    assert.equal(r.failed.error, "Could not confirm this step worked.");
  }
});

test("odd thrown values never crash the runner and always give a string error", async () => {
  const cases = ["x", undefined, null, { message: 5 }, Object.create(null)];
  for (const thrown of cases) {
    const r = await runSteps([{ id: "a", title: "A", severity: "stop", action: async () => { throw thrown; } }], {}, opts(fakeReporter()));
    assert.equal(typeof r.failed.error, "string");
    assert.ok(r.failed.error.length > 0);
  }
  const r = await runSteps([{ id: "a", title: "A", severity: "stop", action: async () => { throw "x"; } }], {}, opts(fakeReporter()));
  assert.equal(r.failed.error, "x");
});

test("warn step with failing verify is a warn with error and hint", async () => {
  const step = { id: "a", title: "A", severity: "warn", action: async () => {}, verify: async () => "getaddrinfo ENOTFOUND codeload.github.com" };
  const r = await runSteps([step], {}, opts(fakeReporter()));
  assert.equal(r.ok, true);
  assert.equal(r.timeline[0].status, "warn");
  assert.equal(r.timeline[0].error, "getaddrinfo ENOTFOUND codeload.github.com");
  assert.match(r.timeline[0].hint, /GitHub unreachable/);
});
