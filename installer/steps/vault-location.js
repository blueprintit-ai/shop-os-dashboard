import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { StepError } from "../core/errors.js";

// ASCII-only on purpose: Windows PowerShell 5.1 reads BOM-less files in the system codepage.
const PICKER_PS1 = [
  "Add-Type -AssemblyName System.Windows.Forms",
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
  "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
  "$d.Description = 'Choose where to keep your Blueprint OS folder (your Dropbox folder is a good choice).'",
  "$d.ShowNewFolderButton = $true",
  "if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }",
].join("\r\n");

export function findExistingVault(parent, exists) {
  for (const name of ["Blueprint OS", "Shop OS"]) {
    if (exists(join(parent, name)) && exists(join(parent, name, "CLAUDE.md"))) return name;
  }
  return null;
}

async function pickFolder(ctx) {
  if (ctx.platform === "win32") {
    const file = join(mkdtempSync(join(ctx.tmpDir(), "pick-")), "pick.ps1");
    writeFileSync(file, PICKER_PS1, "ascii");
    return ctx.run("powershell", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", file], { timeoutMs: 15 * 60 * 1000 });
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
      const parent = (r.stdout ?? "").replace(/^﻿/, "").trim().split(/\r?\n/).pop()?.trim().replace(/[\\/]+$/, "") ?? "";
      if (!r.ok || !parent) throw new StepError("No folder was chosen. Run the installer again and pick a folder when the window opens.");
      const name = await ctx.prompt("Name for your Blueprint OS folder?", findExistingVault(parent, ctx.exists) ?? "Blueprint OS");
      ctx.vaultPath = join(parent, name);
    },
    verify: async (ctx) => (ctx.vaultPath ? true : "No vault folder was selected."),
  };
}
