import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { StepError } from "../core/errors.js";

// ASCII-only on purpose: Windows PowerShell 5.1 reads BOM-less files in the system codepage.
export const PICKER_PS1 = [
  "Add-Type -AssemblyName System.Windows.Forms",
  "Add-Type -AssemblyName System.Drawing",
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
  "$f = $null",
  "try {",
  "  $f = New-Object System.Windows.Forms.Form",
  "  $f.ShowInTaskbar = $false",
  "  $f.StartPosition = 'CenterScreen'",
  "  $f.Size = New-Object System.Drawing.Size(1,1)",
  "  $f.Opacity = 0",
  "  $f.TopMost = $true",
  "  $f.Show()",
  "  $f.Activate()",
  "  $d = New-Object System.Windows.Forms.FolderBrowserDialog",
  "  $d.Description = 'Choose where to keep your Blueprint OS folder (your Dropbox folder is a good choice).'",
  "  $d.ShowNewFolderButton = $true",
  "  $r = $d.ShowDialog($f)",
  "  if ($r -eq 'OK') { Write-Output $d.SelectedPath }",
  "} finally {",
  "  if ($f -ne $null) { $f.Dispose() }",
  "}",
].join("\r\n");

export function findExistingVault(parent, exists) {
  for (const name of ["Blueprint OS", "Shop OS"]) {
    if (exists(join(parent, name)) && exists(join(parent, name, "CLAUDE.md"))) return name;
  }
  return null;
}

export function validateVaultName(name) {
  const n = String(name ?? "").trim();
  const bad = () => new StepError("That folder name can't be used. Use letters, numbers and spaces only, without \\ / : * ? \" < > |, and don't end the name with a dot or space.");
  if (!n || n === "." || n === "..") throw bad();
  if (/[\\/<>:"|?*\u0000-\u001f]/.test(n)) throw bad();
  if (/[. ]$/.test(n)) throw bad();
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(n)) throw new StepError(`"${n}" is a reserved Windows name. Choose a different folder name.`);
  return n;
}

const REMINDER_EVERY_MS = 10000;

// Remind the customer every 10 s while the picker process runs. Always cleared; the timer is unref'd by default.
async function withReminders(ctx, work) {
  let n = 0;
  let h = null;
  try {
    h = ctx.setInterval(() => {
      n++;
      try { ctx.print(`Still waiting for the folder window. Look for a window called "Browse For Folder" in your taskbar, or press Alt+Tab. (${n * 10}s)`); } catch { /* ignore */ }
    }, REMINDER_EVERY_MS);
  } catch { h = null; }
  try {
    return await work();
  } finally {
    if (h !== null) { try { ctx.clearInterval(h); } catch { /* ignore */ } }
  }
}

async function pickFolder(ctx) {
  if (ctx.platform === "win32") {
    const dir = mkdtempSync(join(ctx.tmpDir(), "pick-"));
    try {
      const file = join(dir, "pick.ps1");
      writeFileSync(file, PICKER_PS1, "ascii");
      return await withReminders(ctx, () => ctx.run("powershell", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", file], { timeoutMs: 15 * 60 * 1000 }));
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
  return withReminders(ctx, () => ctx.run("osascript", ["-e", 'POSIX path of (choose folder with prompt "Choose where to keep your Blueprint OS folder (your Dropbox folder is a good choice).")'], { timeoutMs: 15 * 60 * 1000 }));
}

// The vault step records the chosen folder in <shoposHome>/install-state.json. On a re-run reuse it
// (so a different pick can't create a second vault) unless the customer asks to choose again.
function savedVault(ctx) {
  if (ctx.flags?.chooseFolder === true || ctx.env?.SHOPOS_CHOOSE_FOLDER === "1") return null;
  try {
    const state = JSON.parse(ctx.readText(join(ctx.shoposHome, "install-state.json")));
    const p = state?.vaultPath;
    if (typeof p !== "string" || !p.trim()) return null;
    return ctx.exists(p) && ctx.exists(join(p, "CLAUDE.md")) ? p : null;
  } catch {
    return null;
  }
}

export function vaultLocationStep() {
  return {
    id: "vault-location", title: "Choosing where to keep your Blueprint OS folder", severity: "stop",
    heartbeat: false, // this step has its own messages
    check: async (ctx) => {
      if (ctx.vaultPath) return true;
      const saved = savedVault(ctx);
      if (!saved) return false;
      ctx.vaultPath = saved;
      ctx.print(`Using your existing Blueprint OS folder: ${saved}`); // console only; ctx.print is never forwarded to the reporter
      return true;
    },
    async action(ctx) {
      ctx.print("Opening the folder window. The first time this can take up to a minute.");
      const r = await pickFolder(ctx);
      if (r.timedOut) throw new StepError("The folder window was left open too long. Run the installer again and choose a folder.");
      let parent = (r.stdout ?? "").replace(/^\uFEFF/, "").trim().split(/\r?\n/).pop()?.trim() ?? "";
      if (parent.length > 1) parent = parent.replace(/[\\/]+$/, "") || parent.slice(0, 1);
      if (/^[A-Za-z]:$/.test(parent)) parent += "\\";
      if (!r.ok || !parent) throw new StepError("No folder was chosen. Run the installer again and pick a folder when the window opens.");
      const def = findExistingVault(parent, ctx.exists) ?? "Blueprint OS";
      let name = null;
      for (let attempt = 1; attempt <= 3 && name === null; attempt++) {
        try {
          name = validateVaultName(await ctx.prompt("Name for your Blueprint OS folder?", def));
        } catch (e) {
          if (attempt === 3 || !(e instanceof StepError)) throw e;
          ctx.print(e.message);
        }
      }
      ctx.vaultPath = join(parent, name);
    },
    verify: async (ctx) => (ctx.vaultPath ? true : "No vault folder was selected."),
  };
}
