import { join } from "node:path";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { StepError } from "../core/errors.js";
import { claudeVersion, listPlugins } from "../core/claude.js";
import { PLUGIN_IDS } from "./plugins.js";
import { findFreePort } from "../../src/lib/net.js";

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dashboardAnswers(ctx, deps) {
  if (!ctx.dashboardBin) return "the dashboard was not set up";
  const find = deps.findPort ?? findFreePort;
  const port = await find(50020, 50040, "127.0.0.1").catch(() => null);
  if (!port) return "no free local port to test the dashboard";
  const doSpawn = deps.spawnImpl ?? spawn;
  const sleep = deps.sleep ?? realSleep;
  const tries = deps.tries ?? 40;
  const intervalMs = deps.intervalMs ?? 500;
  let child = null;
  try {
    child = doSpawn(ctx.nodeBin ?? process.execPath, [ctx.dashboardBin, ctx.vaultPath, "--no-browser", "--port", String(port)], { stdio: "ignore", windowsHide: true, env: ctx.childEnv() });
    try { child?.on?.("error", () => {}); } catch { /* ignore */ }
    for (let i = 0; i < tries; i++) {
      await sleep(intervalMs);
      try {
        const resp = await ctx.fetchImpl(`http://127.0.0.1:${port}/`);
        if (resp.status < 500) return null;
      } catch { /* not up yet */ }
    }
    return "the dashboard did not answer within 20 seconds";
  } catch (e) {
    return `the dashboard could not be started (${String(e?.message ?? e)})`;
  } finally {
    try { child?.kill(); } catch { /* ignore */ }
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
      if (d) problems.push(d);
      if (problems.length) throw new StepError(`Health check found: ${problems.join("; ")}.`);
    },
  };
}
