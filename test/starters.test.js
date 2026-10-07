// test/starters.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ps1 = readFileSync(new URL("../installer/start-windows.ps1", import.meta.url));
const sh = readFileSync(new URL("../installer/start-macos.sh", import.meta.url), "utf8");

test("the Windows starter is pure ASCII (PS 5.1 reads BOM-less files in the system codepage)", () => {
  for (const [i, b] of ps1.entries()) assert.ok(b < 128, `non-ASCII byte at offset ${i}`);
});
test("no iex cradle, no New-Item -LiteralPath, no admin relaunch", () => {
  const t = ps1.toString("utf8");
  assert.doesNotMatch(t, /\biex\b|Invoke-Expression/i);
  assert.doesNotMatch(t, /New-Item[^\n]*-LiteralPath/);
  assert.doesNotMatch(t, /RunAs/i);
});
test("native commands run with EAP Continue and are judged by exit code", () => {
  const t = ps1.toString("utf8");
  assert.match(t, /\$ErrorActionPreference = "Continue"/);
  assert.match(t, /\$LASTEXITCODE/);
  assert.match(t, /\$ProgressPreference = "SilentlyContinue"/);
});
test("both starters stay thin and hand over to the Node installer", () => {
  assert.ok(ps1.toString("utf8").split("\n").length < 90);
  assert.ok(sh.split("\n").length < 80);
  assert.match(ps1.toString("utf8"), /blueprint-os-install\.js/);
  assert.match(sh, /blueprint-os-install\.js/);
});
test("both starters report their own failures", () => {
  assert.match(ps1.toString("utf8"), /install-log/);
  assert.match(sh, /install-log/);
});
test("both starters use the exact customer message and support-code alphabet", () => {
  for (const t of [ps1.toString("utf8"), sh]) {
    assert.match(t, /We've been notified and will email you shortly\. If you contact us, quote support code/);
    assert.match(t, /ABCDEFGHJKLMNPQRSTUVWXYZ23456789/);
    assert.match(t, /starter:/);
    assert.match(t, /installer-v2-starter/);
  }
});
test("the Windows starter picks the arm64 Node zip, uses tar.exe and exits (not throws) on failure", () => {
  const t = ps1.toString("utf8");
  assert.match(t, /ARM64/);
  assert.match(t, /tar\.exe/);
  assert.match(t, /-UseBasicParsing/);
  assert.doesNotMatch(t, /\bthrow\b/);
  assert.match(t, /exit 1/);
});
test("the macOS starter does not use set -e and propagates the installer's exit status via exec", () => {
  assert.doesNotMatch(sh, /^set -[a-z]*e/m);
  assert.match(sh, /^set -u/m);
  assert.match(sh, /exec "\$NODE_BIN" "\$PKG_DIR\/bin\/blueprint-os-install\.js" "\$@"/);
});
