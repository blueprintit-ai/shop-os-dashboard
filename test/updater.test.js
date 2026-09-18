import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { checkForUpdate, applyUpdate, makeRestart, UPDATE_TIMEOUT_MS } from "../src/updater.js";
import { shoposAppDir } from "../src/lib/paths.js";

test("checkForUpdate reports updateAvailable when the registry version is newer", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ version: "0.3.0" }) });
  const result = await checkForUpdate({ currentVersion: "0.2.5", fetchImpl });
  assert.equal(result.updateAvailable, true);
  assert.equal(result.latest, "0.3.0");
});

test("checkForUpdate reports no update when current is already latest", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ version: "0.2.5" }) });
  const result = await checkForUpdate({ currentVersion: "0.2.5", fetchImpl });
  assert.equal(result.updateAvailable, false);
});

test("checkForUpdate fails closed (no update) if the registry is unreachable", async () => {
  const fetchImpl = async () => { throw new Error("offline"); };
  const result = await checkForUpdate({ currentVersion: "0.2.5", fetchImpl });
  assert.equal(result.updateAvailable, false);
});

test("applyUpdate runs npm install with the private npm binary in appDir", () => {
  const calls = [];
  const spawnSyncImpl = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { status: 0 }; };
  const result = applyUpdate({ appDir: "/app", npmBin: "/runtime/npm", spawnSyncImpl });
  assert.equal(result.ok, true);
  assert.equal(calls[0].cmd, "/runtime/npm");
  assert.deepEqual(calls[0].args, ["install", "@blueprintitai/shop-os-dashboard@latest"]);
  assert.equal(calls[0].opts.cwd, "/app");
});

test("applyUpdate gives npm install a timeout so a hung install can't block the server forever", () => {
  const calls = [];
  const spawnSyncImpl = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { status: 0 }; };
  applyUpdate({ appDir: "/app", npmBin: "/runtime/npm", spawnSyncImpl });
  assert.equal(calls[0].opts.timeout, UPDATE_TIMEOUT_MS);
  assert.ok(calls[0].opts.timeout > 0);
});

test("applyUpdate runs a Windows npm.cmd through a shell (spawnSync can't exec a batch file directly)", () => {
  const calls = [];
  const spawnSyncImpl = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { status: 0 }; };
  const result = applyUpdate({ appDir: "C:\\app", npmBin: "C:\\Program Files\\nodejs\\npm.cmd", spawnSyncImpl });
  assert.equal(result.ok, true);
  assert.equal(calls[0].opts.shell, true);
  // quoted, because the path routinely contains spaces and shell:true passes
  // the command to cmd.exe as a single string
  assert.equal(calls[0].cmd, '"C:\\Program Files\\nodejs\\npm.cmd"');
});

test("applyUpdate reports a spawn error (ENOENT npm) instead of pretending it exited 0", () => {
  const spawnSyncImpl = () => ({ error: new Error("spawnSync npm ENOENT"), status: null });
  const result = applyUpdate({ appDir: "/app", npmBin: "npm", spawnSyncImpl });
  assert.equal(result.ok, false);
  assert.match(result.error, /ENOENT/);
});

test("appDir resolves to the real install location (~/.shopos/app), not ~/.shopos/dashboard/app", () => {
  // Must match bin/shop-os-dashboard-setup.js's dashboardBin and both
  // installer/run-setup.* scripts' $appDir/$APP_DIR — otherwise the updater
  // npm-installs into a directory nothing ever created.
  assert.equal(shoposAppDir(), join(homedir(), ".shopos", "app"));
  assert.ok(!shoposAppDir().includes("dashboard"));
});

test("makeRestart relaunches this process detached before exiting", () => {
  const calls = [];
  let exited = 0;
  let unrefs = 0;
  const spawnImpl = (cmd, argv, opts) => { calls.push({ cmd, argv, opts }); return { unref: () => { unrefs++; } }; };
  const restart = makeRestart({
    spawnImpl, exitImpl: () => { exited++; },
    execPath: "/usr/bin/node", argv: ["/app/bin/shop-os-dashboard.js", "/Vault", "--no-browser"],
  });
  restart();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, "/usr/bin/node");
  // same argv this process was started with: the script plus the vault path and flags
  assert.deepEqual(calls[0].argv, ["/app/bin/shop-os-dashboard.js", "/Vault", "--no-browser"]);
  assert.equal(calls[0].opts.detached, true);
  assert.equal(calls[0].opts.stdio, "ignore");
  assert.equal(unrefs, 1);
  assert.equal(exited, 1);
});

test("makeRestart still exits if the relaunch spawn throws", () => {
  let exited = 0;
  const restart = makeRestart({
    spawnImpl: () => { throw new Error("EPERM"); },
    exitImpl: () => { exited++; }, execPath: "node", argv: ["x.js"],
  });
  restart();
  assert.equal(exited, 1);
});
