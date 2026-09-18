import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server.js";
import { UserStore } from "../src/users.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("POST /api/update is owner-only", async () => {
  const vault = mkdtempSync(join(tmpdir(), "vault-"));
  const home = mkdtempSync(join(tmpdir(), "home-"));
  const server = createServer({ vaultPath: vault, homeDir: home, licenseCheck: () => ({ ok: true }) });
  const users = new UserStore(join(home, "users.json"));
  await users.create({ username: "staffer", password: "staffpassword1", role: "staff", displayName: "Staff" });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  // Must set Origin so the request clears server.js's global same-origin/CSRF
  // guard (sameOriginOk in src/auth.js) and actually reaches the /api/update
  // route -- otherwise every POST here gets a 403 "cross-origin" before the
  // owner check ever runs. See test/helpers/boot.js's requestAs() for the
  // same convention used by every other POST test in this suite.
  const resp = await fetch(`${base}/api/update`, { method: "POST", headers: { origin: base } });
  assert.equal(resp.status, 401); // no session cookie at all
  server.close();
  server.ctx.index.close();
});

test("a second POST /api/update while one is already running is rejected with 409", async () => {
  const vault = mkdtempSync(join(tmpdir(), "vault-"));
  const home = mkdtempSync(join(tmpdir(), "home-"));
  let installs = 0;
  const server = createServer({
    vaultPath: vault, homeDir: home, licenseCheck: () => ({ ok: true }),
    appDir: "/app", npmBin: "/runtime/npm",
    // Injected so the test never shells out to a real npm install.
    applyUpdateImpl: () => { installs++; return { ok: true }; },
    restart: () => {},
  });
  const users = new UserStore(join(home, "users.json"));
  await users.create({ username: "owner1", password: "ownerpassword1", role: "owner", displayName: "Owner" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const login = await fetch(`${base}/api/login`, {
    method: "POST", headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ username: "owner1", password: "ownerpassword1" }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];

  const first = await fetch(`${base}/api/update`, { method: "POST", headers: { origin: base, cookie } });
  assert.equal(first.status, 200);
  const second = await fetch(`${base}/api/update`, { method: "POST", headers: { origin: base, cookie } });
  assert.equal(second.status, 409, "an impatient second click must not start a second npm install");
  assert.equal((await second.json()).error, "update-in-progress");
  assert.equal(installs, 1);
  server.close();
  server.ctx.index.close();
});

test("a FAILED update clears the guard so the owner can retry", async () => {
  const vault = mkdtempSync(join(tmpdir(), "vault-"));
  const home = mkdtempSync(join(tmpdir(), "home-"));
  let installs = 0;
  const server = createServer({
    vaultPath: vault, homeDir: home, licenseCheck: () => ({ ok: true }),
    applyUpdateImpl: () => { installs++; return { ok: false, error: "registry down" }; },
    restart: () => {},
  });
  const users = new UserStore(join(home, "users.json"));
  await users.create({ username: "owner1", password: "ownerpassword1", role: "owner", displayName: "Owner" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/login`, {
    method: "POST", headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ username: "owner1", password: "ownerpassword1" }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];

  const first = await fetch(`${base}/api/update`, { method: "POST", headers: { origin: base, cookie } });
  assert.equal(first.status, 500);
  const second = await fetch(`${base}/api/update`, { method: "POST", headers: { origin: base, cookie } });
  assert.equal(second.status, 500); // not 409
  assert.equal(installs, 2);
  server.close();
  server.ctx.index.close();
});
