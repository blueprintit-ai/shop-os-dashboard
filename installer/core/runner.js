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

export async function runSteps(steps, ctx, { reporter, now = Date.now, sleep = realSleep, retryDelayMs = 1500, onStepDone } = {}) {
  const timeline = [];
  for (const step of steps) {
    const entry = { id: step.id, title: step.title, status: "ok", attempts: 0, durationMs: 0 };
    const t0 = now();
    safeSend(reporter, { status: "progress", step: step.id, step_title: step.title });
    try {
      if (step.check && (await step.check(ctx))) {
        entry.status = "skipped";
      } else {
        const max = 1 + (step.retries ?? 0);
        let lastErr = null;
        let failed = false;
        for (let attempt = 1; attempt <= max; attempt++) {
          entry.attempts = attempt;
          try {
            await step.action(ctx);
            if (step.verify) {
              const v = await step.verify(ctx);
              if (v !== true) throw new StepError(typeof v === "string" && v ? v : "Could not confirm this step worked.");
            }
            failed = false;
            break;
          } catch (e) {
            lastErr = e;
            failed = true;
            if (attempt < max) {
              safeSend(reporter, { status: "retry", step: step.id, error_message: errText(e) });
              await sleep(retryDelayMs);
            }
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
