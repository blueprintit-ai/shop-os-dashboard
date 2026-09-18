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
