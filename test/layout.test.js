import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LayoutStore, defaultLayout } from "../src/layout.js";
import { createServer } from "../src/server.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "vault");

test("LayoutStore returns default layout for a new user, then persists changes", () => {
  const home = mkdtempSync(join(tmpdir(), "sod-layout-"));
  const store = new LayoutStore(home);
  const first = store.get("user-1");
  assert.deepEqual(first, defaultLayout());
  assert.equal(first.theme, "dark");

  store.save("user-1", { ...first, theme: "light", tourSeen: true });
  const again = store.get("user-1");
  assert.equal(again.theme, "light");
  assert.equal(again.tourSeen, true);

  const other = store.get("user-2");
  assert.equal(other.theme, "dark"); // untouched, isolated per user
  rmSync(home, { recursive: true, force: true });
});

test("GET/PUT /api/layout round-trips per user, requires auth", async () => {
  const root = mkdtempSync(join(tmpdir(), "sod-layout-e2e-"));
  const vault = join(root, "vault"); cpSync(FIX, vault, { recursive: true });
  const home = join(root, "home");
  async function* fakeRunTurn() { yield { type: "done", text: "", stats: {} }; }
  const server = createServer({ vaultPath: vault, homeDir: home, runTurn: fakeRunTurn, licenseCheck: () => ({ ok: true }) });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const jar = {};
  const http = async (method, path, { body, as, headers = {} } = {}) => {
    const h = { ...headers };
    if (body !== undefined) { h["content-type"] = "application/json"; h["origin"] = base; }
    if (as && jar[as]) h["cookie"] = jar[as];
    const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
    const sc = res.headers.get("set-cookie");
    if (as && sc) jar[as] = sc.split(";")[0];
    return res;
  };

  // Setup owner
  const setup = await http("POST", "/api/setup", { body: { displayName: "Glenn", username: "glenn", password: "longenough1" }, as: "owner" });
  assert.equal(setup.status, 200);

  try {
    // Test unauthenticated access
    const anon = await fetch(`${base}/api/layout`);
    assert.equal(anon.status, 401);

    // Test authenticated GET
    const got = await http("GET", "/api/layout", { as: "owner" });
    assert.equal(got.status, 200);
    const layout = await got.json();
    assert.equal(layout.theme, "dark");

    // Test authenticated PUT
    const put = await http("PUT", "/api/layout", {
      as: "owner",
      body: { ...layout, theme: "light" },
    });
    assert.equal(put.status, 200);

    // Verify persistence
    const got2 = await http("GET", "/api/layout", { as: "owner" });
    assert.equal((await got2.json()).theme, "light");
  } finally {
    server.close(); server.ctx.index.close(); rmSync(root, { recursive: true, force: true });
  }
});

test("cross-origin PUT /api/layout is refused (CSRF protection)", async () => {
  const root = mkdtempSync(join(tmpdir(), "sod-layout-csrf-"));
  const vault = join(root, "vault"); cpSync(FIX, vault, { recursive: true });
  const home = join(root, "home");
  async function* fakeRunTurn() { yield { type: "done", text: "", stats: {} }; }
  const server = createServer({ vaultPath: vault, homeDir: home, runTurn: fakeRunTurn, licenseCheck: () => ({ ok: true }) });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // Cross-origin PUT with mismatched origin header
    const r = await fetch(base + "/api/layout", {
      method: "PUT",
      headers: { "content-type": "application/json", origin: "http://evil.example" },
      body: JSON.stringify({ theme: "light" }),
    });
    assert.equal(r.status, 403, "cross-origin PUT is refused");

    // PUT with no origin header at all is also refused
    const r2 = await fetch(base + "/api/layout", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ theme: "light" }),
    });
    assert.equal(r2.status, 403, "PUT with no Origin header is also refused");
  } finally {
    server.close(); server.ctx.index.close(); rmSync(root, { recursive: true, force: true });
  }
});
