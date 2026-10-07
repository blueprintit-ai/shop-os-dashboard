import { StepError } from "../core/errors.js";

export function machineCheckStep() {
  return {
    id: "machine-check", title: "Checking this computer", severity: "stop",
    async action(ctx) {
      if (!["win32", "darwin"].includes(ctx.platform)) throw new StepError(`Unsupported operating system: ${ctx.platform}. Blueprint OS installs on Windows and Mac.`);
      const s = await ctx.snapshot();
      // free_disk_mb of -1 means "unknown" and must not fail the check.
      if (s.free_disk_mb >= 0 && s.free_disk_mb < 2048) throw new StepError(`Only ${s.free_disk_mb} MB of disk space is free; Blueprint OS needs at least 2048 MB.`);
      if (!s.reach.github) throw new StepError("Cannot reach github.com, which is needed to download Blueprint OS components.", { hint: "GitHub unreachable, likely a firewall or proxy." });
      if (!s.reach.claude_ai) throw new StepError("Cannot reach claude.ai, which is needed to install Claude Code.", { hint: "claude.ai unreachable, likely a firewall or proxy." });
    },
  };
}
