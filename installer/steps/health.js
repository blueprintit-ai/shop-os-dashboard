import { join } from "node:path";
import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { StepError } from "../core/errors.js";
import { claudeVersion, listPlugins } from "../core/claude.js";
import { PLUGIN_IDS } from "./plugins.js";
import { redactText } from "../core/redact.js";
import { findFreePort } from "../../src/lib/net.js";

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TAIL_BYTES = 2048;
const POLL_TIMEOUT_MS = 2000;

// Limitation: bin/shop-os-dashboard.js has no host/bind option, so the throwaway dashboard listens on all
// interfaces for the few seconds it runs. We only reach it via 127.0.0.1, use a temp --home so the real
// dashboard data is untouched, and always kill it.
//
// Returns null when the dashboard answered, else { message, tail?, exitCode? }. `message` is the one line the
// customer sees; `tail` (redacted, last 2 KB of the child's stdout+stderr) only goes to the step result, the
// reporter and the local log.
async function dashboardAnswers(ctx, deps) {
  if (!ctx.dashboardBin) return { message: "the dashboard was not set up" };
  const find = deps.findPort ?? findFreePort;
  const port = await find(50020, 50040, "127.0.0.1").catch(() => null);
  if (!port) return { message: "no free local port to test the dashboard" };
  const doSpawn = deps.spawnImpl ?? spawn;
  const sleep = deps.sleep ?? realSleep;
  const now = deps.now ?? Date.now;
  const budgetMs = deps.budgetMs ?? 60000;
  const intervalMs = deps.intervalMs ?? 500;
  let child = null;
  let home = null;
  let childError = null;
  let exited = null; // { code, signal }
  let tail = "";
  const onData = (d) => { tail = (tail + String(d)).slice(-TAIL_BYTES); };
  const report = (message) => {
    const clean = redactText(home ? tail.split(home).join("<tmp>") : tail, { homeDir: ctx.homeDir }).trim();
    return { message, tail: clean || undefined, exitCode: exited?.code ?? undefined };
  };
  try {
    home = mkdtempSync(join(deps.tmpRoot ?? tmpdir(), "bp-health-"));
    child = doSpawn(ctx.nodeBin ?? process.execPath, [ctx.dashboardBin, ctx.vaultPath, "--no-browser", "--port", String(port), "--home", home], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: ctx.childEnv() });
    try { child?.on?.("error", (e) => { childError = e; }); } catch { /* ignore */ }
    try { child?.on?.("exit", (code, signal) => { exited = { code, signal }; }); } catch { /* ignore */ }
    try { child?.stdout?.on?.("data", onData); child?.stderr?.on?.("data", onData); } catch { /* ignore */ }
    const start = now();
    while (now() - start < budgetMs) {
      await sleep(intervalMs);
      if (childError) return report(`the dashboard could not be started (${String(childError?.message ?? childError)})`);
      if (exited) {
        await sleep(100); // let the last output chunks arrive
        return report(exited.signal ? `the dashboard was stopped by signal ${exited.signal} before it answered` : `the dashboard exited with code ${exited.code} before it answered`);
      }
      try {
        const resp = await ctx.fetchImpl(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(POLL_TIMEOUT_MS) });
        if (resp.status < 500) return null;
      } catch { /* not up yet */ }
    }
    return report(`the dashboard did not answer within ${Math.round(budgetMs / 1000)} seconds`);
  } catch (e) {
    return report(`the dashboard could not be started (${String(e?.message ?? e)})`);
  } finally {
    try { child?.kill(); } catch { /* ignore */ }
    if (home) try { rmSync(home, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

export function healthStep(deps = {}) {
  return {
    id: "health", title: "Checking everything works", severity: "warn",
    async action(ctx) {
      const problems = [];
      if (!(await claudeVersion(ctx))) problems.push("Claude Code does not run");
      const have = await listPlugins(ctx);
      for (const id of PLUGIN_IDS) if (!have.some((p) => p.id === id && p.enabled)) problems.push(`${id} is not enabled`);
      try { readFileSync(join(ctx.vaultPath, "CLAUDE.md"), "utf8"); } catch { problems.push("the vault's CLAUDE.md cannot be read"); }
      const d = await dashboardAnswers(ctx, deps);
      if (d) problems.push(d.message);
      if (problems.length) throw new StepError(`Health check found: ${problems.join("; ")}.`, { outTail: d?.tail, exitCode: d?.exitCode });
    },
  };
}
