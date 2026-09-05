import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UserStore } from "../src/users.js";
import { Audit } from "../src/audit.js";
import { Auth, COOKIE_NAME, requireUser, requireOwner, sameOriginOk } from "../src/auth.js";

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "sod-auth-"));
  const users = new UserStore(join(dir, "users.json"));
  const audit = new Audit(join(dir, "activity.jsonl"));
  const auth = new Auth({ users, sessionsPath: join(dir, "sessions.json"), audit });
  const owner = await users.create({ username: "glenn", displayName: "Glenn", password: "longenough1", role: "owner" });
  const staff = await users.create({ username: "marco", displayName: "Marco", password: "longenough1", role: "staff" });
  return { dir, users, auth, owner, staff, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function fakeReq(token, extra = {}) {
  return { headers: { cookie: token ? `${COOKIE_NAME}=${token}` : "", ...extra.headers }, socket: { remoteAddress: "192.168.1.5" }, method: extra.method ?? "GET" };
}
function fakeRes() {
  const r = { status: null, body: null, writeHead(s) { r.status = s; }, end(b) { r.body = b; } };
  return r;
}

test("login succeeds, session resolves to user, logout invalidates", async () => {
  const s = await setup();
  const r = await s.auth.login({ username: "glenn", password: "longenough1", remember: false, ip: "x" });
  assert.equal(r.ok, true);
  assert.equal(r.maxAgeSec, 12 * 3600);
  const u = s.auth.userForRequest(fakeReq(r.token));
  assert.equal(u.id, s.owner.id);
  assert.equal("passwordHash" in u, false);
  s.auth.logout(r.token);
  assert.equal(s.auth.userForRequest(fakeReq(r.token)), null);
  s.cleanup();
});

test("remember extends to 30 days", async () => {
  const s = await setup();
  const r = await s.auth.login({ username: "glenn", password: "longenough1", remember: true, ip: "x" });
  assert.equal(r.maxAgeSec, 30 * 24 * 3600);
  s.cleanup();
});

test("wrong password is invalid; five failures lock; locked returns locked even with right password", async () => {
  const s = await setup();
  for (let i = 0; i < 5; i++) {
    const r = await s.auth.login({ username: "marco", password: "nope-nope-nope", remember: false, ip: "x" });
    assert.equal(r.ok, false);
  }
  const locked = await s.auth.login({ username: "marco", password: "longenough1", remember: false, ip: "x" });
  assert.deepEqual(locked, { ok: false, reason: "locked" });
  s.cleanup();
});

test("unknown username is invalid without revealing which field", async () => {
  const s = await setup();
  const r = await s.auth.login({ username: "nobody", password: "whatever-long", remember: false, ip: "x" });
  assert.deepEqual(r, { ok: false, reason: "invalid" });
  s.cleanup();
});

test("deactivating a user kills their live session on the next request", async () => {
  const s = await setup();
  const r = await s.auth.login({ username: "marco", password: "longenough1", remember: false, ip: "x" });
  assert.ok(s.auth.userForRequest(fakeReq(r.token)));
  s.users.deactivate(s.staff.id);
  assert.equal(s.auth.userForRequest(fakeReq(r.token)), null);
  s.cleanup();
});

test("sessions persist across Auth instances", async () => {
  const s = await setup();
  const r = await s.auth.login({ username: "glenn", password: "longenough1", remember: false, ip: "x" });
  const auth2 = new Auth({ users: s.users, sessionsPath: join(s.dir, "sessions.json"), audit: new Audit(join(s.dir, "a.jsonl")) });
  assert.equal(auth2.userForRequest(fakeReq(r.token)).id, s.owner.id);
  s.cleanup();
});

test("requireUser sends 401 for anonymous; requireOwner sends 403 for staff", async () => {
  const s = await setup();
  const res1 = fakeRes();
  assert.equal(requireUser(fakeReq(null), res1, s.auth), null);
  assert.equal(res1.status, 401);
  const r = await s.auth.login({ username: "marco", password: "longenough1", remember: false, ip: "x" });
  const res2 = fakeRes();
  assert.equal(requireOwner(fakeReq(r.token), res2, s.auth), null);
  assert.equal(res2.status, 403);
  const ro = await s.auth.login({ username: "glenn", password: "longenough1", remember: false, ip: "x" });
  const res3 = fakeRes();
  assert.equal(requireOwner(fakeReq(ro.token), res3, s.auth).id, s.owner.id);
  assert.equal(res3.status, null);
  s.cleanup();
});

test("sameOriginOk accepts matching Origin or Referer and rejects mismatch or absence", () => {
  const host = "192.168.1.10:50000";
  assert.equal(sameOriginOk({ headers: { host, origin: `http://${host}` } }), true);
  assert.equal(sameOriginOk({ headers: { host, referer: `http://${host}/users` } }), true);
  assert.equal(sameOriginOk({ headers: { host, origin: "http://evil.example" } }), false);
  assert.equal(sameOriginOk({ headers: { host } }), false);
});
