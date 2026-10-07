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
