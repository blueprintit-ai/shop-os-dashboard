import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { mkdtempSync, readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractTarGz } from "../installer/tar.js";

function ustarHeader({ name, size, typeflag = "0", mode = 0o644 }) {
  const buf = Buffer.alloc(512);
  buf.write(name, 0, "utf8");
  buf.write(mode.toString(8).padStart(7, "0") + "\0", 100, "utf8"); // mode
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
    parts.push(ustarHeader({ name: e.name, size: data.length, typeflag: e.dir ? "5" : "0", mode: e.mode }));
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

test("refuses to extract an entry that escapes destDir via ..", () => {
  const tar = buildTar([
    { name: "foo/../../escaped.txt", content: "pwned" },
    { name: "safe.txt", content: "fine" },
  ]);
  const dest = mkdtempSync(join(tmpdir(), "tar-slip-"));
  const { files } = extractTarGz(gzipSync(tar), dest); // must not throw
  assert.deepEqual(files, ["safe.txt"]); // the malicious entry is not reported
  assert.equal(readFileSync(join(dest, "safe.txt"), "utf8"), "fine");
  assert.equal(existsSync(join(dest, "..", "escaped.txt")), false);
  assert.equal(existsSync(join(dest, "..", "..", "escaped.txt")), false);
});

test("applies the entry's mode so an extracted node binary is actually executable", () => {
  const tar = buildTar([{ name: "bin/node", content: "#!/bin/sh\n", mode: 0o755 }]);
  const dest = mkdtempSync(join(tmpdir(), "tar-mode-"));
  extractTarGz(gzipSync(tar), dest);
  const outPath = join(dest, "bin", "node");
  assert.ok(existsSync(outPath));
  // Windows has no POSIX mode bits (chmod only toggles the read-only flag), so
  // the exact-mode assertion is meaningful on the platforms this matters for.
  if (process.platform !== "win32") {
    assert.equal(statSync(outPath).mode & 0o777, 0o755);
  }
});
