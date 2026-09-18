// Shared server-boot helper for both the node:test role-matrix suite
// (test/owner-routes.test.js) and the Playwright browser suite
// (test/e2e/owner.spec.js). Factors out the boot/setup/login sequence every
// *.test.js file in this directory had been re-typing inline (see
// test/server.test.js's own `boot()`, test/assets.test.js's `bootServer()`,
// etc.) -- this task is the first to need the same sequence from two very
// different callers (a raw `fetch`-based matrix and a real browser page), so
// it earns a shared home instead of a fourth copy.
import { mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createServer } from "../../src/server.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "vault");

export const OWNER_USERNAME = "glenn";
export const OWNER_PASSWORD = "longenough1";
export const STAFF_USERNAME = "marco";
export const STAFF_PASSWORD = "longenough1";

async function* fakeRunTurn() {
  yield { type: "session", claudeSessionId: "cc-1" };
  yield { type: "text", delta: "ok" };
  yield { type: "done", text: "ok", stats: {} };
}

// Boots a fresh server against a copy of the fixture vault, creates the
// owner (via /api/setup) and a staff user (via /api/users), and logs both
// in. Returns everything either kind of caller needs:
//   - server, url/base   : for a real browser to navigate to, or for
//                          requestAs() below to compute the port from.
//   - jar                : { owner: "<cookie>", staff: "<cookie>" } -- fed
//                          straight into requestAs().
//   - username/password  : the owner's own login, for a Playwright page to
//                          type into the real login form.
//   - http               : the same fetch-jar convenience used elsewhere in
//                          this test suite, for callers that want it directly.
//   - cleanup            : closes the server and index watcher and removes
//                          the tmp vault/home. MUST be called by every test.
export async function bootAsOwner({ staffSwitches = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sod-boot-"));
  const vault = join(root, "vault");
  cpSync(FIX, vault, { recursive: true });
  const home = join(root, "home");
  const server = createServer({ vaultPath: vault, homeDir: home, runTurn: fakeRunTurn, licenseCheck: () => ({ ok: true }) });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const jar = {};

  const http = async (method, path, { body, as, headers = {} } = {}) => {
    const h = { ...headers };
    if (body !== undefined) { h["content-type"] = "application/json"; h["origin"] = url; }
    if (as && jar[as]) h["cookie"] = jar[as];
    const res = await fetch(url + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
    const sc = res.headers.get("set-cookie");
    if (as && sc) jar[as] = sc.split(";")[0];
    return res;
  };

  const setup = await http("POST", "/api/setup", { body: { displayName: "Glenn", username: OWNER_USERNAME, password: OWNER_PASSWORD }, as: "owner" });
  assert.equal(setup.status, 200, "owner setup must succeed");

  const created = await http("POST", "/api/users", {
    as: "owner",
    body: { username: STAFF_USERNAME, displayName: "Marco", password: STAFF_PASSWORD, role: "staff", switches: staffSwitches },
  });
  assert.equal(created.status, 201, "staff user creation must succeed");

  const loggedIn = await http("POST", "/api/login", { as: "staff", body: { username: STAFF_USERNAME, password: STAFF_PASSWORD, remember: false } });
  assert.equal(loggedIn.status, 200, "staff login must succeed");

  return {
    server, url, base: url, jar, http, vault, home,
    username: OWNER_USERNAME, password: OWNER_PASSWORD,
    cleanup: () => { server.close(); server.ctx.index.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

// Fires one request as a given role against an already-booted server, using
// the cookie jar bootAsOwner() returned. "anon" sends no cookie at all.
// Matches server.js's own same-origin rule (sameOriginOk, src/auth.js): a
// state-changing method requires an Origin header that matches Host, so
// this always sets one for POST/PUT/PATCH, independent of whether a body
// is supplied -- a route that is meant to 400 on a role/guard-passing but
// bodyless request (see MATRIX's POST /api/runs row) must still get past
// the CSRF check first.
export async function requestAs(server, jar, role, method, path, body) {
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = {};
  if (method === "POST" || method === "PUT" || method === "PATCH") headers["origin"] = base;
  if (body !== undefined) headers["content-type"] = "application/json";
  if (role !== "anon" && jar[role]) headers["cookie"] = jar[role];
  return fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
}
