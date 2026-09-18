// installer/autostart-macos.js
import { spawnSync as defaultSpawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const LABEL = "ai.blueprintit.shop-os-dashboard";

export function registerAutoStart({ nodeBin, dashboardBin, vaultPath, homeOverride, spawnSyncImpl = defaultSpawnSync }) {
  const home = homeOverride ?? homedir();
  const dir = join(home, "Library", "LaunchAgents");
  mkdirSync(dir, { recursive: true });
  const plistPath = join(dir, `${LABEL}.plist`);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${dashboardBin}</string>
    <string>${vaultPath}</string>
    <string>--no-browser</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
</dict>
</plist>
`;
  writeFileSync(plistPath, plist, "utf8");
  const result = spawnSyncImpl("launchctl", ["load", plistPath], { encoding: "utf8" });
  if (result.status !== 0) return { ok: false, error: result.stderr || `launchctl exited ${result.status}` };
  return { ok: true };
}

// A minimal double-clickable .app: no Xcode, no bundler — just the three
// files Finder/LaunchServices require to treat a folder as an application.
export function createDesktopApp({ nodeBin, dashboardBin, vaultPath, desktopDir }) {
  const appPath = join(desktopDir, "Shop OS.app");
  const macosDir = join(appPath, "Contents", "MacOS");
  mkdirSync(macosDir, { recursive: true });
  const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Shop OS</string>
  <key>CFBundleExecutable</key><string>Shop OS</string>
  <key>CFBundleIdentifier</key><string>${LABEL}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
</dict>
</plist>
`;
  writeFileSync(join(appPath, "Contents", "Info.plist"), infoPlist, "utf8");
  const launcher = `#!/bin/bash\nopen "http://localhost:50000" 2>/dev/null\nexec "${nodeBin}" "${dashboardBin}" "${vaultPath}"\n`;
  const exePath = join(macosDir, "Shop OS");
  writeFileSync(exePath, launcher, "utf8");
  chmodSync(exePath, 0o755);
  return { ok: true, path: appPath };
}
