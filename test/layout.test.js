import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
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

test("LayoutStore.save() repairs a malformed patch instead of persisting it verbatim", () => {
  // Post-review fix (finding 8): PUT /api/layout does no body validation of
  // its own (src/routes/layout-routes.js hands the parsed body straight to
  // LayoutStore.save()), and the saved value round-trips back out through
  // GET /api/layout into boot.js's mountGrid() -> widgets.js's
  // `for (const w of layout.widgets)`. A stored `{}` (or a `widgets` that
  // isn't an array) used to throw a TypeError there and abort the whole
  // boot.js module on every later page load, with no UI path to reset.
  const home = mkdtempSync(join(tmpdir(), "sod-layout-malformed-"));
  const store = new LayoutStore(home);

  const savedEmpty = store.save("user-empty", {});
  assert.ok(Array.isArray(savedEmpty.widgets), "widgets is an array");
  assert.ok(savedEmpty.widgets.length > 0, "widgets falls back to the default set, not empty");
  assert.ok(Array.isArray(savedEmpty.removed), "removed is an array");
  assert.equal(savedEmpty.theme, "dark");

  const loadedEmpty = store.get("user-empty");
  assert.deepEqual(loadedEmpty.widgets, defaultLayout().widgets, "the malformed input was not persisted verbatim");

  const savedBadWidgets = store.save("user-bad-widgets", { theme: "light", widgets: "not an array", removed: 42 });
  assert.ok(Array.isArray(savedBadWidgets.widgets), "non-array widgets is repaired to an array");
  assert.ok(Array.isArray(savedBadWidgets.removed), "non-array removed is repaired to an array");
  assert.equal(savedBadWidgets.theme, "light", "well-formed fields in the same patch are still respected");

  const loadedBadWidgets = store.get("user-bad-widgets");
  assert.ok(Array.isArray(loadedBadWidgets.widgets));
  assert.equal(loadedBadWidgets.widgets.length, defaultLayout().widgets.length);

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
  const setup = await http("POST", "/api/setup", { body: { displayName: "Pat", username: "pat", password: "longenough1" }, as: "owner" });
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

test("LayoutStore.save() accepts a valid orb block and normalizes anything else", () => {
  const home = mkdtempSync(join(tmpdir(), "sod-layout-orb-"));
  const store = new LayoutStore(home);

  const ok = store.save("u", { ...defaultLayout(), orb: { c: 12.5, r: 7, s: 1.2, z: 2 } });
  assert.deepEqual(ok.orb, { c: 12.5, r: 7, s: 1.2, z: 2 });
  assert.deepEqual(store.get("u").orb, { c: 12.5, r: 7, s: 1.2, z: 2 });

  // missing block -> defaults; body without orb must not wipe a sane default in
  assert.deepEqual(store.save("u2", { theme: "light" }).orb, defaultLayout().orb);

  // junk values -> per-field defaults, out-of-range -> clamped, extra keys dropped
  const junk = store.save("u3", { ...defaultLayout(), orb: { c: "x", r: 9999, s: 50, z: null, evil: 1 } });
  assert.deepEqual(junk.orb, { c: 16, r: 60, s: 1.7, z: 2.15 });
  assert.deepEqual(store.save("u4", { orb: "nope" }).orb, defaultLayout().orb);
  assert.deepEqual(store.save("u5", { orb: [1, 2] }).orb, defaultLayout().orb);

  rmSync(home, { recursive: true, force: true });
});

test("LayoutStore.get() repairs an orb block that an older/hand-edited file stored badly", () => {
  const home = mkdtempSync(join(tmpdir(), "sod-layout-orb-get-"));
  mkdirSync(join(home, "layouts"), { recursive: true });
  writeFileSync(join(home, "layouts", "u.json"), JSON.stringify({ ...defaultLayout(), orb: { c: 1, r: "q", s: 0, z: 2.6 } }));
  const got = new LayoutStore(home).get("u");
  assert.deepEqual(got.orb, { c: 1, r: 9, s: 0.5, z: 2.6 });
  // the old default saved by every earlier install is "unset": new defaults on get
  writeFileSync(join(home, "layouts", "legacy.json"), JSON.stringify({ ...defaultLayout(), orb: { c: 16, r: 9, s: 1.7, z: 2.6 } }));
  assert.deepEqual(new LayoutStore(home).get("legacy").orb, defaultLayout().orb);
  assert.deepEqual(defaultLayout().orb, { c: 16, r: 9, s: 1.12, z: 2.15 });
  // a layout the user really changed keeps its values
  writeFileSync(join(home, "layouts", "mine.json"), JSON.stringify({ ...defaultLayout(), orb: { c: 16, r: 9, s: 1.7, z: 2.2 } }));
  assert.deepEqual(new LayoutStore(home).get("mine").orb, { c: 16, r: 9, s: 1.7, z: 2.2 });
  writeFileSync(join(home, "layouts", "old.json"), JSON.stringify({ theme: "dark", widgets: [], removed: [] })); // pre-orb file
  assert.deepEqual(new LayoutStore(home).get("old").orb, defaultLayout().orb);
  rmSync(home, { recursive: true, force: true });
});
