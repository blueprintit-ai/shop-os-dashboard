import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server.js";
import { UserStore } from "../src/users.js";

async function bootWithOwner(vaultPath, homeDir) {
  const server = createServer({ vaultPath, homeDir, licenseCheck: () => ({ ok: true }) });
  const users = new UserStore(`${homeDir}/users.json`);
  await users.create({ username: "owner1", password: "ownerpassword1", role: "owner", displayName: "Owner" });
  return server;
}

test("GET /api/status requires a session", async (t) => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const vault = mkdtempSync(join(tmpdir(), "vault-"));
  const home = mkdtempSync(join(tmpdir(), "home-"));
  const server = await bootWithOwner(vault, home);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const resp = await fetch(`http://127.0.0.1:${port}/api/status`);
  assert.equal(resp.status, 401);
  server.close();
});

test("GET /api/status still answers (200) when the license check FAILS, so the owner can see why", async () => {
  // The whole point of the status widget's License card is to show a broken
  // license. Gating /api/status behind the license check meant the 402 fired
  // first and the card could never render.
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const vault = mkdtempSync(join(tmpdir(), "vault-"));
  const home = mkdtempSync(join(tmpdir(), "home-"));
  const server = createServer({ vaultPath: vault, homeDir: home, licenseCheck: () => ({ ok: false, error: "expired" }) });
  const users = new UserStore(`${home}/users.json`);
  await users.create({ username: "owner1", password: "ownerpassword1", role: "owner", displayName: "Owner" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const login = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ username: "owner1", password: "ownerpassword1" }),
  });
  assert.equal(login.status, 200); // /api/login is license-exempt too
  const cookie = login.headers.get("set-cookie").split(";")[0];

  const resp = await fetch(`${base}/api/status`, { headers: { cookie } });
  assert.equal(resp.status, 200, "must not be the 402 license gate");
  const body = await resp.json();
  assert.equal(body.license.ok, false);
  server.close();
  server.ctx.index.close();
});
