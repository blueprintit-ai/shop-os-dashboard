import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { UserStore, hashPassword, verifyPassword, DEFAULT_STAFF_FOLDERS } from "../src/users.js";
import { createServer } from "../src/server.js";

function tmpStore() {
  const dir = mkdtempSync(join(tmpdir(), "sod-users-"));
  return { store: new UserStore(join(dir, "users.json")), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "vault");

async function bootAsOwner() {
  const root = mkdtempSync(join(tmpdir(), "sod-users-routes-"));
  const vault = join(root, "vault"); cpSync(FIX, vault, { recursive: true });
  const server = createServer({ vaultPath: vault, homeDir: join(root, "home"), licenseCheck: () => ({ ok: true }) });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const b = `http://127.0.0.1:${server.address().port}`;

  const setup = await fetch(`${b}/api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: b },
    body: JSON.stringify({ displayName: "Glenn", username: "glenn", password: "longenough1" }),
  });
  const jar = { owner: setup.headers.get("set-cookie").split(";")[0] };

  const staffRes = await fetch(`${b}/api/users`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: b, cookie: jar.owner },
    body: JSON.stringify({ displayName: "Staff User", username: "staff", password: "longenough2", role: "staff" }),
  });
  await staffRes.json();

  const staffLogin = await fetch(`${b}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: b },
    body: JSON.stringify({ username: "staff", password: "longenough2" }),
  });
  jar.staff = staffLogin.headers.get("set-cookie").split(";")[0];

  return { server, jar, root };
}

function base(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

test("hashPassword produces scrypt format and verifyPassword round-trips", async () => {
  const h = await hashPassword("correct horse");
  assert.match(h, /^scrypt\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.equal(await verifyPassword("correct horse", h), true);
  assert.equal(await verifyPassword("wrong", h), false);
});

test("create owner then staff; usernames are unique and case-insensitive", async () => {
  const { store, cleanup } = tmpStore();
  const owner = await store.create({ username: "Glenn", displayName: "Glenn", password: "longenough1", role: "owner" });
  assert.equal(owner.role, "owner");
  assert.equal(store.findByUsername("glenn").id, owner.id);
  await assert.rejects(store.create({ username: "GLENN", displayName: "x", password: "longenough1", role: "staff" }), { code: "USERNAME_TAKEN" });
  const staff = await store.create({ username: "marco", displayName: "Marco", password: "longenough1", role: "staff" });
  assert.deepEqual(staff.switches.folders, [...DEFAULT_STAFF_FOLDERS]);
  assert.equal(staff.switches.assetsView, false);
  assert.equal(staff.switches.artifactsShared, true);
  assert.equal(store.list().length, 2);
  assert.equal("passwordHash" in store.list()[0], false, "list() never exposes hashes");
  cleanup();
});

test("rejects invalid role and short password", async () => {
  const { store, cleanup } = tmpStore();
  await assert.rejects(store.create({ username: "aa", displayName: "a", password: "longenough1", role: "admin" }), { code: "INVALID_ROLE" });
  await assert.rejects(store.create({ username: "bb", displayName: "b", password: "short", role: "staff" }), { code: "WEAK_PASSWORD" });
  cleanup();
});

test("cannot deactivate the last active owner; can after a second owner exists", async () => {
  const { store, cleanup } = tmpStore();
  const o1 = await store.create({ username: "o1", displayName: "o1", password: "longenough1", role: "owner" });
  assert.throws(() => store.deactivate(o1.id), { code: "LAST_OWNER" });
  const o2 = await store.create({ username: "o2", displayName: "o2", password: "longenough1", role: "owner" });
  store.deactivate(o1.id);
  assert.equal(store.get(o1.id).active, false);
  assert.throws(() => store.deactivate(o2.id), { code: "LAST_OWNER" });
  store.reactivate(o1.id);
  assert.equal(store.get(o1.id).active, true);
  cleanup();
});

test("update patches displayName and switches; persists across instances", async () => {
  const { store, cleanup } = tmpStore();
  const s = await store.create({ username: "mm", displayName: "M", password: "longenough1", role: "staff" });
  store.update(s.id, { displayName: "Marco P", switches: { folders: ["Projects"], assetsView: true } });
  const again = new UserStore(store.filePath);
  const u = again.get(s.id);
  assert.equal(u.displayName, "Marco P");
  assert.deepEqual(u.switches.folders, ["Projects"]);
  assert.equal(u.switches.assetsView, true);
  assert.equal(u.switches.artifactsShared, true, "unspecified switches keep their value");
  cleanup();
});

test("NOT_FOUND is thrown for a bogus id on every mutator", async () => {
  const { store, cleanup } = tmpStore();
  await store.create({ username: "real", displayName: "Real", password: "longenough1", role: "staff" });
  const bogus = "00000000-0000-0000-0000-000000000000";
  assert.throws(() => store.update(bogus, { displayName: "x" }), { code: "NOT_FOUND" });
  await assert.rejects(store.setPassword(bogus, "longenough1"), { code: "NOT_FOUND" });
  assert.throws(() => store.deactivate(bogus), { code: "NOT_FOUND" });
  assert.throws(() => store.reactivate(bogus), { code: "NOT_FOUND" });
  assert.throws(() => store.recordFailedLogin(bogus), { code: "NOT_FOUND" });
  assert.throws(() => store.clearFailedLogins(bogus), { code: "NOT_FOUND" });
  cleanup();
});

test("failed login counter locks after 5 and clears, not before", async () => {
  const { store, cleanup } = tmpStore();
  const u = await store.create({ username: "mm", displayName: "M", password: "longenough1", role: "staff" });
  for (let i = 0; i < 4; i++) store.recordFailedLogin(u.id);
  assert.equal(store.get(u.id).lockedUntil, null, "4 failures must not lock the account");
  store.recordFailedLogin(u.id);
  assert.ok(store.get(u.id).lockedUntil > Date.now(), "5th failure must lock the account");
  store.clearFailedLogins(u.id);
  assert.equal(store.get(u.id).failedLogins, 0);
  assert.equal(store.get(u.id).lockedUntil, null);
  cleanup();
});

test("GET /api/users/activity is owner-only and returns recent audit rows", async () => {
  const { server, jar, root } = await bootAsOwner();
  const b = base(server);
  assert.equal((await fetch(`${b}/api/users/activity`, { headers: { cookie: jar.staff } })).status, 403);
  const res = await fetch(`${b}/api/users/activity?limit=5`, { headers: { cookie: jar.owner } });
  assert.equal(res.status, 200);
  const rows = await res.json();
  assert.ok(Array.isArray(rows));
  assert.ok(rows.every((r) => "event" in r && "username" in r));
  server.close(); server.ctx.index.close();
  rmSync(root, { recursive: true, force: true });
});
