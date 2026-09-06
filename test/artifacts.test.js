import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { listArtifacts, removeArtifact } from "../src/artifacts.js";
import { createServer } from "../src/server.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "vault");

function seedVault() {
  const vault = mkdtempSync(join(tmpdir(), "sod-artifacts-"));
  const dir = join(vault, "Dashboard", "artifacts");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "owner-only.html"), "<title>Owner Report</title>");
  writeFileSync(join(dir, "owner-only.json"), JSON.stringify({ title: "Owner Report", visibility: "owner" }));
  writeFileSync(join(dir, "shared.html"), "<title>Shared Brief</title>");
  writeFileSync(join(dir, "shared.json"), JSON.stringify({ title: "Shared Brief", visibility: "staff" }));
  return vault;
}

test("owner sees all artifacts; staff sees only visibility:staff ones when switch is on", () => {
  const vault = seedVault();
  const owner = { role: "owner" };
  const staffOn = { role: "staff", switches: { artifactsShared: true } };
  const staffOff = { role: "staff", switches: { artifactsShared: false } };

  assert.equal(listArtifacts(vault, owner).artifacts.length, 2);
  const staffList = listArtifacts(vault, staffOn).artifacts;
  assert.equal(staffList.length, 1);
  assert.equal(staffList[0].file, "shared.html");
  assert.equal(listArtifacts(vault, staffOff).artifacts.length, 0);
  rmSync(vault, { recursive: true, force: true });
});

test("removeArtifact moves the html and its sidecar into _trash", () => {
  const vault = seedVault();
  const result = removeArtifact(vault, "owner-only.html");
  assert.deepEqual(result, { ok: true });
  const trash = join(vault, "Dashboard", "artifacts", "_trash");
  assert.equal(existsSync(join(trash, "owner-only.html")), true);
  assert.equal(existsSync(join(trash, "owner-only.json")), true);
  assert.equal(existsSync(join(vault, "Dashboard", "artifacts", "owner-only.html")), false);
  rmSync(vault, { recursive: true, force: true });
});

test("removeArtifact rejects path traversal", () => {
  const vault = seedVault();
  const result = removeArtifact(vault, "../../etc/passwd");
  assert.equal(result.error, "bad-path");
  rmSync(vault, { recursive: true, force: true });
});

test("removeArtifact reports not-found for a missing file", () => {
  const vault = seedVault();
  const result = removeArtifact(vault, "nope.html");
  assert.deepEqual(result, { error: "not-found", code: 404 });
  rmSync(vault, { recursive: true, force: true });
});

// --- route-level integration tests -----------------------------------------

async function bootServer() {
  const root = mkdtempSync(join(tmpdir(), "sod-artifacts-srv-"));
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
  const created = await http("POST", "/api/users", { as: "owner", body: { username: "marco", displayName: "Marco", password: "longenough1", role: "staff", switches: { folders: ["Projects", "Resources"] } } });
  assert.equal(created.status, 201);
  const loggedIn = await http("POST", "/api/login", { as: "staff", body: { username: "marco", password: "longenough1", remember: false } });
  assert.equal(loggedIn.status, 200);
  return { server, base, http, vault, cleanup: () => { server.close(); server.ctx.index.close(); rmSync(root, { recursive: true, force: true }); } };
}

function seedArtifactInto(vault) {
  const dir = join(vault, "Dashboard", "artifacts");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "owner-only.html"), "<title>Owner Report</title>");
  writeFileSync(join(dir, "owner-only.json"), JSON.stringify({ title: "Owner Report", visibility: "owner" }));
}

test("GET /api/artifacts and POST /api/artifacts/remove role matrix", async () => {
  const t = await bootServer();
  try {
    seedArtifactInto(t.vault);

    const anon = await fetch(`${t.base}/api/artifacts`);
    assert.equal(anon.status, 401);

    const asOwner = await t.http("GET", "/api/artifacts", { as: "owner" });
    assert.equal(asOwner.status, 200);
    const ownerBody = await asOwner.json();
    assert.ok(ownerBody.artifacts.some((a) => a.file === "owner-only.html"));

    const removeAsStaff = await t.http("POST", "/api/artifacts/remove", { as: "staff", body: { file: "owner-only.html" } });
    assert.equal(removeAsStaff.status, 403);

    const removeAsOwner = await t.http("POST", "/api/artifacts/remove", { as: "owner", body: { file: "owner-only.html" } });
    assert.equal(removeAsOwner.status, 200);
    assert.deepEqual(await removeAsOwner.json(), { ok: true });
  } finally { t.cleanup(); }
});

test("GET /artifacts/<file> is auth-gated and visibility-gated", async () => {
  const t = await bootServer();
  try {
    const dir = join(t.vault, "Dashboard", "artifacts");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "owner-only.html"), "<title>Owner Report</title><p>secret</p>");
    writeFileSync(join(dir, "owner-only.json"), JSON.stringify({ title: "Owner Report", visibility: "owner" }));
    writeFileSync(join(dir, "shared.html"), "<title>Shared Brief</title><p>ok</p>");
    writeFileSync(join(dir, "shared.json"), JSON.stringify({ title: "Shared Brief", visibility: "staff" }));

    const anon = await fetch(`${t.base}/artifacts/owner-only.html`);
    assert.equal(anon.status, 401);

    const staffOnOwnerOnly = await t.http("GET", "/artifacts/owner-only.html", { as: "staff" });
    assert.equal(staffOnOwnerOnly.status, 403, "staff must not be able to fetch an owner-only artifact by filename");

    const staffOnShared = await t.http("GET", "/artifacts/shared.html", { as: "staff" });
    assert.equal(staffOnShared.status, 200);
    assert.match(await staffOnShared.text(), /Shared Brief/);

    const ownerOnOwnerOnly = await t.http("GET", "/artifacts/owner-only.html", { as: "owner" });
    assert.equal(ownerOnOwnerOnly.status, 200);
    assert.match(await ownerOnOwnerOnly.text(), /secret/);

    const traversal = await t.http("GET", "/artifacts/..%2F..%2Fpackage.json", { as: "owner" });
    assert.equal(traversal.status, 400);

    const sidecarDirectly = await t.http("GET", "/artifacts/owner-only.json", { as: "owner" });
    assert.equal(sidecarDirectly.status, 400, "the .json sidecar itself must never be reachable through this route");

    const trashReach = await t.http("GET", "/artifacts/_trash%2Fowner-only.html", { as: "owner" });
    assert.equal(trashReach.status, 400, "encoded slash into _trash must not resolve");

    const missing = await t.http("GET", "/artifacts/does-not-exist.html", { as: "owner" });
    assert.equal(missing.status, 404);
  } finally { t.cleanup(); }
});
