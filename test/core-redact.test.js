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
