// installer/steps/claude-code.js
import { writeFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { StepError, failFromResult } from "../core/errors.js";
import { claudeVersion } from "../core/claude.js";

export function claudeCodeStep() {
  return {
    id: "claude-code", title: "Installing Claude Code", severity: "stop", retries: 1,
    check: async (ctx) => !!(await claudeVersion(ctx)),
    async action(ctx) {
      const win = ctx.platform === "win32";
      const url = win ? "https://claude.ai/install.ps1" : "https://claude.ai/install.sh";
      let resp;
      try { resp = await ctx.fetchImpl(url); }
      catch (e) { throw new StepError(`Could not download the Claude Code installer from ${url}: ${e?.message ?? e}`); }
      if (!resp.ok) throw new StepError(`Could not download the Claude Code installer: HTTP ${resp.status} from ${url}`);
      const text = await resp.text();
      const file = join(ctx.tmpDir(), `claude-install-${randomUUID()}.${win ? "ps1" : "sh"}`);
      try {
        // BOM so Windows PowerShell 5.1 decodes the file as UTF-8, not the system codepage.
        writeFileSync(file, win ? `\ufeff${text}` : text, { encoding: "utf8", mode: 0o700, flag: "wx" });
        const r = win
          ? await ctx.run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file], { env: ctx.childEnv(), timeoutMs: 10 * 60 * 1000 })
          : await ctx.run("/bin/bash", [file], { env: ctx.childEnv(), timeoutMs: 10 * 60 * 1000 });
        if (!r.ok) failFromResult("The Claude Code installer did not finish.", r);
      } finally {
        try { rmSync(file, { force: true }); } catch { /* best effort */ }
      }
    },
    verify: async (ctx) => ((await claudeVersion(ctx)) ? true : "Claude Code was installed but `claude --version` does not run."),
  };
}
