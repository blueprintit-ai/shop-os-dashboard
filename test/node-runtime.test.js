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
