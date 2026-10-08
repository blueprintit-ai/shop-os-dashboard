import { StepError } from "../core/errors.js";

// macOS only. `git` on a Mac without Apple's Command Line Tools pops up the developer-tools
// installer, so we look at `xcode-select -p` first and never run git until it succeeds.
export const CLT_MESSAGE =
  "macOS needs to install Apple's free Command Line Tools before Blueprint OS can continue. A window will appear: click Install, " +
  "wait until it finishes (a few minutes), then run this setup again.";
export const CLT_HINT = "This Mac needs the Xcode Command Line Tools (run: xcode-select --install). The customer must click Install in the macOS window, wait for it to finish, then re-run setup.";

export async function hasCommandLineTools(run) {
  try { return !!(await run("xcode-select", ["-p"], { timeoutMs: 8000 }))?.ok; } catch { return false; }
}

// Builds the customer-readable StepError and opens Apple's installer window (fire and forget).
export function commandLineToolsMissing(ctx) {
  try { Promise.resolve(ctx.run("xcode-select", ["--install"], { timeoutMs: 15000 })).catch(() => {}); } catch { /* the message still tells them what to do */ }
  return new StepError(CLT_MESSAGE, { hint: CLT_HINT });
}
