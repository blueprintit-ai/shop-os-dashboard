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
  assert.ok(ps1.toString("utf8").split("\n").length < 92);
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

// ---- fix round 1 ----
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

const P = ps1.toString("utf8");

test("macOS starter file is executable", () => {
  assert.ok(statSync(new URL("../installer/start-macos.sh", import.meta.url)).mode & 0o100);
});
test("Windows starter: robust exit-code handling, TLS 1.2, pinned Node with checksum, tar.exe, literal paths", () => {
  assert.match(P, /\$global:LASTEXITCODE = -1/);
  assert.doesNotMatch(P, /^\s*\$LASTEXITCODE = /m);
  assert.match(P, /SecurityProtocol -bor 3072/);
  assert.match(P, /\(22\|24\)/);
  assert.match(P, /SHASUMS256\.txt/);
  assert.match(P, /Get-FileHash[^\n]*SHA256/);
  assert.doesNotMatch(P, /Expand-Archive/);
  assert.doesNotMatch(P, /Test-Path (?!-LiteralPath)/);
  assert.match(P, /-ireplace/);
  assert.match(P, /%TEMP%/);
  assert.match(P, /--version/);
});
test("macOS starter: pinned Node major, checksum verified, version-checked runtime, atomic extract", () => {
  assert.match(sh, /\(22\|24\)/);
  assert.match(sh, /SHASUMS256\.txt/);
  assert.match(sh, /shasum -a 256/);
  assert.match(sh, /mktemp -d/);
  assert.match(sh, /--version/);
});

function jsonStr(input, home) {
  const fn = sh.match(/^json_str\(\) \{[\s\S]*?^\}/m)[0];
  return new Promise((resolve) => {
    const c = spawn("bash", ["-c", `${fn}\njson_str "$1"`, "bash", input], { env: { PATH: process.env.PATH, HOME: home } });
    let out = ""; c.stdout.on("data", (d) => (out += d)); c.on("close", () => resolve(out));
  });
}
test("json_str: always valid JSON (backslash, quote, home path, cut at 400 before escaping)", async () => {
  const home = "/Users/some one";
  for (const input of ['a\\b "q" c', `${home}/x\\y`, "\\".repeat(401), "ab\\".repeat(300), "x" + "\"".repeat(500), 'x"'.repeat(500), "café \t tab"]) {
    const out = await jsonStr(input, home);
    const v = JSON.parse(`"${out}"`);
    assert.ok(v.length <= 400, `len ${v.length}`);
    assert.ok(!out.includes(home));
  }
  assert.equal(JSON.parse(`"${await jsonStr(`${home}/a`, home)}"`), "~/a");
});

test("macOS starter behaves: package-extract failure prints the exact message and sends one clean report", async () => {
  const home = mkdtempSync(join(tmpdir(), "starter-home-"));
  const pkg = mkdtempSync(join(tmpdir(), "starter-pkg-"));
  let body = null, url = null;
  const srv = createServer((req, res) => {
    let b = ""; req.on("data", (d) => (b += d));
    req.on("end", () => { body = b; url = req.url; res.end("{}"); });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const env = { PATH: `${dirname(process.execPath)}:${process.env.PATH}`, HOME: home, SHOPOS_PACKAGE_DIR: pkg, SHOPOS_LICENSE_KEY: `${home}/k\\"q`,
    SHOPOS_LICENSE_SERVER: `http://127.0.0.1:${srv.address().port}` };
  const r = await new Promise((resolve) => {
    const c = spawn("bash", [process.env.STARTER_SH ?? new URL("../installer/start-macos.sh", import.meta.url).pathname], { env });
    let out = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", () => {});
    c.on("close", (code) => resolve({ code, out }));
  });
  srv.close();
  assert.equal(r.code, 1);
  const parsed = JSON.parse(body);
  assert.equal(url, "/install-log");
  assert.equal(parsed.step, "starter:package-extract");
  assert.match(parsed.support_code, /^BP-[A-HJ-NP-Z2-9]{4}$/);
  assert.ok(r.out.includes(`Setup hit a problem at "package-extract". We've been notified and will email you shortly. If you contact us, quote support code ${parsed.support_code}.`));
  assert.equal(parsed.license_key, '~/k\\"q');
  assert.ok(!body.includes(home));
});
test("the Windows starter never sends a null license_key (falls back to unknown like the Mac starter)", () => {
  const t = ps1.toString("utf8");
  assert.doesNotMatch(t, /license_key\s*=\s*\$env:SHOPOS_LICENSE_KEY/);
  assert.match(t, /license_key\s*=\s*\$lk/);
  assert.match(t, /\$lk\s*=\s*if \(\$env:SHOPOS_LICENSE_KEY\)[^\n]*"unknown"/);
});

// ---- final review fixes ----
test("macOS starter: failure reports carry a valid run_id; the node path is exported for the installer", async () => {
  const home = mkdtempSync(join(tmpdir(), "starter-home-"));
  const pkg = mkdtempSync(join(tmpdir(), "starter-pkg-"));
  let body = null;
  const srv = createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { body = b; res.end("{}"); }); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const env = { PATH: `${dirname(process.execPath)}:${process.env.PATH}`, HOME: home, SHOPOS_PACKAGE_DIR: pkg, SHOPOS_LICENSE_SERVER: `http://127.0.0.1:${srv.address().port}` };
  await new Promise((resolve) => { const c = spawn("bash", [new URL("../installer/start-macos.sh", import.meta.url).pathname], { env }); c.stdout.on("data", () => {}); c.on("close", resolve); });
  srv.close();
  const parsed = JSON.parse(body);
  assert.match(parsed.run_id, /^[A-Za-z0-9-]{1,64}$/);
});
test("macOS starter exports SHOPOS_NODE_BIN (the path it found) before handing over", async () => {
  const home = mkdtempSync(join(tmpdir(), "starter-home-"));
  const pkg = mkdtempSync(join(tmpdir(), "starter-pkg-"));
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(join(pkg, "bin"));
  writeFileSync(join(pkg, "bin", "blueprint-os-install.js"), "console.log('NODEBIN=' + process.env.SHOPOS_NODE_BIN);\n");
  const env = { PATH: `${dirname(process.execPath)}:${process.env.PATH}`, HOME: home, SHOPOS_PACKAGE_DIR: pkg };
  const out = await new Promise((resolve) => {
    const c = spawn("bash", [new URL("../installer/start-macos.sh", import.meta.url).pathname], { env });
    let o = ""; c.stdout.on("data", (d) => (o += d)); c.on("close", () => resolve(o));
  });
  assert.match(out, /NODEBIN=\/.*node\s*$/m);
});
test("Windows starter: run_id (GUID) in failure reports, SHOPOS_NODE_BIN exported, pinned Node fallback when index.json fails", () => {
  assert.match(P, /\$runId = \[guid\]::NewGuid\(\)\.ToString\(\)/);
  assert.match(P, /run_id = \$runId/);
  assert.match(P, /\$env:SHOPOS_NODE_BIN = \$nodeBin/);
  assert.match(P, /Get-Command node/);
  // the index.json fetch has its own try/catch and a v22.20.0 default set BEFORE it
  assert.match(P, /\$ver = "v22\.20\.0"[^\n]*\n\s*try \{\s*\n\s*\$idx = Invoke-RestMethod[\s\S]*?\} catch \{\}/);
  assert.ok(P.indexOf('$ver = "v22.20.0"') < P.indexOf("Invoke-RestMethod -Uri \"https://nodejs.org/dist/index.json\""));
  assert.match(P, /Get-FileHash[^\n]*SHA256/);
});

test("both starters read SHOPOS_INSTALLER_REF, validate it, and default to refs/heads/main", () => {
  const t = ps1.toString("utf8");
  for (const x of [t, sh]) {
    assert.match(x, /SHOPOS_INSTALLER_REF/);
    assert.ok(x.includes("[A-Za-z0-9._-]{1,64}"));
    assert.match(x, /refs\/heads\/main/);
  }
  assert.match(t, /tar\.gz\/\$ref"/);
  assert.match(sh, /tar\.gz\/\$REF"/);
  assert.match(t, /--strip-components=1/);
  assert.match(sh, /--strip-components=1/);
  assert.doesNotMatch(t, /tar\.gz\/refs\/heads\/main"/);
});
for (const [name, ref, expected] of [
  ["a valid ref is used", "abc123", "/blueprintit-ai/shop-os-dashboard/tar.gz/abc123"],
  ["a full sha is used", "a".repeat(40), `/tar.gz/${"a".repeat(40)}`],
  ["path traversal falls back to main", "a/../b", "/tar.gz/refs/heads/main"],
  ["command substitution falls back to main", "$(x)", "/tar.gz/refs/heads/main"],
  ["a bare dot-dot falls back to main", "..", "/tar.gz/refs/heads/main"],
  ["unset falls back to main", undefined, "/tar.gz/refs/heads/main"],
]) {
  test(`macOS starter download URL: ${name}`, async () => {
    const home = mkdtempSync(join(tmpdir(), "starter-home-"));
    const urls = [];
    const srv = createServer((req, res) => { urls.push(req.url); req.resume(); req.on("end", () => { res.statusCode = req.url.includes("tar.gz") ? 404 : 200; res.end("{}"); }); });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    const env = { PATH: `${dirname(process.execPath)}:${process.env.PATH}`, HOME: home, SHOPOS_LICENSE_SERVER: base, SHOPOS_TEST_MODE: "1", SHOPOS_TEST_CODELOAD: base };
    if (ref !== undefined) env.SHOPOS_INSTALLER_REF = ref;
    const code = await new Promise((resolve) => { const c = spawn("bash", [new URL("../installer/start-macos.sh", import.meta.url).pathname], { env }); c.stdout.on("data", () => {}); c.stderr.on("data", () => {}); c.on("close", resolve); });
    srv.close();
    assert.equal(code, 1);
    const dl = urls.find((u) => u.includes("tar.gz"));
    assert.ok(dl && dl.includes(expected), `${dl} should contain ${expected}`);
  });
}
test("the test-only codeload override is ignored unless SHOPOS_TEST_MODE=1", () => {
  assert.match(sh, /\[ "\$\{SHOPOS_TEST_MODE:-\}" = 1 \] && CL=/);
});
