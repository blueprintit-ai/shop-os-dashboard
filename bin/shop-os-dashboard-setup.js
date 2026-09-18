#!/usr/bin/env node
// bin/shop-os-dashboard-setup.js
import { join } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import { resolveNode } from "../installer/node-runtime.js";
import { JsonStore } from "../src/lib/store.js";
import {
  installMarketplaces, createVaultClaudeMd, createRawInbox, enableForVault, enableForUser, saveLicenseFile, PLUGINS_TO_ENABLE,
  normalizeLicenseKey, looksLikeLicenseKey, validateLicense,
} from "../installer/vault-setup.js";
import * as win from "../installer/autostart-windows.js";
import * as mac from "../installer/autostart-macos.js";

export async function runSetup({ vaultPath, license, homeDir = join(homedir(), ".shopos"), isWindows = process.platform === "win32", desktopDir, homeOverride, claudeRoot = join(homedir(), ".claude"), fetchImpl = fetch, spawnSyncImpl }) {
  const steps = [];
  const record = (name, fn) => {
    try {
      const value = fn();
      // A step may succeed structurally yet have something the owner must be
      // told about (e.g. enableForUser had to back up an unparseable
      // settings.json). That is reported as a failed step, not a silent pass.
      if (value && typeof value === "object" && value.warning) {
        steps.push({ name, ok: false, warning: true, error: value.warning, value });
        return value;
      }
      steps.push({ name, ok: true, value });
      return value;
    } catch (e) { steps.push({ name, ok: false, error: e.message }); return null; }
  };

  const node = await resolveNode({ homeDir, fetchImpl, spawnSyncImpl });
  steps.push({ name: "node", ok: true, value: node });

  // The running dashboard has no other way to find npm: on a portable-Node
  // install there is no npm on PATH at all, so "Update now" would be an ENOENT.
  // src/lib/paths.js's shoposRuntimeFile() is the read side of this file.
  record("runtime", () => {
    new JsonStore(join(homeDir, "runtime.json"), {}).save({ node: node.node, npm: node.npm, version: node.version, system: node.system });
    return join(homeDir, "runtime.json");
  });

  const mpResult = await installMarketplaces({ claudeRoot, fetchImpl });
  steps.push({ name: "marketplaces", ok: mpResult.failed.length === 0, error: mpResult.failed.map((f) => f.error).join("; ") || undefined });

  record("vault.claudeMd", () => createVaultClaudeMd(vaultPath, license));
  record("vault.rawInbox", () => createRawInbox(vaultPath));
  record("vault.settings", () => enableForVault(vaultPath, PLUGINS_TO_ENABLE));
  record("user.settings", () => enableForUser(claudeRoot, PLUGINS_TO_ENABLE));
  // NOT homeDir: homeDir is already "~/.shopos" (used for the portable-node
  // cache and the installed app path below), but saveLicenseFile (Task 4)
  // appends ".shopos" internally — it expects the plain OS home directory,
  // the same thing homeOverride already stands in for everywhere else in
  // this function. Passing homeDir here would write to "~/.shopos/.shopos/
  // license.json", which the running server's readLicense() (its own
  // hardcoded "~/.shopos/license.json") would never find — a fresh install
  // would come up permanently unlicensed. Passing homeOverride keeps this
  // test-isolated the same way the autostart step already is.
  record("license", () => saveLicenseFile(license, homeOverride));

  const dashboardBin = join(homeDir, "app", "node_modules", "@blueprintitai", "shop-os-dashboard", "bin", "shop-os-dashboard.js");
  const autostartMod = isWindows ? win : mac;
  const autostartResult = autostartMod.registerAutoStart({ nodeBin: node.node, dashboardBin, vaultPath, homeOverride, spawnSyncImpl });
  steps.push({ name: "autostart", ok: autostartResult.ok, error: autostartResult.error });

  if (desktopDir) {
    const shortcutResult = isWindows
      ? win.createDesktopShortcut({ nodeBin: node.node, dashboardBin, vaultPath, desktopDir, spawnSyncImpl })
      : mac.createDesktopApp({ nodeBin: node.node, dashboardBin, vaultPath, desktopDir });
    steps.push({ name: "shortcut", ok: shortcutResult.ok, error: shortcutResult.error });
  }

  // Blocking steps: vault scaffolding and marketplaces. Everything else
  // (autostart, shortcut) is best-effort and never flips the overall result.
  // `warning: true` steps (e.g. an unparseable settings.json that was backed up
  // and rebuilt) are surfaced to the owner with a ⚠ but did not actually fail:
  // the file is written and usable, so they must not fail the whole install.
  const blocking = steps.filter((s) => !s.warning && ["marketplaces", "vault.claudeMd", "vault.rawInbox", "vault.settings", "user.settings", "license"].includes(s.name));
  return { ok: blocking.every((s) => s.ok), steps, node };
}

// CLI entry: parses --license/--vault flags (mirroring shop-os-install.js's
// existing flag names so a future cutover doesn't retrain anyone), prompting
// for whichever one is missing, then hands off to runSetup.
export async function main(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--license") args.license = argv[++i];
    else if (argv[i] === "--vault") args.vault = argv[++i];
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let license;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const rawKey = args.license || (await rl.question("Shop OS license key: "));
    // Clear it immediately: otherwise a bad --license value is retried
    // verbatim on every iteration and the loop never prompts interactively.
    args.license = undefined;
    const key = normalizeLicenseKey(rawKey);
    if (!looksLikeLicenseKey(key)) {
      console.log(`That doesn't look like a Shop OS key. The format is SHOP-XXXX-XXXX-XXXX.`);
      if (attempt === 3) { rl.close(); console.error("No valid license key entered."); process.exitCode = 1; return; }
      continue;
    }
    const result = await validateLicense(key);
    if (result.ok) { license = { ...result.license, key }; break; }
    console.log(`License rejected: ${result.error}`);
    if (attempt === 3) { rl.close(); console.error("License validation failed."); process.exitCode = 1; return; }
  }

  const vaultPath = args.vault || (await rl.question("Vault folder path: "));
  rl.close();

  const homeDir = join(homedir(), ".shopos");
  const desktopDir = join(homedir(), "Desktop");
  console.log(`Installing Shop OS Dashboard for ${license.customer} into ${vaultPath}...`);
  const result = await runSetup({ vaultPath, license, homeDir, desktopDir });

  for (const step of result.steps) console.log(`  ${step.ok ? "✓" : "⚠"} ${step.name}${step.error ? `: ${step.error}` : ""}`);
  if (!result.ok) { console.error("Setup did not complete — see the failed step above."); process.exitCode = 1; return; }
  console.log(`\nDone. Shop OS Dashboard will start automatically at login, or run it now with:\n  ${result.node.node} ${join(homeDir, "app", "node_modules", "@blueprintitai", "shop-os-dashboard", "bin", "shop-os-dashboard.js")} "${vaultPath}"`);
}

// NOT `import.meta.url === \`file://${process.argv[1]}\``: that string-built
// comparison is silently false on Windows. import.meta.url for a file at
// C:\Users\x\bin\shop-os-dashboard-setup.js is "file:///C:/Users/x/bin/..."
// (forward slashes, a leading triple slash, percent-encoded special chars),
// while the naive template produces "file://C:\Users\x\bin\..." (raw
// backslashes) — the two never match, so main() would silently never run on
// the platform this installer's schtasks/cscript code exists for in the
// first place. pathToFileURL() produces the same normalized form
// import.meta.url uses, on every platform, including percent-encoding a
// path containing spaces (which the naive template also gets wrong on
// POSIX). Also, unlike the brief's original bare `main();`, failures are
// caught and reported instead of surfacing as a raw stack trace.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err.message || String(err)); process.exitCode = 1; });
}
