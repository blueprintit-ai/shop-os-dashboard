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
