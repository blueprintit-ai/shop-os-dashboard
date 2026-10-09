// installer/core/runner.js
import { StepError } from "./errors.js";
import { hintFor } from "./diagnose.js";

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Reporting must never block or throw into the step loop.
function safeSend(reporter, event) {
  try {
    const p = reporter?.send?.(event);
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch {
    // ignore
  }
}

function errText(e) {
  try {
    const t = String(e?.message || e);
    return t || "Unknown error";
  } catch {
    return "Unknown error";
  }
}

function field(e, k) {
  try { return e?.[k]; } catch { return undefined; }
}

const HEARTBEAT_AFTER_MS = 8000;
const HEARTBEAT_EVERY_MS = 10000;

// Console-only reassurance for long steps. Never goes to the reporter; never throws; never keeps the process alive.
function startHeartbeat(step, ctx, now, timers) {
  if (step.heartbeat === false || typeof ctx?.print !== "function") return null;
  const t0 = now();
  let lastAt = null;
  try {
    return timers.setInterval(() => {
      try {
        const elapsed = now() - t0;
        if (elapsed < HEARTBEAT_AFTER_MS) return;
        if (lastAt !== null && elapsed - lastAt < HEARTBEAT_EVERY_MS) return;
        lastAt = elapsed;
        ctx.print(`Still working on "${step.title}"... please keep this window open. (${Math.round(elapsed / 1000)}s)`);
      } catch { /* ignore */ }
    }, 1000);
  } catch {
    return null;
  }
}

function stopHeartbeat(handle, timers) {
  if (handle === null) return;
  try { timers.clearInterval(handle); } catch { /* ignore */ }
}

function defaultSetInterval(fn, ms) {
  const h = setInterval(fn, ms);
  h?.unref?.();
  return h;
}

export async function runSteps(steps, ctx, { reporter, now = Date.now, sleep = realSleep, retryDelayMs = 1500, onStepStart, onStepDone, setInterval: setIv = defaultSetInterval, clearInterval: clearIv = clearInterval } = {}) {
  const timers = { setInterval: setIv, clearInterval: clearIv };
  const timeline = [];
  for (const step of steps) {
    const entry = { id: step.id, title: step.title, status: "ok", attempts: 0, durationMs: 0 };
    const t0 = now();
    safeSend(reporter, { status: "progress", step: step.id, step_title: step.title });
    try {
      if (step.check && (await step.check(ctx))) {
        entry.status = "skipped";
      } else {
        // Console-only: the check said the action will run, so tell the customer now (once, not per attempt).
        try { onStepStart?.(step); } catch { /* a callback must not break the run */ }
        const max = 1 + (step.retries ?? 0);
        let lastErr = null;
        let failed = false;
        for (let attempt = 1; attempt <= max; attempt++) {
          entry.attempts = attempt;
          const hb = startHeartbeat(step, ctx, now, timers);
          try {
            await step.action(ctx);
            if (step.verify) {
              const v = await step.verify(ctx);
              if (v !== true) throw new StepError(typeof v === "string" && v ? v : "Could not confirm this step worked.");
            }
            failed = false;
            break;
          } catch (e) {
            stopHeartbeat(hb, timers);
            lastErr = e;
            failed = true;
            if (attempt < max) {
              safeSend(reporter, { status: "retry", step: step.id, error_message: errText(e) });
              await sleep(retryDelayMs);
            }
          } finally {
            stopHeartbeat(hb, timers);
          }
        }
        if (failed) throw lastErr;
        if (entry.attempts > 1) entry.retried = true;
      }
    } catch (e) {
      entry.status = step.severity === "warn" ? "warn" : "failed";
      entry.error = errText(e);
      entry.command = field(e, "command");
      entry.exitCode = field(e, "exitCode");
      entry.outTail = field(e, "outTail");
      entry.hint = field(e, "hint") ?? hintFor({ message: entry.error, outTail: entry.outTail }) ?? undefined;
    }
    entry.durationMs = now() - t0;
    timeline.push(entry);
    try { onStepDone?.(entry); } catch { /* a callback must not break the run */ }
    if (entry.status === "failed") return summary(false, timeline, entry);
  }
  return summary(true, timeline, null);
}

function summary(ok, timeline, failed) {
  return {
    ok,
    timeline,
    failed,
    warnings: timeline.filter((t) => t.status === "warn"),
    retried: timeline.filter((t) => t.retried === true),
  };
}
