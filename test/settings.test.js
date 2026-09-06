import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SettingsStore } from "../src/settings.js";
import { createServer } from "../src/server.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "vault");

test("SettingsStore defaults, then merges a patch", () => {
  const home = mkdtempSync(join(tmpdir(), "sod-settings-"));
  const store = new SettingsStore(home);
  assert.deepEqual(store.get(), { assetsDir: null, sessionCap: 3, portOverride: null });
  const updated = store.save({ assetsDir: "C:/Business Assets" });
  assert.equal(updated.assetsDir, "C:/Business Assets");
  assert.equal(updated.sessionCap, 3); // untouched fields survive the merge
  assert.equal(store.get().assetsDir, "C:/Business Assets"); // persisted
  rmSync(home, { recursive: true, force: true });
});

test("GET/PUT /api/settings is owner-only", async () => {
  const root = mkdtempSync(join(tmpdir(), "sod-settings-routes-"));
  const vault = join(root, "vault"); cpSync(FIX, vault, { recursive: true });
  const home = join(root, "home");
  async function* fakeRunTurn() { yield { type: "done", text: "", stats: {} }; }
  const server = createServer({ vaultPath: vault, homeDir: home, runTurn: fakeRunTurn, licenseCheck: () => ({ ok: true }) });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const b = `http://127.0.0.1:${server.address().port}`;

  const jar = {};
  const http = async (method, path, { headers = {} } = {}) => {
    const h = { ...headers };
    if (jar.staff) h["cookie"] = jar.staff;
    const res = await fetch(b + path, { method, headers: h, redirect: "manual" });
    const sc = res.headers.get("set-cookie");
    if (sc) {
      if (path === "/api/login" && headers["x-role"] === "staff") jar.staff = sc.split(";")[0];
      else jar.owner = sc.split(";")[0];
    }
    return res;
  };

  try {
    // Setup owner
    const setup = await fetch(`${b}/api/setup`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: b },
      body: JSON.stringify({ displayName: "Glenn", username: "glenn", password: "longenough1" }),
    });
    const sc = setup.headers.get("set-cookie");
    if (sc) jar.owner = sc.split(";")[0];

    // Create staff user
    const staffSetup = await http("POST", "/api/users", {
      headers: {
        "content-type": "application/json", "x-role": "owner", origin: b,
        cookie: jar.owner
      },
    });
    const staffRes = await fetch(`${b}/api/users`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: b, cookie: jar.owner },
      body: JSON.stringify({ displayName: "Staff User", username: "staff", password: "longenough2", role: "staff" }),
    });
    const staffData = await staffRes.json();

    // Login as staff
    const staffLogin = await fetch(`${b}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: b },
      body: JSON.stringify({ username: "staff", password: "longenough2" }),
    });
    const staffSc = staffLogin.headers.get("set-cookie");
    if (staffSc) jar.staff = staffSc.split(";")[0];

    // Test: staff cannot GET /api/settings
    assert.equal((await fetch(`${b}/api/settings`, { headers: { cookie: jar.staff } })).status, 403);

    // Test: owner can GET /api/settings
    const got = await fetch(`${b}/api/settings`, { headers: { cookie: jar.owner } });
    assert.equal(got.status, 200);
    const getResult = await got.json();
    assert.deepEqual(getResult, { assetsDir: null, sessionCap: 3, portOverride: null });

    // Test: owner can PUT /api/settings
    const put = await fetch(`${b}/api/settings`, {
      method: "PUT", headers: { cookie: jar.owner, "content-type": "application/json", origin: b },
      body: JSON.stringify({ sessionCap: 5 }),
    });
    assert.equal(put.status, 200);
    const putResult = await put.json();
    assert.equal(putResult.sessionCap, 5);
    assert.equal(putResult.assetsDir, null); // original value preserved
  } finally {
    server.close(); server.ctx.index.close(); rmSync(root, { recursive: true, force: true });
  }
});
