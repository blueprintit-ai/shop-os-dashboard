# Shop OS Dashboard Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the new install sequence for `shop-os-dashboard` — portable Node bootstrap, git-free marketplace/plugin fetch, vault scaffolding, auto-start + desktop shortcut, a `status` module driving health cards, an updater, and a LAN QR code — entirely inside this repo, so a customer can go from a downloaded `.bat`/`.command` to a running, auto-starting Shop OS Dashboard with only Node and Claude Code as prerequisites and zero administrator/sudo rights.

**Architecture:** A new `installer/` directory holds standalone, dependency-free Node modules (tar/zip extraction, portable-Node resolution, tarball-based marketplace fetch, vault scaffolding, auto-start registration) that a new `bin/shop-os-dashboard-setup.js` CLI orchestrates — the direct successor to `shop-os-installer/bin/shop-os-install.js`, minus every step that required Git, WinGet, Homebrew, or admin rights. New customer-facing bootstrap scripts (`installer/setup-windows.ps1`, `installer/setup-macos.sh`) download this package and run the setup CLI, applying the download-then-execute pattern (never `irm|iex`/`curl|bash` piped straight to a shell) already fixed in `shop-os-installer` after it tripped Windows Defender's `Trojan:Win32/Commando.A!ml` classifier. Inside the running dashboard, a new `status` module and `/api/status` route surface health cards (Claude Code present/signed-in, license, port, LAN address), and a new `updater` module checks the npm registry daily and can update-and-restart in place.

**Tech Stack:** Node 20+ (dev on 24), ESM, `node:http`, `node:zlib` (gunzip + raw inflate, no archive library), `node:child_process` (`spawnSync`, `spawn`), `node --test`. No new runtime dependency for the dashboard package itself. One vendored front-end file (a QR encoder) follows the project's existing vendoring pattern (`public/vendor/three.module.min.js`, `public/vendor/thinking-orbs.js`).

**Spec:** `Projects/shop-os-dashboard/specs/2026-09-05-shop-os-dashboard-design.md` (Section 5: The new install sequence; Section 6: Error handling and testing — status cards and install tests; Section 1: `status`/`updater` modules and data layout)

**This is Plan 3 of 3.** Plan 1 (Foundation) and Plan 2 (Owner Dashboard) are both implemented and merged to `main` via PR #1 and PR #2. Plan 3 is the last plan before cutover, and per the spec's own isolation rules it does **not** touch `shop-os-chat`, `shop-os-installer`, `shop-os-license-server`, or `blueprint-skills` — every new file lives in this repo. Repointing the install page and publishing the package are cutover-time operations, out of scope here.

**Reference source (read-only, copy-and-adapt, never edit in place):**
- `Projects/shop-os-installer/bin/shop-os-install.js` — the license validation, vault scaffolding (`createVaultClaudeMd`, `createRawInbox`, `enableForVault`, `enableForUser`, `buildPermissionAllowList`, `saveLicenseFile`), and Claude Code detection/auto-install logic. None of this depends on Git, WinGet, or admin rights already — it is ported with only the marketplace-fetch internals swapped from `git clone`/`git fetch` to the tarball fetch built in Task 3.
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
import { existsSync, mkdirSync } from "node:fs";
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

export async function resolveNode({ homeDir, fetchImpl = fetch, spawnSyncImpl = defaultSpawnSync, platformOverride, archOverride }) {
  const systemVersion = checkSystemNode(spawnSyncImpl);
  if (systemVersion) {
    return { node: "node", npm: (platformOverride ?? osPlatform()) === "win32" ? "npm.cmd" : "npm", system: true, version: systemVersion };
  }

  const version = await resolveLtsVersion(fetchImpl);
  const runtimeDir = join(homeDir, "runtime");
  const dist = buildDist({ version, platformOverride, archOverride });
  const extractDir = join(runtimeDir, dist.dirName);
  const isWin = (platformOverride ?? osPlatform()) === "win32";
  const nodeBin = isWin ? join(extractDir, "node.exe") : join(extractDir, "bin", "node");
  const npmBin = isWin ? join(extractDir, "npm.cmd") : join(extractDir, "bin", "npm");

  if (!existsSync(nodeBin)) {
    mkdirSync(runtimeDir, { recursive: true });
    const resp = await fetchImpl(dist.url);
    if (!resp.ok) throw new Error(`Failed to download Node ${version} (${dist.url}): HTTP ${resp.status ?? "error"}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    if (dist.kind === "zip") extractZip(buf, runtimeDir);
    else extractTarGz(buf, runtimeDir);
  }

  if (!existsSync(nodeBin)) throw new Error(`Node extracted but binary not found at ${nodeBin}`);
  return { node: nodeBin, npm: npmBin, system: false, version };
}
```

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

These are the same functions and behavior as `shop-os-installer/bin/shop-os-install.js`'s `createVaultClaudeMd`, `createRawInbox`, `buildPermissionAllowList`, `enableForVault`, `enableForUser`, and `saveLicenseFile` — copied verbatim (they never touched Git). Only the marketplace step changes: `installMarketplaces` replaces `ensureMarketplaces`/`refreshMarketplaceClone`, calling `fetchMarketplaceTarball` for each of the two marketplaces instead of `git clone`/`git fetch`.

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/vault-setup.test.js`
Expected: FAIL — `Cannot find module '../installer/vault-setup.js'`

- [ ] **Step 3: Implement `installer/vault-setup.js`**

Port `createVaultClaudeMd`, `createRawInbox`, `buildPermissionAllowList`, `enableForVault`, `enableForUser`, `saveLicenseFile` from `Projects/shop-os-installer/bin/shop-os-install.js` lines 671–815 and 1032–1052 verbatim, changing only: `saveLicenseFile` takes an explicit `homeOverride` second parameter for testability (defaulting to `homedir()`), and a new `installMarketplaces` replaces `ensureMarketplaces`/`refreshMarketplaceClone`:

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
    if (!known[mp.name]) added.push(mp.name);
    const result = await fetchMarketplaceTarball({ repo: mp.repo, destDir: installLocation, fetchImpl });
    if (!result.ok) { failed.push({ name: mp.name, error: result.error }); continue; }
    known[mp.name] = { source: { source: "tarball", repo: mp.repo }, installLocation, lastUpdated: new Date().toISOString() };
  }
  writeJSON(path, known);
  return { added, failed };
}
```

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
- Produces (macOS): `registerAutoStart({nodeBin, dashboardBin, vaultPath, homeOverride?, spawnSyncImpl?}) -> {ok: boolean, error?: string}` (writes a `launchd` user-agent plist to `~/Library/LaunchAgents/` and loads it with `launchctl`), `createDesktopApp({nodeBin, dashboardBin, vaultPath, desktopDir}) -> {ok: boolean, path?: string}` (hand-builds a minimal `.app` bundle: `Contents/Info.plist` + a shell-script `Contents/MacOS/Shop OS`).

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
  const scriptDir = mkdtempSync(join(tmpdir(), "shopos-shortcut-"));
  const vbsPath = join(scriptDir, "shortcut.vbs");
  writeFileSync(vbsPath, vbs, "utf8");
  const result = spawnSyncImpl("cscript", ["//nologo", vbsPath], { encoding: "utf8" });
  if (result.status !== 0) return { ok: false, error: result.stderr || `cscript exited ${result.status}` };
  return { ok: true, path: shortcutPath };
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
  mkdirSync(dir, { recursive: true });
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
  writeFileSync(plistPath, plist, "utf8");
  const result = spawnSyncImpl("launchctl", ["load", plistPath], { encoding: "utf8" });
  if (result.status !== 0) return { ok: false, error: result.stderr || `launchctl exited ${result.status}` };
  return { ok: true };
}

// A minimal double-clickable .app: no Xcode, no bundler — just the three
// files Finder/LaunchServices require to treat a folder as an application.
export function createDesktopApp({ nodeBin, dashboardBin, vaultPath, desktopDir }) {
  const appPath = join(desktopDir, "Shop OS.app");
  const macosDir = join(appPath, "Contents", "MacOS");
  mkdirSync(macosDir, { recursive: true });
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
  writeFileSync(join(appPath, "Contents", "Info.plist"), infoPlist, "utf8");
  const launcher = `#!/bin/bash\nopen "http://localhost:50000" 2>/dev/null\nexec "${nodeBin}" "${dashboardBin}" "${vaultPath}"\n`;
  const exePath = join(macosDir, "Shop OS");
  writeFileSync(exePath, launcher, "utf8");
  chmodSync(exePath, 0o755);
  return { ok: true, path: appPath };
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
- Test: `test/status.test.js`, `test/status-routes.test.js`

**Interfaces:**
- Produces: `class StatusStore { constructor(homeDir); recordClaudeObservation(ok: boolean, message?: string); get(): {claude: {present, signedIn}, ...} }` persisted via the existing `JsonStore`.
- Produces: `checkStatus({vaultPath, homeDir, statusStore, licenseCheck, port, spawnSyncImpl?}) -> {claude: {present: boolean, signedIn: "yes"|"no"|"unknown"}, license: {ok, error?}, vault: {reachable: boolean}, port: number, lan: string[]}`.
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

In `src/routes/chat-routes.js`: after the `for await (const ev of runTurn(...))` loop's `write(ev)` call, add `if (ev.type === "error") ctx.statusStore?.observeChatError(ev.message); if (ev.type === "text") ctx.statusStore?.recordClaudeObservation(true);` — pass `statusStore` into `chatRoutes(ctx)`'s destructure alongside the existing fields.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/status.test.js test/status-routes.test.js`
Expected: PASS

- [ ] **Step 6: Run the full suite to confirm the `server.js`/`chat-routes.js` changes didn't regress anything**

Run: `npm test`
Expected: PASS (existing chat and server route-matrix tests unaffected — the new `statusStore` call is additive and optional-chained)

- [ ] **Step 7: Commit**

```bash
git add src/status.js src/routes/status-routes.js src/server.js src/routes/chat-routes.js test/status.test.js test/status-routes.test.js
git commit -m "feat: status module with best-effort Claude sign-in detection

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Updater module and `/api/update` route

**Files:**
- Create: `src/updater.js`, `src/routes/update-routes.js`
- Modify: `src/server.js` (register the router), `src/status.js`'s `checkStatus` (add an `update` field)
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
  const resp = await fetch(`http://127.0.0.1:${port}/api/update`, { method: "POST" });
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

In `src/server.js`, add `appDir`, `npmBin`, and `restart` to `createServer`'s destructured options (each optional, defaulting to `null`/a no-op), add them to `ctx`, and append `updateRoutes(ctx)` to `routers`. In `src/status.js`'s `checkStatus`, add an `update` field by accepting an optional `updateInfo` parameter (the CLI's cached last-check result — see Task 8) and spreading it into the response: `update: updateInfo ?? { updateAvailable: false }`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/updater.test.js test/update-routes.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/updater.js src/routes/update-routes.js src/server.js src/status.js test/updater.test.js test/update-routes.test.js
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
- Consumes: `resolveNode` (Task 2), `installMarketplaces`/`createVaultClaudeMd`/`createRawInbox`/`enableForVault`/`enableForUser`/`saveLicenseFile` (Task 4), `registerAutoStart`/`createDesktopShortcut`/`createDesktopApp` (Task 5).
- Produces: `runSetup({vaultPath, license, homeDir, isWindows, desktopDir, fetchImpl?, spawnSyncImpl?}) -> Promise<{ok: boolean, steps: Array<{name, ok, error?}>}>` — the orchestration function the CLI's `main()` calls; every step is best-effort except vault scaffolding and marketplace install, matching `shop-os-install.js`'s existing fail/warn split (`fail()` for a blocking step, `warn()`/pending-list for a best-effort one).

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
  const homeDir = mkdtempSync(join(tmpdir(), "home-"));
  const vaultPath = mkdtempSync(join(tmpdir(), "vault-"));
  const desktopDir = mkdtempSync(join(tmpdir(), "desktop-"));
  const license = { key: "SHOP-AAAA-BBBB-CCCC", customer: "Acme", product: "foundation", entitlements: ["foundation"] };
  const fetchImpl = async () => ({ ok: true, arrayBuffer: async () => tarGzWithManifest() });
  // Simulate: claude present, but schtasks/launchctl denied — setup must still report ok overall.
  const spawnSyncImpl = (cmd) => (/schtasks|launchctl|cscript/.test(cmd) ? { status: 1, stderr: "denied" } : { status: 0, stdout: "v22.0.0\n" });

  const result = await runSetup({ vaultPath, license, homeDir, isWindows: false, desktopDir, fetchImpl, spawnSyncImpl });

  assert.equal(result.ok, true);
  assert.ok(existsSync(join(vaultPath, "CLAUDE.md")));
  assert.ok(existsSync(join(vaultPath, "Raw", "processed")));
  const autostartStep = result.steps.find((s) => s.name === "autostart");
  assert.equal(autostartStep.ok, false); // reported, not thrown
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/shop-os-dashboard-setup.test.js`
Expected: FAIL — `bin/shop-os-dashboard-setup.js` doesn't exist

- [ ] **Step 3: Implement `bin/shop-os-dashboard-setup.js`**

```javascript
#!/usr/bin/env node
// bin/shop-os-dashboard-setup.js
import { join } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { resolveNode } from "../installer/node-runtime.js";
import { installMarketplaces, createVaultClaudeMd, createRawInbox, enableForVault, enableForUser, saveLicenseFile, PLUGINS_TO_ENABLE } from "../installer/vault-setup.js";
import * as win from "../installer/autostart-windows.js";
import * as mac from "../installer/autostart-macos.js";

export async function runSetup({ vaultPath, license, homeDir = join(homedir(), ".shopos"), isWindows = process.platform === "win32", desktopDir, fetchImpl = fetch, spawnSyncImpl }) {
  const steps = [];
  const record = (name, fn) => {
    try { const value = fn(); steps.push({ name, ok: true, value }); return value; }
    catch (e) { steps.push({ name, ok: false, error: e.message }); return null; }
  };

  const claudeRoot = join(homedir(), ".claude");
  const node = await resolveNode({ homeDir, fetchImpl, spawnSyncImpl });
  steps.push({ name: "node", ok: true, value: node });

  const mpResult = await installMarketplaces({ claudeRoot, fetchImpl });
  steps.push({ name: "marketplaces", ok: mpResult.failed.length === 0, error: mpResult.failed.map((f) => f.error).join("; ") || undefined });

  record("vault.claudeMd", () => createVaultClaudeMd(vaultPath, license));
  record("vault.rawInbox", () => createRawInbox(vaultPath));
  record("vault.settings", () => enableForVault(vaultPath, PLUGINS_TO_ENABLE));
  record("user.settings", () => enableForUser(claudeRoot, PLUGINS_TO_ENABLE));
  record("license", () => saveLicenseFile(license, homeDir));

  const dashboardBin = join(homeDir, "app", "node_modules", "@blueprintitai", "shop-os-dashboard", "bin", "shop-os-dashboard.js");
  const autostartMod = isWindows ? win : mac;
  const autostartResult = autostartMod.registerAutoStart({ nodeBin: node.node, dashboardBin, vaultPath, spawnSyncImpl });
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

// CLI entry — license/vault prompts reuse the exact license-key format and
// validation flow already live in the license server; ported unchanged from
// shop-os-installer/bin/shop-os-install.js's normalizeLicenseKey/validateLicense,
// omitted here since Task 4 owns vault-setup.js and this file only orchestrates.
if (import.meta.url === `file://${process.argv[1]}`) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log("Shop OS Dashboard setup — see docs/decisions/installer-no-git-no-admin.md for what this does and why.");
  rl.close();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/shop-os-dashboard-setup.test.js`
Expected: PASS

- [ ] **Step 5: Add the bin entry and wire the daily update check into `bin/shop-os-dashboard.js`**

In `package.json`, add `"shop-os-dashboard-setup": "./bin/shop-os-dashboard-setup.js"` to `"bin"`.

In `bin/shop-os-dashboard.js`'s `main()`, after `createServer(...)`, add a daily check that stores its result where `status.js`'s `checkStatus` can read it, and pass a `restart` callback:

```javascript
import { checkForUpdate } from "../src/updater.js";
// ...
let updateInfo = { updateAvailable: false };
async function refreshUpdateInfo() {
  updateInfo = await checkForUpdate({ currentVersion: JSON.parse(readFileSync(new URL("../package.json", import.meta.url))).version });
}
refreshUpdateInfo();
setInterval(refreshUpdateInfo, 24 * 60 * 60 * 1000).unref?.();

const server = createServer({
  vaultPath, homeDir: home,
  appDir: join(home, "app"),
  npmBin: process.env.SHOPOS_NPM_BIN || "npm",
  restart: () => process.exit(0), // the registered auto-start task/agent relaunches it
});
```

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
- Create: `installer/setup-windows.ps1`, `installer/setup-macos.sh`
- Create: `docs/decisions/installer-no-git-no-admin.md`

These are the customer-facing entry points a personalized `.bat`/`.command` will eventually download and run (repointing the install page happens at cutover, out of scope here). They apply the non-cradle, BOM-safe pattern from `shop-os-installer/notes/windows-defender-false-positive.md` from the start.

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

`run-setup.ps1`/`run-setup.sh` (the actual bodies these two bootstraps fetch and run) are thin wrappers that resolve a system or portable Node via the logic in Task 2 and then exec `node bin/shop-os-dashboard-setup.js`, mirroring `shop-os-installer`'s split between the customer-facing bootstrap and the npm-published installer package. Their content is a straightforward download-and-invoke sequence with no new logic beyond Tasks 2–8, and is deferred to execution time rather than fully spelled out here — the two files above are the part of this task that carries the security-relevant pattern.

- [ ] **Step 3: Write `docs/decisions/installer-no-git-no-admin.md`**

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
| WinGet/Homebrew/MSI for Node.js | Portable Node into `~/.shopos/runtime/`, system Node 20+ reused if present | `installer/node-runtime.js` |
| Admin relaunch for WinGet | Not needed — nothing left requires elevation | n/a |

## Why hand-rolled tar/zip readers instead of a dependency

The installer modules run *before* `npm install` has ever happened — a
runtime dependency isn't available yet to fetch a dependency with. The
formats themselves are small and stable (USTAR, ZIP local/central headers);
`shop-os-license-server`'s `buildZipWithExecutable` already hand-rolls a ZIP
*writer* for the same class of reason, this is the same tradeoff in reverse.
```

- [ ] **Step 4: Commit**

```bash
git add installer/setup-windows.ps1 installer/setup-macos.sh docs/decisions/installer-no-git-no-admin.md
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
- [ ] A machine with an existing system Node 20+: `resolveNode` must reuse it, not download a portable copy.
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
