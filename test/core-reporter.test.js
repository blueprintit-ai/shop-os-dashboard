import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReporter } from "../installer/core/reporter.js";

const KEY = "SHOP-AB12-CD34-EF56";
const mk = (over = {}) => createReporter({
  licenseKey: KEY, runId: "run-1", supportCode: "BP-AAAA", serverBase: "https://srv.test",
  logDir: mkdtempSync(join(tmpdir(), "rep-")), timeoutMs: 80, ...over,
});

test("posts the documented payload; full key only in license_key, shortened in free text", async () => {
  const calls = [];
  const r = mk({ fetchImpl: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true }; } });
  await r.send({ status: "error", step: "claude-code", error_message: `failed for ${KEY}`, output_tail: "token ghp_abcdefghijklmnopqrst1234", snapshot: { os: "Windows 11" } });
  await r.flush();
  assert.equal(calls[0].url, "https://srv.test/install-log");
  const b = calls[0].body;
  assert.equal(b.license_key, KEY);
  assert.equal(b.run_id, "run-1");
  assert.equal(b.support_code, "BP-AAAA");
  assert.equal(b.status, "error");
  assert.equal(b.error_message, "failed for SHOP-AB12-...-EF56");
  assert.doesNotMatch(b.output_tail, /ghp_/);
  assert.equal(b.machine.os, "Windows 11");
  assert.equal(b.machine.source, "installer-v2");
});

test("a rejecting fetch never throws (Review Focus 4)", async () => {
  const r = mk({ fetchImpl: async () => { throw new Error("offline"); } });
  await r.send({ status: "progress", step: "a" });
  await r.flush();
});

test("a synchronously throwing fetch never throws", async () => {
  const r = mk({ fetchImpl: () => { throw new Error("boom"); } });
  await r.send({ status: "progress", step: "a" });
  await r.flush();
});

test("a hanging fetch is abandoned at the timeout and flush returns promptly", async () => {
  const r = mk({ fetchImpl: (url, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted")))) });
  r.send({ status: "progress", step: "a" });
  const t0 = Date.now();
  await r.flush();
  assert.ok(Date.now() - t0 < 1500);
});

test("writes a redacted local log line per event", async () => {
  const r = mk({ fetchImpl: async () => ({ ok: true }) });
  await r.send({ status: "progress", step: "a", error_message: KEY });
  assert.ok(existsSync(r.logPath));
  const text = readFileSync(r.logPath, "utf8");
  assert.doesNotMatch(text, /CD34/);
  assert.match(text, /SHOP-AB12-\.\.\.-EF56/);
});

test("payload stays under 20 KB", async () => {
  let body;
  const r = mk({ fetchImpl: async (u, init) => { body = init.body; return { ok: true }; } });
  await r.send({ status: "error", step: "x", output_tail: "z".repeat(80000) });
  await r.flush();
  assert.ok(Buffer.byteLength(body) <= 20000);
  assert.equal(JSON.parse(body).license_key, KEY);
});
