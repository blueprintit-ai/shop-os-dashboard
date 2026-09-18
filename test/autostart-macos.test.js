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
  const script = readFileSync(exe, "utf8");
  // No hardcoded port: the dashboard falls back through 50001-50010, and
  // bin/shop-os-dashboard.js opens the browser itself once it knows the real
  // bound port (this launcher passes no --no-browser, so that still happens).
  assert.ok(!/localhost:50000/.test(script), "launcher must not open a hardcoded port");
  assert.ok(!/\bopen\b/.test(script), "launcher must not open a browser at all");
  assert.match(script, /^exec /m);
});

test("plist escapes XML-significant characters in the vault path", () => {
  const home = mkdtempSync(join(tmpdir(), "home-"));
  const spawnSyncImpl = () => ({ status: 0 });
  const vaultPath = "/Users/glenn/Acme & Sons <Vault>";
  registerAutoStart({ nodeBin: "/usr/local/bin/node", dashboardBin: "/dash/bin.js", vaultPath, homeOverride: home, spawnSyncImpl });
  const plist = readFileSync(join(home, "Library", "LaunchAgents", "ai.blueprintit.shop-os-dashboard.plist"), "utf8");
  assert.ok(plist.includes("Acme &amp; Sons &lt;Vault&gt;"), "XML-significant characters must be escaped");
  // No bare & left anywhere: launchctl load fails outright on malformed XML.
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(plist), "no unescaped ampersand may remain");
});

test(".app launcher single-quotes interpolated paths so $ and \" cannot expand or break out", () => {
  const desktopDir = mkdtempSync(join(tmpdir(), "desktop-"));
  const vaultPath = '/Users/glenn/$HOME "quoted" `backtick`';
  const result = createDesktopApp({ nodeBin: "/usr/local/bin/node", dashboardBin: "/dash/bin.js", vaultPath, desktopDir });
  assert.equal(result.ok, true);
  const script = readFileSync(join(result.path, "Contents", "MacOS", "Shop OS"), "utf8");
  assert.ok(script.includes(`'${vaultPath}'`), "the vault path must appear inside single quotes");
  assert.ok(!script.includes(`"${vaultPath}"`), "must not be left in an expanding double-quoted string");
});

test(".app launcher escapes an embedded single quote", () => {
  const desktopDir = mkdtempSync(join(tmpdir(), "desktop-"));
  const result = createDesktopApp({ nodeBin: "/usr/local/bin/node", dashboardBin: "/dash/bin.js", vaultPath: "/Users/glenn/Bob's Vault", desktopDir });
  const script = readFileSync(join(result.path, "Contents", "MacOS", "Shop OS"), "utf8");
  assert.ok(script.includes(`'/Users/glenn/Bob'"'"'s Vault'`), `unexpected launcher: ${script}`);
});
