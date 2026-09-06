import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanAssets, setFavorite, saveUpload, assetPath, assetId, MAX_UPLOAD } from "../src/assets.js";
import { createServer } from "../src/server.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "vault");

function seedRoot() {
  const root = mkdtempSync(join(tmpdir(), "sod-assets-"));
  mkdirSync(join(root, "Contracts"));
  writeFileSync(join(root, "Contracts", "lease.pdf"), "%PDF-fake");
  return root;
}

test("scanAssets lists categories and files; favorite toggling round-trips", () => {
  const root = seedRoot();
  const scan = scanAssets(root);
  assert.equal(scan.categories.length, 1);
  assert.equal(scan.files[0].category, "Contracts");
  assert.equal(scan.files[0].favorite, false);

  const id = scan.files[0].id;
  const fav = setFavorite(root, id, true);
  assert.equal(fav.ok, true);
  assert.equal(scanAssets(root).files[0].favorite, true);
  rmSync(root, { recursive: true, force: true });
});

test("assetPath rejects an id that resolves outside the root", () => {
  const root = seedRoot();
  const escapee = assetId("../../etc/passwd");
  assert.equal(assetPath(root, escapee), null);
  rmSync(root, { recursive: true, force: true });
});

test("setFavorite enforces the maxFavorites cap", () => {
  const root = mkdtempSync(join(tmpdir(), "sod-assets-cap-"));
  for (const n of ["a.pdf", "b.pdf", "c.pdf", "d.pdf", "e.pdf"]) writeFileSync(join(root, n), "x");
  const scan = scanAssets(root);
  assert.equal(scan.files.length, 5);

  // First 4 favorites succeed and fill the cap.
  for (const f of scan.files.slice(0, 4)) {
    assert.equal(setFavorite(root, f.id, true).ok, true);
  }
  assert.equal(scanAssets(root).favorites.length, 4);

  // A 5th distinct favorite is rejected with a 409 and the cap error, leaving the set at 4.
  const fifth = setFavorite(root, scan.files[4].id, true);
  assert.equal(fifth.code, 409);
  assert.ok(fifth.error);
  assert.equal(scanAssets(root).favorites.length, 4);

  rmSync(root, { recursive: true, force: true });
});

test("saveUpload never overwrites; it appends a (2), (3)... suffix on collision", () => {
  const root = seedRoot();
  const first = saveUpload(root, "Contracts", "lease.pdf", Buffer.from("v1"));
  assert.equal(first.name, "lease (2).pdf"); // "lease.pdf" already exists from seedRoot()
  const second = saveUpload(root, "Contracts", "lease.pdf", Buffer.from("v2"));
  assert.equal(second.name, "lease (3).pdf");
  const unknownCategory = saveUpload(root, "NoSuchCategory", "x.pdf", Buffer.from("x"));
  assert.equal(unknownCategory.code, 400);
  rmSync(root, { recursive: true, force: true });
});

test("saveUpload rejects a buffer over the 50MB cap", () => {
  const root = seedRoot();
  const oversized = Buffer.alloc(MAX_UPLOAD + 1); // zero-filled; no need for real content
  const result = saveUpload(root, "", "big.bin", oversized);
  assert.equal(result.code, 413);
  assert.ok(result.error);
  rmSync(root, { recursive: true, force: true });
});

// --- route-level integration tests -----------------------------------------

async function bootServer() {
  const root = mkdtempSync(join(tmpdir(), "sod-assets-srv-"));
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
  const setup = await http("POST", "/api/setup", { body: { displayName: "Glenn", username: "glenn", password: "longenough1" }, as: "owner" });
  assert.equal(setup.status, 200);
  // staff fixture user is created with switches.assetsView left at its default (false)
  const created = await http("POST", "/api/users", { as: "owner", body: { username: "marco", displayName: "Marco", password: "longenough1", role: "staff" } });
  assert.equal(created.status, 201);
  const loggedIn = await http("POST", "/api/login", { as: "staff", body: { username: "marco", password: "longenough1", remember: false } });
  assert.equal(loggedIn.status, 200);
  return { server, base, http, home, cleanup: () => { server.close(); server.ctx.index.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("GET /api/assets respects the assetsView switch for staff; owner is always allowed", async () => {
  const t = await bootServer();
  try {
    const anon = await fetch(`${t.base}/api/assets`);
    assert.equal(anon.status, 401);

    const asStaff = await t.http("GET", "/api/assets", { as: "staff" });
    assert.equal(asStaff.status, 403);

    const asOwner = await t.http("GET", "/api/assets", { as: "owner" });
    assert.equal(asOwner.status, 200);
    const body = await asOwner.json();
    assert.equal(body.dir, join(t.home, "business-assets"));
    assert.equal(body.maxFavorites, 4);
  } finally { t.cleanup(); }
});

test("POST /api/assets/favorite and GET /assets/file/<id> are also gated by the switch", async () => {
  const t = await bootServer();
  try {
    // Seed a file directly under the default assets root so we have something to favorite/fetch.
    const assetsDir = join(t.home, "business-assets");
    mkdirSync(assetsDir, { recursive: true });
    writeFileSync(join(assetsDir, "note.txt"), "hello");

    const scan = await (await t.http("GET", "/api/assets", { as: "owner" })).json();
    const id = scan.files.find((f) => f.name === "note.txt").id;

    const favAsStaff = await t.http("POST", "/api/assets/favorite", { as: "staff", body: { id, on: true } });
    assert.equal(favAsStaff.status, 403);

    const favAsOwner = await t.http("POST", "/api/assets/favorite", { as: "owner", body: { id, on: true } });
    assert.equal(favAsOwner.status, 200);
    assert.equal((await favAsOwner.json()).favorite, true);

    const fileAsStaff = await t.http("GET", `/assets/file/${id}`, { as: "staff" });
    assert.equal(fileAsStaff.status, 403);

    const fileAsOwner = await t.http("GET", `/assets/file/${id}`, { as: "owner" });
    assert.equal(fileAsOwner.status, 200);
    assert.equal(await fileAsOwner.text(), "hello");
  } finally { t.cleanup(); }
});
