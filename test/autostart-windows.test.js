// test/autostart-windows.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAutoStart, createDesktopShortcut } from "../installer/autostart-windows.js";

test("registerAutoStart shells out to schtasks with a login trigger, no admin flag", () => {
  const calls = [];
  const spawnSyncImpl = (cmd, args) => { calls.push([cmd, args]); return { status: 0 }; };
  const result = registerAutoStart({ nodeBin: "C:\\node.exe", dashboardBin: "C:\\dash.js", vaultPath: "C:\\Vault", spawnSyncImpl });
  assert.equal(result.ok, true);
  assert.equal(calls[0][0], "schtasks");
  assert.ok(calls[0][1].includes("/create"));
  assert.ok(calls[0][1].includes("/sc") && calls[0][1].includes("ONLOGON"));
  assert.ok(!calls[0][1].some((a) => /runas|admin/i.test(a)));
});

test("registerAutoStart reports failure without throwing", () => {
  const spawnSyncImpl = () => ({ status: 1, stderr: "denied" });
  const result = registerAutoStart({ nodeBin: "n", dashboardBin: "d", vaultPath: "v", spawnSyncImpl });
  assert.equal(result.ok, false);
  assert.match(result.error, /denied/);
});

test("createDesktopShortcut writes a .vbs script and runs it via cscript", () => {
  const desktopDir = mkdtempSync(join(tmpdir(), "desktop-"));
  const calls = [];
  const spawnSyncImpl = (cmd, args) => { calls.push([cmd, args]); return { status: 0 }; };
  const result = createDesktopShortcut({ nodeBin: "C:\\node.exe", dashboardBin: "C:\\dash.js", vaultPath: "C:\\Vault", desktopDir, spawnSyncImpl });
  assert.equal(result.ok, true);
  assert.equal(calls[0][0], "cscript");
  const vbsPath = calls[0][1].find((a) => a.endsWith(".vbs"));
  assert.ok(existsSync(vbsPath));
  assert.match(readFileSync(vbsPath).subarray(2).toString("utf16le"), /CreateShortcut/);
});

test("the .vbs is UTF-16 LE with a BOM: cscript can't parse a UTF-8 BOM, and ANSI mangles non-ASCII paths", () => {
  // A UTF-8 BOM makes cscript fail with "VBScript compilation error: Invalid
  // character" at (1, 1) (seen live on a customer install). Without any BOM it
  // decodes as the system ANSI codepage and mangles C:\Users\<name>\... for a
  // non-ASCII username. UTF-16 LE + BOM (FF FE) is what VBScript honours.
  const desktopDir = mkdtempSync(join(tmpdir(), "desktop-"));
  const calls = [];
  const spawnSyncImpl = (cmd, args) => { calls.push([cmd, args]); return { status: 0 }; };
  createDesktopShortcut({ nodeBin: "C:\\node.exe", dashboardBin: "C:\\dash.js", vaultPath: "C:\\Vault\\Ünïcøde", desktopDir, spawnSyncImpl });
  const vbsPath = calls[0][1].find((a) => a.endsWith(".vbs"));
  const bytes = readFileSync(vbsPath);
  assert.deepEqual([...bytes.subarray(0, 2)], [0xFF, 0xFE]);
  assert.notDeepEqual([...bytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF]);
  // and the content after the BOM is still the intended script
  const text = bytes.subarray(2).toString("utf16le");
  assert.match(text, /^Set oShell/);
  assert.match(text, /Ünïcøde/);
});

// ---- the login task points at a tiny launcher, never at the long command (schtasks /tr max is 261 chars) ----
import { mkdirSync } from "node:fs";

function longHome() {
  const base = mkdtempSync(join(tmpdir(), "as-"));
  // a profile like "C:\Users\OC Outfeed" but ~120 chars, with a space and non-ASCII
  const dir = join(base, "Users", "OC Outfeed Ünïcøde " + "x".repeat(60), ".shopos");
  mkdirSync(dir, { recursive: true });
  return dir;
}
const LONG_NODE = "C:\\Users\\OC Outfeed\\.shopos\\node\\node-v22.17.0-win-x64\\node.exe";
const LONG_DASH = "C:\\Users\\OC Outfeed\\.shopos\\package\\shop-os-dashboard-main\\bin\\shop-os-dashboard.js";
const LONG_VAULT = "C:\\Users\\OC Outfeed\\Documents\\Blueprint OS\\Some Very Long Business Name Folder\\Vault Number One " + "y".repeat(60);

test("registerAutoStart: /tr is only the short launcher call, well under 261 chars, with a long profile and vault", () => {
  const launcherDir = longHome();
  const calls = [];
  const spawnSyncImpl = (cmd, args) => { calls.push([cmd, args]); return { status: 0 }; };
  const r = registerAutoStart({ nodeBin: LONG_NODE, dashboardBin: LONG_DASH, vaultPath: LONG_VAULT, launcherDir, spawnSyncImpl });
  assert.equal(r.ok, true);
  const args = calls[0][1];
  const tr = args[args.indexOf("/tr") + 1];
  assert.ok(tr.length < 261, `tr is ${tr.length}`);
  assert.match(tr, /^wscript\.exe "/);
  assert.ok(tr.includes("start-dashboard.vbs"));
  assert.ok(!tr.includes("--no-browser") && !tr.includes("node.exe") && !tr.includes("Vault Number One"));
  assert.ok(tr.includes(launcherDir), "launcher path is quoted whole, spaces included");
  assert.ok(args.includes("ShopOSDashboard") && args.includes("/f") && args.includes("ONLOGON"));
  // /tr does not grow with the node/vault paths
  const calls2 = [];
  registerAutoStart({ nodeBin: "n", dashboardBin: "d", vaultPath: "v", launcherDir, spawnSyncImpl: (c, a) => { calls2.push(a); return { status: 0 }; } });
  assert.equal(calls2[0][calls2[0].indexOf("/tr") + 1], tr);
});

test("registerAutoStart: the launcher is a UTF-16 LE BOM .vbs that runs node hidden with every path quoted", () => {
  const launcherDir = longHome();
  registerAutoStart({ nodeBin: LONG_NODE, dashboardBin: LONG_DASH, vaultPath: LONG_VAULT, launcherDir, spawnSyncImpl: () => ({ status: 0 }) });
  const bytes = readFileSync(join(launcherDir, "start-dashboard.vbs"));
  assert.deepEqual([...bytes.subarray(0, 2)], [0xFF, 0xFE]);
  const text = bytes.subarray(2).toString("utf16le");
  assert.match(text, /CreateObject\("WScript\.Shell"\)/);
  assert.ok(text.includes(`""${LONG_NODE}"" ""${LONG_DASH}"" ""${LONG_VAULT}"" --no-browser`), text);
  assert.match(text, /, 0, False\s*$/); // hidden window, do not wait
});

test("registerAutoStart: the launcher is overwritten on re-run and a write failure reports ok:false", () => {
  const launcherDir = longHome();
  registerAutoStart({ nodeBin: "old", dashboardBin: "d", vaultPath: "v", launcherDir, spawnSyncImpl: () => ({ status: 0 }) });
  registerAutoStart({ nodeBin: "newnode", dashboardBin: "d", vaultPath: "v", launcherDir, spawnSyncImpl: () => ({ status: 0 }) });
  const text = readFileSync(join(launcherDir, "start-dashboard.vbs")).subarray(2).toString("utf16le");
  assert.ok(text.includes("newnode") && !text.includes("old"));
  const bad = registerAutoStart({ nodeBin: "n", dashboardBin: "d", vaultPath: "v", launcherDir: join(launcherDir, "start-dashboard.vbs", "nope"), spawnSyncImpl: () => ({ status: 0 }) });
  assert.equal(bad.ok, false);
});
