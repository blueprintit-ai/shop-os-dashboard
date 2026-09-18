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
});
