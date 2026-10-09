import { spawn } from "node:child_process";
import { claudePath, authOk } from "../core/claude.js";

function interactive(ctx) {
  return new Promise((resolve) => {
    const child = spawn(claudePath(ctx), [], { cwd: ctx.vaultPath, env: ctx.childEnv(), stdio: "inherit" });
    child.on("error", () => {
      ctx.print("\nClaude Code could not be opened automatically. To open it yourself, open a terminal in your Blueprint OS folder and run `claude`.\n");
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 0));
  });
}

export function launchStep() {
  return {
    id: "launch", title: "Opening Claude Code", severity: "warn", heartbeat: false,
    check: async (ctx) => ctx.flags?.noLaunch === true,
    async action(ctx) {
      const run = ctx.interactive ?? interactive;
      ctx.print("\nStep 1 of 2: sign in to Claude Code. After signing in, type /exit and it will reopen with all your /bp commands ready.\n");
      await run(ctx);
      if (!(await authOk(ctx))) {
        ctx.print("\nYou are not signed in yet. Open Claude Code any time from your Blueprint OS folder, run `claude`, and sign in.\n");
        return;
      }
      ctx.print("\nReopening Claude Code with all /bp commands ready...\n");
      await run(ctx);
    },
  };
}
