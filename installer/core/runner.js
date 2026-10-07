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
        for (let attempt = 1; attempt <= max; attempt++) {
          entry.attempts = attempt;
          try {
            await step.action(ctx);
            if (step.verify) {
              const v = await step.verify(ctx);
              if (v !== true) throw new StepError(typeof v === "string" ? v : "Could not confirm this step worked.");
            }
            lastErr = null;
            break;
          } catch (e) {
            lastErr = e;
            if (attempt < max) {
              safeSend(reporter, { status: "retry", step: step.id, error_message: e?.message });
              await sleep(retryDelayMs);
            }
          }
        }
        if (lastErr) throw lastErr;
      }
    } catch (e) {
      entry.status = step.severity === "warn" ? "warn" : "failed";
      entry.error = e?.message ?? String(e);
      entry.command = e?.command;
      entry.exitCode = e?.exitCode;
      entry.outTail = e?.outTail;
      entry.hint = e?.hint ?? hintFor({ message: entry.error, outTail: e?.outTail }) ?? undefined;
    }
    entry.durationMs = now() - t0;
    timeline.push(entry);
    try { onStepDone?.(entry); } catch { /* a callback must not break the run */ }
    if (entry.status === "failed") return { ok: false, timeline, failed: entry, warnings: timeline.filter((t) => t.status === "warn") };
  }
  return { ok: true, timeline, failed: null, warnings: timeline.filter((t) => t.status === "warn") };
}
