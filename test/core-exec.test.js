import { test } from "node:test";
import assert from "node:assert/strict";
import { runCommand } from "../installer/core/exec.js";
import { StepError, failFromResult } from "../installer/core/errors.js";

const node = process.execPath;

test("captures stdout and success", async () => {
  const r = await runCommand(node, ["-e", "console.log('hi')"]);
  assert.equal(r.ok, true);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /hi/);
});

test("non-zero exit keeps only the last N lines of combined output", async () => {
  const script = "for (let i=1;i<=100;i++) console.error('line'+i); process.exit(3)";
  const r = await runCommand(node, ["-e", script], { tailLines: 5 });
  assert.equal(r.ok, false);
  assert.equal(r.code, 3);
  assert.deepEqual(r.outTail.split("\n"), ["line96", "line97", "line98", "line99", "line100"]);
});

test("timeout kills the process and says so", async () => {
  const r = await runCommand(node, ["-e", "setInterval(()=>{},1000)"], { timeoutMs: 300 });
  assert.equal(r.ok, false);
  assert.equal(r.timedOut, true);
});

test("missing command is a result, not a throw", async () => {
  const r = await runCommand("definitely-not-a-real-command-xyz", []);
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, "ENOENT");
});

test("arguments with spaces and non-ASCII reach the child intact (Review Focus 1)", async () => {
  const weird = "C:\\Users\\Jos\u00e9 Garc\u00eda\\My Vault";
  const r = await runCommand(node, ["-e", "process.stdout.write(process.argv[1])", weird]);
  assert.equal(r.stdout, weird);
});

test("failFromResult throws a StepError carrying the command details", async () => {
  const r = await runCommand(node, ["-e", "console.error('boom'); process.exit(7)"]);
  assert.throws(() => failFromResult("Thing failed", r), (e) => {
    assert.ok(e instanceof StepError);
    assert.equal(e.exitCode, 7);
    assert.match(e.outTail, /boom/);
    assert.match(e.command, /-e/);
    return true;
  });
});
