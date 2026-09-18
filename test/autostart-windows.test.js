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
  assert.match(readFileSync(vbsPath, "utf8"), /CreateShortcut/);
});

test("the .vbs is written with a UTF-8 BOM so cscript doesn't decode it as ANSI", () => {
  // Without the BOM, cscript uses the system codepage and mangles the
  // C:\Users\<name>\... paths embedded in the script for any non-ASCII
  // username — the same bug class already fixed for the PowerShell scripts.
  const desktopDir = mkdtempSync(join(tmpdir(), "desktop-"));
  const calls = [];
  const spawnSyncImpl = (cmd, args) => { calls.push([cmd, args]); return { status: 0 }; };
  createDesktopShortcut({ nodeBin: "C:\\node.exe", dashboardBin: "C:\\dash.js", vaultPath: "C:\\Vault\\Ünïcøde", desktopDir, spawnSyncImpl });
  const vbsPath = calls[0][1].find((a) => a.endsWith(".vbs"));
  const bytes = readFileSync(vbsPath);
  assert.deepEqual([...bytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF]);
  // and the content after the BOM is still the intended UTF-8 script
  assert.match(bytes.subarray(3).toString("utf8"), /Ünïcøde/);
});
