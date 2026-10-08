import { join } from "node:path";
import { existsSync, rmSync, renameSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { StepError } from "../core/errors.js";
import { extractZip } from "../zip.js";
import { hasCommandLineTools, commandLineToolsMissing } from "./clt.js";

// Claude Code's plugin commands shell out to git for `owner/repo` marketplaces
// and every plugin install (spike runs 2-5). Windows PCs often have none, so we
// unpack portable MinGit (a zip, no installer, no admin) and put it on PATH for
// OUR child processes only. Nothing is added to the customer's PATH.
//
// Pinned on purpose: no unauthenticated GitHub API lookup (60 req/h per IP) and
// every download is verified against a SHA-256 before anything is extracted.
// To update: `gh api repos/git-for-windows/git/releases/latest` -> tag and the
// MinGit-<ver>-64-bit.zip / MinGit-<ver>-arm64.zip assets (NOT busybox); download
// each, `shasum -a 256` it, and cross-check the sha256 table in the release body.
const BASE = "https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.2";
export const MINGIT = {
  version: "2.56.0.2",
  assets: {
    x64: { url: `${BASE}/MinGit-2.56.0.2-64-bit.zip`, sha256: "da35e72aa21c005a5a0d298cfbae110bc1609a815730ea0dde84b01a1b3cd3be" },
    arm64: { url: `${BASE}/MinGit-2.56.0.2-arm64.zip`, sha256: "38b33dc6024026e3315cf88ab2cfea65205bbd7bb3a8e824bd21c8ad4fe609a7" },
  },
};

async function gitRuns(ctx, cmdDir) {
  const env = ctx.childEnv();
  if (cmdDir) {
    const key = Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
    env[key] = [cmdDir, env[key] ?? ""].filter(Boolean).join(ctx.platform === "win32" ? ";" : ":");
  }
  return ctx.run("git", ["--version"], { env, timeoutMs: 15000 });
}

async function download(ctx, url) {
  let resp;
  try { resp = await ctx.fetchImpl(url); }
  catch (e) { throw new StepError(`Could not download the portable Git from ${url}: ${e?.message ?? e}`); }
  if (!resp.ok) throw new StepError(`Could not download the portable Git: HTTP ${resp.status} from ${url}`);
  try { return Buffer.from(await resp.arrayBuffer()); }
  catch (e) { throw new StepError(`Could not download the portable Git from ${url}: ${e?.message ?? e}`); }
}

export async function ensureGit(ctx, { mingit = MINGIT } = {}) {
  if (ctx.platform === "darwin" && !(await hasCommandLineTools(ctx.run))) throw commandLineToolsMissing(ctx);
  const have = await gitRuns(ctx);
  if (have.ok) return;
  if (ctx.platform !== "win32") {
    throw new StepError("Git is not available on this Mac. Run `xcode-select --install`, then run the installer again.", { outTail: have.outTail, hint: "This Mac needs the Xcode Command Line Tools (run: xcode-select --install)." });
  }
  const toolsDir = join(ctx.shoposHome, "tools");
  const dir = join(toolsDir, "mingit");
  const partial = join(toolsDir, "mingit.partial");
  const cmdDir = join(dir, "cmd");

  if (existsSync(dir)) {
    // A cached copy counts only if it actually runs; otherwise self-heal.
    if (existsSync(join(cmdDir, "git.exe")) && (await gitRuns(ctx, cmdDir)).ok) {
      if (!ctx.extraPath.includes(cmdDir)) ctx.extraPath.unshift(cmdDir);
      return;
    }
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(partial, { recursive: true, force: true });

  const asset = ctx.arch === "arm64" ? mingit.assets.arm64 : mingit.assets.x64;
  const buf = await download(ctx, asset.url);
  const sum = createHash("sha256").update(buf).digest("hex");
  if (sum !== asset.sha256) {
    throw new StepError(`The portable Git download failed its integrity check (expected ${asset.sha256.slice(0, 12)}..., got ${sum.slice(0, 12)}...). Nothing was installed.`, { hint: `Downloaded from ${asset.url}` });
  }
  try {
    mkdirSync(partial, { recursive: true });
    extractZip(buf, partial);
    if (!existsSync(join(partial, "cmd", "git.exe"))) throw new Error("cmd/git.exe is missing from the archive");
    renameSync(partial, dir);
  } catch (e) {
    rmSync(partial, { recursive: true, force: true });
    throw new StepError(`Could not unpack the portable Git: ${e?.message ?? e}`);
  }
  const check = await gitRuns(ctx, cmdDir);
  if (!check.ok) throw new StepError("Portable Git was unpacked but does not run.", { command: check.cmdline, outTail: check.outTail });
  if (!ctx.extraPath.includes(cmdDir)) ctx.extraPath.unshift(cmdDir);
}
