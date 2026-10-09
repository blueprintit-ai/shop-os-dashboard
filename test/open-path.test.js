import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateOpenPath } from "../src/lib/open-path.js";
import { decideStartup, vaultFingerprint } from "../src/lib/instance.js";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "shop-os-dashboard.js");

test("validateOpenPath accepts plain absolute paths", () => {
  for (const p of ["/employee", "/", "/a/b_c-d.html", "/employee?tab=notes&x=1", "/a%20b"]) assert.deepEqual(validateOpenPath(p), { ok: true, path: p }, p);
  assert.equal(validateOpenPath("/" + "a".repeat(99)).ok, true);
});

test("validateOpenPath rejects everything else", () => {
  for (const p of ["", undefined, null, "employee", "//evil.com", "/a//b", "http://evil.com", "https:/x", "javascript:alert(1)", "/a b", "/a\"b", "/a;b", "/a<b", "/a\\b", "/a#b", "/é", "/" + "a".repeat(100)]) {
    const r = validateOpenPath(p);
    assert.equal(r.ok, false, String(p));
    assert.ok(r.error.length > 10);
  }
});

test("CLI: a bad --open dies with a clear message before doing anything", () => {
  const vault = mkdtempSync(join(tmpdir(), "vault-"));
  for (const bad of ["http://evil.com", "//evil.com", "employee", "/a b"]) {
    const r = spawnSync(process.execPath, [BIN, vault, "--no-browser", "--open", bad], { encoding: "utf8" });
    assert.equal(r.status, 1, bad);
    assert.match(r.stderr, /--open/, bad);
  }
  const missing = spawnSync(process.execPath, [BIN, vault, "--no-browser", "--open"], { encoding: "utf8" });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /--open/);
});

test("CLI: --help documents --open", () => {
  const r = spawnSync(process.execPath, [BIN, "--help"], { encoding: "utf8" });
  assert.match(r.stdout, /--open <path>/);
});

test("decideStartup carries the open path into the attach url; default is the root", async () => {
  const vaultPath = "/v/one";
  const f = async (url) => ({ ok: true, json: async () => (new URL(url).port === "50002" ? { app: "shop-os-dashboard", vault: vaultFingerprint(vaultPath), port: 50002 } : (() => { throw new Error("refused"); })()) });
  const g = async (url) => { if (new URL(url).port !== "50002") throw new Error("ECONNREFUSED"); return f(url); };
  const a = await decideStartup({ vaultPath, port: null, noBrowser: false, openPath: "/employee", fetchImpl: g });
  assert.equal(a.action, "attach");
  assert.equal(a.url, "http://localhost:50002/employee");
  assert.equal(a.message, "Blueprint OS is already running at http://localhost:50002");
  const b = await decideStartup({ vaultPath, port: null, noBrowser: false, fetchImpl: g });
  assert.equal(b.url, "http://localhost:50002");
  const c = await decideStartup({ vaultPath, port: null, noBrowser: true, openPath: "/employee", fetchImpl: g });
  assert.equal(c.openBrowser, false);
});
