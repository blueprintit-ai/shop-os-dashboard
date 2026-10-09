import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../src/server.js";
import { vaultFingerprint, findRunningInstance, decideStartup } from "../src/lib/instance.js";

// Fake fetch: `running` maps port -> ping body; every other port refuses.
function fakeFetch(running) {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    const port = Number(new URL(url).port);
    if (!(port in running)) throw new Error("ECONNREFUSED");
    return { ok: true, json: async () => running[port] };
  };
  f.calls = calls;
  return f;
}
const ping = (vault, port) => ({ app: "shop-os-dashboard", vault: vaultFingerprint(vault), port });

test("fingerprint is 16 hex chars, stable per path, different per path", () => {
  const a = vaultFingerprint("/v/one");
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(a, vaultFingerprint("/v/one"));
  assert.notEqual(a, vaultFingerprint("/v/two"));
});

test("findRunningInstance finds the same vault and returns its port", async () => {
  const f = fakeFetch({ 50000: ping("/v/one", 50000) });
  assert.deepEqual(await findRunningInstance({ vaultPath: "/v/one", fetchImpl: f }), { port: 50000 });
});

test("findRunningInstance ignores a different vault, junk bodies and refused ports", async () => {
  const f = fakeFetch({ 50000: ping("/v/other", 50000), 50001: { hello: 1 } });
  assert.equal(await findRunningInstance({ vaultPath: "/v/one", fetchImpl: f }), null);
});

test("findRunningInstance finds the same vault on a later port past a different vault", async () => {
  const f = fakeFetch({ 50000: ping("/v/other", 50000), 50001: ping("/v/one", 50001) });
  assert.deepEqual(await findRunningInstance({ vaultPath: "/v/one", fetchImpl: f }), { port: 50001 });
});

test("decideStartup: same vault running -> attach and open browser at its URL", async () => {
  const f = fakeFetch({ 50000: ping("/v/one", 50000) });
  const d = await decideStartup({ vaultPath: "/v/one", port: null, noBrowser: false, fetchImpl: f });
  assert.deepEqual(d, { action: "attach", url: "http://localhost:50000", openBrowser: true, message: "Blueprint OS is already running at http://localhost:50000" });
});

test("decideStartup: --no-browser and running -> attach, no browser", async () => {
  const f = fakeFetch({ 50000: ping("/v/one", 50000) });
  const d = await decideStartup({ vaultPath: "/v/one", port: null, noBrowser: true, fetchImpl: f });
  assert.equal(d.action, "attach");
  assert.equal(d.openBrowser, false);
});

test("decideStartup: different vault or nothing running -> start", async () => {
  assert.deepEqual(await decideStartup({ vaultPath: "/v/one", port: null, noBrowser: false, fetchImpl: fakeFetch({ 50000: ping("/v/other", 50000) }) }), { action: "start" });
  assert.deepEqual(await decideStartup({ vaultPath: "/v/one", port: null, noBrowser: false, fetchImpl: fakeFetch({}) }), { action: "start" });
});

test("decideStartup: explicit --port never probes", async () => {
  const f = fakeFetch({ 50000: ping("/v/one", 50000) });
  assert.deepEqual(await decideStartup({ vaultPath: "/v/one", port: 51234, noBrowser: false, fetchImpl: f }), { action: "start" });
  assert.equal(f.calls.length, 0);
});

test("GET /api/ping needs no auth, returns exactly {app, vault, port}", async () => {
  const vault = mkdtempSync(join(tmpdir(), "vault-"));
  const vault2 = mkdtempSync(join(tmpdir(), "vault-"));
  const mk = (v, port) => createServer({ vaultPath: v, homeDir: mkdtempSync(join(tmpdir(), "home-")), licenseCheck: () => ({ ok: false, error: "expired" }), port });
  const s1 = mk(vault, 50123), s2 = mk(vault2, null);
  await new Promise((r) => s1.listen(0, "127.0.0.1", r));
  await new Promise((r) => s2.listen(0, "127.0.0.1", r));
  const get = async (s) => { const r = await fetch(`http://127.0.0.1:${s.address().port}/api/ping`); assert.equal(r.status, 200); return r.json(); };
  const a = await get(s1), a2 = await get(s1), b = await get(s2);
  assert.deepEqual(Object.keys(a).sort(), ["app", "port", "vault"]);
  assert.equal(a.app, "shop-os-dashboard");
  assert.equal(a.port, 50123);
  assert.equal(a.vault, vaultFingerprint(vault));
  assert.equal(a.vault, a2.vault);
  assert.notEqual(a.vault, b.vault);
  s1.close(); s2.close();
});
