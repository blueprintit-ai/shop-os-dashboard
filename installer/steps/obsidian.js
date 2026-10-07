// installer/steps/obsidian.js
import { writeFileSync, mkdtempSync, mkdirSync, createWriteStream, rmSync, renameSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { StepError, failFromResult } from "../core/errors.js";

function winExe(ctx) {
  return join(ctx.env.LOCALAPPDATA ?? join(ctx.homeDir, "AppData", "Local"), "Programs", "Obsidian", "Obsidian.exe");
}
function obsidianPaths(ctx) {
  return ctx.platform === "win32"
    ? [winExe(ctx), join(ctx.env.ProgramFiles ?? "C:\\Program Files", "Obsidian", "Obsidian.exe")]
    : ["/Applications/Obsidian.app", join(ctx.homeDir, "Applications", "Obsidian.app")];
}
const installed = (ctx) => obsidianPaths(ctx).some((p) => ctx.exists(p));

async function latestAsset(ctx, re) {
  let rel;
  try {
    rel = await ctx.fetchImpl("https://api.github.com/repos/obsidianmd/obsidian-releases/releases/latest", { headers: { "User-Agent": "blueprint-os-installer", Accept: "application/vnd.github+json" } });
  } catch (e) {
    throw new StepError(`Could not reach GitHub to look up the Obsidian download: ${e.message}`);
  }
  if (!rel.ok) throw new StepError(`Could not look up the Obsidian download: HTTP ${rel.status}`);
  const asset = ((await rel.json()).assets ?? []).find((a) => re.test(a.name));
  if (!asset) throw new StepError("No matching Obsidian download was found in the latest release.");
  return asset;
}

// Writes a ~300 MB response to disk without holding two copies in memory.
async function saveResponse(resp, file) {
  if (resp.body && typeof resp.body.getReader === "function") {
    await pipeline(Readable.fromWeb(resp.body), createWriteStream(file));
  } else {
    writeFileSync(file, Buffer.from(await resp.arrayBuffer()));
  }
}

export function obsidianStep() {
  return {
    id: "obsidian", title: "Installing Obsidian", severity: "warn", retries: 2,
    check: async (ctx) => installed(ctx),
    async action(ctx) {
      const win = ctx.platform === "win32";
      const asset = await latestAsset(ctx, win ? /^Obsidian-[\d.]+\.exe$/ : /^Obsidian-[\d.]+\.dmg$/);
      let resp;
      try {
        resp = await ctx.fetchImpl(asset.browser_download_url);
      } catch (e) {
        throw new StepError(`Could not download Obsidian: ${e.message}`);
      }
      if (!resp.ok) throw new StepError(`Could not download ${asset.name}: HTTP ${resp.status}`);
      const dir = mkdtempSync(join(ctx.tmpDir(), "obs-"));
      try {
        const file = join(dir, asset.name);
        await saveResponse(resp, file);
        if (win) {
          // Per-user silent install (no UAC). Start-Process -Wait, not a direct pipe: the app the
          // installer launches at the end inherits the output pipe and would hang runCommand (CI spike).
          // The path travels in an environment variable, so no quoting problem is possible.
          const script = "$ErrorActionPreference = 'Stop'; $p = Start-Process -FilePath $env:BP_OBS_EXE -ArgumentList '/S' -Wait -PassThru; exit $p.ExitCode";
          const r = await ctx.run("powershell", ["-NoProfile", "-Command", script], { timeoutMs: 5 * 60 * 1000, env: { ...ctx.childEnv(), BP_OBS_EXE: file } });
          if (!r.ok) failFromResult("The Obsidian installer did not finish.", r);
          return;
        }
        const mnt = join(dir, "mnt");
        mkdirSync(mnt, { recursive: true });
        const attach = await ctx.run("hdiutil", ["attach", "-nobrowse", "-quiet", "-mountpoint", mnt, file], { timeoutMs: 120000 });
        if (!attach.ok) failFromResult("Could not open the Obsidian disk image.", attach);
        const appsDir = join(ctx.homeDir, "Applications");
        const finalApp = join(appsDir, "Obsidian.app");
        const partial = join(appsDir, "Obsidian.app.partial");
        try {
          mkdirSync(appsDir, { recursive: true });
          rmSync(partial, { recursive: true, force: true });
          const copy = await ctx.run("ditto", [join(mnt, "Obsidian.app"), partial], { timeoutMs: 120000 });
          if (!copy.ok) failFromResult("Could not copy Obsidian into your Applications folder.", copy);
          renameSync(partial, finalApp);
        } finally {
          try { rmSync(partial, { recursive: true, force: true }); } catch { /* best effort */ }
          await ctx.run("hdiutil", ["detach", mnt, "-quiet"], { timeoutMs: 60000 });
        }
      } finally {
        try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
      }
    },
    verify: async (ctx) => (installed(ctx) ? true : "Obsidian was installed but its app could not be found afterwards."),
  };
}
