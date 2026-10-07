// installer/steps/vault.js
import { join, dirname } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { createVaultClaudeMd, createRawInbox, enableForVault, saveLicenseFile } from "../vault-setup.js";

export function vaultStep() {
  return {
    id: "vault", title: "Setting up your Blueprint OS folder", severity: "stop",
    async action(ctx) {
      mkdirSync(ctx.vaultPath, { recursive: true });
      createVaultClaudeMd(ctx.vaultPath, ctx.license); // returns false and leaves an existing CLAUDE.md alone
      createRawInbox(ctx.vaultPath);
      enableForVault(ctx.vaultPath);                  // belt-and-braces; the real enablement is user scope (plugins step)
      saveLicenseFile(ctx.license, ctx.homeDir);
      const state = join(ctx.shoposHome, "install-state.json");
      mkdirSync(dirname(state), { recursive: true });
      writeFileSync(state, JSON.stringify({ vaultPath: ctx.vaultPath, installedAt: new Date().toISOString() }, null, 2));
    },
    verify: async (ctx) => {
      const need = [join(ctx.vaultPath, "CLAUDE.md"), join(ctx.vaultPath, "Raw", "README.md"), join(ctx.vaultPath, ".claude", "settings.json"), join(ctx.homeDir, ".shopos", "license.json")];
      const missing = need.filter((p) => !ctx.exists(p));
      return missing.length ? `Missing after setup: ${missing.join(", ")}` : true;
    },
  };
}
