// installer/autostart-windows.js
import { spawnSync as defaultSpawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TASK_NAME = "ShopOSDashboard";

// Per-user, no /RL HIGHEST, no elevation — /sc ONLOGON registers a login
// trigger in the current user's own Task Scheduler library.
export function registerAutoStart({ nodeBin, dashboardBin, vaultPath, spawnSyncImpl = defaultSpawnSync }) {
  const command = `"${nodeBin}" "${dashboardBin}" "${vaultPath}" --no-browser`;
  const result = spawnSyncImpl("schtasks", [
    "/create", "/tn", TASK_NAME, "/sc", "ONLOGON", "/tr", command, "/f",
  ], { encoding: "utf8" });
  if (result.status !== 0) return { ok: false, error: result.stderr || `schtasks exited ${result.status}` };
  return { ok: true };
}

// WScript.Shell's CreateShortcut is the standard dependency-free way to make a
// .lnk on Windows; cscript ships with every Windows install, no admin needed.
export function createDesktopShortcut({ nodeBin, dashboardBin, vaultPath, desktopDir, spawnSyncImpl = defaultSpawnSync }) {
  const shortcutPath = join(desktopDir, "Shop OS.lnk");
  const vbs = `
Set oShell = CreateObject("WScript.Shell")
Set oShortcut = oShell.CreateShortcut("${shortcutPath.replace(/\\/g, "\\\\")}")
oShortcut.TargetPath = "${nodeBin.replace(/\\/g, "\\\\")}"
oShortcut.Arguments = """${dashboardBin.replace(/\\/g, "\\\\")}"" ""${vaultPath.replace(/\\/g, "\\\\")}"""
oShortcut.WorkingDirectory = "${vaultPath.replace(/\\/g, "\\\\")}"
oShortcut.Description = "Shop OS"
oShortcut.Save
`.trim();
  // Best-effort per the plan's Global Constraints: a locked-down desktopDir,
  // a full temp volume, etc. must report {ok:false}, not throw and abort setup.
  try {
    const scriptDir = mkdtempSync(join(tmpdir(), "shopos-shortcut-"));
    const vbsPath = join(scriptDir, "shortcut.vbs");
    writeFileSync(vbsPath, vbs, "utf8");
    const result = spawnSyncImpl("cscript", ["//nologo", vbsPath], { encoding: "utf8" });
    if (result.status !== 0) return { ok: false, error: result.stderr || `cscript exited ${result.status}` };
    return { ok: true, path: shortcutPath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
