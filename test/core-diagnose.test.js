import { test } from "node:test";
import assert from "node:assert/strict";
import { hintFor } from "../installer/core/diagnose.js";
import { renderFailure, renderSuccess } from "../installer/core/messages.js";

test("github network failure names GitHub and firewall", () => {
  assert.match(hintFor({ message: "getaddrinfo ENOTFOUND codeload.github.com" }), /GitHub unreachable.*firewall or proxy/);
});
test("generic network", () => assert.match(hintFor({ message: "connect ETIMEDOUT 1.2.3.4:443" }), /timed out or was reset/));
test("tls interception", () => assert.match(hintFor({ outTail: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" }), /certificate/i));
test("disk full", () => assert.match(hintFor({ message: "ENOSPC: no space left on device" }), /disk/i));
test("permission", () => assert.match(hintFor({ outTail: "Access is denied." }), /antivirus|permission/i));
test("git missing", () => assert.match(hintFor({ message: "Command 'git' not found" }), /Git/));
test("unknown returns null", () => assert.equal(hintFor({ message: "weird" }), null));

test("failure message is the exact agreed text", () => {
  const m = renderFailure({ stepTitle: "Installing Claude Code", supportCode: "BP-7K2Q", logPath: "~/.shopos/logs/install-x.log" });
  assert.ok(m.includes(`Setup hit a problem at "Installing Claude Code". We've been notified and will email you shortly. If you contact us, quote support code BP-7K2Q.`));
  assert.ok(m.includes("~/.shopos/logs/install-x.log"));
});

test("success message mentions Desktop only as the spec allows", () => {
  const yes = renderSuccess({ desktopInstalled: true, vaultPath: "V", warnings: [] });
  assert.match(yes, /Code tab/);
  assert.match(yes, /Chat and Cowork/);
  const no = renderSuccess({ desktopInstalled: false, vaultPath: "V", warnings: ["Obsidian: x"] });
  assert.doesNotMatch(no, /Cowork/);
  assert.match(no, /Obsidian: x/);
});
