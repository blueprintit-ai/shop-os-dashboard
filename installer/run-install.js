import { join } from "node:path";
import { createContext } from "./core/context.js";
import { createReporter } from "./core/reporter.js";
import { runSteps } from "./core/runner.js";
import { newRunId, newSupportCode } from "./core/ids.js";
import { renderFailure, renderSuccess } from "./core/messages.js";
import { normalizeLicenseKey, looksLikeLicenseKey } from "./vault-setup.js";
import { machineCheckStep } from "./steps/machine-check.js";
import { licenseStep } from "./steps/license.js";
import { vaultLocationStep } from "./steps/vault-location.js";
import { claudeCodeStep } from "./steps/claude-code.js";
import { pluginsStep } from "./steps/plugins.js";
import { obsidianStep } from "./steps/obsidian.js";
import { vaultStep } from "./steps/vault.js";
import { dashboardStep } from "./steps/dashboard.js";
import { healthStep } from "./steps/health.js";
import { launchStep } from "./steps/launch.js";

export function parseArgs(argv, env) {
  const a = { licenseKey: env.SHOPOS_LICENSE_KEY, vaultPath: env.SHOPOS_VAULT_PATH, noLaunch: env.SHOPOS_NO_LAUNCH === "1", licenseServer: env.SHOPOS_LICENSE_SERVER, testMode: env.SHOPOS_TEST_MODE === "1" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--license") a.licenseKey = argv[++i];
    else if (argv[i] === "--vault") a.vaultPath = argv[++i];
    else if (argv[i] === "--no-launch") a.noLaunch = true;
  }
  for (const k of Object.keys(a)) if (a[k] === undefined) delete a[k];
  return { noLaunch: false, testMode: false, ...a };
}

export const buildSteps = () => [machineCheckStep(), licenseStep(), vaultLocationStep(), claudeCodeStep(), pluginsStep(), obsidianStep(), vaultStep(), dashboardStep(), healthStep(), launchStep()];

// CI-only fault injection: SHOPOS_TEST_MODE=1 plus SHOPOS_TEST_FAIL_HOSTS=github.com,codeload.github.com
// makes fetches to those hosts fail like a blocked network. Inert unless both are set.
export function withTestFaults(fetchImpl, env) {
  const hosts = (env.SHOPOS_TEST_FAIL_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  if (env.SHOPOS_TEST_MODE !== "1" || hosts.length === 0) return fetchImpl;
  return (url, init) => {
    const host = new URL(String(url)).hostname;
    if (hosts.some((h) => host === h || host.endsWith(`.${h}`))) return Promise.reject(Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" }));
    return fetchImpl(url, init);
  };
}

// Use the flag/env key; otherwise ask (up to 3 tries) so every report carries the real key.
async function resolveLicenseKey(ctx, given) {
  if (given) return normalizeLicenseKey(given);
  for (let i = 0; i < 3; i++) {
    let raw = "";
    try { raw = await ctx.prompt("Blueprint OS license key:"); } catch { break; }
    const key = normalizeLicenseKey(raw);
    if (!key) break;
    if (looksLikeLicenseKey(key)) return key;
    ctx.print("That does not look like a Blueprint OS key. The format is SHOP-XXXX-XXXX-XXXX.");
  }
  return null;
}

export async function runInstall({ argv = process.argv.slice(2), env = process.env, ctxOverrides = {}, steps } = {}) {
  const args = parseArgs(argv, env);
  const started = Date.now();
  const supportCode = newSupportCode();
  const runId = newRunId();
  let ctx = null;
  let print = ctxOverrides.print ?? ((m) => console.log(m));
  let stage = "orchestrator";
  try {
    ctx = createContext({
      env, licenseKey: args.licenseKey ?? null, vaultPath: args.vaultPath ?? null, flags: { noLaunch: args.noLaunch },
      ...(args.licenseServer ? { licenseServer: args.licenseServer } : {}), ...ctxOverrides,
    });
    print = ctx.print;
    ctx.notes = ctx.notes ?? [];
    ctx.fetchImpl = withTestFaults(ctx.fetchImpl, env);
    ctx.runId = runId;
    ctx.supportCode = supportCode;
    const key = await resolveLicenseKey(ctx, args.licenseKey);
    ctx.licenseKey = key;
    ctx.reporter = createReporter({
      licenseKey: key ?? "unknown", runId, supportCode, serverBase: ctx.licenseServer,
      fetchImpl: ctx.fetchImpl, logDir: join(ctx.shoposHome, "logs"), homeDir: ctx.homeDir, homeToken: ctx.platform === "win32" ? "%USERPROFILE%" : "~",
    });
    ctx.print(`Blueprint OS setup. Support code (quote this if you need help): ${supportCode}`);
    const result = await runSteps(steps ?? buildSteps(), ctx, {
      reporter: ctx.reporter,
      onStepDone: (e) => ctx.print(`  ${e.status === "failed" ? "x" : e.status === "warn" ? "!" : e.status === "skipped" ? "-" : "ok"} ${e.title}`),
    });
    const snapshot = await ctx.snapshot().catch(() => undefined);
    const base = { timeline: result.timeline, notes: ctx.notes ?? [], snapshot, duration_ms: result.timeline.reduce((n, t) => n + (t.durationMs ?? 0), 0) };
    if (result.ok) {
      await ctx.reporter.send({ status: "success", step: "complete", ...base });
      ctx.print(renderSuccess({
        desktopInstalled: !!snapshot?.desktop, vaultPath: ctx.vaultPath,
        warnings: [...(ctx.notes ?? []), ...result.warnings.map((w) => `${w.title}: ${w.error}`)],
      }));
    } else {
      const f = result.failed;
      await ctx.reporter.send({ status: "error", step: f.id, step_title: f.title, error_message: f.error, command: f.command, exit_code: f.exitCode, output_tail: f.outTail, hint: f.hint, ...base });
      ctx.print(renderFailure({ stepTitle: f.title, supportCode, logPath: ctx.reporter.logPath }));
    }
    await ctx.reporter.flush();
    return { exitCode: result.ok ? 0 : 1, result };
  } catch (e) {
    // The orchestrator itself broke (not a step). Still tell the customer, report best-effort, never throw.
    const message = String(e?.message ?? e);
    try {
      print(renderFailure({ stepTitle: "Starting setup", supportCode, logPath: ctx?.reporter?.logPath ?? "(not available)" }));
    } catch { /* ignore */ }
    try {
      if (ctx?.reporter) {
        await ctx.reporter.send({ status: "error", step: stage, step_title: "Starting setup", error_message: message, timeline: [], notes: ctx.notes ?? [], duration_ms: Date.now() - started });
        await ctx.reporter.flush();
      }
    } catch { /* ignore */ }
    return { exitCode: 1, result: { ok: false, timeline: [], failed: { id: stage, title: "Starting setup", error: message }, warnings: [], retried: [] } };
  }
}
