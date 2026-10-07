// installer/steps/git.js
import { join } from "node:path";
import { existsSync } from "node:fs";
import { StepError } from "../core/errors.js";
import { extractZip } from "../zip.js";

// Claude Code's plugin commands shell out to git for `owner/repo` marketplaces
// and every plugin install (spike runs 2-5). Windows PCs often have none, so we
// unpack portable MinGit (a zip, no installer, no admin) and put it on PATH for
// OUR child processes only. Nothing is added to the customer's PATH.
export async function ensureGit(ctx) {
  const have = await ctx.run("git", ["--version"], { env: ctx.childEnv(), timeoutMs: 15000 });
  if (have.ok) return;
  if (ctx.platform !== "win32") {
    throw new StepError("Git is not available on this Mac. Run `xcode-select --install`, then run the installer again.", { outTail: have.outTail, hint: "This Mac needs the Xcode Command Line Tools (run: xcode-select --install)." });
  }
  const dir = join(ctx.shoposHome, "tools", "mingit");
  const cmdDir = join(dir, "cmd");
  if (!existsSync(join(cmdDir, "git.exe"))) {
    const rel = await ctx.fetchImpl("https://api.github.com/repos/git-for-windows/git/releases/latest", { headers: { "User-Agent": "blueprint-os-installer" } });
    if (!rel.ok) throw new StepError(`Could not look up the portable Git download: HTTP ${rel.status}`);
    const suffix = ctx.arch === "arm64" ? "arm64" : "64-bit";
    const asset = (await rel.json()).assets.find((a) => new RegExp(`^MinGit-[\\d.]+-${suffix}\\.zip$`).test(a.name));
    if (!asset) throw new StepError(`No portable Git (${suffix}) found in the latest Git for Windows release.`);
    const zip = await ctx.fetchImpl(asset.browser_download_url);
    if (!zip.ok) throw new StepError(`Could not download ${asset.name}: HTTP ${zip.status}`);
    extractZip(Buffer.from(await zip.arrayBuffer()), dir);
  }
  if (!ctx.extraPath.includes(cmdDir)) ctx.extraPath.unshift(cmdDir);
  const check = await ctx.run("git", ["--version"], { env: ctx.childEnv(), timeoutMs: 15000 });
  if (!check.ok) throw new StepError("Portable Git was unpacked but does not run.", { command: check.cmdline, outTail: check.outTail });
}
