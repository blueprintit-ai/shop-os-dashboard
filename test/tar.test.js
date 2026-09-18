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
