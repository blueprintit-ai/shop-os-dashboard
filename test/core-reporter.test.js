import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReporter, installerVersionFor } from "../installer/core/reporter.js";

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

test("a hanging fetch is aborted at the timeout; send settles near timeoutMs and flush is prompt", async () => {
  let aborted = false;
  const r = mk({ fetchImpl: (url, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => { aborted = true; rej(new Error("aborted")); })) });
  // The reporter's timers are unref'd (they must never delay process exit). A real hung fetch holds a
  // socket open; this fake holds nothing, so keep the event loop alive ourselves or Node 22 cancels the test.
  const keepAlive = setInterval(() => {}, 20);
  try {
    const t0 = Date.now();
    await r.send({ status: "progress", step: "a" });
    assert.equal(aborted, true);
    assert.ok(Date.now() - t0 < 300);
    const t1 = Date.now();
    await r.flush();
    assert.ok(Date.now() - t1 < 300);
  } finally {
    clearInterval(keepAlive);
  }
});

test("event fields cannot override the reporter identity fields", async () => {
  let body;
  const r = mk({ fetchImpl: async (u, init) => { body = JSON.parse(init.body); return { ok: true }; } });
  await r.send({ status: "progress", license_key: "x", run_id: "evil", support_code: "BP-EVIL" });
  assert.equal(body.license_key, KEY);
  assert.equal(body.run_id, "run-1");
  assert.equal(body.support_code, "BP-AAAA");
});

test("a rejecting fetch leaves one report_failed line in the local log", async () => {
  const r = mk({ fetchImpl: async () => { throw new Error("offline"); } });
  await r.send({ status: "progress", step: "a" });
  await r.flush();
  const lines = readFileSync(r.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const failed = lines.filter((l) => l.report_failed);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].reason, "offline");
});

test("a non-ok response leaves a report_failed line with the HTTP status", async () => {
  const r = mk({ fetchImpl: async () => ({ ok: false, status: 503 }) });
  await r.send({ status: "progress", step: "a" });
  await r.flush();
  const lines = readFileSync(r.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.filter((l) => l.report_failed && l.reason === "HTTP 503").length, 1);
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

test("installer_version is 2.0.0 by default and 2.0.0+<12 chars> for a valid pinned ref", async () => {
  assert.equal(installerVersionFor(undefined), "2.0.0");
  assert.equal(installerVersionFor("main"), "2.0.0+main");
  assert.equal(installerVersionFor("0123456789abcdef0123456789abcdef01234567"), "2.0.0+0123456789ab");
  assert.equal(installerVersionFor("a/../b"), "2.0.0");
  assert.equal(installerVersionFor("$(x)"), "2.0.0");
  assert.equal(installerVersionFor(".."), "2.0.0");
  assert.ok(installerVersionFor("x".repeat(64)).length <= 20);
  const calls = [];
  const r = mk({ installerVersion: installerVersionFor("0123456789abcdef"), fetchImpl: async (u, init) => { calls.push(JSON.parse(init.body)); return { ok: true }; } });
  await r.send({ status: "success", step: "complete" }); await r.flush();
  assert.equal(calls[0].installer_version, "2.0.0+0123456789ab");
});
