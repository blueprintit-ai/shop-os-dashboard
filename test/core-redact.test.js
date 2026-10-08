import { test } from "node:test";
import assert from "node:assert/strict";
import { shortenLicenseKey, redactText, redactDeep, capReport } from "../installer/core/redact.js";
import { newRunId, newSupportCode } from "../installer/core/ids.js";

test("license keys are shortened to first and last block", () => {
  assert.equal(shortenLicenseKey("SHOP-AB12-CD34-EF56"), "SHOP-AB12-...-EF56");
  assert.equal(redactText("key=SHOP-AB12-CD34-EF56 failed"), "key=SHOP-AB12-...-EF56 failed");
});

test("secrets are masked", () => {
  const t = "tok sk-ant-api03-abcdefghijklmnop1234 cfut_abcdefghijklmnop12345 ghp_abcdefghijklmnopqrst1234 Bearer abc.def.ghi";
  const r = redactText(t);
  assert.doesNotMatch(r, /sk-ant|cfut_|ghp_|abc\.def/);
  assert.equal((r.match(/\[masked\]/g) || []).length, 4);
});

test("home directory with a space becomes the token (Review Focus 1)", () => {
  const home = "C:\\Users\\Jos\u00e9 Garc\u00eda";
  const r = redactText(`ENOENT ${home}\\.claude\\x and ${home.replace(/\\/g, "/")}/y`, { homeDir: home, homeToken: "%USERPROFILE%" });
  assert.equal(r, "ENOENT %USERPROFILE%\\.claude\\x and %USERPROFILE%/y");
});

test("any other /Users/<name> or \\Users\\<name> is generalised", () => {
  assert.equal(redactText("D:\\Users\\bob\\file"), "D:\\Users\\<user>\\file");
  assert.equal(redactText("/Users/alice/Library"), "/Users/<user>/Library");
});

test("redactDeep walks objects and arrays", () => {
  const r = redactDeep({ a: ["SHOP-AB12-CD34-EF56"], b: { c: "ghp_abcdefghijklmnopqrst1234" }, n: 5 });
  assert.equal(r.a[0], "SHOP-AB12-...-EF56");
  assert.equal(r.b.c, "[masked]");
  assert.equal(r.n, 5);
});

test("capReport keeps a report under the byte limit, dropping detail before identity", () => {
  const big = { status: "error", step: "x", error_message: "e", output_tail: "z".repeat(50000), timeline: [{ id: "a", outTail: "q".repeat(30000) }], snapshot: { os: "w" } };
  const r = capReport(big, 20000);
  assert.ok(Buffer.byteLength(JSON.stringify(r)) <= 20000);
  assert.equal(r.status, "error");
  assert.equal(r.step, "x");
});

test("ids", () => {
  assert.match(newRunId(), /^[0-9a-f-]{36}$/);
  assert.match(newSupportCode(), /^BP-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
});

import { homedir } from "node:os";

test("fix: lowercase and JSON-escaped user paths are generalised", () => {
  assert.equal(redactText("c:\\users\\carol\\x", { homeDir: null }), "c:\\users\\<user>\\x");
  const j = JSON.stringify({ p: "C:\\Users\\carol\\x" });
  assert.doesNotMatch(redactText(j, { homeDir: null }), /carol/);
});

test("fix: home with a space, plain and JSON-escaped", () => {
  const home = "C:\\Users\\Jos\u00e9 Garc\u00eda";
  const o = { homeDir: home, homeToken: "%USERPROFILE%" };
  assert.equal(redactText(`${home}\\x`, o), "%USERPROFILE%\\x");
  const j = JSON.stringify({ p: `${home}\\x` });
  assert.doesNotMatch(redactText(j, o), /Jos/);
});

test("fix: default homeDir is os.homedir()", () => {
  const r = redactText(`at ${homedir()}/foo`);
  assert.ok(!r.includes(homedir()));
});

test("fix: prefix collision both directions", () => {
  const o = { homeDir: "C:\\Users\\bob", homeToken: "H" };
  assert.equal(redactText("C:\\Users\\bobby\\z", o), "C:\\Users\\<user>\\z");
  assert.equal(redactText("C:\\Users\\bob\\z", o), "H\\z");
  assert.equal(redactText("C:\\Users\\bob", o), "H");
});

test("fix: homeDir / is a no-op; token with $& is literal", () => {
  assert.equal(redactText("a/b/c", { homeDir: "/", homeToken: "H" }), "a/b/c");
  assert.equal(redactText("/h/me/x", { homeDir: "/h/me", homeToken: "$&" }), "$&/x");
});

test("fix: capReport enforces the cap on large identity-ish fields", () => {
  const r = capReport({ status: "error", step: "x", run_id: "r".repeat(30000), error_message: "e".repeat(30000), extra: "k".repeat(30000) }, 20000);
  assert.ok(Buffer.byteLength(JSON.stringify(r)) <= 20000);
  assert.equal(r.status, "error");
});

test("license keys are shortened case-insensitively, other text untouched", () => {
  assert.equal(shortenLicenseKey("shop-ab12-cd34-ef56"), "SHOP-ab12-...-ef56");
  assert.equal(shortenLicenseKey("Shop-Ab12-Cd34-Ef56"), "SHOP-Ab12-...-Ef56");
  assert.equal(redactText("key shop-ab12-cd34-ef56 failed", { homeDir: null }), "key SHOP-ab12-...-ef56 failed");
  assert.ok(!redactText("shop-ab12-cd34-ef56", { homeDir: null }).includes("cd34"));
  // negatives: not a key shape
  assert.equal(redactText("shop-os-dashboard and SHOP-AB12-CD34", { homeDir: null }), "shop-os-dashboard and SHOP-AB12-CD34");
  assert.equal(shortenLicenseKey("SHOP-AB12-CD34-EF56-XX"), "SHOP-AB12-...-EF56-XX");
});
