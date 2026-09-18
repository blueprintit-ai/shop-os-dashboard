import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../src/server.js";
import { readStats, readRoutines } from "../src/snapshots.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "vault");

test("readStats/readRoutines return needsSetup when the feed file is absent", () => {
  const vault = mkdtempSync(join(tmpdir(), "sod-snap-"));
  assert.deepEqual(readStats(vault), { needsSetup: true });
  assert.deepEqual(readRoutines(vault), { needsSetup: true, sources: [], routines: [], counts: {} });
  rmSync(vault, { recursive: true, force: true });
});

test("readStats/readRoutines parse real feed files", () => {
  const vault = mkdtempSync(join(tmpdir(), "sod-snap-"));
  const dir = join(vault, "Dashboard", "snapshots");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "stats.json"), JSON.stringify({
    title: "BUSINESS HEALTH", asOf: "2026-09-05",
    metrics: [{ big: "48%", cap: "GROSS PROFIT<br>margin" }],
  }));
  writeFileSync(join(dir, "routines.json"), JSON.stringify({
    generated: "2026-09-05T07:00:00Z",
    sources: [{ key: "shop", label: "SHOP AGENT" }],
    counts: { shop: 1 },
    routines: [{ t: "07:00", d: "daily", src: "shop", n: "morning digest", desc: "summarize the day" }],
  }));
  assert.equal(readStats(vault).metrics[0].big, "48%");
  assert.equal(readRoutines(vault).routines[0].n, "morning digest");
  rmSync(vault, { recursive: true, force: true });
});

test("readStats/readRoutines report a parse error without crashing", () => {
  const vault = mkdtempSync(join(tmpdir(), "sod-snap-"));
  const dir = join(vault, "Dashboard", "snapshots");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "stats.json"), "{not json");
  assert.match(readStats(vault).error, /stats\.json/);
  rmSync(vault, { recursive: true, force: true });
});

test("GET /api/snapshots/stats and /routines require a session", async () => {
  const root = mkdtempSync(join(tmpdir(), "sod-snap-routes-"));
  const vault = join(root, "vault"); cpSync(FIX, vault, { recursive: true });
  const home = join(root, "home");
  async function* fakeRunTurn() { yield { type: "done", text: "", stats: {} }; }
  const server = createServer({ vaultPath: vault, homeDir: home, runTurn: fakeRunTurn, licenseCheck: () => ({ ok: true }) });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const jar = {};
  const http = async (method, path, { headers = {} } = {}) => {
    const h = { ...headers };
    if (jar.owner) h["cookie"] = jar.owner;
    const res = await fetch(base + path, { method, headers: h, redirect: "manual" });
    const sc = res.headers.get("set-cookie");
    if (sc) jar.owner = sc.split(";")[0];
    return res;
  };

  try {
    // Setup owner
    const setup = await fetch(`${base}/api/setup`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ displayName: "Glenn", username: "glenn", password: "longenough1" }),
    });
    const sc = setup.headers.get("set-cookie");
    if (sc) jar.owner = sc.split(";")[0];

    assert.equal((await fetch(`${base}/api/snapshots/stats`)).status, 401);
    assert.equal((await fetch(`${base}/api/snapshots/stats`, { headers: { cookie: jar.owner } })).status, 200);
    assert.equal((await fetch(`${base}/api/snapshots/routines`, { headers: { cookie: jar.owner } })).status, 200);
  } finally {
    server.close(); server.ctx.index.close(); rmSync(root, { recursive: true, force: true });
  }
});
