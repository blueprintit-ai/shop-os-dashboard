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

// Last resort only: used when the redirect lookup below fails. It may be stale, but old Obsidian
// releases stay downloadable, so a stale pin still installs a working app.
export const OBSIDIAN_FALLBACK_VERSION = "1.14.4";
const RELEASES = "https://github.com/obsidianmd/obsidian-releases/releases";

// Asks github.com (not the rate-limited API) where /releases/latest points: a 302 to .../tag/vX.Y.Z.
// Any failure returns the pinned fallback; the lookup alone must never block the install.
async function latestVersion(ctx) {
  try {
    const r = await ctx.fetchImpl(`${RELEASES}/latest`, { redirect: "manual", headers: { "User-Agent": "blueprint-os-installer" } });
    const loc = r?.status === 302 ? r.headers?.get?.("location") : null;
    const m = typeof loc === "string" ? /\/tag\/v?(\d+\.\d+\.\d+)$/.exec(loc) : null;
    if (m) return m[1];
  } catch { /* fall through to the pinned version */ }
  return OBSIDIAN_FALLBACK_VERSION;
}

async function latestAsset(ctx, ext) {
  const v = await latestVersion(ctx);
  const name = `Obsidian-${v}.${ext}`;
  return { name, url: `${RELEASES}/download/v${v}/${name}` };
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
      const asset = await latestAsset(ctx, win ? "exe" : "dmg");
      let resp;
      try {
        resp = await ctx.fetchImpl(asset.url);
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
