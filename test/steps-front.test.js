import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createContext } from "../installer/core/context.js";
import { runSteps } from "../installer/core/runner.js";
import { machineCheckStep } from "../installer/steps/machine-check.js";
import { licenseStep } from "../installer/steps/license.js";
import { vaultLocationStep, findExistingVault } from "../installer/steps/vault-location.js";

const quiet = { sleep: async () => {} };
const okSnap = { os: "x", free_disk_mb: 50000, reach: { github: true, npm: true, claude_ai: true } };
const withSnap = (snap, extra = {}) => createContext({ platform: "win32", print: () => {}, snapshot: async () => snap, ...extra });

test("machine check passes on a healthy machine", async () => {
  assert.equal((await runSteps([machineCheckStep()], withSnap(okSnap), quiet)).ok, true);
});
test("machine check does not fail when free disk is unknown (-1)", async () => {
  assert.equal((await runSteps([machineCheckStep()], withSnap({ ...okSnap, free_disk_mb: -1 }), quiet)).ok, true);
});
test("machine check stops on low disk with a clear reason", async () => {
  const r = await runSteps([machineCheckStep()], withSnap({ ...okSnap, free_disk_mb: 500 }), quiet);
  assert.match(r.failed.error, /500 MB.*2048 MB/);
});
test("machine check stops when GitHub is unreachable, with a hint", async () => {
  const r = await runSteps([machineCheckStep()], withSnap({ ...okSnap, reach: { github: false, npm: true, claude_ai: true } }), quiet);
  assert.match(r.failed.error, /github\.com/);
  assert.equal(r.failed.hint, "GitHub unreachable, likely a firewall or proxy.");
});
test("machine check stops when claude.ai is unreachable, with a hint", async () => {
  const r = await runSteps([machineCheckStep()], withSnap({ ...okSnap, reach: { github: true, npm: true, claude_ai: false } }), quiet);
  assert.match(r.failed.error, /claude\.ai/);
  assert.equal(r.failed.hint, "claude.ai unreachable, likely a firewall or proxy.");
});
test("machine check rejects Linux", async () => {
  const r = await runSteps([machineCheckStep()], createContext({ platform: "linux", print: () => {}, snapshot: async () => okSnap }), quiet);
  assert.match(r.failed.error, /Unsupported/);
});

const respond = (status, body) => async () => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });

test("license step stores the validated license and normalizes the key", async () => {
  const ctx = withSnap(okSnap, { licenseKey: " shop-ab12-cd34-ef56 ", fetchImpl: respond(200, { customer: "Acme", product: "p", valid: true }) });
  const r = await runSteps([licenseStep()], ctx, quiet);
  assert.equal(r.ok, true);
  assert.equal(ctx.license.customer, "Acme");
  assert.equal(ctx.license.key, "SHOP-AB12-CD34-EF56");
  assert.equal(ctx.licenseKey, "SHOP-AB12-CD34-EF56");
});
test("license step stops with the server's reason when revoked, never echoing the full key", async () => {
  const ctx = withSnap(okSnap, { licenseKey: "SHOP-AB12-CD34-EF56", fetchImpl: respond(403, { error: "key SHOP-AB12-CD34-EF56 revoked" }) });
  const r = await runSteps([licenseStep()], ctx, quiet);
  assert.match(r.failed.error, /revoked/);
  assert.doesNotMatch(r.failed.error, /CD34/);
});
test("license step rejects a malformed key without calling the server", async () => {
  let called = false;
  const ctx = withSnap(okSnap, { licenseKey: "nope", fetchImpl: async () => { called = true; } });
  const r = await runSteps([licenseStep()], ctx, quiet);
  assert.equal(called, false);
  assert.match(r.failed.error, /SHOP-XXXX-XXXX-XXXX/);
});
test("license step uses the licenseServer override", async () => {
  let seen = "";
  const ctx = withSnap(okSnap, { licenseKey: "SHOP-AB12-CD34-EF56", licenseServer: "https://example.test", fetchImpl: async (u) => { seen = u; return { ok: true, status: 200, text: async () => "{}" }; } });
  await runSteps([licenseStep()], ctx, quiet);
  assert.match(seen, /^https:\/\/example\.test\/validate\?key=/);
});

test("vault location: --vault style preset skips the picker", async () => {
  const ctx = withSnap(okSnap, { vaultPath: "C:\\Users\\a\\Dropbox\\Blueprint OS", run: async () => { throw new Error("picker must not run"); } });
  assert.equal((await runSteps([vaultLocationStep()], ctx, quiet)).ok, true);
});
test("vault location: picker output (non-ASCII) + default name", async () => {
  const picked = "C:\\Users\\Jos\u00e9 Garc\u00eda\\Dropbox";
  const ctx = withSnap(okSnap, { run: async () => ({ ok: true, stdout: `${picked}\r\n` }), prompt: async (q, def) => def, exists: () => false });
  const r = await runSteps([vaultLocationStep()], ctx, quiet);
  assert.equal(r.ok, true);
  assert.equal(ctx.vaultPath, join(picked, "Blueprint OS"));
});
test("vault location: existing vault name is the prompt default", async () => {
  let def = null;
  const exists = (p) => p.includes("Shop OS");
  const ctx = withSnap(okSnap, { run: async () => ({ ok: true, stdout: "/Users/a/Dropbox/\n" }), prompt: async (q, d) => { def = d; return d; }, exists });
  await runSteps([vaultLocationStep()], ctx, quiet);
  assert.equal(def, "Shop OS");
});
test("vault location: cancelled picker is a clear stop (Review Focus 2)", async () => {
  const ctx = withSnap(okSnap, { run: async () => ({ ok: true, stdout: "" }) });
  const r = await runSteps([vaultLocationStep()], ctx, quiet);
  assert.equal(r.ok, false);
  assert.match(r.failed.error, /No folder was chosen/);
});
test("vault location: cancelled picker on Mac (non-zero exit) is the same stop", async () => {
  const ctx = createContext({ platform: "darwin", print: () => {}, snapshot: async () => okSnap, run: async () => ({ ok: false, stdout: "" }) });
  const r = await runSteps([vaultLocationStep()], ctx, quiet);
  assert.match(r.failed.error, /No folder was chosen/);
});
test("findExistingVault prefers Blueprint OS, then Shop OS, else null", () => {
  const has = (...names) => (p) => names.some((n) => p === join("Dropbox", n) || p === join("Dropbox", n, "CLAUDE.md"));
  assert.equal(findExistingVault("Dropbox", has()), null);
  assert.equal(findExistingVault("Dropbox", has("Shop OS")), "Shop OS");
  assert.equal(findExistingVault("Dropbox", has("Shop OS", "Blueprint OS")), "Blueprint OS");
});
