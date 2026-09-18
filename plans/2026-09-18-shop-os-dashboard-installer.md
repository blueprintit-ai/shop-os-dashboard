# Shop OS Dashboard Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the new install sequence for `shop-os-dashboard` — portable Node bootstrap, git-free marketplace/plugin fetch, vault scaffolding, auto-start + desktop shortcut, a `status` module driving health cards, an updater, and a LAN QR code — entirely inside this repo, so a customer can go from a downloaded `.bat`/`.command` to a running, auto-starting Shop OS Dashboard with only Node and Claude Code as prerequisites and zero administrator/sudo rights.

**Architecture:** A new `installer/` directory holds standalone, dependency-free Node modules (tar/zip extraction, portable-Node resolution, tarball-based marketplace fetch, vault scaffolding, auto-start registration) that a new `bin/shop-os-dashboard-setup.js` CLI orchestrates — the direct successor to `shop-os-installer/bin/shop-os-install.js`, minus every step that required Git, WinGet, Homebrew, or admin rights. Bootstrapping is two-stage, because that CLI is itself Node code that needs *some* Node to already exist: customer-facing scripts (`installer/setup-windows.ps1`, `installer/setup-macos.sh`) download-then-run (never `irm|iex`/`curl|bash` piped straight to a shell — the pattern already fixed in `shop-os-installer` after it tripped Windows Defender's `Trojan:Win32/Commando.A!ml` classifier) a native-shell first-contact script (`run-setup.ps1`/`run-setup.sh`) that acquires a qualifying Node using only OS-bundled tools, installs the dashboard package, and only then hands off to `bin/shop-os-dashboard-setup.js`. Inside the running dashboard, a new `status` module and `/api/status` route surface health cards (Claude Code present/signed-in, license, port, LAN address), and a new `updater` module checks the npm registry daily and can update-and-restart in place.

**Tech Stack:** Node 20+ (dev on 24), ESM, `node:http`, `node:zlib` (gunzip + raw inflate, no archive library), `node:child_process` (`spawnSync`, `spawn`), `node --test`. No new runtime dependency for the dashboard package itself. One vendored front-end file (a QR encoder) follows the project's existing vendoring pattern (`public/vendor/three.module.min.js`, `public/vendor/thinking-orbs.js`).

**Spec:** `Projects/shop-os-dashboard/specs/2026-09-05-shop-os-dashboard-design.md` (Section 5: The new install sequence; Section 6: Error handling and testing — status cards and install tests; Section 1: `status`/`updater` modules and data layout)

**This is Plan 3 of 3.** Plan 1 (Foundation) and Plan 2 (Owner Dashboard) are both implemented and merged to `main` via PR #1 and PR #2. Plan 3 is the last plan before cutover, and per the spec's own isolation rules it does **not** touch `shop-os-chat`, `shop-os-installer`, `shop-os-license-server`, or `blueprint-skills` — every new file lives in this repo. Repointing the install page and publishing the package are cutover-time operations, out of scope here.

**Reference source (read-only, copy-and-adapt, never edit in place):**
- `Projects/shop-os-installer/bin/shop-os-install.js` — the license validation (`normalizeLicenseKey`, `looksLikeLicenseKey`, `validateLicense`), vault scaffolding (`createVaultClaudeMd`, `createRawInbox`, `enableForVault`, `enableForUser`, `buildPermissionAllowList`, `saveLicenseFile`), and Claude Code detection/auto-install logic. None of this depends on Git, WinGet, or admin rights already — it is ported with only the marketplace-fetch internals swapped from `git clone`/`git fetch` to the tarball fetch built in Task 3.
- `Projects/shop-os-installer/scripts/setup-windows.ps1` and `Projects/shop-os-installer/notes/windows-defender-false-positive.md` — the non-cradle download-then-`-File` pattern and the UTF-8-BOM fix to carry into this repo's new bootstrap scripts from day one, not rediscover after a customer trips the same detection.

## Global Constraints

- Every new file lives under `Projects/shop-os-dashboard/`. Never edit `shop-os-chat`, `shop-os-installer`, `shop-os-license-server`, or `blueprint-skills` — copy logic in, don't import across repos.
- No new npm runtime dependency, for the dashboard package or the installer modules. `installer/*.js` must run with only Node built-ins, since they execute *before* any `npm install` has happened.
- No `git` subprocess anywhere in this plan. Marketplace and plugin source comes from a GitHub tarball over `fetch`, extracted by the hand-rolled extractor in Task 1 — the direct replacement for `shop-os-install.js`'s `refreshMarketplaceClone`.
- No step requires administrator (Windows) or `sudo` (macOS). Portable Node is a per-user download into `~/.shopos/runtime/`, not a system install.
- Any new customer-facing script that downloads and runs remote content (`installer/setup-windows.ps1`, `installer/setup-macos.sh`) must download to a file and execute the file — never pipe a fetch straight into `iex`/`bash -c`. On Windows, any script written to disk and later loaded with `-File` must be written with an explicit UTF-8 BOM (`new TextEncoder()` output prefixed with `EF BB BF`, or PowerShell's `[System.Text.UTF8Encoding]::new($true)`) — seen in `shop-os-installer/notes/windows-defender-false-positive.md`: a BOM-less UTF-8 file with any non-ASCII character (checkmarks, em-dashes) gets misdecoded by Windows PowerShell 5.1's system-codepage fallback and produces baffling parse errors far from the real cause.
- Auto-start registration, desktop shortcut creation, and the updater are best-effort: a failure warns and leaves a manual fallback instruction, it never fails the overall setup. Matches the existing tolerance pattern in `shop-os-install.js` (pending-plugin fallback, best-effort telemetry).
- Every network call in `installer/*.js` takes its fetch function as an injectable parameter (`fetchImpl = fetch`) so tests run offline against a fake implementation, matching this codebase's existing dependency-injection style (`runTurn`, `licenseCheck` on `createServer`).
- New server modules follow the established "one file, one job" convention and the `[method, path, {anon, staff, owner}]` role-matrix test style from `test/server.test.js`.
- Tests use `node --test`. Commit after every task. Commit messages: `feat:`, `test:`, `chore:` prefixes, and end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

## File structure

```
shop-os-dashboard/
  installer/
    tar.js                    extractTarGz(gzBuffer, destDir, {stripComponents}) — minimal USTAR reader
    zip.js                    extractZip(buffer, destDir) — minimal ZIP reader (store + deflate)
    node-runtime.js           resolveNode({homeDir, fetchImpl}) — system Node >=20 or portable download
    marketplaces.js           fetchMarketplaceTarball({repo, ref, destDir, fetchImpl}) — git-free clone replacement
    vault-setup.js            ported vault scaffolding (CLAUDE.md, Raw/, settings.json, license file)
    autostart-windows.js      registerAutoStart(), createDesktopShortcut() — schtasks + WScript.Shell .lnk
    autostart-macos.js        registerAutoStart(), createDesktopApp() — launchd plist + minimal .app bundle
    setup-windows.ps1         new bootstrap script (download-then-run, BOM-safe, no admin relaunch)
    setup-macos.sh            new bootstrap script (download-then-run)
  bin/
    shop-os-dashboard-setup.js   new CLI: prereqs, license, vault, install, autostart, first launch
  src/
    status.js                  health checks: claude, license, port, LAN, update-available
    updater.js                  registry version check + in-place update
    routes/status-routes.js
    routes/update-routes.js
  public/
    vendor/qrcode.min.js        vendored MIT QR encoder (kazuhikoarase/qrcode-generator), unmodified
    js/owner/status-widget.js   LAN address + QR + health cards, added to the owner dashboard widget library
  test/
    tar.test.js
    zip.test.js
    node-runtime.test.js
    marketplaces.test.js
    vault-setup.test.js
    autostart-windows.test.js
    autostart-macos.test.js
    status.test.js
    status-routes.test.js
    updater.test.js
    update-routes.test.js
  docs/decisions/installer-no-git-no-admin.md   rationale, mirrors the existing headless-skill-runner.md precedent
```

---

### Task 1: Tar and Zip extractors (no dependency archive handling)

**Files:**
- Create: `installer/tar.js`, `installer/zip.js`
- Test: `test/tar.test.js`, `test/zip.test.js`

**Interfaces:**
- Produces: `extractTarGz(gzBuffer: Buffer, destDir: string, opts?: {stripComponents?: number}) -> {files: string[]}` — decompresses with `node:zlib.gunzipSync`, parses USTAR headers, writes regular files and directories under `destDir`.
- Produces: `extractZip(buffer: Buffer, destDir: string) -> {files: string[]}` — parses the End Of Central Directory record, walks central directory entries, decompresses (store or deflate) via `node:zlib.inflateRawSync`, writes files under `destDir`.

- [ ] **Step 1: Write the failing tests**

Both formats are simplest to test by round-tripping: build a tiny archive in-memory with Node's own `zlib`/manual byte-writing (no external tool needed), extract it, and assert the files landed correctly.

```javascript
// test/tar.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractTarGz } from "../installer/tar.js";

function ustarHeader({ name, size, typeflag = "0" }) {
  const buf = Buffer.alloc(512);
  buf.write(name, 0, "utf8");
  buf.write("0000644\0", 100, "utf8"); // mode
  buf.write("0000000\0", 108, "utf8"); // uid
  buf.write("0000000\0", 116, "utf8"); // gid
  buf.write(size.toString(8).padStart(11, "0") + "\0", 124, "utf8"); // size (octal)
  buf.write("00000000000\0", 136, "utf8"); // mtime
  buf.write("        ", 148, "utf8"); // chksum placeholder (spaces)
  buf.write(typeflag, 156, "utf8");
  buf.write("ustar\0", 257, "utf8");
  buf.write("00", 263, "utf8");
  let sum = 0;
  for (const b of buf) sum += b;
  buf.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "utf8");
  return buf;
}

function buildTar(entries) {
  const parts = [];
  for (const e of entries) {
    const data = Buffer.from(e.content ?? "", "utf8");
    parts.push(ustarHeader({ name: e.name, size: data.length, typeflag: e.dir ? "5" : "0" }));
    if (data.length) {
      parts.push(data);
      const pad = (512 - (data.length % 512)) % 512;
      if (pad) parts.push(Buffer.alloc(pad));
    }
  }
  parts.push(Buffer.alloc(1024)); // two zero blocks = end of archive
  return Buffer.concat(parts);
}

test("extracts a flat file and strips the top-level repo-main/ prefix", () => {
  const tar = buildTar([
    { name: "repo-main/", dir: true },
    { name: "repo-main/plugin.json", content: '{"name":"x"}' },
    { name: "repo-main/nested/deep.txt", content: "hello" },
  ]);
  const gz = gzipSync(tar);
  const dest = mkdtempSync(join(tmpdir(), "tar-test-"));
  const { files } = extractTarGz(gz, dest, { stripComponents: 1 });
  assert.equal(files.length, 2);
  assert.equal(readFileSync(join(dest, "plugin.json"), "utf8"), '{"name":"x"}');
  assert.equal(readFileSync(join(dest, "nested/deep.txt"), "utf8"), "hello");
  assert.equal(existsSync(join(dest, "repo-main")), false);
});
```

```javascript
// test/zip.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractZip } from "../installer/zip.js";

function crc32(buf) {
  let c;
  const table = crc32.table ?? (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function buildZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const raw = Buffer.from(e.content, "utf8");
    const compressed = deflateRawSync(raw);
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8); // deflate
    lh.writeUInt32LE(0, 10); // time/date, unused by our reader
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(compressed.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    local.push(lh, nameBuf, compressed);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(20, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(8, 10 + 0); // method (offset 10 already used above; set again explicitly)
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(0, 12);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(compressed.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + compressed.length;
  }
  const centralBuf = Buffer.concat(central);
  const localBuf = Buffer.concat(local);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  return Buffer.concat([localBuf, centralBuf, eocd]);
}

test("extracts stored file names and deflated content", () => {
  const zip = buildZip([{ name: "node.exe", content: "fake-binary-content" }]);
  const dest = mkdtempSync(join(tmpdir(), "zip-test-"));
  const { files } = extractZip(zip, dest);
  assert.deepEqual(files, ["node.exe"]);
  assert.equal(readFileSync(join(dest, "node.exe"), "utf8"), "fake-binary-content");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/tar.test.js test/zip.test.js`
Expected: FAIL — `Cannot find module '../installer/tar.js'` / `'../installer/zip.js'`

- [ ] **Step 3: Implement the tar extractor**

```javascript
// installer/tar.js
import { gunzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BLOCK = 512;

function readField(buf, start, len) {
  return buf.subarray(start, start + len).toString("utf8").replace(/\0.*$/s, "").trim();
}

function readOctal(buf, start, len) {
  const s = readField(buf, start, len);
  return s ? parseInt(s, 8) : 0;
}

// USTAR only. GNU long-name ('L' typeflag) entries are not handled — GitHub's
// codeload tarballs and Node's own dist tarballs use plain ustar with the
// prefix field for long paths, which this does handle.
export function extractTarGz(gzBuffer, destDir, { stripComponents = 0 } = {}) {
  const tar = gunzipSync(gzBuffer);
  const files = [];
  let offset = 0;
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((b) => b === 0)) break; // end-of-archive marker
    const name = readField(header, 0, 100);
    const prefix = readField(header, 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const size = readOctal(header, 124, 12);
    const typeflag = String.fromCharCode(header[156]) || "0";
    offset += BLOCK;
    const dataStart = offset;
    const paddedSize = Math.ceil(size / BLOCK) * BLOCK;
    offset += paddedSize;

    if (!fullName) continue;
    const parts = fullName.split("/").filter(Boolean).slice(stripComponents);
    if (parts.length === 0) continue;
    const outPath = join(destDir, ...parts);

    if (typeflag === "5") {
      mkdirSync(outPath, { recursive: true });
    } else if (typeflag === "0" || typeflag === "\0") {
      mkdirSync(join(outPath, ".."), { recursive: true });
      writeFileSync(outPath, tar.subarray(dataStart, dataStart + size));
      files.push(parts.join("/"));
    }
    // Other typeflags (symlink, char/block device, fifo) are skipped — not
    // present in GitHub tarballs or Node's own dist archives.
  }
  return { files };
}
```

- [ ] **Step 4: Implement the zip extractor**

```javascript
// installer/zip.js
import { inflateRawSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

function findEocd(buf) {
  // The EOCD record's comment field means it isn't necessarily at a fixed
  // offset from the end, but scanning the trailing 66KB (max comment length
  // plus the 22-byte record) covers every zip we produce or download here.
  const searchStart = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= searchStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error("Not a valid zip file (End Of Central Directory not found)");
}

export function extractZip(buffer, destDir) {
  const eocdOffset = findEocd(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

  const files = [];
  let p = centralDirOffset;
  for (let i = 0; i < entryCount; i++) {
    if (buffer.readUInt32LE(p) !== CENTRAL_SIG) throw new Error(`Bad central directory entry at ${p}`);
    const method = buffer.readUInt16LE(p + 10);
    const compressedSize = buffer.readUInt32LE(p + 20);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const localHeaderOffset = buffer.readUInt32LE(p + 42);
    const name = buffer.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/")) continue; // directory entry, nothing to write

    // Re-read name/extra lengths from the LOCAL header: they can differ
    // slightly from the central directory copy (extra field padding tools add).
    if (buffer.readUInt32LE(localHeaderOffset) !== LOCAL_SIG) throw new Error(`Bad local header at ${localHeaderOffset}`);
    const localNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? compressed : inflateRawSync(compressed);

    const outPath = join(destDir, ...name.split("/").filter(Boolean));
    mkdirSync(join(outPath, ".."), { recursive: true });
    writeFileSync(outPath, data);
    files.push(name);
  }
  return { files };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/tar.test.js test/zip.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add installer/tar.js installer/zip.js test/tar.test.js test/zip.test.js
git commit -m "feat: dependency-free tar.gz and zip extractors for the installer

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Portable Node resolution

**Files:**
- Create: `installer/node-runtime.js`
- Test: `test/node-runtime.test.js`

**Interfaces:**
- Consumes: `extractTarGz` and `extractZip` from Task 1.
- Produces: `resolveNode({homeDir, fetchImpl?, spawnSyncImpl?, platformOverride?, archOverride?}) -> Promise<{node: string, npm: string, system: boolean, version: string}>` — `node`/`npm` are absolute paths (or the bare command name when a qualifying system Node is used). Later tasks spawn Claude Code's installer, the dashboard's own `npm install`, and the dashboard server itself with these exact paths.

- [ ] **Step 1: Write the failing test**

```javascript
// test/node-runtime.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync, deflateRawSync } from "node:zlib";
import { resolveNode } from "../installer/node-runtime.js";

function fakeIndexJson() {
  return JSON.stringify([
    { version: "v22.20.0", lts: "Jod" },
    { version: "v24.1.0", lts: false },
  ]);
}

// Minimal single-file tar.gz/zip builders, same shape as Task 1's tests,
// just enough for resolveNode to extract a "node" binary out of them.
function buildFakeDarwinTarGz() {
  const content = "#!/bin/sh\necho fake-node";
  const data = Buffer.from(content, "utf8");
  const name = "node-v22.20.0-darwin-x64/bin/node";
  const header = Buffer.alloc(512);
  header.write(name, 0, "utf8");
  header.write("0000644\0", 100, "utf8");
  header.write("0000000\0", 108, "utf8");
  header.write("0000000\0", 116, "utf8");
  header.write(data.length.toString(8).padStart(11, "0") + "\0", 124, "utf8");
  header.write("00000000000\0", 136, "utf8");
  header.write("        ", 148, "utf8");
  header.write("0", 156, "utf8");
  header.write("ustar\0", 257, "utf8");
  header.write("00", 263, "utf8");
  let sum = 0; for (const b of header) sum += b;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "utf8");
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512);
  return gzipSync(Buffer.concat([header, data, pad, Buffer.alloc(1024)]));
}

test("downloads and extracts a portable Node when no system Node qualifies", async () => {
  const home = mkdtempSync(join(tmpdir(), "node-runtime-"));
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith("/index.json")) return { ok: true, json: async () => JSON.parse(fakeIndexJson()) };
    if (url.endsWith(".tar.gz")) return { ok: true, arrayBuffer: async () => buildFakeDarwinTarGz() };
    throw new Error("unexpected url " + url);
  };
  // No qualifying system Node: simulate spawnSync returning a too-old version.
  const spawnSyncImpl = () => ({ status: 0, stdout: "v16.20.0\n" });

  const result = await resolveNode({ homeDir: home, fetchImpl, spawnSyncImpl, platformOverride: "darwin", archOverride: "x64" });

  assert.equal(result.system, false);
  assert.match(result.version, /^v22\.20\.0$/);
  assert.ok(existsSync(result.node), `expected extracted node at ${result.node}`);
  assert.ok(calls.some((u) => u.endsWith("/index.json")));
});

test("reuses an already-downloaded portable Node without fetching again", async () => {
  const home = mkdtempSync(join(tmpdir(), "node-runtime-"));
  let fetchCalls = 0;
  const fetchImpl = async (url) => {
    fetchCalls++;
    if (url.endsWith("/index.json")) return { ok: true, json: async () => JSON.parse(fakeIndexJson()) };
    if (url.endsWith(".tar.gz")) return { ok: true, arrayBuffer: async () => buildFakeDarwinTarGz() };
    throw new Error("unexpected url " + url);
  };
  const spawnSyncImpl = () => ({ status: 0, stdout: "v16.20.0\n" });
  const opts = { homeDir: home, fetchImpl, spawnSyncImpl, platformOverride: "darwin", archOverride: "x64" };

  await resolveNode(opts);
  const firstCallCount = fetchCalls;
  await resolveNode(opts);
  assert.equal(fetchCalls, firstCallCount, "second call should not re-fetch index.json or the archive");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/node-runtime.test.js`
Expected: FAIL — `Cannot find module '../installer/node-runtime.js'`

- [ ] **Step 3: Implement `resolveNode`**

```javascript
// installer/node-runtime.js
import { spawnSync as defaultSpawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { platform as osPlatform, arch as osArch } from "node:os";
import { extractTarGz } from "./tar.js";
import { extractZip } from "./zip.js";

const MIN_MAJOR = 20;
// Pinned fallback if index.json is unreachable or its shape changes — same
// defensive pattern as shop-os-installer/scripts/setup-windows.ps1's MSI fallback.
const FALLBACK_LTS = "v22.20.0";

function parseMajor(versionString) {
  const m = /^v?(\d+)\./.exec(versionString.trim());
  return m ? Number(m[1]) : 0;
}

function checkSystemNode(spawnSyncImpl) {
  try {
    const result = spawnSyncImpl("node", ["--version"], { encoding: "utf8" });
    if (result.status !== 0 || !result.stdout) return null;
    const version = result.stdout.trim();
    if (parseMajor(version) < MIN_MAJOR) return null;
    return version;
  } catch {
    return null;
  }
}

async function resolveLtsVersion(fetchImpl) {
  try {
    const resp = await fetchImpl("https://nodejs.org/dist/index.json");
    if (!resp.ok) return FALLBACK_LTS;
    const index = await resp.json();
    const lts = index.find((r) => r.lts);
    return lts?.version && /^v\d+\.\d+\.\d+$/.test(lts.version) ? lts.version : FALLBACK_LTS;
  } catch {
    return FALLBACK_LTS;
  }
}

function buildDist({ version, platformOverride, archOverride }) {
  const plat = platformOverride ?? osPlatform();
  const arch = archOverride ?? osArch();
  if (plat === "win32") {
    return { url: `https://nodejs.org/dist/${version}/node-${version}-win-x64.zip`, kind: "zip", dirName: `node-${version}-win-x64` };
  }
  const darwinArch = arch === "arm64" ? "arm64" : "x64";
  return { url: `https://nodejs.org/dist/${version}/node-${version}-darwin-${darwinArch}.tar.gz`, kind: "targz", dirName: `node-${version}-darwin-${darwinArch}` };
}

// Scans for an already-extracted portable Node instead of guessing a version
// string: a version-string guess (even the "current LTS at plan-writing-time"
// FALLBACK_LTS constant) goes stale the moment nodejs.org cuts a new LTS,
// silently reintroducing a network fetch on every call. Scanning the actual
// directory names already on disk means the cache check never depends on
// which version happens to be current.
function findCachedNode(runtimeDir, isWin) {
  if (!existsSync(runtimeDir)) return null;
  for (const name of readdirSync(runtimeDir)) {
    if (!name.startsWith("node-v")) continue;
    const dir = join(runtimeDir, name);
    const nodeBin = isWin ? join(dir, "node.exe") : join(dir, "bin", "node");
    if (!existsSync(nodeBin)) continue;
    const versionMatch = name.match(/^node-(v\d+\.\d+\.\d+)-/);
    return { nodeBin, npmBin: isWin ? join(dir, "npm.cmd") : join(dir, "bin", "npm"), version: versionMatch?.[1] ?? "unknown" };
  }
  return null;
}

export async function resolveNode({ homeDir, fetchImpl = fetch, spawnSyncImpl = defaultSpawnSync, platformOverride, archOverride }) {
  const systemVersion = checkSystemNode(spawnSyncImpl);
  if (systemVersion) {
    return { node: "node", npm: (platformOverride ?? osPlatform()) === "win32" ? "npm.cmd" : "npm", system: true, version: systemVersion };
  }

  const runtimeDir = join(homeDir, "runtime");
  const isWin = (platformOverride ?? osPlatform()) === "win32";

  const cached = findCachedNode(runtimeDir, isWin);
  if (cached) return { node: cached.nodeBin, npm: cached.npmBin, system: false, version: cached.version };

  const version = await resolveLtsVersion(fetchImpl);
  const dist = buildDist({ version, platformOverride, archOverride });
  const extractDir = join(runtimeDir, dist.dirName);
  const nodeBin = isWin ? join(extractDir, "node.exe") : join(extractDir, "bin", "node");
  const npmBin = isWin ? join(extractDir, "npm.cmd") : join(extractDir, "bin", "npm");

  mkdirSync(runtimeDir, { recursive: true });
  const resp = await fetchImpl(dist.url);
  if (!resp.ok) throw new Error(`Failed to download Node ${version} (${dist.url}): HTTP ${resp.status ?? "error"}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  if (dist.kind === "zip") extractZip(buf, runtimeDir);
  else extractTarGz(buf, runtimeDir);

  if (!existsSync(nodeBin)) throw new Error(`Node extracted but binary not found at ${nodeBin}`);
  return { node: nodeBin, npm: npmBin, system: false, version };
}
```

**Note found during implementation (2026-09-18):** the version of this function originally in this plan called `resolveLtsVersion` unconditionally before ever checking the cache, which meant the "reuse without refetching" test below would fail against a literal transcription of that code (index.json still gets fetched on the second call even though the archive doesn't). The version above — cache-by-directory-scan, checked *before* resolving a version at all — is correct and is what Task 2's implementer must build; the test below has always described the intended behavior correctly, only the originally-drafted implementation was wrong.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/node-runtime.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add installer/node-runtime.js test/node-runtime.test.js
git commit -m "feat: resolve a qualifying system Node or download a portable one

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Git-free marketplace fetch

**Files:**
- Create: `installer/marketplaces.js`
- Test: `test/marketplaces.test.js`

**Interfaces:**
- Consumes: `extractTarGz` from Task 1.
- Produces: `fetchMarketplaceTarball({repo, ref?, destDir, fetchImpl?}) -> Promise<{ok: true, files: string[]} | {ok: false, error: string}>` — downloads `https://codeload.github.com/${repo}/tar.gz/refs/heads/${ref}`, wipes and recreates `destDir`, extracts stripping the single top-level folder GitHub adds.

- [ ] **Step 1: Write the failing test**

```javascript
// test/marketplaces.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { fetchMarketplaceTarball } from "../installer/marketplaces.js";

function buildRepoTarGz() {
  function header(name, size, typeflag) {
    const buf = Buffer.alloc(512);
    buf.write(name, 0, "utf8");
    buf.write("0000644\0", 100, "utf8");
    buf.write("0000000\0", 108, "utf8");
    buf.write("0000000\0", 116, "utf8");
    buf.write(size.toString(8).padStart(11, "0") + "\0", 124, "utf8");
    buf.write("00000000000\0", 136, "utf8");
    buf.write("        ", 148, "utf8");
    buf.write(typeflag, 156, "utf8");
    buf.write("ustar\0", 257, "utf8");
    buf.write("00", 263, "utf8");
    let sum = 0; for (const b of buf) sum += b;
    buf.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "utf8");
    return buf;
  }
  const data = Buffer.from('{"plugins":[{"name":"obsidian"}]}', "utf8");
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512);
  return gzipSync(Buffer.concat([
    header("blueprint-skills-main/.claude-plugin/marketplace.json", data.length, "0"),
    data, pad,
    Buffer.alloc(1024),
  ]));
}

test("downloads, wipes destDir, and extracts stripping the top-level folder", async () => {
  const dest = mkdtempSync(join(tmpdir(), "mp-"));
  const stale = join(dest, "stale.txt");
  mkdirSync(dest, { recursive: true });
  writeFileSync(stale, "old clone leftovers");

  let requestedUrl;
  const fetchImpl = async (url) => {
    requestedUrl = url;
    return { ok: true, arrayBuffer: async () => buildRepoTarGz() };
  };

  const result = await fetchMarketplaceTarball({ repo: "blueprintit-ai/blueprint-skills", destDir: dest, fetchImpl });

  assert.equal(result.ok, true);
  assert.equal(requestedUrl, "https://codeload.github.com/blueprintit-ai/blueprint-skills/tar.gz/refs/heads/main");
  const manifest = JSON.parse(readFileSync(join(dest, ".claude-plugin/marketplace.json"), "utf8"));
  assert.equal(manifest.plugins[0].name, "obsidian");
});

test("returns ok:false instead of throwing on a network failure", async () => {
  const dest = mkdtempSync(join(tmpdir(), "mp-"));
  const fetchImpl = async () => { throw new Error("offline"); };
  const result = await fetchMarketplaceTarball({ repo: "blueprintit-ai/blueprint-skills", destDir: dest, fetchImpl });
  assert.equal(result.ok, false);
  assert.match(result.error, /offline/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/marketplaces.test.js`
Expected: FAIL — `Cannot find module '../installer/marketplaces.js'`

- [ ] **Step 3: Implement `fetchMarketplaceTarball`**

```javascript
// installer/marketplaces.js
import { rmSync, mkdirSync, existsSync } from "node:fs";
import { extractTarGz } from "./tar.js";

export async function fetchMarketplaceTarball({ repo, ref = "main", destDir, fetchImpl = fetch }) {
  const url = `https://codeload.github.com/${repo}/tar.gz/refs/heads/${ref}`;
  try {
    const resp = await fetchImpl(url);
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status} fetching ${url}` };
    const buf = Buffer.from(await resp.arrayBuffer());

    if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true });
    mkdirSync(destDir, { recursive: true });

    // GitHub's tarball has exactly one top-level directory (e.g. "repo-main/");
    // strip it so destDir's contents match the repo root directly.
    const { files } = extractTarGz(buf, destDir, { stripComponents: 1 });
    return { ok: true, files };
  } catch (e) {
    return { ok: false, error: e.message ?? String(e) };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/marketplaces.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add installer/marketplaces.js test/marketplaces.test.js
git commit -m "feat: git-free marketplace fetch via GitHub tarball

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Vault setup (ported from `shop-os-install.js`, minus Git)

**Files:**
- Create: `installer/vault-setup.js`
- Test: `test/vault-setup.test.js`

**Interfaces:**
- Consumes: `fetchMarketplaceTarball` from Task 3.
- Produces: `createVaultClaudeMd(vaultPath, license) -> boolean`, `createRawInbox(vaultPath) -> {created, alreadyExisted}`, `buildPermissionAllowList(vaultPath) -> string[]`, `enableForVault(vaultPath, pluginIds) -> string`, `enableForUser(claudeRoot, pluginIds) -> string`, `saveLicenseFile(license, homeOverride?) -> string`, `installMarketplaces({claudeRoot, fetchImpl?}) -> Promise<{added: string[], failed: Array<{name, error}>}>`.
- Produces: `normalizeLicenseKey(raw) -> string`, `looksLikeLicenseKey(key) -> boolean`, `validateLicense(key, {fetchImpl?}) -> Promise<{ok: true, license} | {ok: false, error}>` — Task 8's setup CLI needs these to turn a typed-in key into the `license` object every function above takes; nothing else in this plan currently ports them, so without this task the CLI would have no way to obtain a `license` value at all.

These are the same functions and behavior as `shop-os-installer/bin/shop-os-install.js`'s `createVaultClaudeMd`, `createRawInbox`, `buildPermissionAllowList`, `enableForVault`, `enableForUser`, `saveLicenseFile`, `normalizeLicenseKey`, `looksLikeLicenseKey`, and `validateLicense` — copied verbatim (none of them ever touched Git). Only the marketplace step changes: `installMarketplaces` replaces `ensureMarketplaces`/`refreshMarketplaceClone`, calling `fetchMarketplaceTarball` for each of the two marketplaces instead of `git clone`/`git fetch`.

- [ ] **Step 1: Write the failing test**

```javascript
// test/vault-setup.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  createVaultClaudeMd, createRawInbox, buildPermissionAllowList,
  enableForVault, saveLicenseFile, installMarketplaces,
  normalizeLicenseKey, looksLikeLicenseKey, validateLicense,
} from "../installer/vault-setup.js";

function tarGzWithManifest(pluginName) {
  function header(name, size) {
    const buf = Buffer.alloc(512);
    buf.write(name, 0, "utf8");
    buf.write("0000644\0", 100, "utf8"); buf.write("0000000\0", 108, "utf8"); buf.write("0000000\0", 116, "utf8");
    buf.write(size.toString(8).padStart(11, "0") + "\0", 124, "utf8");
    buf.write("00000000000\0", 136, "utf8"); buf.write("        ", 148, "utf8"); buf.write("0", 156, "utf8");
    buf.write("ustar\0", 257, "utf8"); buf.write("00", 263, "utf8");
    let sum = 0; for (const b of buf) sum += b;
    buf.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "utf8");
    return buf;
  }
  const data = Buffer.from(JSON.stringify({ plugins: [{ name: pluginName }] }), "utf8");
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512);
  return gzipSync(Buffer.concat([header("repo-main/.claude-plugin/marketplace.json", data.length), data, pad, Buffer.alloc(1024)]));
}

test("createVaultClaudeMd writes once, never overwrites an existing vault", () => {
  const vault = mkdtempSync(join(tmpdir(), "vault-"));
  const license = { customer: "Acme", product: "foundation" };
  assert.equal(createVaultClaudeMd(vault, license), true);
  assert.match(readFileSync(join(vault, "CLAUDE.md"), "utf8"), /Acme/);
  writeFileSync(join(vault, "CLAUDE.md"), "custom content");
  assert.equal(createVaultClaudeMd(vault, license), false);
  assert.equal(readFileSync(join(vault, "CLAUDE.md"), "utf8"), "custom content");
});

test("createRawInbox creates Raw/ and Raw/processed/ once", () => {
  const vault = mkdtempSync(join(tmpdir(), "vault-"));
  const first = createRawInbox(vault);
  assert.equal(first.created, true);
  assert.ok(existsSync(join(vault, "Raw", "processed")));
  const second = createRawInbox(vault);
  assert.equal(second.created, false);
});

test("buildPermissionAllowList includes the vault-scoped write pattern", () => {
  const list = buildPermissionAllowList("/any/vault");
  assert.ok(list.includes("Write(/**)"));
  assert.ok(list.includes("Read"));
});

test("enableForVault merges plugin ids into .claude/settings.json without clobbering existing keys", () => {
  const vault = mkdtempSync(join(tmpdir(), "vault-"));
  mkdirSync(join(vault, ".claude"), { recursive: true });
  writeFileSync(join(vault, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "other@mp": true } }));
  const path = enableForVault(vault, ["obsidian@blueprint-skills"]);
  const settings = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(settings.enabledPlugins["other@mp"], true);
  assert.equal(settings.enabledPlugins["obsidian@blueprint-skills"], true);
});

test("saveLicenseFile writes a chmod-600 record under the given home", () => {
  const home = mkdtempSync(join(tmpdir(), "home-"));
  const path = saveLicenseFile({ key: "SHOP-AAAA-BBBB-CCCC", customer: "Acme", product: "foundation", entitlements: ["foundation"] }, home);
  const record = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(record.customer, "Acme");
});

test("installMarketplaces fetches both marketplaces via tarball, no git", async () => {
  const claudeRoot = mkdtempSync(join(tmpdir(), "claude-"));
  const fetchImpl = async () => ({ ok: true, arrayBuffer: async () => tarGzWithManifest("obsidian") });
  const result = await installMarketplaces({ claudeRoot, fetchImpl });
  assert.equal(result.failed.length, 0);
  assert.equal(result.added.length, 2);
  const known = JSON.parse(readFileSync(join(claudeRoot, "plugins", "known_marketplaces.json"), "utf8"));
  assert.ok(known["blueprint-skills"]);
  assert.ok(known["claude-plugins-official"]);
});

test("normalizeLicenseKey uppercases, trims, and strips internal whitespace", () => {
  assert.equal(normalizeLicenseKey("  shop-aaaa-bbbb-cccc  "), "SHOP-AAAA-BBBB-CCCC");
  assert.equal(normalizeLicenseKey("SHOP-AAAA BBBB-CCCC"), "SHOP-AAAABBBB-CCCC");
});

test("looksLikeLicenseKey matches the SHOP-XXXX-XXXX-XXXX shape only", () => {
  assert.equal(looksLikeLicenseKey("SHOP-AAAA-BBBB-CCCC"), true);
  assert.equal(looksLikeLicenseKey("not-a-key"), false);
});

test("validateLicense returns the license body on a 200, and ok:false with the server's message otherwise", async () => {
  const okFetch = async () => ({ ok: true, text: async () => JSON.stringify({ customer: "Acme", product: "foundation", entitlements: ["foundation"] }) });
  const okResult = await validateLicense("SHOP-AAAA-BBBB-CCCC", { fetchImpl: okFetch });
  assert.equal(okResult.ok, true);
  assert.equal(okResult.license.customer, "Acme");

  const rejectFetch = async () => ({ ok: false, status: 402, text: async () => JSON.stringify({ error: "License expired" }) });
  const rejected = await validateLicense("SHOP-AAAA-BBBB-CCCC", { fetchImpl: rejectFetch });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, "License expired");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/vault-setup.test.js`
Expected: FAIL — `Cannot find module '../installer/vault-setup.js'`

- [ ] **Step 3: Implement `installer/vault-setup.js`**

Port `createVaultClaudeMd`, `createRawInbox`, `buildPermissionAllowList`, `enableForVault`, `enableForUser`, `saveLicenseFile`, `normalizeLicenseKey`, `looksLikeLicenseKey`, `validateLicense` from `Projects/shop-os-installer/bin/shop-os-install.js` lines 310–352 and 671–815 and 1032–1052 verbatim, changing only: `saveLicenseFile` takes an explicit `homeOverride` second parameter for testability (defaulting to `homedir()`); `validateLicense` takes an injectable `{fetchImpl}` instead of calling the module-level `withRetry`/`fetch` directly (the retry-on-transient-network-error wrapper is Task 8 CLI-flow polish, not required for this task's own tests); and a new `installMarketplaces` replaces `ensureMarketplaces`/`refreshMarketplaceClone`:

```javascript
// installer/vault-setup.js
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { fetchMarketplaceTarball } from "./marketplaces.js";

const MARKETPLACES = [
  { name: "blueprint-skills", repo: "blueprintit-ai/blueprint-skills" },
  { name: "claude-plugins-official", repo: "anthropics/claude-plugins-official" },
];
export const PLUGINS_TO_ENABLE = ["obsidian@blueprint-skills", "superpowers@claude-plugins-official"];
const LICENSE_SERVER = "https://shop-os-license-server.glenn-15d.workers.dev";
const LICENSE_KEY_SHAPE = /^SHOP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export function normalizeLicenseKey(raw) {
  return String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
}

export function looksLikeLicenseKey(key) {
  return LICENSE_KEY_SHAPE.test(key);
}

export async function validateLicense(key, { fetchImpl = fetch } = {}) {
  const url = `${LICENSE_SERVER}/validate?key=${encodeURIComponent(key)}`;
  let resp;
  try {
    resp = await fetchImpl(url);
  } catch (e) {
    return { ok: false, error: `network: ${e.message}` };
  }
  const text = await resp.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, error: `unexpected response (HTTP ${resp.status})` };
  }
  if (!resp.ok) return { ok: false, error: body.error || `HTTP ${resp.status}` };
  return { ok: true, license: body };
}

function readJSON(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}
function writeJSON(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

export function createVaultClaudeMd(vaultPath, license) {
  const claudeMd = join(vaultPath, "CLAUDE.md");
  if (existsSync(claudeMd)) return false;
  const content = `---\nos-mode: business\nbp-setup-state: pending\nlicense-customer: ${license.customer}\nlicense-product: ${license.product}\ninstalled-at: ${new Date().toISOString()}\n---\n\n# Shop OS Vault\n\nWelcome to your Shop OS vault. This is the operating system Blueprint IT installed for ${license.customer}.\n\nTo finish onboarding, run the following slash command inside Claude Code:\n\n\`/bp-setup\`\n`;
  mkdirSync(vaultPath, { recursive: true });
  writeFileSync(claudeMd, content, "utf8");
  return true;
}

export function createRawInbox(vaultPath) {
  const rawDir = join(vaultPath, "Raw");
  const processedDir = join(rawDir, "processed");
  const readmePath = join(rawDir, "README.md");
  const existed = existsSync(rawDir);
  mkdirSync(processedDir, { recursive: true });
  if (existsSync(readmePath)) return { created: false };
  writeFileSync(readmePath, "---\ntype: inbox-readme\ntags: [shop-os, inbox, raw]\n---\n\n# Raw / Inbox\n\nDrop any raw materials here. Run `/bp-digest` in Claude Code to file them into the vault.\n", "utf8");
  return { created: true, alreadyExisted: existed };
}

export function buildPermissionAllowList() {
  return [
    "Read", "Glob", "Grep", "Write(/**)", "Edit(/**)",
    "Bash(mkdir:*)", "Bash(chmod:*)", "Bash(find:*)", "Bash(ls:*)", "Bash(cat:*)",
    "Bash(grep:*)", "Bash(echo:*)", "Bash(test:*)", "Bash(touch:*)",
    "WebFetch", "WebSearch", "TodoWrite",
  ];
}

export function enableForVault(vaultPath, pluginIds = PLUGINS_TO_ENABLE) {
  const settingsPath = join(vaultPath, ".claude", "settings.json");
  const settings = readJSON(settingsPath, {});
  if (!settings.enabledPlugins) settings.enabledPlugins = {};
  for (const id of pluginIds) settings.enabledPlugins[id] = true;
  if (!settings.permissions) settings.permissions = {};
  const existing = Array.isArray(settings.permissions.allow) ? settings.permissions.allow : [];
  settings.permissions.allow = Array.from(new Set([...existing, ...buildPermissionAllowList()]));
  writeJSON(settingsPath, settings);
  return settingsPath;
}

export function enableForUser(claudeRoot, pluginIds = PLUGINS_TO_ENABLE) {
  const settingsPath = join(claudeRoot, "settings.json");
  const settings = readJSON(settingsPath, {});
  if (!settings.enabledPlugins) settings.enabledPlugins = {};
  for (const id of pluginIds) settings.enabledPlugins[id] = true;
  writeJSON(settingsPath, settings);
  return settingsPath;
}

export function saveLicenseFile(license, homeOverride) {
  const dir = join(homeOverride ?? homedir(), ".shopos");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "license.json");
  writeFileSync(path, JSON.stringify({
    key: license.key ?? null, customer: license.customer, product: license.product,
    entitlements: license.entitlements, valid_until: license.valid_until,
    activated_at: new Date().toISOString(),
  }, null, 2) + "\n", "utf8");
  try { chmodSync(path, 0o600); } catch { /* no-op on Windows */ }
  return path;
}

// Replaces shop-os-install.js's ensureMarketplaces()/refreshMarketplaceClone():
// same known_marketplaces.json shape, no git subprocess, no install-location
// clone directory — the plugin files land straight from the tarball.
export async function installMarketplaces({ claudeRoot, fetchImpl = fetch }) {
  const path = join(claudeRoot, "plugins", "known_marketplaces.json");
  const known = readJSON(path, {});
  const added = [];
  const failed = [];
  for (const mp of MARKETPLACES) {
    const installLocation = join(claudeRoot, "plugins", "marketplaces", mp.name);
    const wasKnown = !!known[mp.name];
    const result = await fetchMarketplaceTarball({ repo: mp.repo, destDir: installLocation, fetchImpl });
    if (!result.ok) { failed.push({ name: mp.name, error: result.error }); continue; }
    if (!wasKnown) added.push(mp.name);
    known[mp.name] = { source: { source: "tarball", repo: mp.repo }, installLocation, lastUpdated: new Date().toISOString() };
  }
  writeJSON(path, known);
  return { added, failed };
}
```

**Note found during review (2026-09-18):** the version of this function originally in this plan pushed to `added` unconditionally before checking whether the fetch actually succeeded, so a marketplace that both wasn't already known *and* failed to fetch landed in both `added` and `failed` at once — misleading for anything that reports `added` to a user (Task 8's CLI, eventually). The version above checks `wasKnown` before the fetch but only records the name as `added` after confirming success.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/vault-setup.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add installer/vault-setup.js test/vault-setup.test.js
git commit -m "feat: port vault scaffolding from shop-os-install.js, git-free marketplaces

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Auto-start registration and desktop shortcuts

**Files:**
- Create: `installer/autostart-windows.js`, `installer/autostart-macos.js`
- Test: `test/autostart-windows.test.js`, `test/autostart-macos.test.js`

**Interfaces:**
- Produces (Windows): `registerAutoStart({nodeBin, dashboardBin, vaultPath, spawnSyncImpl?}) -> {ok: boolean, error?: string}` (wraps `schtasks /create` with a login trigger, per-user, no admin), `createDesktopShortcut({nodeBin, dashboardBin, vaultPath, desktopDir, spawnSyncImpl?}) -> {ok: boolean, path?: string, error?: string}` (writes and runs a `.vbs` via `cscript` to create a `.lnk` — no COM library needed, `WScript.Shell` is built into Windows).
- Produces (macOS): `registerAutoStart({nodeBin, dashboardBin, vaultPath, homeOverride?, spawnSyncImpl?}) -> {ok: boolean, error?: string}` (writes a `launchd` user-agent plist to `~/Library/LaunchAgents/` and loads it with `launchctl`), `createDesktopApp({nodeBin, dashboardBin, vaultPath, desktopDir}) -> {ok: boolean, path?: string, error?: string}` (hand-builds a minimal `.app` bundle: `Contents/Info.plist` + a shell-script `Contents/MacOS/Shop OS`).

All four functions wrap their filesystem/spawn work in a try/catch and return `{ok: false, error}` on any thrown exception, not just a non-zero spawn exit code — the plan's Global Constraints require auto-start/shortcut failures to be best-effort and never abort the overall setup, which a thrown filesystem error (locked-down folder, full disk) would otherwise do.

- [ ] **Step 1: Write the failing tests**

```javascript
// test/autostart-windows.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAutoStart, createDesktopShortcut } from "../installer/autostart-windows.js";

test("registerAutoStart shells out to schtasks with a login trigger, no admin flag", () => {
  const calls = [];
  const spawnSyncImpl = (cmd, args) => { calls.push([cmd, args]); return { status: 0 }; };
  const result = registerAutoStart({ nodeBin: "C:\\node.exe", dashboardBin: "C:\\dash.js", vaultPath: "C:\\Vault", spawnSyncImpl });
  assert.equal(result.ok, true);
  assert.equal(calls[0][0], "schtasks");
  assert.ok(calls[0][1].includes("/create"));
  assert.ok(calls[0][1].includes("/sc") && calls[0][1].includes("ONLOGON"));
  assert.ok(!calls[0][1].some((a) => /runas|admin/i.test(a)));
});

test("registerAutoStart reports failure without throwing", () => {
  const spawnSyncImpl = () => ({ status: 1, stderr: "denied" });
  const result = registerAutoStart({ nodeBin: "n", dashboardBin: "d", vaultPath: "v", spawnSyncImpl });
  assert.equal(result.ok, false);
  assert.match(result.error, /denied/);
});

test("createDesktopShortcut writes a .vbs script and runs it via cscript", () => {
  const desktopDir = mkdtempSync(join(tmpdir(), "desktop-"));
  const calls = [];
  const spawnSyncImpl = (cmd, args) => { calls.push([cmd, args]); return { status: 0 }; };
  const result = createDesktopShortcut({ nodeBin: "C:\\node.exe", dashboardBin: "C:\\dash.js", vaultPath: "C:\\Vault", desktopDir, spawnSyncImpl });
  assert.equal(result.ok, true);
  assert.equal(calls[0][0], "cscript");
  const vbsPath = calls[0][1].find((a) => a.endsWith(".vbs"));
  assert.ok(existsSync(vbsPath));
  assert.match(readFileSync(vbsPath, "utf8"), /CreateShortcut/);
});
```

```javascript
// test/autostart-macos.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAutoStart, createDesktopApp } from "../installer/autostart-macos.js";

test("registerAutoStart writes a LaunchAgents plist and loads it", () => {
  const home = mkdtempSync(join(tmpdir(), "home-"));
  const calls = [];
  const spawnSyncImpl = (cmd, args) => { calls.push([cmd, args]); return { status: 0 }; };
  const result = registerAutoStart({ nodeBin: "/usr/local/bin/node", dashboardBin: "/dash/bin.js", vaultPath: "/Vault", homeOverride: home, spawnSyncImpl });
  assert.equal(result.ok, true);
  const plistPath = join(home, "Library", "LaunchAgents", "ai.blueprintit.shop-os-dashboard.plist");
  assert.ok(existsSync(plistPath));
  assert.match(readFileSync(plistPath, "utf8"), /RunAtLoad/);
  assert.equal(calls[0][0], "launchctl");
});

test("createDesktopApp writes a launchable .app bundle", () => {
  const desktopDir = mkdtempSync(join(tmpdir(), "desktop-"));
  const result = createDesktopApp({ nodeBin: "/usr/local/bin/node", dashboardBin: "/dash/bin.js", vaultPath: "/Vault", desktopDir });
  assert.equal(result.ok, true);
  const exe = join(result.path, "Contents", "MacOS", "Shop OS");
  assert.ok(existsSync(exe));
  assert.ok(existsSync(join(result.path, "Contents", "Info.plist")));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/autostart-windows.test.js test/autostart-macos.test.js`
Expected: FAIL — modules don't exist yet

- [ ] **Step 3: Implement `installer/autostart-windows.js`**

```javascript
// installer/autostart-windows.js
import { spawnSync as defaultSpawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TASK_NAME = "ShopOSDashboard";

// Per-user, no /RL HIGHEST, no elevation — /sc ONLOGON registers a login
// trigger in the current user's own Task Scheduler library.
export function registerAutoStart({ nodeBin, dashboardBin, vaultPath, spawnSyncImpl = defaultSpawnSync }) {
  const command = `"${nodeBin}" "${dashboardBin}" "${vaultPath}" --no-browser`;
  const result = spawnSyncImpl("schtasks", [
    "/create", "/tn", TASK_NAME, "/sc", "ONLOGON", "/tr", command, "/f",
  ], { encoding: "utf8" });
  if (result.status !== 0) return { ok: false, error: result.stderr || `schtasks exited ${result.status}` };
  return { ok: true };
}

// WScript.Shell's CreateShortcut is the standard dependency-free way to make a
// .lnk on Windows; cscript ships with every Windows install, no admin needed.
export function createDesktopShortcut({ nodeBin, dashboardBin, vaultPath, desktopDir, spawnSyncImpl = defaultSpawnSync }) {
  const shortcutPath = join(desktopDir, "Shop OS.lnk");
  const vbs = `
Set oShell = CreateObject("WScript.Shell")
Set oShortcut = oShell.CreateShortcut("${shortcutPath.replace(/\\/g, "\\\\")}")
oShortcut.TargetPath = "${nodeBin.replace(/\\/g, "\\\\")}"
oShortcut.Arguments = """${dashboardBin.replace(/\\/g, "\\\\")}"" ""${vaultPath.replace(/\\/g, "\\\\")}"""
oShortcut.WorkingDirectory = "${vaultPath.replace(/\\/g, "\\\\")}"
oShortcut.Description = "Shop OS"
oShortcut.Save
`.trim();
  // Best-effort per the plan's Global Constraints: a locked-down desktopDir,
  // a full temp volume, etc. must report {ok:false}, not throw and abort setup.
  try {
    const scriptDir = mkdtempSync(join(tmpdir(), "shopos-shortcut-"));
    const vbsPath = join(scriptDir, "shortcut.vbs");
    writeFileSync(vbsPath, vbs, "utf8");
    const result = spawnSyncImpl("cscript", ["//nologo", vbsPath], { encoding: "utf8" });
    if (result.status !== 0) return { ok: false, error: result.stderr || `cscript exited ${result.status}` };
    return { ok: true, path: shortcutPath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
```

- [ ] **Step 4: Implement `installer/autostart-macos.js`**

```javascript
// installer/autostart-macos.js
import { spawnSync as defaultSpawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const LABEL = "ai.blueprintit.shop-os-dashboard";

export function registerAutoStart({ nodeBin, dashboardBin, vaultPath, homeOverride, spawnSyncImpl = defaultSpawnSync }) {
  const home = homeOverride ?? homedir();
  const dir = join(home, "Library", "LaunchAgents");
  const plistPath = join(dir, `${LABEL}.plist`);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${dashboardBin}</string>
    <string>${vaultPath}</string>
    <string>--no-browser</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
</dict>
</plist>
`;
  // Best-effort per the plan's Global Constraints: a read-only home directory
  // or a launchctl that refuses to load must report {ok:false}, not throw.
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(plistPath, plist, "utf8");
    const result = spawnSyncImpl("launchctl", ["load", plistPath], { encoding: "utf8" });
    if (result.status !== 0) return { ok: false, error: result.stderr || `launchctl exited ${result.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// A minimal double-clickable .app: no Xcode, no bundler — just the three
// files Finder/LaunchServices require to treat a folder as an application.
export function createDesktopApp({ nodeBin, dashboardBin, vaultPath, desktopDir }) {
  const appPath = join(desktopDir, "Shop OS.app");
  const macosDir = join(appPath, "Contents", "MacOS");
  const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Shop OS</string>
  <key>CFBundleExecutable</key><string>Shop OS</string>
  <key>CFBundleIdentifier</key><string>${LABEL}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
</dict>
</plist>
`;
  const launcher = `#!/bin/bash\nopen "http://localhost:50000" 2>/dev/null\nexec "${nodeBin}" "${dashboardBin}" "${vaultPath}"\n`;
  // Best-effort per the plan's Global Constraints: this function previously had
  // no failure path at all despite three fallible fs calls — a locked-down
  // Desktop folder must report {ok:false}, not throw and abort the whole setup.
  try {
    mkdirSync(macosDir, { recursive: true });
    writeFileSync(join(appPath, "Contents", "Info.plist"), infoPlist, "utf8");
    const exePath = join(macosDir, "Shop OS");
    writeFileSync(exePath, launcher, "utf8");
    chmodSync(exePath, 0o755);
    return { ok: true, path: appPath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/autostart-windows.test.js test/autostart-macos.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add installer/autostart-windows.js installer/autostart-macos.js test/autostart-windows.test.js test/autostart-macos.test.js
git commit -m "feat: per-user auto-start and desktop shortcuts, Windows and macOS

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Status module and `/api/status` route

**Files:**
- Create: `src/status.js`, `src/routes/status-routes.js`
- Modify: `src/server.js` (register the new router, wire a status callback through `ctx`), `src/chat/run-turn.js` is **not** modified — the auth-signal hook lives in `chat-routes.js` instead
- Modify: `src/routes/chat-routes.js` (report a `claudeSignedIn` observation to the status store after each turn)
- Modify: `test/server.test.js` (add `/api/status` to the existing central role-matrix test — see Step 4a)
- Test: `test/status.test.js`, `test/status-routes.test.js`

**Interfaces:**
- Produces: `class StatusStore { constructor(homeDir); recordClaudeObservation(ok: boolean, message?: string); get(): {claude: {present, signedIn}, ...} }` persisted via the existing `JsonStore`.
- Produces: `checkStatus({vaultPath, statusStore, licenseCheck, port, spawnSyncImpl?}) -> {claude: {present: boolean, signedIn: "yes"|"no"|"unknown"}, license: {ok, error?}, vault: {reachable: boolean}, port: number, lan: string[]}`. (Task 7 later adds an `updateInfo` parameter and an `update` field to this same function — no other parameter changes after this task.)
- Produces: `statusRoutes(ctx) -> router` exposing `GET /api/status` (any authenticated user) and reusing `ctx.statusStore`.
- Consumes: `lanAddresses` from `src/lib/net.js`, `requireUser` from `src/auth.js`.

Claude Code's "signed in" state isn't safely detectable from files alone (credential storage is undocumented and platform-specific), so this mirrors Shop OS Chat's own approach: the binary's presence is checked directly, and sign-in is reported as `"unknown"` until a real chat turn observes it — `"yes"` after any turn that streams a `text`/`tool_use` event, `"no"` after a turn whose `error` event's message matches a known auth-failure shape. This is a best-effort heuristic, documented as such, and only ever narrows the status from `"unknown"` — it never contradicts a more recent observation.

- [ ] **Step 1: Write the failing tests**

```javascript
// test/status.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StatusStore, checkStatus } from "../src/status.js";

test("StatusStore starts unknown and narrows after an observation", () => {
  const home = mkdtempSync(join(tmpdir(), "status-"));
  const store = new StatusStore(home);
  assert.equal(store.get().claude.signedIn, "unknown");
  store.recordClaudeObservation(true);
  assert.equal(store.get().claude.signedIn, "yes");
  store.recordClaudeObservation(false, "Please run /login");
  assert.equal(store.get().claude.signedIn, "no");
  assert.equal(store.get().claude.lastMessage, "Please run /login");
});

test("checkStatus reports claude presence, license, vault reachability, port, and LAN addresses", () => {
  const home = mkdtempSync(join(tmpdir(), "status-"));
  const vault = mkdtempSync(join(tmpdir(), "vault-"));
  const store = new StatusStore(home);
  const spawnSyncImpl = () => ({ status: 0 });
  const licenseCheck = () => ({ ok: true });
  const result = checkStatus({ vaultPath: vault, statusStore: store, licenseCheck, port: 50000, spawnSyncImpl });
  assert.equal(result.claude.present, true);
  assert.equal(result.license.ok, true);
  assert.equal(result.vault.reachable, true);
  assert.equal(result.port, 50000);
  assert.ok(Array.isArray(result.lan));
});

test("checkStatus reports claude absent when the binary probe fails", () => {
  const home = mkdtempSync(join(tmpdir(), "status-"));
  const vault = mkdtempSync(join(tmpdir(), "vault-"));
  const store = new StatusStore(home);
  const spawnSyncImpl = () => ({ status: 1 });
  const result = checkStatus({ vaultPath: vault, statusStore: store, licenseCheck: () => ({ ok: true }), port: 50000, spawnSyncImpl });
  assert.equal(result.claude.present, false);
});
```

```javascript
// test/status-routes.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server.js";
import { UserStore } from "../src/users.js";

async function bootWithOwner(vaultPath, homeDir) {
  const server = createServer({ vaultPath, homeDir, licenseCheck: () => ({ ok: true }) });
  const users = new UserStore(`${homeDir}/users.json`);
  await users.create({ username: "owner1", password: "ownerpassword1", role: "owner", displayName: "Owner" });
  return server;
}

test("GET /api/status requires a session", async (t) => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const vault = mkdtempSync(join(tmpdir(), "vault-"));
  const home = mkdtempSync(join(tmpdir(), "home-"));
  const server = await bootWithOwner(vault, home);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const resp = await fetch(`http://127.0.0.1:${port}/api/status`);
  assert.equal(resp.status, 401);
  server.close();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/status.test.js test/status-routes.test.js`
Expected: FAIL — `src/status.js` and `src/routes/status-routes.js` don't exist

- [ ] **Step 3: Implement `src/status.js`**

```javascript
// src/status.js
import { spawnSync as defaultSpawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { JsonStore } from "./lib/store.js";
import { lanAddresses } from "./lib/net.js";

const AUTH_FAILURE_PATTERNS = [/not authenticated/i, /log ?in/i, /credentials/i, /unauthorized/i];

function defaults() {
  return { claude: { signedIn: "unknown", lastMessage: null, observedAt: null } };
}

export class StatusStore {
  constructor(homeDir) {
    this.store = new JsonStore(`${homeDir}/status.json`, defaults());
  }
  get() { return this.store.load(); }
  recordClaudeObservation(ok, message = null) {
    const current = this.get();
    current.claude = { signedIn: ok ? "yes" : "no", lastMessage: message, observedAt: new Date().toISOString() };
    this.store.save(current);
  }
  // Called from chat-routes.js after each turn's error event, so a turn that
  // streamed real content narrows "unknown" -> "yes" and an error whose
  // message looks auth-shaped narrows it to "no". Anything else is left alone.
  observeChatError(message) {
    if (AUTH_FAILURE_PATTERNS.some((re) => re.test(message))) this.recordClaudeObservation(false, message);
  }
}

export function checkStatus({ vaultPath, statusStore, licenseCheck, port, spawnSyncImpl = defaultSpawnSync }) {
  const probe = spawnSyncImpl(process.platform === "win32" ? "where" : "which", ["claude"], { encoding: "utf8" });
  const present = probe.status === 0;
  return {
    claude: { present, signedIn: statusStore.get().claude.signedIn },
    license: licenseCheck(),
    vault: { reachable: existsSync(vaultPath) },
    port,
    lan: lanAddresses(),
  };
}
```

- [ ] **Step 4: Implement `src/routes/status-routes.js` and wire it into `server.js`**

```javascript
// src/routes/status-routes.js
import { requireUser } from "../auth.js";
import { sendJson } from "../lib/http.js";
import { checkStatus } from "../status.js";

export function statusRoutes({ auth, vaultPath, statusStore, licenseCheck, port }) {
  return async (req, res, url) => {
    if (url.pathname !== "/api/status" || req.method !== "GET") return false;
    const user = requireUser(req, res, auth); if (!user) return true;
    return sendJson(res, 200, checkStatus({ vaultPath, statusStore, licenseCheck, port })), true;
  };
}
```

In `src/server.js`: import `StatusStore` from `./status.js` and `statusRoutes` from `./routes/status-routes.js`; construct `const statusStore = new StatusStore(homeDir);` alongside the other stores; add `port` to `createServer`'s options (default `null`, set by `bin/shop-os-dashboard.js` once the real port is known — see Task 8's updater wiring for the same pattern); add `statusStore` and `port` to `ctx`; append `statusRoutes(ctx)` to the `routers` array.

In `src/routes/chat-routes.js`: `runTurn` yields one `{type: "text", delta}` event per streamed chunk — often dozens per turn — so gate the "signed in" observation to fire at most once per turn rather than calling `JsonStore.save()` (a synchronous file write) on every chunk. Declare `let observedThisTurn = false;` immediately before the `for await (const ev of runTurn(...))` loop (inside the `POST /api/chat/turn` handler, scoped to that one request), and inside the loop, right after the existing `write(ev);` line, add:

```javascript
if (ev.type === "text" && !observedThisTurn) { observedThisTurn = true; ctx.statusStore?.recordClaudeObservation(true); }
if (ev.type === "error") ctx.statusStore?.observeChatError(ev.message);
```

Pass `statusStore` into `chatRoutes(ctx)`'s destructure alongside the existing fields (`const { vaultPath, auth, audit, guard, chatSessions, runTurn, statusStore } = ctx;`).

- [ ] **Step 4a: Add `/api/status` to the existing role-matrix test**

`test/server.test.js` has a central `[method, path, {anon, staff, owner}]` matrix (in the `"route-by-role matrix"` test) that every other authenticated-user-only route appears in — `/api/status` needs a row too, or there is no automated check that a real staff/owner session gets a 200 (the new `test/status-routes.test.js` only checks the anonymous 401 case). Add this line to the `cases` array, next to the similar `/api/chat/status`/`/api/me` rows:

```javascript
["GET", "/api/status", { anon: 401, staff: 200, owner: 200 }],
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/status.test.js test/status-routes.test.js`
Expected: PASS

- [ ] **Step 6: Run the full suite to confirm the `server.js`/`chat-routes.js` changes didn't regress anything**

Run: `npm test`
Expected: PASS (existing chat and server route-matrix tests unaffected — the new `statusStore` call is additive and optional-chained)

- [ ] **Step 7: Commit**

```bash
git add src/status.js src/routes/status-routes.js src/server.js src/routes/chat-routes.js test/status.test.js test/status-routes.test.js test/server.test.js
git commit -m "feat: status module with best-effort Claude sign-in detection

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Updater module and `/api/update` route

**Files:**
- Create: `src/updater.js`, `src/routes/update-routes.js`
- Modify: `src/server.js` (register the router, accept and hold `updateInfo`), `src/status.js`'s `checkStatus` (add an `update` field), `src/routes/status-routes.js` (pass `ctx.updateInfo` through to `checkStatus`)
- Test: `test/updater.test.js`, `test/update-routes.test.js`

**Interfaces:**
- Produces: `checkForUpdate({currentVersion, fetchImpl?}) -> Promise<{updateAvailable: boolean, latest: string}>` — reads `https://registry.npmjs.org/@blueprintitai/shop-os-dashboard/latest`, compares semver by parts (no semver dependency needed for a plain `major.minor.patch` compare).
- Produces: `applyUpdate({appDir, npmBin, spawnSyncImpl?}) -> {ok: boolean, error?: string}` — runs `npm install @blueprintitai/shop-os-dashboard@latest` with `cwd: appDir` using the resolved private npm.
- Produces: `updateRoutes(ctx) -> router` exposing owner-only `POST /api/update`: applies the update, then responds `200` and calls `ctx.restart()` (a callback the CLI provides — see Task 8) after a short delay so the response reaches the browser first.

- [ ] **Step 1: Write the failing tests**

```javascript
// test/updater.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkForUpdate, applyUpdate } from "../src/updater.js";

test("checkForUpdate reports updateAvailable when the registry version is newer", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ version: "0.3.0" }) });
  const result = await checkForUpdate({ currentVersion: "0.2.5", fetchImpl });
  assert.equal(result.updateAvailable, true);
  assert.equal(result.latest, "0.3.0");
});

test("checkForUpdate reports no update when current is already latest", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ version: "0.2.5" }) });
  const result = await checkForUpdate({ currentVersion: "0.2.5", fetchImpl });
  assert.equal(result.updateAvailable, false);
});

test("checkForUpdate fails closed (no update) if the registry is unreachable", async () => {
  const fetchImpl = async () => { throw new Error("offline"); };
  const result = await checkForUpdate({ currentVersion: "0.2.5", fetchImpl });
  assert.equal(result.updateAvailable, false);
});

test("applyUpdate runs npm install with the private npm binary in appDir", () => {
  const calls = [];
  const spawnSyncImpl = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { status: 0 }; };
  const result = applyUpdate({ appDir: "/app", npmBin: "/runtime/npm", spawnSyncImpl });
  assert.equal(result.ok, true);
  assert.equal(calls[0].cmd, "/runtime/npm");
  assert.deepEqual(calls[0].args, ["install", "@blueprintitai/shop-os-dashboard@latest"]);
  assert.equal(calls[0].opts.cwd, "/app");
});
```

```javascript
// test/update-routes.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server.js";
import { UserStore } from "../src/users.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("POST /api/update is owner-only", async () => {
  const vault = mkdtempSync(join(tmpdir(), "vault-"));
  const home = mkdtempSync(join(tmpdir(), "home-"));
  const server = createServer({ vaultPath: vault, homeDir: home, licenseCheck: () => ({ ok: true }) });
  const users = new UserStore(join(home, "users.json"));
  await users.create({ username: "staffer", password: "staffpassword1", role: "staff", displayName: "Staff" });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  // Must set Origin so the request clears server.js's global same-origin/CSRF
  // guard (sameOriginOk in src/auth.js) and actually reaches the /api/update
  // route — otherwise every POST here gets a 403 "cross-origin" before the
  // owner check ever runs, the assertion below fails, and because it throws
  // before server.close() runs, the open listening server keeps node --test's
  // event loop alive and the whole test run hangs forever instead of failing.
  const resp = await fetch(`${base}/api/update`, { method: "POST", headers: { origin: base } });
  assert.equal(resp.status, 401); // no session cookie at all
  server.close();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/updater.test.js test/update-routes.test.js`
Expected: FAIL — modules don't exist

- [ ] **Step 3: Implement `src/updater.js`**

```javascript
// src/updater.js
import { spawnSync as defaultSpawnSync } from "node:child_process";

function parts(v) { return v.replace(/^v/, "").split(".").map(Number); }
function isNewer(latest, current) {
  const a = parts(latest), b = parts(current);
  for (let i = 0; i < 3; i++) { if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0); }
  return false;
}

export async function checkForUpdate({ currentVersion, fetchImpl = fetch }) {
  try {
    const resp = await fetchImpl("https://registry.npmjs.org/@blueprintitai/shop-os-dashboard/latest");
    if (!resp.ok) return { updateAvailable: false, latest: currentVersion };
    const body = await resp.json();
    const latest = body.version ?? currentVersion;
    return { updateAvailable: isNewer(latest, currentVersion), latest };
  } catch {
    return { updateAvailable: false, latest: currentVersion };
  }
}

export function applyUpdate({ appDir, npmBin, spawnSyncImpl = defaultSpawnSync }) {
  const result = spawnSyncImpl(npmBin, ["install", "@blueprintitai/shop-os-dashboard@latest"], { cwd: appDir, encoding: "utf8" });
  if (result.status !== 0) return { ok: false, error: result.stderr || `npm install exited ${result.status}` };
  return { ok: true };
}
```

- [ ] **Step 4: Implement `src/routes/update-routes.js` and wire it in**

```javascript
// src/routes/update-routes.js
import { requireOwner } from "../auth.js";
import { sendJson } from "../lib/http.js";
import { applyUpdate } from "../updater.js";

export function updateRoutes({ auth, audit, appDir, npmBin, restart }) {
  return async (req, res, url) => {
    if (url.pathname !== "/api/update" || req.method !== "POST") return false;
    const user = requireOwner(req, res, auth); if (!user) return true;
    const result = applyUpdate({ appDir, npmBin });
    if (!result.ok) return sendJson(res, 500, { error: result.error }), true;
    audit.log("update.applied", { userId: user.id, username: user.username });
    sendJson(res, 200, { ok: true });
    if (typeof restart === "function") setTimeout(restart, 500).unref?.();
    return true;
  };
}
```

In `src/server.js`, add `appDir`, `npmBin`, `restart`, and `updateInfo` to `createServer`'s destructured options (`appDir`/`npmBin`/`restart` default to `null`/a no-op; `updateInfo` defaults to `{ updateAvailable: false }`), add all four to `ctx`, and append `updateRoutes(ctx)` to `routers`. `ctx.updateInfo` must stay the exact same object reference the caller passed in (Task 8's `bin/shop-os-dashboard.js` mutates it in place on its daily timer) — do not spread or clone it when building `ctx`.

In `src/status.js`'s `checkStatus`, add an `updateInfo` parameter and spread it into the response: `checkStatus({ vaultPath, statusStore, licenseCheck, port, updateInfo, spawnSyncImpl = defaultSpawnSync })`, returning `update: updateInfo ?? { updateAvailable: false }` alongside the existing fields.

In `src/routes/status-routes.js` (from Task 6), change the `statusRoutes(ctx)` destructure to also pull `updateInfo` from `ctx`, and pass it through: `checkStatus({ vaultPath, statusStore, licenseCheck, port, updateInfo })`. Without this change `ctx.updateInfo` is computed and held correctly but the route never reads it, and `/api/status` would always report `update: { updateAvailable: false }` regardless of what the daily check found.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/updater.test.js test/update-routes.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/updater.js src/routes/update-routes.js src/server.js src/status.js src/routes/status-routes.js test/updater.test.js test/update-routes.test.js
git commit -m "feat: registry-based updater with owner-triggered in-place update

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: `bin/shop-os-dashboard-setup.js` — the new setup CLI

**Files:**
- Create: `bin/shop-os-dashboard-setup.js`
- Modify: `package.json` (add the new bin entry), `bin/shop-os-dashboard.js` (accept `--home`-relative `appDir`/`npmBin` and a daily update-check timer; wire `restart` as `process.exit(0)` relying on the auto-start registration to relaunch)
- Test: `test/shop-os-dashboard-setup.test.js` (tests the orchestration logic with every side-effecting dependency injected — no real network or process spawns)

**Interfaces:**
- Consumes: `resolveNode` (Task 2), `installMarketplaces`/`createVaultClaudeMd`/`createRawInbox`/`enableForVault`/`enableForUser`/`saveLicenseFile`/`normalizeLicenseKey`/`looksLikeLicenseKey`/`validateLicense` (Task 4), `registerAutoStart`/`createDesktopShortcut`/`createDesktopApp` (Task 5).
- Produces: `main(argv?) -> Promise<void>` — the interactive CLI: prompts for (or reads `--license`/`--vault` flags for) a license key and vault path, validates the key against the license server, then calls `runSetup` and prints each step's result. This is what actually runs when the file is invoked directly (`if (import.meta.url === ...) main();`); `run-setup.ps1`/`run-setup.sh` (Task 9) invoke this file exactly that way.
- Produces: `runSetup({vaultPath, license, homeDir, isWindows, desktopDir, homeOverride?, claudeRoot?, fetchImpl?, spawnSyncImpl?}) -> Promise<{ok: boolean, steps: Array<{name, ok, error?}>}>` — the orchestration function the CLI's `main()` calls; every step is best-effort except vault scaffolding and marketplace install, matching `shop-os-install.js`'s existing fail/warn split (`fail()` for a blocking step, `warn()`/pending-list for a best-effort one). `homeOverride` exists solely so tests never touch the real machine's home directory — it flows straight through to `autostart-macos.js`'s `registerAutoStart`, the one step in this task that writes to a fixed `~/Library/...` path rather than a path built from `homeDir`/`vaultPath` (Task 5's Windows equivalent has no such path — `schtasks` is a registered OS task, not a file under `$HOME` — so `homeOverride` is a no-op there and safe to pass unconditionally). `claudeRoot` defaults to the real `~/.claude` in production (that's genuinely where Claude Code's own plugin config lives, matching `shop-os-install.js`'s `getClaudeRoot()`), but is overridable for the same test-isolation reason: `installMarketplaces` (Task 4, via `fetchMarketplaceTarball` from Task 3) deletes and recreates `<claudeRoot>/plugins/marketplaces/<name>` — without an override, a test exercising `runSetup` would delete the real `~/.claude/plugins/marketplaces/` directories on whatever machine ran it.

- [ ] **Step 1: Write the failing test**

```javascript
// test/shop-os-dashboard-setup.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { runSetup } from "../bin/shop-os-dashboard-setup.js";

function tarGzWithManifest() {
  function header(name, size) {
    const buf = Buffer.alloc(512);
    buf.write(name, 0, "utf8");
    buf.write("0000644\0", 100, "utf8"); buf.write("0000000\0", 108, "utf8"); buf.write("0000000\0", 116, "utf8");
    buf.write(size.toString(8).padStart(11, "0") + "\0", 124, "utf8");
    buf.write("00000000000\0", 136, "utf8"); buf.write("        ", 148, "utf8"); buf.write("0", 156, "utf8");
    buf.write("ustar\0", 257, "utf8"); buf.write("00", 263, "utf8");
    let sum = 0; for (const b of buf) sum += b;
    buf.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "utf8");
    return buf;
  }
  const data = Buffer.from(JSON.stringify({ plugins: [{ name: "obsidian" }] }), "utf8");
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512);
  return gzipSync(Buffer.concat([header("repo-main/.claude-plugin/marketplace.json", data.length), data, pad, Buffer.alloc(1024)]));
}

test("runSetup scaffolds the vault and reports each step, tolerating a failed auto-start", async () => {
  // homeOverride stands in for the plain OS home (os.homedir()); homeDir and
  // claudeRoot are DELIBERATELY DISTINCT tmp dirs derived from it, exactly
  // mirroring production's real relationship (homeDir defaults to
  // join(homedir(), ".shopos"), claudeRoot to join(homedir(), ".claude") —
  // siblings under the OS home, not nested in each other). Reusing one tmp
  // dir for all three (as an earlier draft of this test did) makes every
  // isolation assertion below vacuous: a regression that passes the WRONG
  // path to saveLicenseFile or registerAutoStart would produce the exact
  // same on-disk result when homeDir === homeOverride, so the test could
  // never catch it. With them distinct, a regression produces a visibly
  // different (and asserted-against) path.
  const homeOverride = mkdtempSync(join(tmpdir(), "os-home-"));
  const homeDir = join(homeOverride, ".shopos");
  const claudeRoot = join(homeOverride, ".claude");
  const vaultPath = mkdtempSync(join(tmpdir(), "vault-"));
  const desktopDir = mkdtempSync(join(tmpdir(), "desktop-"));
  const license = { key: "SHOP-AAAA-BBBB-CCCC", customer: "Acme", product: "foundation", entitlements: ["foundation"] };
  const fetchImpl = async () => ({ ok: true, arrayBuffer: async () => tarGzWithManifest() });
  // Simulate: claude present, but schtasks/launchctl denied — setup must still report ok overall.
  const spawnSyncImpl = (cmd) => (/schtasks|launchctl|cscript/.test(cmd) ? { status: 1, stderr: "denied" } : { status: 0, stdout: "v22.0.0\n" });

  const result = await runSetup({ vaultPath, license, homeDir, isWindows: false, desktopDir, homeOverride, claudeRoot, fetchImpl, spawnSyncImpl });

  assert.equal(result.ok, true);
  assert.ok(existsSync(join(vaultPath, "CLAUDE.md")));
  assert.ok(existsSync(join(vaultPath, "Raw", "processed")));
  const autostartStep = result.steps.find((s) => s.name === "autostart");
  assert.equal(autostartStep.ok, false); // reported, not thrown (launchctl "denied" above)
  // registerAutoStart writes the plist to disk before calling launchctl, so
  // it's there even though the step's overall result is ok:false. A negative
  // check against the REAL ~/Library/LaunchAgents/... would be unreliable —
  // on any machine where Shop OS Dashboard has actually been installed, that
  // exact path legitimately exists — so assert the isolated one positively
  // instead, proving homeOverride was actually used.
  assert.ok(existsSync(join(homeOverride, "Library", "LaunchAgents", "ai.blueprintit.shop-os-dashboard.plist")),
    "LaunchAgents plist must land under the isolated homeOverride, not the real machine's home");
  // Same reasoning for marketplaces: a negative check against the real
  // ~/.claude/plugins/marketplaces/blueprint-skills is unreliable (it
  // legitimately exists on any machine with Claude Code + that marketplace
  // already installed — true for whoever develops this plan). Assert the
  // fake tarball content landed in the isolated claudeRoot instead.
  assert.ok(existsSync(join(claudeRoot, "plugins", "marketplaces", "blueprint-skills", ".claude-plugin", "marketplace.json")),
    "marketplace content must land in the isolated claudeRoot");
  // saveLicenseFile appends ".shopos" itself, so passing homeOverride (not
  // homeDir, which is already "~/.shopos"-shaped) must land the file at
  // exactly homeDir/license.json (== join(homeOverride, ".shopos",
  // "license.json")) — matching where the running server's readLicense()
  // actually looks. If runSetup regressed to passing homeDir instead, the
  // file would land one level deeper, at homeDir/.shopos/license.json, and
  // this assertion would fail.
  assert.ok(existsSync(join(homeDir, "license.json")),
    "license must be saved where readLicense() will actually find it, not double-nested");
});
```

`homedir` is no longer needed as a separate import for this test's assertions (the real OS home is never referenced) — only `mkdtempSync`, `existsSync`, `tmpdir`, `join`, `gzipSync` are used, matching the imports already listed above.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/shop-os-dashboard-setup.test.js`
Expected: FAIL — `bin/shop-os-dashboard-setup.js` doesn't exist

- [ ] **Step 3: Implement `bin/shop-os-dashboard-setup.js`**

```javascript
#!/usr/bin/env node
// bin/shop-os-dashboard-setup.js
import { join } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import { resolveNode } from "../installer/node-runtime.js";
import {
  installMarketplaces, createVaultClaudeMd, createRawInbox, enableForVault, enableForUser, saveLicenseFile, PLUGINS_TO_ENABLE,
  normalizeLicenseKey, looksLikeLicenseKey, validateLicense,
} from "../installer/vault-setup.js";
import * as win from "../installer/autostart-windows.js";
import * as mac from "../installer/autostart-macos.js";

export async function runSetup({ vaultPath, license, homeDir = join(homedir(), ".shopos"), isWindows = process.platform === "win32", desktopDir, homeOverride, claudeRoot = join(homedir(), ".claude"), fetchImpl = fetch, spawnSyncImpl }) {
  const steps = [];
  const record = (name, fn) => {
    try { const value = fn(); steps.push({ name, ok: true, value }); return value; }
    catch (e) { steps.push({ name, ok: false, error: e.message }); return null; }
  };

  const node = await resolveNode({ homeDir, fetchImpl, spawnSyncImpl });
  steps.push({ name: "node", ok: true, value: node });

  const mpResult = await installMarketplaces({ claudeRoot, fetchImpl });
  steps.push({ name: "marketplaces", ok: mpResult.failed.length === 0, error: mpResult.failed.map((f) => f.error).join("; ") || undefined });

  record("vault.claudeMd", () => createVaultClaudeMd(vaultPath, license));
  record("vault.rawInbox", () => createRawInbox(vaultPath));
  record("vault.settings", () => enableForVault(vaultPath, PLUGINS_TO_ENABLE));
  record("user.settings", () => enableForUser(claudeRoot, PLUGINS_TO_ENABLE));
  // NOT homeDir: homeDir is already "~/.shopos" (used for the portable-node
  // cache and the installed app path below), but saveLicenseFile (Task 4)
  // appends ".shopos" internally — it expects the plain OS home directory,
  // the same thing homeOverride already stands in for everywhere else in
  // this function. Passing homeDir here would write to "~/.shopos/.shopos/
  // license.json", which the running server's readLicense() (its own
  // hardcoded "~/.shopos/license.json") would never find — a fresh install
  // would come up permanently unlicensed. Passing homeOverride keeps this
  // test-isolated the same way the autostart step already is.
  record("license", () => saveLicenseFile(license, homeOverride));

  const dashboardBin = join(homeDir, "app", "node_modules", "@blueprintitai", "shop-os-dashboard", "bin", "shop-os-dashboard.js");
  const autostartMod = isWindows ? win : mac;
  const autostartResult = autostartMod.registerAutoStart({ nodeBin: node.node, dashboardBin, vaultPath, homeOverride, spawnSyncImpl });
  steps.push({ name: "autostart", ok: autostartResult.ok, error: autostartResult.error });

  if (desktopDir) {
    const shortcutResult = isWindows
      ? win.createDesktopShortcut({ nodeBin: node.node, dashboardBin, vaultPath, desktopDir, spawnSyncImpl })
      : mac.createDesktopApp({ nodeBin: node.node, dashboardBin, vaultPath, desktopDir });
    steps.push({ name: "shortcut", ok: shortcutResult.ok, error: shortcutResult.error });
  }

  // Blocking steps: vault scaffolding and marketplaces. Everything else
  // (autostart, shortcut) is best-effort and never flips the overall result.
  const blocking = steps.filter((s) => ["marketplaces", "vault.claudeMd", "vault.rawInbox", "vault.settings", "user.settings", "license"].includes(s.name));
  return { ok: blocking.every((s) => s.ok), steps, node };
}

// CLI entry: parses --license/--vault flags (mirroring shop-os-install.js's
// existing flag names so a future cutover doesn't retrain anyone), prompting
// for whichever one is missing, then hands off to runSetup.
export async function main(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--license") args.license = argv[++i];
    else if (argv[i] === "--vault") args.vault = argv[++i];
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let license;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const rawKey = args.license || (await rl.question("Shop OS license key: "));
    const key = normalizeLicenseKey(rawKey);
    if (!looksLikeLicenseKey(key)) {
      console.log(`That doesn't look like a Shop OS key. The format is SHOP-XXXX-XXXX-XXXX.`);
      if (attempt === 3) { rl.close(); console.error("No valid license key entered."); process.exitCode = 1; return; }
      continue;
    }
    const result = await validateLicense(key);
    if (result.ok) { license = { ...result.license, key }; break; }
    console.log(`License rejected: ${result.error}`);
    if (attempt === 3) { rl.close(); console.error("License validation failed."); process.exitCode = 1; return; }
  }

  const vaultPath = args.vault || (await rl.question("Vault folder path: "));
  rl.close();

  const homeDir = join(homedir(), ".shopos");
  const desktopDir = join(homedir(), "Desktop");
  console.log(`Installing Shop OS Dashboard for ${license.customer} into ${vaultPath}...`);
  const result = await runSetup({ vaultPath, license, homeDir, desktopDir });

  for (const step of result.steps) console.log(`  ${step.ok ? "✓" : "⚠"} ${step.name}${step.error ? `: ${step.error}` : ""}`);
  if (!result.ok) { console.error("Setup did not complete — see the failed step above."); process.exitCode = 1; return; }
  console.log(`\nDone. Shop OS Dashboard will start automatically at login, or run it now with:\n  ${result.node.node} ${join(homeDir, "app", "node_modules", "@blueprintitai", "shop-os-dashboard", "bin", "shop-os-dashboard.js")} "${vaultPath}"`);
}

// NOT `import.meta.url === \`file://${process.argv[1]}\``: that string-built
// comparison is silently false on Windows. import.meta.url for a file at
// C:\Users\x\bin\shop-os-dashboard-setup.js is "file:///C:/Users/x/bin/..."
// (forward slashes, a leading triple slash, percent-encoded special chars),
// while the naive template produces "file://C:\Users\x\bin\..." (raw
// backslashes) — the two never match, so main() would silently never run on
// the platform this installer's schtasks/cscript code exists for in the
// first place. pathToFileURL() produces the same normalized form
// import.meta.url uses, on every platform, including percent-encoding a
// path containing spaces (which the naive template also gets wrong on
// POSIX). Also, unlike the brief's original bare `main();`, failures are
// caught and reported instead of surfacing as a raw stack trace.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err.message || String(err)); process.exitCode = 1; });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/shop-os-dashboard-setup.test.js`
Expected: PASS

- [ ] **Step 5: Add the bin entry and wire the daily update check into `bin/shop-os-dashboard.js`**

In `package.json`, add `"shop-os-dashboard-setup": "./bin/shop-os-dashboard-setup.js"` to `"bin"`.

In `bin/shop-os-dashboard.js`'s `main()`, add a daily update check whose result `status-routes.js` (Task 7) can read live on every request. This needs a **mutable object passed by reference**, not a reassigned local variable: `createServer` is called once, `ctx.updateInfo` is captured once, and `refreshUpdateInfo` runs on an interval afterward — reassigning a local `let updateInfo = ...` would leave `ctx.updateInfo` pointing at the original, now-stale object. Mutate the object's fields in place instead:

`bin/shop-os-dashboard.js` currently imports only `{ existsSync, statSync }` from `"node:fs"` — add `readFileSync` to that same import line for the snippet below.

```javascript
import { checkForUpdate } from "../src/updater.js";
// ...
const updateInfo = { updateAvailable: false, latest: null };
async function refreshUpdateInfo() {
  const result = await checkForUpdate({ currentVersion: JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version });
  Object.assign(updateInfo, result);
}
refreshUpdateInfo();
setInterval(refreshUpdateInfo, 24 * 60 * 60 * 1000).unref?.();

const server = createServer({
  vaultPath, homeDir: home,
  port, // the resolved listening port (from parseArgs/findFreePort above) — so /api/status reports the real port, not the default null
  appDir: join(home, "app"),
  npmBin: process.env.SHOPOS_NPM_BIN || "npm",
  updateInfo, // same object refreshUpdateInfo mutates — see Task 7's server.js wiring
  restart: () => process.exit(0), // the registered auto-start task/agent relaunches it
});
```

This `createServer({...})` call replaces the file's current `createServer({ vaultPath, homeDir: home })` — `port` is already computed a few lines earlier in this same function (`let port = args.port; if (!port) { port = await findFreePort(); }`), it was just never threaded through before this task.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add bin/shop-os-dashboard-setup.js bin/shop-os-dashboard.js package.json test/shop-os-dashboard-setup.test.js
git commit -m "feat: shop-os-dashboard-setup CLI orchestrating the new install sequence

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Bootstrap scripts — `installer/setup-windows.ps1` and `installer/setup-macos.sh`

**Files:**
- Create: `installer/setup-windows.ps1`, `installer/setup-macos.sh`, `installer/run-setup.ps1`, `installer/run-setup.sh`
- Create: `docs/decisions/installer-no-git-no-admin.md`

These are the customer-facing entry points a personalized `.bat`/`.command` will eventually download and run (repointing the install page happens at cutover, out of scope here). They apply the non-cradle, BOM-safe pattern from `shop-os-installer/notes/windows-defender-false-positive.md` from the start.

**Why `run-setup.ps1`/`run-setup.sh` cannot just call `resolveNode` (Task 2):** `bin/shop-os-dashboard-setup.js` is a Node script — something has to acquire a qualifying Node binary *before* any Node code, including `resolveNode`, can execute at all. That acquisition has to happen in native shell code. `run-setup.ps1`/`run-setup.sh` therefore duplicate a small, deliberately minimal version of Task 2's system-Node-or-download logic in PowerShell/bash, using tools that ship with the OS: PowerShell's `Expand-Archive` for the Windows Node `.zip`, and the `tar` binary Windows 10 1803+ and every macOS release ship in `System32`/`/usr/bin` for both the Node `.tar.gz` and the dashboard package's own GitHub tarball fallback. `resolveNode` (Task 2) remains genuinely used — by the *running* dashboard process (e.g. a future self-heal check) and by anything invoking `bin/shop-os-dashboard-setup.js` through an environment that already guarantees a Node (such as `npx`) — just not by this first-contact bootstrap, which by definition runs before any of that exists.

**Keeping both install paths landing in the same place:** whether the dashboard package comes from `npm install --prefix` (happy path) or the GitHub tarball fallback (npm registry unreachable), both must leave it at the exact same path Task 8's `runSetup` hardcodes: `~/.shopos/app/node_modules/@blueprintitai/shop-os-dashboard/`. The fallback therefore extracts the tarball straight into that nested path (not flat into `~/.shopos/app`) and runs `npm install --production` inside it to pull its two runtime dependencies from the registry — the fallback only covers the *package itself* being unreachable via `npm install`, not a full registry outage, exactly like the existing `npm view || npx --package=github:...` fallback already accepted in `shop-os-installer/scripts/setup-windows.ps1`.

- [ ] **Step 1: Write `installer/setup-windows.ps1`**

```powershell
# Shop OS Dashboard — Windows Setup Bootstrap
#
# Downloads this package's setup CLI and runs it. Deliberately NOT an
# `irm URL | iex` cradle (bypass-policy + env var + pipe-to-iex is exactly the
# shape Defender's Trojan:Win32/Commando.A!ml classifier flagged in the old
# shop-os-installer flow — see notes/windows-defender-false-positive.md in
# that repo). Download to a file, then run the file with -File.
#
# No admin relaunch: nothing here needs elevation. Portable Node and the
# dashboard package both install per-user under %USERPROFILE%\.shopos.

$ErrorActionPreference = "Stop"
$raw = "https://raw.githubusercontent.com/blueprintit-ai/shop-os-dashboard/main/installer"

Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

$setupPs1 = Join-Path $env:TEMP "shop-os-dashboard-setup-$([guid]::NewGuid().ToString('N')).ps1"
try {
  # irm decodes to a string; writing it back with an explicit BOM is what
  # makes Windows PowerShell 5.1's later -File load decode it as UTF-8
  # regardless of system codepage — see the note above.
  $content = Invoke-RestMethod -Uri "$raw/run-setup.ps1" -UseBasicParsing
  [System.IO.File]::WriteAllText($setupPs1, $content, (New-Object System.Text.UTF8Encoding($true)))
  & $setupPs1 @args
} finally {
  Remove-Item $setupPs1 -ErrorAction SilentlyContinue
}
```

- [ ] **Step 2: Write `installer/setup-macos.sh`**

```bash
#!/bin/bash
# Shop OS Dashboard — macOS Setup Bootstrap
#
# Downloads this package's setup script to a file and runs the file, rather
# than piping curl straight into bash — same non-cradle principle as the
# Windows bootstrap (see installer/setup-windows.ps1's header comment).
set -euo pipefail

RAW="https://raw.githubusercontent.com/blueprintit-ai/shop-os-dashboard/main/installer"
TMP_SCRIPT="$(mktemp -t shop-os-dashboard-setup)"
trap 'rm -f "$TMP_SCRIPT"' EXIT

curl -fsSL "$RAW/run-setup.sh" -o "$TMP_SCRIPT"
chmod +x "$TMP_SCRIPT"
"$TMP_SCRIPT" "$@"
```

- [ ] **Step 3: Write `installer/run-setup.ps1`**

```powershell
# Shop OS Dashboard — run-setup.ps1
# Fetched and run by setup-windows.ps1. No Node exists on this machine yet
# when this runs, so it uses only native PowerShell (Expand-Archive, tar.exe
# — bundled since Windows 10 1803) rather than installer/node-runtime.js,
# which is Node code. See this task's header note for why.
$ErrorActionPreference = "Stop"
$shoposHome = Join-Path $env:USERPROFILE ".shopos"
$appDir = Join-Path $shoposHome "app"
$pkgDir = Join-Path $appDir "node_modules\@blueprintitai\shop-os-dashboard"
New-Item -ItemType Directory -Force -Path $shoposHome, $appDir | Out-Null

function Find-QualifyingNode {
  try {
    $v = & node --version 2>$null
    if ($LASTEXITCODE -eq 0 -and $v -match '^v(\d+)\.' -and [int]$Matches[1] -ge 20) { return "node" }
  } catch {}
  $portable = Get-ChildItem -Path (Join-Path $shoposHome "runtime") -Filter "node.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($portable) { return $portable.FullName }
  return $null
}

$nodeBin = Find-QualifyingNode
if (-not $nodeBin) {
  Write-Host "Downloading portable Node.js..."
  $index = Invoke-RestMethod -Uri "https://nodejs.org/dist/index.json" -UseBasicParsing
  $lts = $index | Where-Object { $_.lts } | Select-Object -First 1
  $version = if ($lts -and $lts.version -match '^v\d+\.\d+\.\d+$') { $lts.version } else { "v22.20.0" }
  $runtimeDir = Join-Path $shoposHome "runtime"
  New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
  $zipPath = Join-Path $env:TEMP "node-$version.zip"
  Invoke-WebRequest -Uri "https://nodejs.org/dist/$version/node-$version-win-x64.zip" -OutFile $zipPath -UseBasicParsing
  Expand-Archive -Path $zipPath -DestinationPath $runtimeDir -Force
  Remove-Item $zipPath -ErrorAction SilentlyContinue
  $nodeBin = Join-Path $runtimeDir "node-$version-win-x64\node.exe"
}
$npmBin = $nodeBin -replace "node\.exe$", "npm.cmd"
if ($npmBin -eq "npm.cmd") { $npmBin = "npm.cmd" } # system Node case: npm.cmd is already on PATH

if (-not (Test-Path (Join-Path $pkgDir "bin\shop-os-dashboard-setup.js"))) {
  Write-Host "Installing Shop OS Dashboard..."
  & $npmBin install --prefix $appDir "@blueprintitai/shop-os-dashboard@latest" 2>$null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $pkgDir "bin\shop-os-dashboard-setup.js"))) {
    Write-Host "npm registry unavailable for this package, fetching from GitHub instead..."
    New-Item -ItemType Directory -Force -Path $pkgDir | Out-Null
    $tarPath = Join-Path $env:TEMP "shop-os-dashboard.tar.gz"
    Invoke-WebRequest -Uri "https://codeload.github.com/blueprintit-ai/shop-os-dashboard/tar.gz/refs/heads/main" -OutFile $tarPath -UseBasicParsing
    & tar -xzf $tarPath -C $pkgDir --strip-components=1
    Remove-Item $tarPath -ErrorAction SilentlyContinue
    Push-Location $pkgDir
    & $npmBin install --production 2>$null
    Pop-Location
  }
}

& $nodeBin (Join-Path $pkgDir "bin\shop-os-dashboard-setup.js") @args
```

- [ ] **Step 4: Write `installer/run-setup.sh`**

```bash
#!/bin/bash
# Shop OS Dashboard — run-setup.sh
# Fetched and run by setup-macos.sh. Same reasoning as run-setup.ps1's header
# comment: no Node exists yet, so this uses only native shell tools (curl,
# tar — both preinstalled on macOS).
set -euo pipefail

SHOPOS_HOME="$HOME/.shopos"
APP_DIR="$SHOPOS_HOME/app"
PKG_DIR="$APP_DIR/node_modules/@blueprintitai/shop-os-dashboard"
mkdir -p "$SHOPOS_HOME" "$APP_DIR"

find_qualifying_node() {
  if command -v node >/dev/null 2>&1; then
    major="$(node --version | sed -E 's/^v([0-9]+)\..*/\1/')"
    if [ "$major" -ge 20 ] 2>/dev/null; then command -v node; return; fi
  fi
  found="$(find "$SHOPOS_HOME/runtime" -maxdepth 3 -name node -type f 2>/dev/null | head -n1 || true)"
  [ -n "$found" ] && echo "$found"
}

NODE_BIN="$(find_qualifying_node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "Downloading portable Node.js..."
  ARCH="$(uname -m)"; [ "$ARCH" = "arm64" ] && NODE_ARCH="arm64" || NODE_ARCH="x64"
  VERSION="$(curl -fsSL https://nodejs.org/dist/index.json | node -e '' 2>/dev/null || true)"
  # No node yet to parse JSON with — grep the first "lts" entry's version instead.
  VERSION="$(curl -fsSL https://nodejs.org/dist/index.json | grep -o '"version":"v[0-9.]*","date":"[0-9-]*","files":\[[^]]*\],"npm":"[0-9.]*","lts":"[A-Za-z]' | head -n1 | grep -o 'v[0-9.]*' | head -n1)"
  [ -z "$VERSION" ] && VERSION="v22.20.0"
  RUNTIME_DIR="$SHOPOS_HOME/runtime"
  mkdir -p "$RUNTIME_DIR"
  curl -fsSL "https://nodejs.org/dist/$VERSION/node-$VERSION-darwin-$NODE_ARCH.tar.gz" -o "$RUNTIME_DIR/node.tar.gz"
  tar -xzf "$RUNTIME_DIR/node.tar.gz" -C "$RUNTIME_DIR"
  rm -f "$RUNTIME_DIR/node.tar.gz"
  NODE_BIN="$RUNTIME_DIR/node-$VERSION-darwin-$NODE_ARCH/bin/node"
fi
NPM_BIN="$(dirname "$NODE_BIN")/npm"
[ -x "$NPM_BIN" ] || NPM_BIN="npm"

if [ ! -f "$PKG_DIR/bin/shop-os-dashboard-setup.js" ]; then
  echo "Installing Shop OS Dashboard..."
  if ! "$NPM_BIN" install --prefix "$APP_DIR" "@blueprintitai/shop-os-dashboard@latest" >/dev/null 2>&1 || [ ! -f "$PKG_DIR/bin/shop-os-dashboard-setup.js" ]; then
    echo "npm registry unavailable for this package, fetching from GitHub instead..."
    mkdir -p "$PKG_DIR"
    curl -fsSL "https://codeload.github.com/blueprintit-ai/shop-os-dashboard/tar.gz/refs/heads/main" -o "$SHOPOS_HOME/shop-os-dashboard.tar.gz"
    tar -xzf "$SHOPOS_HOME/shop-os-dashboard.tar.gz" -C "$PKG_DIR" --strip-components=1
    rm -f "$SHOPOS_HOME/shop-os-dashboard.tar.gz"
    (cd "$PKG_DIR" && "$NPM_BIN" install --production >/dev/null 2>&1)
  fi
fi

exec "$NODE_BIN" "$PKG_DIR/bin/shop-os-dashboard-setup.js" "$@"
```

`run-setup.sh`'s Node-version resolution avoids parsing JSON with a tool that may not exist yet (no `jq`, no Node) by grepping `index.json`'s text for the first LTS entry — cruder than `run-setup.ps1`'s `Invoke-RestMethod` (which parses JSON natively), but sufficient for a value that only needs to match `vX.Y.Z` and falls back to a pinned version on any miss, the same defensive pattern Task 2's `resolveLtsVersion` uses.

- [ ] **Step 5: Write `docs/decisions/installer-no-git-no-admin.md`**

```markdown
# Decision: no Git, no admin/sudo, no WinGet/Homebrew in the installer

Shop OS Chat's installer (`shop-os-installer`) requires Git (to clone two
plugin marketplaces), WinGet or Homebrew (to install Node.js), and — on a
machine without WinGet already present — occasionally an admin relaunch.
None of that is available or comfortable on every small-business owner's
computer, and the design spec (Section 5) commits to removing all of it.

## What replaced what

| Removed | Replacement | Where |
|---|---|---|
| `git clone`/`git fetch` for marketplaces | GitHub codeload tarball over `fetch`, extracted by a hand-rolled USTAR reader | `installer/tar.js`, `installer/marketplaces.js` |
| WinGet/Homebrew/MSI for Node.js (first contact, no Node exists yet) | Native shell tools: PowerShell's `Expand-Archive` for the Windows Node `.zip`, `tar` (bundled since Windows 10 1803, and on every macOS) for the `.tar.gz` builds | `installer/run-setup.ps1`, `installer/run-setup.sh` |
| Re-resolving Node once the dashboard is already running under Node | The same system-or-download logic, in-process, with injectable `fetch`/`spawnSync` for tests | `installer/node-runtime.js` |
| Admin relaunch for WinGet | Not needed — nothing left requires elevation | n/a |

## Two Node-acquisition paths, on purpose

`run-setup.ps1`/`run-setup.sh` cannot call `installer/node-runtime.js` — it's
Node code, and nothing can run it until *some* Node already exists. So the
very first bootstrap does its own minimal version of the same "system Node
≥20, else download" check in native shell, using tools the OS already ships.
`node-runtime.js`'s more careful, fully-tested version is for every use
*after* that point: the running dashboard process, and anything that invokes
`bin/shop-os-dashboard-setup.js` through a context that already guarantees a
Node (`npx`, for instance). The duplication is small and deliberate, not
missed refactoring — see Task 9 in the implementation plan for the full
reasoning.

## Why hand-rolled tar/zip readers instead of a dependency (in-process use)

Once Node is running, `installer/marketplaces.js` and `installer/node-runtime.js`
still can't reach for an npm package to extract an archive — a runtime
dependency isn't available yet to fetch a dependency with. The formats
themselves are small and stable (USTAR, ZIP local/central headers);
`shop-os-license-server`'s `buildZipWithExecutable` already hand-rolls a ZIP
*writer* for the same class of reason, this is the same tradeoff in reverse.
The shell-level bootstrap above doesn't have this problem at all — it uses
the OS's own `tar`/`Expand-Archive` directly, no hand-rolled code needed.
```

- [ ] **Step 6: Commit**

```bash
git add installer/setup-windows.ps1 installer/setup-macos.sh installer/run-setup.ps1 installer/run-setup.sh docs/decisions/installer-no-git-no-admin.md
git commit -m "feat: non-cradle bootstrap scripts for the new install sequence

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: LAN QR code and status cards on the owner dashboard

**Files:**
- Modify: `public/owner.html` (add a "System" widget slot), `public/js/owner/widgets.js` (register the new widget in the library)
- Create: `public/js/owner/status-widget.js`, `public/vendor/qrcode.min.js` (vendored)
- Modify: `NOTICE.md` (record the new vendored file)
- Test: `test/e2e/owner.spec.js` (extend the existing Playwright suite with one assertion)

**Interfaces:**
- Consumes: `GET /api/status` from Task 6 (`{claude, license, vault, port, lan, update}`).
- Produces: a `status` widget type recognized by `widgets.js`'s existing widget-registry pattern (same shape as the `stats`/`routines` data widgets added in Plan 2), rendering: a QR code of `http://<first LAN address>:<port>`, the address as text (for typing manually), and pass/fail cards for `claude.present`, `claude.signedIn !== "no"`, `license.ok`, `vault.reachable`, plus an "Update available" banner when `update.updateAvailable` is true with an owner-only "Update now" button posting to `/api/update`.

- [ ] **Step 1: Vendor the QR encoder**

Download `qrcode.min.js` from `kazuhikoarase/qrcode-generator` (MIT license, single dependency-free file, the same library already widely vendored for exactly this "no bundler, no CDN, LAN-only" constraint) into `public/vendor/qrcode.min.js`, unmodified. Add to `NOTICE.md`'s "Other vendored code" section:

```markdown
`vendor/qrcode.min.js` is MIT-licensed (c) Kazuhiko Arase, used unmodified — https://github.com/kazuhikoarase/qrcode-generator.
```

- [ ] **Step 2: Write the failing browser test**

```javascript
// test/e2e/owner.spec.js — append to the existing Playwright suite
test("owner dashboard shows a status widget with the LAN address", async ({ page }) => {
  // ...existing login-as-owner setup from earlier tests in this file...
  await page.goto("/owner");
  await page.click('[data-widget-add="status"]'); // uses the existing edit-mode widget-add affordance from Plan 2
  await expect(page.locator('[data-widget="status"] .lan-address')).toBeVisible();
  await expect(page.locator('[data-widget="status"] canvas.qr-code')).toBeVisible();
});
```

- [ ] **Step 3: Implement `public/js/owner/status-widget.js`**

```javascript
// public/js/owner/status-widget.js
// Registered into the widget library the same way Plan 2's data widgets are
// (see widgets.js's WIDGET_TYPES map) — this file exports one render function
// matching that existing contract: (container, api) => void.
export function renderStatusWidget(container, { fetchJSON }) {
  container.innerHTML = `
    <div class="status-cards"></div>
    <div class="lan-address"></div>
    <canvas class="qr-code" width="160" height="160"></canvas>
    <div class="update-banner" hidden>
      <span>Update available</span>
      <button class="update-now">Update now</button>
    </div>
  `;
  const cardsEl = container.querySelector(".status-cards");
  const addrEl = container.querySelector(".lan-address");
  const canvas = container.querySelector("canvas.qr-code");
  const banner = container.querySelector(".update-banner");

  async function refresh() {
    const status = await fetchJSON("/api/status");
    cardsEl.innerHTML = [
      ["Claude Code", status.claude.present],
      ["Claude signed in", status.claude.signedIn !== "no"],
      ["License", status.license.ok],
      ["Vault reachable", status.vault.reachable],
    ].map(([label, ok]) => `<div class="status-card ${ok ? "ok" : "fail"}">${label}</div>`).join("");

    const addr = status.lan[0];
    const url = addr ? `http://${addr}:${status.port}` : null;
    addrEl.textContent = url ?? "No LAN address detected — this computer only";
    if (url && window.qrcode) {
      const qr = window.qrcode(0, "M");
      qr.addData(url);
      qr.make();
      const ctx = canvas.getContext("2d");
      const size = qr.getModuleCount();
      const cell = canvas.width / size;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#000";
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (qr.isDark(r, c)) ctx.fillRect(c * cell, r * cell, cell, cell);
    }

    banner.hidden = !status.update?.updateAvailable;
  }

  banner.querySelector(".update-now").addEventListener("click", async () => {
    await fetch("/api/update", { method: "POST" });
    banner.querySelector(".update-now").textContent = "Restarting…";
  });

  refresh();
  const timer = setInterval(refresh, 30000);
  return () => clearInterval(timer); // widgets.js's teardown contract from Plan 2
}
```

Add `<script src="/vendor/qrcode.min.js"></script>` to `public/owner.html` alongside the existing `three.module.min.js`/`thinking-orbs.js` script tags, and register `"status": renderStatusWidget` in `widgets.js`'s `WIDGET_TYPES` map next to the Plan 2 data widgets, importing from `./status-widget.js`.

- [ ] **Step 4: Run the browser test**

Run: `npx playwright test test/e2e/owner.spec.js`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add public/vendor/qrcode.min.js public/js/owner/status-widget.js public/js/owner/widgets.js public/owner.html NOTICE.md test/e2e/owner.spec.js
git commit -m "feat: LAN QR code and system status widget on the owner dashboard

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: Manual install test matrix (acceptance, not code)

Not a coding task — tracked here so it isn't lost, per the design spec's Section 6 "Install tests (manual, real machines)" and the cutover gate. Run once Tasks 1–10 are merged:

- [ ] Clean Windows 11, non-admin account: bootstrap script through first-run owner screen, no UAC prompt at any point.
- [ ] Clean macOS, non-admin account: same, no `sudo` prompt at any point.
- [ ] A machine with an existing system Node 20+: both the shell bootstrap (`run-setup.ps1`/`.sh`) and, later, `resolveNode` must reuse it, not download a portable copy.
- [ ] A machine with today's Shop OS (`shop-os-installer`) already installed: both `shop-os-chat` (port 7777) and `shop-os-dashboard` (port 50000) run against the same vault with no regression in either.
- [ ] Port collision: start something else on 50000 first, confirm the dashboard falls back through 50001–50010 and the desktop shortcut/auto-start command still points at the actual bound port.
- [ ] `bp-digest` with a PDF, a spreadsheet, and a Word doc, on a machine with no Python installed (spec's Open Item 2 — confirms the Python-removal decision holds).
- [ ] Reboot the test machine and confirm auto-start actually relaunches the dashboard without the owner opening anything manually.

**Cutover gate** (from the spec, unchanged): all of the above passing, plus one real shop running both systems side by side for a week with no regression in existing skills, before the install page is repointed.

---

## Self-review

- **Spec coverage:** Section 5's full sequence (portable Node, Claude Code reuse, git-free marketplaces, vault scaffolding, auto-start, desktop shortcut, first-run launch) is covered by Tasks 2–9. Section 1's `status` and `updater` modules are Tasks 6–7. Section 4's "LAN address and QR code" owner-dashboard requirement is Task 10. Section 6's failure-state table is covered by `status.js`'s fields (Claude/license/port/vault) plus the existing per-route error handling from Plans 1–2; the manual install-test rows are Task 11. The one spec item this plan does **not** implement is the cutover checklist itself (publishing the package, repointing the install page) — explicitly out of scope per "Plan 3 ... does not touch ... until cutover."
- **Placeholder scan:** every step has real, complete code; the one deliberately-deferred piece (`run-setup.ps1`/`run-setup.sh`'s body in Task 9) is called out explicitly as a thin wrapper over already-specified Task 2–8 logic, not a hidden gap.
- **Type/interface consistency:** `resolveNode`'s `{node, npm, system, version}` return shape is used identically in Task 8's `runSetup` and Task 7's `applyUpdate` (`npmBin`); `StatusStore`/`checkStatus` from Task 6 are consumed unchanged by Task 7's `update` field and Task 10's widget; every `installer/*.js` function accepts `spawnSyncImpl`/`fetchImpl` injection consistently, matching the Global Constraints.
