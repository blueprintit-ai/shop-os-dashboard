// test/autostart-macos.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAutoStart, createDesktopApp } from "../installer/autostart-macos.js";

test("registerAutoStart writes a LaunchAgents plist and loads it", () => {
  const home = mkdtempSync(join(tmpdir(), "home-"));
  const calls = [];
  const spawnSyncImpl = (cmd, args) => { calls.push([cmd, args]); return { status: 0 }; };
  const result = registerAutoStart({ nodeBin: "/usr/local/bin/node", dashboardBin: "/dash/bin.js", vaultPath: "/Vault", homeOverride: home, spawnSyncImpl });
  assert.equal(result.ok, true);
  const plistPath = join(home, "Library", "LaunchAgents", "ai.blueprintit.shop-os-dashboard.plist");
  assert.ok(existsSync(plistPath));
  assert.match(readFileSync(plistPath, "utf8"), /RunAtLoad/);
  assert.equal(calls[0][0], "launchctl");
});

test("createDesktopApp writes a launchable .app bundle", () => {
  const desktopDir = mkdtempSync(join(tmpdir(), "desktop-"));
  const result = createDesktopApp({ nodeBin: "/usr/local/bin/node", dashboardBin: "/dash/bin.js", vaultPath: "/Vault", desktopDir });
  assert.equal(result.ok, true);
  const exe = join(result.path, "Contents", "MacOS", "Shop OS");
  assert.ok(existsSync(exe));
  assert.ok(existsSync(join(result.path, "Contents", "Info.plist")));
});
