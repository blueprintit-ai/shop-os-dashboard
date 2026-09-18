import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StatusStore, checkStatus } from "../src/status.js";

test("StatusStore starts unknown and narrows after an observation", () => {
  const home = mkdtempSync(join(tmpdir(), "status-"));
  const store = new StatusStore(home);
  assert.equal(store.get().claude.signedIn, "unknown");
  store.recordClaudeObservation(true);
  assert.equal(store.get().claude.signedIn, "yes");
  store.recordClaudeObservation(false, "Please run /login");
  assert.equal(store.get().claude.signedIn, "no");
  assert.equal(store.get().claude.lastMessage, "Please run /login");
});

test("checkStatus reports claude presence, license, vault reachability, port, and LAN addresses", () => {
  const home = mkdtempSync(join(tmpdir(), "status-"));
  const vault = mkdtempSync(join(tmpdir(), "vault-"));
  const store = new StatusStore(home);
  const spawnSyncImpl = () => ({ status: 0 });
  const licenseCheck = () => ({ ok: true });
  const result = checkStatus({ vaultPath: vault, statusStore: store, licenseCheck, port: 50000, spawnSyncImpl });
  assert.equal(result.claude.present, true);
  assert.equal(result.license.ok, true);
  assert.equal(result.vault.reachable, true);
  assert.equal(result.port, 50000);
  assert.ok(Array.isArray(result.lan));
});

test("checkStatus reports claude absent when the binary probe fails", () => {
  const home = mkdtempSync(join(tmpdir(), "status-"));
  const vault = mkdtempSync(join(tmpdir(), "vault-"));
  const store = new StatusStore(home);
  const spawnSyncImpl = () => ({ status: 1 });
  const result = checkStatus({ vaultPath: vault, statusStore: store, licenseCheck: () => ({ ok: true }), port: 50000, spawnSyncImpl });
  assert.equal(result.claude.present, false);
});
