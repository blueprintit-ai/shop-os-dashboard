import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { StepError } from "../core/errors.js";

// ASCII-only on purpose: Windows PowerShell 5.1 reads BOM-less files in the system codepage.
export const PICKER_PS1 = [
  "Add-Type -AssemblyName System.Windows.Forms",
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
  "$f = New-Object System.Windows.Forms.Form",
  "$f.TopMost = $true",
  "$f.ShowInTaskbar = $false",
  "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
  "$d.Description = 'Choose where to keep your Blueprint OS folder (your Dropbox folder is a good choice).'",
  "$d.ShowNewFolderButton = $true",
  "$r = $d.ShowDialog($f)",
  "$f.Dispose()",
  "if ($r -eq 'OK') { Write-Output $d.SelectedPath }",
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

async function pickFolder(ctx) {
  if (ctx.platform === "win32") {
    const dir = mkdtempSync(join(ctx.tmpDir(), "pick-"));
    try {
      const file = join(dir, "pick.ps1");
      writeFileSync(file, PICKER_PS1, "ascii");
      return await ctx.run("powershell", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", file], { timeoutMs: 15 * 60 * 1000 });
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
  return ctx.run("osascript", ["-e", 'POSIX path of (choose folder with prompt "Choose where to keep your Blueprint OS folder (your Dropbox folder is a good choice).")'], { timeoutMs: 15 * 60 * 1000 });
}

export function vaultLocationStep() {
  return {
    id: "vault-location", title: "Choosing where to keep your Blueprint OS folder", severity: "stop",
    check: async (ctx) => !!ctx.vaultPath,
    async action(ctx) {
      ctx.print("A window will open so you can choose where to keep your Blueprint OS folder.");
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
