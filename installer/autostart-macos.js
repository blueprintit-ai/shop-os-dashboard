// installer/autostart-macos.js
import { spawnSync as defaultSpawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const LABEL = "ai.blueprintit.shop-os-dashboard";

// A vault path may legally contain &, <, >, ' or " ("Acme & Sons" is a perfectly
// ordinary folder name). Interpolated raw, that produces a malformed plist and
// `launchctl load` fails with a parse error.
function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Wraps a value as a single-quoted shell literal: the only form bash does no
// expansion inside. An embedded single quote is closed, escaped, reopened.
function shQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

export function registerAutoStart({ nodeBin, dashboardBin, vaultPath, homeOverride, spawnSyncImpl = defaultSpawnSync }) {
  const home = homeOverride ?? homedir();
  const dir = join(home, "Library", "LaunchAgents");
  const plistPath = join(dir, `${LABEL}.plist`);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xmlEscape(LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(nodeBin)}</string>
    <string>${xmlEscape(dashboardBin)}</string>
    <string>${xmlEscape(vaultPath)}</string>
    <string>--no-browser</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
</dict>
</plist>
`;
  // Best-effort per the plan's Global Constraints: a read-only home directory
  // or a launchctl that refuses to load must report {ok:false}, not throw.
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(plistPath, plist, "utf8");
    const result = spawnSyncImpl("launchctl", ["load", plistPath], { encoding: "utf8" });
    if (result.status !== 0) return { ok: false, error: result.stderr || `launchctl exited ${result.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// A minimal double-clickable .app: no Xcode, no bundler — just the three
// files Finder/LaunchServices require to treat a folder as an application.
export function createDesktopApp({ nodeBin, dashboardBin, vaultPath, desktopDir }) {
  const appPath = join(desktopDir, "Shop OS.app");
  const macosDir = join(appPath, "Contents", "MacOS");
  const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Shop OS</string>
  <key>CFBundleExecutable</key><string>Shop OS</string>
  <key>CFBundleIdentifier</key><string>${xmlEscape(LABEL)}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
</dict>
</plist>
`;
  // No `open http://localhost:50000` here: the dashboard falls back through
  // ports 50001-50010 when 50000 is taken (src/lib/net.js findFreePort), so a
  // hardcoded URL can open a dead page — and it ran BEFORE the server had
  // bound anything anyway. bin/shop-os-dashboard.js opens the browser itself
  // once it knows the real port, and this launcher passes no --no-browser.
  // Values are single-quoted: a $, backtick or " in a path would otherwise
  // expand or break out of the double-quoted form this used to use.
  const launcher = `#!/bin/bash\nexec ${shQuote(nodeBin)} ${shQuote(dashboardBin)} ${shQuote(vaultPath)}\n`;
  // Best-effort per the plan's Global Constraints: this function previously had
  // no failure path at all despite three fallible fs calls — a locked-down
  // Desktop folder must report {ok:false}, not throw and abort the whole setup.
  try {
    mkdirSync(macosDir, { recursive: true });
    writeFileSync(join(appPath, "Contents", "Info.plist"), infoPlist, "utf8");
    const exePath = join(macosDir, "Shop OS");
    writeFileSync(exePath, launcher, "utf8");
    chmodSync(exePath, 0o755);
    return { ok: true, path: appPath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
