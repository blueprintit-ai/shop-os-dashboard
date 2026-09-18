import { test } from "node:test";
import assert from "node:assert/strict";
import { checkForUpdate, applyUpdate } from "../src/updater.js";

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
