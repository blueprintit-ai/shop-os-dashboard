// installer/steps/plugins.js
import { join } from "node:path";
import { StepError, failFromResult } from "../core/errors.js";
import { claudePath, listPlugins } from "../core/claude.js";
import { fetchMarketplaceTarball } from "../marketplaces.js";
import { ensureGit } from "./git.js";

export const PLUGIN_IDS = ["obsidian@blueprint-skills", "superpowers@claude-plugins-official"];
const ALREADY_MARKETPLACE = /already (exists|added|configured)/i;
const ALREADY_INSTALL = /already installed/i;

async function bothEnabled(ctx) {
  const have = await listPlugins(ctx);
  return PLUGIN_IDS.every((id) => have.some((p) => p.id === id && p.enabled));
}

async function claude(ctx, args, what, already) {
  const r = await ctx.run(claudePath(ctx), args, { env: ctx.childEnv(), timeoutMs: 5 * 60 * 1000 });
  if (!r.ok && !(already.test(r.outTail ?? "") && !r.timedOut)) failFromResult(what, r);
}

export function pluginsStep({ fetchTarball = fetchMarketplaceTarball } = {}) {
  return {
    id: "plugins", title: "Installing the Blueprint OS skills", severity: "stop", retries: 1,
    check: bothEnabled,
    async action(ctx) {
      await ensureGit(ctx);
      // blueprint-skills is ours: fetched as a tarball over HTTPS (no git), then added as a folder.
      // The folder is READ by Claude Code afterwards, so it lives in a permanent place, not temp.
      const mpDir = join(ctx.shoposHome, "marketplaces", "blueprint-skills");
      const t = await fetchTarball({ repo: "blueprintit-ai/blueprint-skills", destDir: mpDir, fetchImpl: ctx.fetchImpl });
      if (!t.ok) throw new StepError(`Could not download the Blueprint OS skills: ${t.error}`);
      await claude(ctx, ["plugin", "marketplace", "add", mpDir], "Could not add the Blueprint OS skills marketplace.", ALREADY_MARKETPLACE);
      // Official marketplace: the name is reserved, so it must come from GitHub (needs git, provided above).
      await claude(ctx, ["plugin", "marketplace", "add", "anthropics/claude-plugins-official"], "Could not add the official Claude plugins marketplace.", ALREADY_MARKETPLACE);
      for (const id of PLUGIN_IDS) await claude(ctx, ["plugin", "install", id, "--scope", "user"], `Could not install ${id}.`, ALREADY_INSTALL);
    },
    verify: async (ctx) => ((await bothEnabled(ctx)) ? true : "Both skills were installed but `claude plugin list` does not show them enabled."),
  };
}
