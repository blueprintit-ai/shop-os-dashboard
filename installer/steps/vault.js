// installer/steps/vault.js
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { createVaultClaudeMd, createRawInbox, enableForVault, saveLicenseFile } from "../vault-setup.js";
import { StepError } from "../core/errors.js";
import { JsonStore } from "../../src/lib/store.js";

export function vaultStep() {
  return {
    id: "vault", title: "Setting up your Blueprint OS folder", severity: "stop",
    async action(ctx) {
      if (!ctx.license || !ctx.vaultPath) throw new StepError("Setup reached the folder step without a validated license or a chosen folder.");
      mkdirSync(ctx.vaultPath, { recursive: true });
      createVaultClaudeMd(ctx.vaultPath, ctx.license); // returns false and leaves an existing CLAUDE.md alone
      createRawInbox(ctx.vaultPath);
      const { warning } = enableForVault(ctx.vaultPath); // belt-and-braces; the real enablement is user scope (plugins step)
      if (warning) {
        ctx.notes = [...(ctx.notes ?? []), warning];
        ctx.print(`Note: ${warning}`);
      }
      saveLicenseFile(ctx.license, ctx.homeDir);
      const store = new JsonStore(join(ctx.shoposHome, "install-state.json"), {});
      const prev = store.load();
      store.save({ vaultPath: ctx.vaultPath, installedAt: prev.installedAt ?? new Date().toISOString() });
    },
    verify: async (ctx) => {
      const need = [join(ctx.vaultPath, "CLAUDE.md"), join(ctx.vaultPath, "Raw", "README.md"), join(ctx.vaultPath, ".claude", "settings.json"), join(ctx.homeDir, ".shopos", "license.json")];
      const missing = need.filter((p) => !ctx.exists(p));
      return missing.length ? `Missing after setup: ${missing.join(", ")}` : true;
    },
  };
}
