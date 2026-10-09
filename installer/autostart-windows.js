// installer/autostart-windows.js
import { spawnSync as defaultSpawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";

const TASK_NAME = "ShopOSDashboard";

const LAUNCHER_NAME = "start-dashboard.vbs";

// VBScript reads a BOM-less file as the ANSI codepage (mangles non-ASCII paths) and does not
// understand a UTF-8 BOM; it does honour a UTF-16 LE BOM. See createDesktopShortcut below.
function writeVbs(path, text) {
  writeFileSync(path, Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(text, "utf16le")]));
}

// In VBScript a double quote inside a string literal is written "".
const vbsQuote = (s) => `""${s}""`;

// schtasks /tr is limited to 261 characters, and node + dashboard + vault paths blow past that
// for a profile like "C:\Users\OC Outfeed". So the task only runs a tiny launcher with a short
// fixed name in the .shopos folder; the long command lives inside the launcher. wscript runs it
// with no console window (Run ..., 0, False). The launcher is overwritten on every install.
//
// Per-user, no /RL HIGHEST, no elevation: /sc ONLOGON registers a login trigger in the current
// user's own Task Scheduler library.
export function registerAutoStart({ nodeBin, dashboardBin, vaultPath, launcherDir = join(homedir(), ".shopos"), spawnSyncImpl = defaultSpawnSync }) {
  const launcherPath = join(launcherDir, LAUNCHER_NAME);
  try {
    mkdirSync(launcherDir, { recursive: true });
    const command = [nodeBin, dashboardBin, vaultPath].map(vbsQuote).join(" ") + " --no-browser";
    writeVbs(launcherPath, `Set oShell = CreateObject("WScript.Shell")\r\noShell.Run "${command}", 0, False\r\n`);
  } catch (e) {
    return { ok: false, error: `Could not write the launcher: ${e.message}` };
  }
  const result = spawnSyncImpl("schtasks", [
    "/create", "/tn", TASK_NAME, "/sc", "ONLOGON", "/tr", `wscript.exe "${launcherPath}"`, "/f",
  ], { encoding: "utf8" });
  if (result.status !== 0) return { ok: false, error: result.stderr || `schtasks exited ${result.status}` };
  return { ok: true };
}

// WScript.Shell's CreateShortcut is the standard dependency-free way to make a
// .lnk on Windows; cscript ships with every Windows install, no admin needed.
export function createDesktopShortcut({ nodeBin, dashboardBin, vaultPath, desktopDir, spawnSyncImpl = defaultSpawnSync }) {
  const shortcutPath = join(desktopDir, "Blueprint OS.lnk");
  const vbs = `
Set oShell = CreateObject("WScript.Shell")
Set oShortcut = oShell.CreateShortcut("${shortcutPath.replace(/\\/g, "\\\\")}")
oShortcut.TargetPath = "${nodeBin.replace(/\\/g, "\\\\")}"
oShortcut.Arguments = """${dashboardBin.replace(/\\/g, "\\\\")}"" ""${vaultPath.replace(/\\/g, "\\\\")}"""
oShortcut.WorkingDirectory = "${vaultPath.replace(/\\/g, "\\\\")}"
oShortcut.Description = "Blueprint OS"
oShortcut.Save
`.trim();
  // Best-effort per the plan's Global Constraints: a locked-down desktopDir,
  // a full temp volume, etc. must report {ok:false}, not throw and abort setup.
  try {
    const scriptDir = mkdtempSync(join(tmpdir(), "shopos-shortcut-"));
    const vbsPath = join(scriptDir, "shortcut.vbs");
    // cscript decodes a BOM-less .vbs with the system ANSI codepage, which
    // mangles the C:\Users\<name>\... paths embedded above for any non-ASCII
    // username. The fix is NOT a UTF-8 BOM (that works for PowerShell, but
    // VBScript doesn't recognise it: the three BOM bytes become junk at line 1,
    // column 1 -> "Microsoft VBScript compilation error: Invalid character",
    // seen live on a customer install). VBScript does honour a UTF-16 LE BOM.
    writeVbs(vbsPath, vbs);
    const result = spawnSyncImpl("cscript", ["//nologo", vbsPath], { encoding: "utf8" });
    if (result.status !== 0) return { ok: false, error: result.stderr || `cscript exited ${result.status}` };
    return { ok: true, path: shortcutPath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
