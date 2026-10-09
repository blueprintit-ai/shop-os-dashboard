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
  const setup = await http("POST", "/api/setup", { body: { displayName: "Pat", username: "pat", password: "longenough1" }, as: "owner" });
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

// ---- upload path traversal (name and category come from the query string) ----
import { existsSync, readdirSync, symlinkSync } from "node:fs";
import { bootAsOwner } from "./helpers/boot.js";

function listAll(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); out.push(p); if (e.isDirectory()) listAll(p, out); }
  return out;
}

test("saveUpload refuses names and categories that could leave the assets root", () => {
  const parent = mkdtempSync(join(tmpdir(), "sod-up-"));
  const root = join(parent, "assets"); mkdirSync(join(root, "Contracts"), { recursive: true });
  mkdirSync(join(parent, "assets-evil"));
  try {
    const before = listAll(parent).sort();
    const bad = [
      ["", "../escape.txt"], ["", "..\\escape.txt"], ["", "/etc/escape.txt"], ["", "C:\\x\\escape.txt"], ["", "a/b.txt"], ["", ".."],
      ["", "."], ["", ".hidden"], ["", ".assets.json"], ["", ""], ["", "nul\0.txt"],
      ["Contracts/..", "x.txt"], ["Cat/../..", "x.txt"], ["..", "x.txt"], ["../assets-evil", "x.txt"], ["/tmp", "x.txt"],
      ["Contracts/", "x.txt"], [".git", "x.txt"], ["C:", "x.txt"], ["Contracts\\..", "x.txt"],
    ];
    for (const [cat, name] of bad) {
      const r = saveUpload(root, cat, name, Buffer.from("x"));
      assert.ok(r.error && (r.code === 400), `${JSON.stringify([cat, name])} must be refused, got ${JSON.stringify(r)}`);
    }
    assert.deepEqual(listAll(parent).sort(), before, "nothing was written anywhere");
    const ok = saveUpload(root, "Contracts", "lease (final).pdf", Buffer.from("x"));
    assert.equal(ok.name, "lease (final).pdf");
    assert.ok(existsSync(join(root, "Contracts", "lease (final).pdf")));
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("saveUpload refuses a category that is a symlink pointing outside the root", { skip: process.platform === "win32" }, () => {
  const parent = mkdtempSync(join(tmpdir(), "sod-up-"));
  const root = join(parent, "assets"); mkdirSync(root);
  mkdirSync(join(parent, "outside"));
  symlinkSync(join(parent, "outside"), join(root, "Link"));
  try {
    const r = saveUpload(root, "Link", "x.txt", Buffer.from("x"));
    assert.equal(r.code, 400);
    assert.deepEqual(readdirSync(join(parent, "outside")), []);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("the default 'Uncategorized' category uploads to the root; a real folder of that name wins", () => {
  const root = mkdtempSync(join(tmpdir(), "sod-up-"));
  try {
    assert.equal(saveUpload(root, "Uncategorized", "a.txt", Buffer.from("x")).category, "Uncategorized");
    assert.ok(existsSync(join(root, "a.txt")));
    mkdirSync(join(root, "Uncategorized"));
    saveUpload(root, "Uncategorized", "b.txt", Buffer.from("x"));
    assert.ok(existsSync(join(root, "Uncategorized", "b.txt")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("POST /api/assets/upload: encoded traversal in the query string is refused with 400 and writes nothing", async () => {
  const b = await bootAsOwner();
  try {
    const root = join(b.home, "business-assets"); mkdirSync(join(root, "Contracts"), { recursive: true });
    const sentinel = join(b.home, "pwned.txt");
    const attempts = [
      "category=&name=..%2F..%2Fpwned.txt", "category=&name=%2e%2e%2fpwned.txt", "category=&name=%2Fetc%2Fpwned.txt",
      "category=Cat%2F..%2F..&name=pwned.txt", "category=..&name=pwned.txt", "category=&name=.assets.json", "category=%2Ftmp&name=x.txt",
    ];
    for (const q of attempts) {
      const res = await fetch(`${b.url}/api/assets/upload?${q}`, { method: "POST", headers: { cookie: b.jar.owner, origin: b.url }, body: "x" });
      assert.equal(res.status, 400, q);
      await res.arrayBuffer();
    }
    assert.ok(!existsSync(sentinel));
    assert.ok(!existsSync(join(root, "..", "pwned.txt")));
    assert.deepEqual(readdirSync(root).sort(), ["Contracts"]);
  } finally { b.cleanup(); }
});

test("assetPath rejects encoded traversal ids and sibling directories that merely share the root's prefix", () => {
  const parent = mkdtempSync(join(tmpdir(), "sod-ap-"));
  const root = join(parent, "assets"); mkdirSync(root); mkdirSync(join(parent, "assets-evil"));
  try {
    for (const rel of ["../assets-evil/x", "a/../../assets-evil/x", "/etc/passwd", "..", "."]) assert.equal(assetPath(root, assetId(rel)), null, rel);
    const odd = assetPath(root, "%2e%2e%2f"); // not valid base64url: garbage, but never outside the root
    assert.ok(odd === null || odd.abs.startsWith(root + "/") || odd.abs.startsWith(root + "\\"));
    assert.ok(assetPath(root, assetId("Contracts/lease.pdf")));
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

// ---- same-origin active content from the assets viewer ----
test("/assets/file: active types download, only an allowlist displays inline, every response is nosniff + CSP sandbox (pdf excepted)", async () => {
  const b = await bootAsOwner();
  try {
    const root = join(b.home, "business-assets"); mkdirSync(join(root, "Docs"), { recursive: true });
    const files = ["a.html", "a.htm", "a.svg", "a.xml", "a.xhtml", "a.json", "a.js", "a.exe", "a.png", "a.jpg", "a.jpeg", "a.gif", "a.webp", "a.txt", "a.md", "a.csv", "a.pdf", "noext"];
    for (const f of files) writeFileSync(join(root, "Docs", f), "<script>alert(1)</script>");
    const ids = Object.fromEntries(scanAssets(root).files.map((f) => [f.name, f.id]));
    const inline = new Set(["a.png", "a.jpg", "a.jpeg", "a.gif", "a.webp", "a.txt", "a.md", "a.csv", "a.pdf"]);
    for (const f of files) {
      const res = await fetch(`${b.url}/assets/file/${ids[f]}`, { headers: { cookie: b.jar.owner } });
      assert.equal(res.status, 200, f);
      await res.arrayBuffer();
      const disp = res.headers.get("content-disposition");
      assert.match(disp, inline.has(f) ? /^inline;/ : /^attachment;/, `${f}: ${disp}`);
      assert.equal(res.headers.get("x-content-type-options"), "nosniff", f);
      if (f === "a.pdf") assert.equal(res.headers.get("content-security-policy"), null, "Chrome's PDF viewer refuses sandboxed documents");
      else assert.equal(res.headers.get("content-security-policy"), "sandbox", f);
    }
    // ?download always attaches
    const dl = await fetch(`${b.url}/assets/file/${ids["a.png"]}?download`, { headers: { cookie: b.jar.owner } });
    assert.match(dl.headers.get("content-disposition"), /^attachment;/);
    await dl.arrayBuffer();
  } finally { b.cleanup(); }
});

// ---- review round 2: reserved names, bidi, error text, chunked bodies, what /assets/file may serve ----
import { chmodSync, mkdtempSync as mkd } from "node:fs";
import { request as httpRequest } from "node:http";

test("saveUpload refuses Windows reserved names, trailing dots/spaces and bidi/format control characters", () => {
  const root = mkd(join(tmpdir(), "sod-up2-"));
  mkdirSync(join(root, "Docs"));
  try {
    const names = ["CON", "con.txt", "PRN.pdf", "Aux.tar.gz", "NUL", "nul.", "COM1", "com9.txt", "LPT1.doc", "lpt9",
      "report.", "report ", "report. .", "invoice\u202Egpj.exe", "a\u2066b.txt", "a\u2069b", "a\u200Eb.txt", "a\u200Fb.txt", "a\u202Ab", "tab\tname.txt"];
    for (const n of names) assert.equal(saveUpload(root, "", n, Buffer.from("x")).code, 400, JSON.stringify(n));
    for (const c of ["CON", "aux", "Docs.", "Docs ", "Do\u202Ecs"]) assert.equal(saveUpload(root, c, "ok.txt", Buffer.from("x")).code, 400, `category ${JSON.stringify(c)}`);
    assert.deepEqual(readdirSync(root), ["Docs"]);
    assert.deepEqual(readdirSync(join(root, "Docs")), []);
    for (const ok of ["console.txt", "com10.txt", "lpt.txt", "nullable.pdf", "Q3 report.pdf"]) assert.ok(saveUpload(root, "Docs", ok, Buffer.from("x")).id, ok);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a failed write answers without the server's absolute path", { skip: process.platform === "win32" || process.getuid?.() === 0 }, () => {
  const root = mkd(join(tmpdir(), "sod-up3-"));
  mkdirSync(join(root, "Locked"));
  chmodSync(join(root, "Locked"), 0o500);
  try {
    const r = saveUpload(root, "Locked", "x.txt", Buffer.from("x"));
    assert.equal(r.code, 500);
    assert.ok(r.error);
    assert.ok(!JSON.stringify(r).includes(root) && !/EACCES|\/tmp|\/var\//.test(JSON.stringify(r)), JSON.stringify(r));
  } finally { chmodSync(join(root, "Locked"), 0o700); rmSync(root, { recursive: true, force: true }); }
});

test("a chunked upload with no content-length is cut off at the upload limit with 413", async () => {
  const b = await bootAsOwner();
  try {
    const root = join(b.home, "business-assets"); mkdirSync(join(root, "Contracts"), { recursive: true });
    const status = await new Promise((resolve, reject) => {
      const u = new URL(`${b.url}/api/assets/upload?category=Contracts&name=huge.bin`);
      const req = httpRequest({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: "POST", headers: { cookie: b.jar.owner, origin: b.url, "transfer-encoding": "chunked" } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
      req.on("error", (e) => (e.code === "EPIPE" || e.code === "ECONNRESET" ? resolve(413) : reject(e)));
      const chunk = Buffer.alloc(1024 * 1024);
      let sent = 0;
      (function pump() { while (sent < 60) { sent++; if (!req.write(chunk)) return req.once("drain", pump); } req.end(); })();
    });
    assert.equal(status, 413);
    assert.deepEqual(readdirSync(join(root, "Contracts")), []);
  } finally { b.cleanup(); }
});

test("/assets/file serves only what the listing exposes: no hidden files, depth <= 2, no symlink escapes, nothing outside the root", async () => {
  const b = await bootAsOwner();
  try {
    const root = join(b.home, "business-assets");
    mkdirSync(join(root, "Docs", "deep"), { recursive: true });
    const outside = mkd(join(tmpdir(), "sod-out-"));
    writeFileSync(join(outside, "secret.txt"), "TOP SECRET");
    writeFileSync(join(root, "Docs", "ok.txt"), "fine");
    writeFileSync(join(root, "Docs", ".hidden.txt"), "hidden");
    writeFileSync(join(root, "Docs", "deep", "three.txt"), "too deep");
    writeFileSync(join(root, ".assets.json"), JSON.stringify({ favorites: [] }));
    writeFileSync(join(root, "top.txt"), "top");
    symlinkSync(outside, join(root, "LinkDir"));
    symlinkSync(join(outside, "secret.txt"), join(root, "Docs", "link.txt"));
    const get = async (rel) => { const r = await fetch(`${b.url}/assets/file/${assetId(rel)}`, { headers: { cookie: b.jar.owner } }); const t = await r.text(); return [r.status, t]; };
    assert.deepEqual(await get("Docs/ok.txt"), [200, "fine"]);
    assert.deepEqual(await get("top.txt"), [200, "top"]);
    for (const rel of [".assets.json", "Docs/.hidden.txt", ".hidden/x.txt", "Docs/deep/three.txt", "../x", "Docs/../../x", "LinkDir/secret.txt", "Docs/link.txt", "Docs", "Docs/~$lock.docx"]) {
      const [st, body] = await get(rel);
      assert.equal(st, 404, rel);
      assert.doesNotMatch(body, /TOP SECRET|hidden|too deep|favorites/, rel);
    }
    // the same gate applies to favorite / scan / remind
    const fav = await b.http("POST", "/api/assets/favorite", { as: "owner", body: { id: assetId(".assets.json"), on: true } });
    assert.equal(fav.status, 404);
    rmSync(outside, { recursive: true, force: true });
  } finally { b.cleanup(); }
});

test("COOP: same-origin on /assets/file and /artifacts", async () => {
  const b = await bootAsOwner();
  try {
    const root = join(b.home, "business-assets"); mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "a.txt"), "x");
    const a = await fetch(`${b.url}/assets/file/${assetId("a.txt")}`, { headers: { cookie: b.jar.owner } });
    assert.equal(a.headers.get("cross-origin-opener-policy"), "same-origin"); await a.arrayBuffer();
    const r = await fetch(`${b.url}/artifacts/sample-report.html`, { headers: { cookie: b.jar.owner } });
    assert.equal(r.headers.get("cross-origin-opener-policy"), "same-origin"); await r.arrayBuffer();
  } finally { b.cleanup(); }
});
