# Shop OS Dashboard Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `shop-os-dashboard` server with logins, owner-managed permissions, the read-only note viewer, role-scoped Claude chat, the employee page, and the owner Users screen, running on the LAN against an existing vault without touching any shipped Shop OS code.

**Architecture:** One Node ESM process serving static pages and a JSON/SSE API. Shop OS Chat's Agent SDK wrapper, license gate, and transcript writer are copied in and generalized to two roles. Permissions are enforced twice from one folder-scope list: in the notes API and in the SDK `canUseTool` callback. State outside the vault lives in `~/.shopos/dashboard/` as JSON files with atomic writes.

**Tech Stack:** Node 20+ (dev on 24), ESM, `node:http`, `node:crypto` scrypt, `node --test`, `@anthropic-ai/claude-agent-sdk` 0.3.261, `marked` 18.0.11. No native modules. No framework.

**Spec:** `Projects/shop-os-dashboard/specs/2026-09-05-shop-os-dashboard-design.md`

**This is Plan 1 of 3.** Plan 2 ports the agentic-os owner dashboard (ring, widgets, skills deck, artifacts, snapshots, assets, per-user layout). Plan 3 builds the installer, auto-start, updater, and status cards. Plan 1 must run end to end on its own: login, employee chat, note viewer, Users screen.

## Global Constraints

- New repo `blueprintit-ai/shop-os-dashboard`, package `@blueprintitai/shop-os-dashboard`. Never edit `shop-os-chat`, `shop-os-installer`, `shop-os-license-server`, or `blueprint-skills`.
- Port default 50000, fallback 50001 to 50010, bind `0.0.0.0`.
- Runtime dependencies are exactly `@anthropic-ai/claude-agent-sdk` and `marked`. Nothing native.
- Secrets never enter the vault. Users, sessions, settings, audit live in `~/.shopos/dashboard/`. Override the base dir with env `SHOPOS_DASHBOARD_HOME` for tests.
- The dashboard writes inside the vault only to `Dashboard/` and `Chats/`.
- Transcripts stay byte-compatible with Shop OS Chat's format (frontmatter `type: chat-transcript`, `project: shop-os-chat`).
- Staff tool list is exactly `Read`, `Glob`, `Grep`. Scope enforced by `canUseTool`, not by prompt.
- Every POST requires a session cookie and an `Origin` or `Referer` matching the request `Host`.
- First-run setup and `--reset-owner` respond only to loopback addresses.
- Tests use `node --test`. No test framework. Playwright is deferred to Plan 2.
- Commit after every task. Commit messages: `feat:`, `test:`, `chore:` prefixes, and end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Reference sources to copy from (read-only): `Projects/shop-os-chat/src/*.js`, `Projects/shop-os-chat/test/*.js`.

---

## File structure

```
shop-os-dashboard/
  package.json
  NOTICE.md                       CC BY 4.0 attribution (agentic-os shell arrives in Plan 2, notice written now)
  README.md
  bin/shop-os-dashboard.js        CLI entry: args, port, bind, LAN address, --reset-owner
  src/
    lib/http.js                   readJsonBody, sendJson, send, cookie parse/serialize, serveStatic, isLoopback
    lib/store.js                  JsonStore: load/save JSON with atomic rename
    lib/paths.js                  dashboardHome(), vault subpaths
    license.js                    copied from Shop OS Chat
    audit.js                      append JSON lines
    users.js                      user records, scrypt, roles, switches
    auth.js                       sessions, lockout, cookie, guards
    scope.js                      folder scope: allowedRoots(user), isPathAllowed(vault, user, absPath)
    notes/index.js                link index + watcher + backlinks
    notes/render.js               markdown preprocessing + marked
    notes/search.js               title + full-text search within scope
    notes/tree.js                 folder tree within scope
    chat/options.js               buildQueryOptions(role, scope) with canUseTool
    chat/run-turn.js              runTurn generator (copied)
    chat/system-prompt.js         staff prompt (copied, adapted) + owner prompt
    chat/transcript.js            copied from Shop OS Chat
    chat/sessions.js              copied from Shop OS Chat, plus userId
    sessions-guard.js             concurrency cap + queue
    server.js                     createServer({ vaultPath, deps }) and routes
    routes/auth-routes.js
    routes/users-routes.js
    routes/notes-routes.js
    routes/chat-routes.js
    routes/pages.js               HTML pages with role redirects
  public/
    login.html, setup.html, employee.html, users.html
    css/base.css
    js/chat.js                    SSE client (adapted from Shop OS Chat app.js)
    js/notes.js                   tree + viewer + search
    js/users.js                   Users screen
    vendor/marked.min.js          copied from Shop OS Chat public/
  test/
    fixtures/vault/               tiny synthetic vault
    *.test.js                     one per module
```

---

### Task 1: Repo scaffold, license gate, HTTP helpers, JSON store

**Files:**
- Create: `package.json`, `.gitignore`, `NOTICE.md`
- Modify: `README.md` (append a Package section)
- Create: `src/lib/paths.js`, `src/lib/http.js`, `src/lib/store.js`
- Create: `src/license.js` (copy of `Projects/shop-os-chat/src/license.js`)
- Test: `test/license.test.js` (copy of Shop OS Chat's), `test/store.test.js`, `test/http.test.js`

**Interfaces:**
- Produces: `dashboardHome(): string`, `vaultDashboardDir(vaultPath): string`
- Produces: `readJsonBody(req, maxBytes?) -> Promise<object>`, `sendJson(res, status, obj, extraHeaders?)`, `send(res, status, headers, body)`, `parseCookies(req) -> Record<string,string>`, `serializeCookie(name, value, {maxAge, httpOnly, sameSite, path}) -> string`, `serveStatic(res, absPath)`, `mimeFor(path)`, `isLoopback(req) -> boolean`
- Produces: `class JsonStore { constructor(filePath, defaults); load() -> object; save(obj) }`
- Produces: `readLicense(path?)`, `validateLicense(license) -> {ok, error?}`

- [ ] **Step 1: Init repo and package**

The repo root is the existing project folder `Dropbox/Blueprint-OS/Projects/shop-os-dashboard/`, the same convention as `shop-os-chat`, which is also a git repo inside the vault. `specs/`, `plans/`, and the vault-style `README.md` already live there; keep them.

```bash
cd "Dropbox/Blueprint-OS/Projects/shop-os-dashboard" && git init -b main
```

After the first `npm install`, mark `node_modules` as Dropbox-ignored so Mac binaries never sync onto the PC (Windows PowerShell: `Set-Content -Path node_modules -Stream com.dropbox.ignored -Value 1`; Mac: `xattr -w com.dropbox.ignored 1 node_modules`). Repeat if `node_modules` is ever deleted and recreated.

`package.json`:
```json
{
  "name": "@blueprintitai/shop-os-dashboard",
  "version": "0.1.0",
  "description": "Shop OS Dashboard: the center access point for Shop OS. Owner cockpit, employee door, note viewer.",
  "type": "module",
  "bin": { "shop-os-dashboard": "./bin/shop-os-dashboard.js" },
  "files": ["bin", "src", "public", "NOTICE.md", "README.md"],
  "engines": { "node": ">=20.0.0" },
  "scripts": { "test": "node --test", "start": "node bin/shop-os-dashboard.js" },
  "author": "Blueprint IT <info@blueprintit.ai>",
  "license": "UNLICENSED",
  "repository": { "type": "git", "url": "git+https://github.com/blueprintit-ai/shop-os-dashboard.git" },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "0.3.261",
    "marked": "18.0.11"
  }
}
```

`.gitignore`:
```
node_modules
.env
```

`NOTICE.md`: copy `Dropbox/Robonuggets/agentic-os/NOTICE.md` verbatim, then change the first sentence to: `Shop OS Dashboard (this package) includes, starting with Plan 2, a modified version of **Rubric Agentic OS**.`

`README.md`: keep the existing vault index content and append a `## Package` section with the start command `shop-os-dashboard "<vault path>"` and `npm test`.

Run `npm install`.

- [ ] **Step 2: Write failing tests for store and http helpers**

`test/store.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonStore } from "../src/lib/store.js";

test("JsonStore returns defaults when file missing and creates parent dir on save", () => {
  const dir = mkdtempSync(join(tmpdir(), "sod-"));
  const store = new JsonStore(join(dir, "nested", "x.json"), { items: [] });
  assert.deepEqual(store.load(), { items: [] });
  store.save({ items: [1] });
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "nested", "x.json"), "utf8")), { items: [1] });
  assert.equal(existsSync(join(dir, "nested", "x.json.tmp")), false, "tmp file removed after rename");
  rmSync(dir, { recursive: true, force: true });
});

test("JsonStore returns a fresh copy of defaults, not the shared object", () => {
  const dir = mkdtempSync(join(tmpdir(), "sod-"));
  const store = new JsonStore(join(dir, "x.json"), { items: [] });
  store.load().items.push("mutated");
  assert.deepEqual(store.load(), { items: [] });
  rmSync(dir, { recursive: true, force: true });
});
```

`test/http.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCookies, serializeCookie, isLoopback } from "../src/lib/http.js";

test("parseCookies splits a cookie header", () => {
  const req = { headers: { cookie: "a=1; sod=abc%20def; b=x=y" } };
  assert.deepEqual(parseCookies(req), { a: "1", sod: "abc def", b: "x=y" });
});

test("parseCookies returns empty object with no header", () => {
  assert.deepEqual(parseCookies({ headers: {} }), {});
});

test("serializeCookie emits HttpOnly, SameSite, Path and Max-Age", () => {
  const c = serializeCookie("sod", "tok", { maxAge: 3600, httpOnly: true, sameSite: "Lax", path: "/" });
  assert.equal(c, "sod=tok; Max-Age=3600; Path=/; HttpOnly; SameSite=Lax");
});

test("isLoopback recognizes IPv4 and IPv6 loopback only", () => {
  assert.equal(isLoopback({ socket: { remoteAddress: "127.0.0.1" } }), true);
  assert.equal(isLoopback({ socket: { remoteAddress: "::1" } }), true);
  assert.equal(isLoopback({ socket: { remoteAddress: "::ffff:127.0.0.1" } }), true);
  assert.equal(isLoopback({ socket: { remoteAddress: "192.168.1.20" } }), false);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test test/store.test.js test/http.test.js`
Expected: FAIL, cannot find module `../src/lib/store.js`

- [ ] **Step 4: Implement paths, http, store**

`src/lib/paths.js`:
```js
import { homedir } from "node:os";
import { join } from "node:path";

export function dashboardHome() {
  return process.env.SHOPOS_DASHBOARD_HOME || join(homedir(), ".shopos", "dashboard");
}

export function vaultDashboardDir(vaultPath) {
  return join(vaultPath, "Dashboard");
}
```

`src/lib/store.js`:
```js
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export class JsonStore {
  constructor(filePath, defaults) {
    this.filePath = filePath;
    this.defaults = defaults;
  }
  load() {
    if (!existsSync(this.filePath)) return structuredClone(this.defaults);
    try {
      return JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch {
      return structuredClone(this.defaults);
    }
  }
  save(obj) {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + ".tmp";
    writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
    renameSync(tmp, this.filePath);
  }
}
```

`src/lib/http.js`:
```js
import { readFileSync, existsSync } from "node:fs";
import { extname } from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".svg": "image/svg+xml", ".webp": "image/webp", ".pdf": "application/pdf",
  ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8",
};

export function mimeFor(path) {
  return MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
}

export async function readJsonBody(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on("data", (c) => {
      total += c.length;
      if (total > maxBytes) { req.destroy(); reject(new Error("Body too large")); }
      chunks.push(c);
    });
    req.on("end", () => {
      try { const t = Buffer.concat(chunks).toString("utf8"); resolve(t ? JSON.parse(t) : {}); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

export function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

export function sendJson(res, status, obj, extraHeaders = {}) {
  send(res, status, { "content-type": "application/json; charset=utf-8", ...extraHeaders }, JSON.stringify(obj));
}

export function serveStatic(res, absPath) {
  if (!existsSync(absPath)) return send(res, 404, { "content-type": "text/plain" }, "Not found");
  res.writeHead(200, { "content-type": mimeFor(absPath) });
  res.end(readFileSync(absPath));
}

export function parseCookies(req) {
  const header = req.headers?.cookie;
  if (!header) return {};
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function serializeCookie(name, value, { maxAge, httpOnly = true, sameSite = "Lax", path = "/" } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  parts.push(`Path=${path}`);
  if (httpOnly) parts.push("HttpOnly");
  parts.push(`SameSite=${sameSite}`);
  return parts.join("; ");
}

export function isLoopback(req) {
  const a = req.socket?.remoteAddress ?? "";
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}
```

Copy `Projects/shop-os-chat/src/license.js` to `src/license.js` and `Projects/shop-os-chat/test/license.test.js` to `test/license.test.js`. In both, replace the string "Shop OS Chat" with "Shop OS Dashboard".

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: all tests in store, http, license PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold shop-os-dashboard with license gate, http helpers, json store

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Users module

**Files:**
- Create: `src/users.js`
- Test: `test/users.test.js`

**Interfaces:**
- Produces: `ROLES = ["owner","staff"]`, `DEFAULT_STAFF_FOLDERS = ["Projects","Resources","Processes"]`, `MIN_PASSWORD_LENGTH = 10`, `LOCKOUT_THRESHOLD = 5`, `LOCKOUT_MS`
- Produces: `hashPassword(pw) -> Promise<string>` (format `scrypt$<saltB64>$<hashB64>`), `verifyPassword(pw, stored) -> Promise<boolean>`
- Produces: `class UserStore { constructor(filePath); list(); get(id); getWithHash(id); findByUsername(username); create({username, displayName, password, role, switches}); update(id, patch); setPassword(id, pw); deactivate(id); reactivate(id); count(); recordFailedLogin(id); clearFailedLogins(id) }`
- User record: `{ id, username, displayName, role, active, switches: { folders: string[], teamFolder: string|null, assetsView: boolean, artifactsShared: boolean }, passwordHash, failedLogins, lockedUntil, createdAt, updatedAt }`. `list()` and `get()` strip `passwordHash`; `findByUsername()` and `getWithHash()` include it.
- Errors are `Error` with `.code` in `USERNAME_TAKEN`, `INVALID_USERNAME`, `INVALID_ROLE`, `LAST_OWNER`, `NOT_FOUND`, `WEAK_PASSWORD`

- [ ] **Step 1: Write failing tests**

`test/users.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UserStore, hashPassword, verifyPassword, DEFAULT_STAFF_FOLDERS } from "../src/users.js";

function tmpStore() {
  const dir = mkdtempSync(join(tmpdir(), "sod-users-"));
  return { store: new UserStore(join(dir, "users.json")), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
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

test("failed login counter locks after 5 and clears", async () => {
  const { store, cleanup } = tmpStore();
  const u = await store.create({ username: "mm", displayName: "M", password: "longenough1", role: "staff" });
  for (let i = 0; i < 5; i++) store.recordFailedLogin(u.id);
  assert.ok(store.get(u.id).lockedUntil > Date.now());
  store.clearFailedLogins(u.id);
  assert.equal(store.get(u.id).failedLogins, 0);
  assert.equal(store.get(u.id).lockedUntil, null);
  cleanup();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/users.test.js`
Expected: FAIL, cannot find module `../src/users.js`

- [ ] **Step 3: Implement users.js**

```js
import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { JsonStore } from "./lib/store.js";

const scrypt = promisify(scryptCb);
export const ROLES = Object.freeze(["owner", "staff"]);
export const DEFAULT_STAFF_FOLDERS = Object.freeze(["Projects", "Resources", "Processes"]);
export const MIN_PASSWORD_LENGTH = 10;
export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };

function err(code, message) { const e = new Error(message); e.code = code; return e; }

export async function hashPassword(password) {
  const salt = randomBytes(32);
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem });
  return `scrypt$${salt.toString("base64")}$${Buffer.from(key).toString("base64")}`;
}

export async function verifyPassword(password, stored) {
  const [algo, saltB64, hashB64] = String(stored ?? "").split("$");
  if (algo !== "scrypt" || !saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const key = Buffer.from(await scrypt(password, salt, expected.length, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem }));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

function defaultSwitches(role) {
  if (role === "owner") return { folders: [], teamFolder: null, assetsView: true, artifactsShared: true };
  return { folders: [...DEFAULT_STAFF_FOLDERS], teamFolder: null, assetsView: false, artifactsShared: true };
}

function publicView(u) {
  const { passwordHash, ...rest } = u;
  return rest;
}

export class UserStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.store = new JsonStore(filePath, { users: [] });
  }
  _all() { return this.store.load().users; }
  _save(users) { this.store.save({ users }); }
  _find(users, id) {
    const u = users.find((x) => x.id === id);
    if (!u) throw err("NOT_FOUND", "User not found");
    return u;
  }

  count() { return this._all().length; }
  list() { return this._all().map(publicView); }
  get(id) { const u = this._all().find((x) => x.id === id); return u ? publicView(u) : null; }
  getWithHash(id) { return this._all().find((x) => x.id === id) ?? null; }
  findByUsername(username) {
    const n = String(username ?? "").trim().toLowerCase();
    return this._all().find((x) => x.username.toLowerCase() === n) ?? null;
  }

  async create({ username, displayName, password, role, switches = {} }) {
    if (!ROLES.includes(role)) throw err("INVALID_ROLE", `Role must be one of ${ROLES.join(", ")}`);
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) throw err("WEAK_PASSWORD", `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    const uname = String(username ?? "").trim();
    if (!/^[A-Za-z0-9._-]{2,32}$/.test(uname)) throw err("INVALID_USERNAME", "Username: 2-32 letters, numbers, dot, dash, underscore");
    if (this.findByUsername(uname)) throw err("USERNAME_TAKEN", "That username is already in use");
    const now = Date.now();
    const user = {
      id: randomUUID(), username: uname, displayName: String(displayName ?? uname).trim() || uname,
      role, active: true, switches: { ...defaultSwitches(role), ...switches },
      passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: null, createdAt: now, updatedAt: now,
    };
    const users = this._all(); users.push(user); this._save(users);
    return publicView(user);
  }

  update(id, patch) {
    const users = this._all(); const u = this._find(users, id);
    if (patch.displayName !== undefined) u.displayName = String(patch.displayName).trim() || u.displayName;
    if (patch.role !== undefined) {
      if (!ROLES.includes(patch.role)) throw err("INVALID_ROLE", "Invalid role");
      if (u.role === "owner" && patch.role !== "owner") this._assertNotLastOwner(users, u);
      u.role = patch.role;
    }
    if (patch.switches) u.switches = { ...u.switches, ...patch.switches };
    u.updatedAt = Date.now(); this._save(users); return publicView(u);
  }

  async setPassword(id, password) {
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) throw err("WEAK_PASSWORD", `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    const users = this._all(); const u = this._find(users, id);
    u.passwordHash = await hashPassword(password); u.failedLogins = 0; u.lockedUntil = null; u.updatedAt = Date.now();
    this._save(users);
  }

  _assertNotLastOwner(users, u) {
    const others = users.filter((x) => x.id !== u.id && x.role === "owner" && x.active);
    if (others.length === 0) throw err("LAST_OWNER", "At least one active owner must remain");
  }
  deactivate(id) {
    const users = this._all(); const u = this._find(users, id);
    if (u.role === "owner" && u.active) this._assertNotLastOwner(users, u);
    u.active = false; u.updatedAt = Date.now(); this._save(users); return publicView(u);
  }
  reactivate(id) {
    const users = this._all(); const u = this._find(users, id);
    u.active = true; u.updatedAt = Date.now(); this._save(users); return publicView(u);
  }
  recordFailedLogin(id) {
    const users = this._all(); const u = this._find(users, id);
    u.failedLogins = (u.failedLogins ?? 0) + 1;
    if (u.failedLogins >= LOCKOUT_THRESHOLD) u.lockedUntil = Date.now() + LOCKOUT_MS;
    this._save(users);
  }
  clearFailedLogins(id) {
    const users = this._all(); const u = this._find(users, id);
    u.failedLogins = 0; u.lockedUntil = null; this._save(users);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/users.test.js`
Expected: PASS. scrypt at N=2^15 takes about 50 ms per hash, so the file finishes in a few seconds.

- [ ] **Step 5: Commit**

```bash
git add src/users.js test/users.test.js
git commit -m "feat: user store with scrypt passwords, roles, switches, lockout counter

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Audit log and auth (sessions, lockout, guards)

**Files:**
- Create: `src/audit.js`, `src/auth.js`
- Test: `test/audit.test.js`, `test/auth.test.js`

**Interfaces:**
- Consumes: `UserStore`, `verifyPassword` from Task 2; `parseCookies`, `serializeCookie`, `isLoopback` from Task 1
- Produces: `class Audit { constructor(filePath); log(event, fields) }` writing one JSON line `{ts, event, ...fields}`; `readAll(filePath) -> object[]` for tests and the activity widget
- Produces: `COOKIE_NAME = "sod_session"`, `SESSION_TTL_MS = 12h`, `REMEMBER_TTL_MS = 30d`
- Produces: `class Auth { constructor({ users, sessionsPath, audit }); async login({username, password, remember, ip}) -> {ok:true, token, maxAgeSec, user} | {ok:false, reason: "invalid"|"locked"|"inactive"}; logout(token); userForRequest(req) -> user|null (re-reads the user record; null if session expired, user missing, or inactive); issueCookie(token, maxAgeSec) -> string; clearCookie() -> string; gc() }`
- Produces: guard helpers `requireUser(req, res, auth) -> user|null` (sends 401 JSON when null), `requireOwner(req, res, auth) -> user|null` (401 when anonymous, 403 when staff), `sameOriginOk(req) -> boolean` (true when `Origin` or `Referer` host equals request `Host`; false when both headers are absent on a POST)

- [ ] **Step 1: Write failing tests**

`test/audit.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Audit, readAll } from "../src/audit.js";

test("Audit appends JSON lines with timestamp and reads them back", () => {
  const dir = mkdtempSync(join(tmpdir(), "sod-audit-"));
  const p = join(dir, "activity.jsonl");
  const a = new Audit(p);
  a.log("login", { userId: "u1", username: "glenn" });
  a.log("note.view", { userId: "u1", path: "Projects/Acme.md" });
  const rows = readAll(p);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].event, "login");
  assert.equal(typeof rows[0].ts, "string");
  assert.equal(rows[1].path, "Projects/Acme.md");
  rmSync(dir, { recursive: true, force: true });
});
```

`test/auth.test.js`:
```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/audit.test.js test/auth.test.js`
Expected: FAIL, cannot find module

- [ ] **Step 3: Implement audit.js**

```js
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export class Audit {
  constructor(filePath) { this.filePath = filePath; }
  log(event, fields = {}) {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      appendFileSync(this.filePath, JSON.stringify({ ts: new Date().toISOString(), event, ...fields }) + "\n", "utf8");
    } catch (e) {
      console.error("[audit] write failed", e.message);
    }
  }
}

export function readAll(filePath) {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
```

- [ ] **Step 4: Implement auth.js**

```js
import { randomBytes } from "node:crypto";
import { JsonStore } from "./lib/store.js";
import { parseCookies, serializeCookie, sendJson } from "./lib/http.js";
import { verifyPassword } from "./users.js";

export const COOKIE_NAME = "sod_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class Auth {
  constructor({ users, sessionsPath, audit }) {
    this.users = users;
    this.audit = audit;
    this.store = new JsonStore(sessionsPath, { sessions: {} });
  }
  _load() { return this.store.load().sessions; }
  _save(sessions) { this.store.save({ sessions }); }

  async login({ username, password, remember = false, ip = "" }) {
    const record = this.users.findByUsername(username);
    if (!record) {
      // Burn comparable time so a missing username is not distinguishable by latency.
      await verifyPassword(password ?? "", "scrypt$AAAA$AAAA");
      this.audit.log("login.failed", { username: String(username ?? ""), ip, reason: "unknown-user" });
      return { ok: false, reason: "invalid" };
    }
    if (record.lockedUntil && record.lockedUntil > Date.now()) {
      this.audit.log("login.locked", { userId: record.id, username: record.username, ip });
      return { ok: false, reason: "locked" };
    }
    if (!record.active) {
      this.audit.log("login.failed", { userId: record.id, username: record.username, ip, reason: "inactive" });
      return { ok: false, reason: "inactive" };
    }
    const good = await verifyPassword(password ?? "", record.passwordHash);
    if (!good) {
      this.users.recordFailedLogin(record.id);
      const after = this.users.get(record.id);
      this.audit.log(after.lockedUntil ? "login.lockout" : "login.failed", { userId: record.id, username: record.username, ip, reason: "bad-password" });
      return { ok: false, reason: "invalid" };
    }
    this.users.clearFailedLogins(record.id);
    const token = randomBytes(32).toString("base64url");
    const ttl = remember ? REMEMBER_TTL_MS : SESSION_TTL_MS;
    const sessions = this._load();
    sessions[token] = { userId: record.id, createdAt: Date.now(), expiresAt: Date.now() + ttl, remember: !!remember, ip };
    this._save(sessions);
    this.audit.log("login", { userId: record.id, username: record.username, ip, remember: !!remember });
    return { ok: true, token, maxAgeSec: Math.floor(ttl / 1000), user: this.users.get(record.id) };
  }

  logout(token) {
    if (!token) return;
    const sessions = this._load();
    const s = sessions[token];
    delete sessions[token];
    this._save(sessions);
    if (s) this.audit.log("logout", { userId: s.userId });
  }

  tokenFor(req) { return parseCookies(req)[COOKIE_NAME] ?? null; }

  userForRequest(req) {
    const token = this.tokenFor(req);
    if (!token) return null;
    const s = this._load()[token];
    if (!s || s.expiresAt < Date.now()) return null;
    const user = this.users.get(s.userId);
    if (!user || !user.active) return null;
    return user;
  }

  issueCookie(token, maxAgeSec) { return serializeCookie(COOKIE_NAME, token, { maxAge: maxAgeSec, httpOnly: true, sameSite: "Lax", path: "/" }); }
  clearCookie() { return serializeCookie(COOKIE_NAME, "", { maxAge: 0, httpOnly: true, sameSite: "Lax", path: "/" }); }

  gc() {
    const sessions = this._load();
    const now = Date.now();
    let removed = 0;
    for (const [t, s] of Object.entries(sessions)) if (s.expiresAt < now) { delete sessions[t]; removed++; }
    if (removed) this._save(sessions);
    return removed;
  }
}

export function requireUser(req, res, auth) {
  const user = auth.userForRequest(req);
  if (!user) { sendJson(res, 401, { error: "Sign in required" }); return null; }
  return user;
}

export function requireOwner(req, res, auth) {
  const user = auth.userForRequest(req);
  if (!user) { sendJson(res, 401, { error: "Sign in required" }); return null; }
  if (user.role !== "owner") { sendJson(res, 403, { error: "Owner only" }); return null; }
  return user;
}

export function sameOriginOk(req) {
  const host = req.headers?.host;
  const src = req.headers?.origin || req.headers?.referer;
  if (!host || !src) return false;
  try { return new URL(src).host === host; } catch { return false; }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/audit.test.js test/auth.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/audit.js src/auth.js test/audit.test.js test/auth.test.js
git commit -m "feat: audit log and cookie-session auth with lockout and role guards

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Folder scope and the fixture vault

**Files:**
- Create: `src/scope.js`
- Create: `test/fixtures/vault/` (files listed below)
- Test: `test/scope.test.js`

**Interfaces:**
- Consumes: user record shape from Task 2
- Produces: `HIDDEN_DIRS = [".claude",".obsidian",".git",".shopos","node_modules",".trash"]`
- Produces: `allowedRoots(vaultPath, user) -> string[]` absolute directories the user may see. Owner: `[vaultPath]`. Staff: each of `switches.folders` that exists under the vault, plus `switches.teamFolder` if set.
- Produces: `isPathAllowed(vaultPath, user, candidatePath) -> boolean`. Resolves the candidate with `realpathSync` when it exists, else `path.resolve`. False if the path is outside every allowed root, or any path segment is in `HIDDEN_DIRS`.
- Produces: `toVaultRelative(vaultPath, absPath) -> string` with forward slashes

- [ ] **Step 1: Create the fixture vault**

```
test/fixtures/vault/
  CLAUDE.md                       "# Vault\nRouting doc."
  Context/organization.md         frontmatter type: context, then "# Acme Cabinets\n\nWe build cabinets in Boise. Owner is [[Glenn Chua]]."
  Context/operator.md             frontmatter "owner: Glenn Chua", then "# Glenn Chua"
  Projects/Acme Kitchen.md        frontmatter type: project, tags: [kitchen, acme]; body: "# Acme Kitchen\n\nCustomer: [[Acme Cabinets|Acme]]. See [[Pricing Sheet#Countertops]] and ![[layout.png]].\n\n> [!note] Deposit received\n> 50% on 2026-08-01.\n\n- [x] Measure\n- [ ] Order doors\n\nStatus is ==on track== #kitchen"
  Projects/layout.png             any 1x1 PNG (67 bytes)
  Resources/Pricing Sheet.md      "# Pricing Sheet\n\n## Countertops\nQuartz $85/sqft.\n\n## Doors\nShaker $42."
  Processes/Install Checklist.md  "# Install Checklist\n\n1. Level cabinets\n2. Secure to studs"
  Intelligence/competitors/Big Box.md   "# Big Box\n\nUndercuts on price."
  Daily/2026-09-04.md             "# 2026-09-04\n\nBriefing: call [[Acme Cabinets]]."
  Team/acme/Profiles/marco/Marco.md     "# Marco\n\nInstaller."
  Chats/CLAUDE.md                 copy of the CHATS_CLAUDE_MD text from Shop OS Chat transcript.js
  .obsidian/app.json              "{}"
  .claude/settings.json           "{}"
```

- [ ] **Step 2: Write failing tests**

`test/scope.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { allowedRoots, isPathAllowed, toVaultRelative, HIDDEN_DIRS } from "../src/scope.js";

const VAULT = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "vault");
const owner = { role: "owner", switches: { folders: [], teamFolder: null } };
const staff = { role: "staff", switches: { folders: ["Projects", "Resources", "Processes"], teamFolder: "Team/acme/Profiles/marco" } };

test("owner sees the whole vault", () => {
  assert.deepEqual(allowedRoots(VAULT, owner), [VAULT]);
  assert.equal(isPathAllowed(VAULT, owner, join(VAULT, "Intelligence", "competitors", "Big Box.md")), true);
});

test("staff sees only switched folders and their team folder", () => {
  const roots = allowedRoots(VAULT, staff);
  assert.equal(roots.length, 4);
  assert.equal(isPathAllowed(VAULT, staff, join(VAULT, "Projects", "Acme Kitchen.md")), true);
  assert.equal(isPathAllowed(VAULT, staff, join(VAULT, "Team", "acme", "Profiles", "marco", "Marco.md")), true);
  assert.equal(isPathAllowed(VAULT, staff, join(VAULT, "Intelligence", "competitors", "Big Box.md")), false);
  assert.equal(isPathAllowed(VAULT, staff, join(VAULT, "Context", "organization.md")), false);
  assert.equal(isPathAllowed(VAULT, staff, join(VAULT, "Daily", "2026-09-04.md")), false);
});

test("traversal and hidden dirs are refused for everyone", () => {
  assert.equal(isPathAllowed(VAULT, staff, join(VAULT, "Projects", "..", "Context", "operator.md")), false);
  assert.equal(isPathAllowed(VAULT, owner, join(VAULT, "..", "..", "etc", "passwd")), false);
  assert.equal(isPathAllowed(VAULT, owner, join(VAULT, ".obsidian", "app.json")), false);
  assert.equal(isPathAllowed(VAULT, owner, join(VAULT, ".claude", "settings.json")), false);
  assert.ok(HIDDEN_DIRS.includes(".obsidian"));
});

test("switched folder that does not exist is ignored, not an error", () => {
  const u = { role: "staff", switches: { folders: ["Projects", "Nope"], teamFolder: null } };
  assert.deepEqual(allowedRoots(VAULT, u), [join(VAULT, "Projects")]);
});

test("toVaultRelative uses forward slashes", () => {
  assert.equal(toVaultRelative(VAULT, join(VAULT, "Projects", "Acme Kitchen.md")), "Projects/Acme Kitchen.md");
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test test/scope.test.js`
Expected: FAIL, cannot find module `../src/scope.js`

- [ ] **Step 4: Implement scope.js**

```js
import { existsSync, realpathSync, statSync } from "node:fs";
import { resolve, relative, sep, isAbsolute } from "node:path";

export const HIDDEN_DIRS = Object.freeze([".claude", ".obsidian", ".git", ".shopos", "node_modules", ".trash"]);

function real(p) {
  try { return realpathSync(p); } catch { return resolve(p); }
}

function isDir(p) { try { return statSync(p).isDirectory(); } catch { return false; } }

export function allowedRoots(vaultPath, user) {
  const root = real(vaultPath);
  if (user.role === "owner") return [root];
  const out = [];
  const wanted = [...(user.switches?.folders ?? [])];
  if (user.switches?.teamFolder) wanted.push(user.switches.teamFolder);
  for (const f of wanted) {
    const abs = real(resolve(root, f));
    if (!insideOf(root, abs)) continue;
    if (isDir(abs) && !out.includes(abs)) out.push(abs);
  }
  return out;
}

function insideOf(root, abs) {
  const rel = relative(root, abs);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function isPathAllowed(vaultPath, user, candidatePath) {
  const root = real(vaultPath);
  const abs = real(resolve(candidatePath));
  if (!insideOf(root, abs)) return false;
  const segments = relative(root, abs).split(sep).filter(Boolean);
  if (segments.some((s) => HIDDEN_DIRS.includes(s))) return false;
  return allowedRoots(vaultPath, user).some((r) => insideOf(r, abs));
}

export function toVaultRelative(vaultPath, absPath) {
  return relative(real(vaultPath), real(absPath)).split(sep).join("/");
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/scope.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/scope.js test/scope.test.js test/fixtures
git commit -m "feat: folder scope resolution shared by notes and chat, with fixture vault

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Note renderer (frontmatter, wikilinks, callouts, tags, highlights)

**Files:**
- Create: `src/notes/render.js`
- Test: `test/render.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure functions)
- Produces: `splitFrontmatter(md) -> { frontmatter: Record<string,string>|null, body: string }` (simple `key: value` lines only; arrays stay as their raw string like `[kitchen, acme]`)
- Produces: `extractWikilinks(md) -> Array<{ target: string, alias: string|null, heading: string|null, embed: boolean }>` (target has heading and alias stripped; `![[x]]` sets embed)
- Produces: `renderNote(md, { resolveLink }) -> { html: string, frontmatter, links }` where `resolveLink(target) -> { href: string, exists: boolean }` is supplied by the caller. Unresolved links render as `<span class="wikilink missing">text</span>`. Resolved links render as `<a class="wikilink" href="...">text</a>`. Embeds of images render `<img class="embed" src="href" alt="target">`; embeds of notes render the same as links.
- Produces: `slugHeading(text) -> string` used for `#Heading` anchors (lowercase, spaces to dashes, strip non-word chars)

- [ ] **Step 1: Write failing tests**

`test/render.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitFrontmatter, extractWikilinks, renderNote, slugHeading } from "../src/notes/render.js";

const NOTE = `---
type: project
tags: [kitchen, acme]
---
# Acme Kitchen

Customer: [[Acme Cabinets|Acme]]. See [[Pricing Sheet#Countertops]] and ![[layout.png]].

> [!note] Deposit received
> 50% on 2026-08-01.

- [x] Measure
- [ ] Order doors

Status is ==on track== #kitchen %%private%%
`;

const resolveLink = (target) => {
  const known = { "Acme Cabinets": "/notes/view?path=Context%2Forganization.md", "Pricing Sheet": "/notes/view?path=Resources%2FPricing%20Sheet.md", "layout.png": "/notes/raw?path=Projects%2Flayout.png" };
  return known[target] ? { href: known[target], exists: true } : { href: "", exists: false };
};

test("splitFrontmatter separates keys and body", () => {
  const { frontmatter, body } = splitFrontmatter(NOTE);
  assert.equal(frontmatter.type, "project");
  assert.equal(frontmatter.tags, "[kitchen, acme]");
  assert.ok(body.startsWith("# Acme Kitchen"));
  assert.deepEqual(splitFrontmatter("# No fm").frontmatter, null);
});

test("extractWikilinks handles alias, heading, embed", () => {
  const links = extractWikilinks(NOTE);
  assert.deepEqual(links, [
    { target: "Acme Cabinets", alias: "Acme", heading: null, embed: false },
    { target: "Pricing Sheet", alias: null, heading: "Countertops", embed: false },
    { target: "layout.png", alias: null, heading: null, embed: true },
  ]);
});

test("renderNote produces clickable wikilinks, heading anchors, image embeds", () => {
  const { html } = renderNote(NOTE, { resolveLink });
  assert.match(html, /<a class="wikilink" href="\/notes\/view\?path=Context%2Forganization\.md">Acme<\/a>/);
  assert.match(html, /<a class="wikilink" href="\/notes\/view\?path=Resources%2FPricing%20Sheet\.md#countertops">Pricing Sheet › Countertops<\/a>/);
  assert.match(html, /<img class="embed" src="\/notes\/raw\?path=Projects%2Flayout\.png" alt="layout.png">/);
});

test("renderNote renders callouts, tags, highlights, checkboxes; strips comments and frontmatter", () => {
  const { html } = renderNote(NOTE, { resolveLink });
  assert.match(html, /<div class="callout callout-note"><div class="callout-title">Deposit received<\/div>/);
  assert.match(html, /<a class="tag" href="\/notes\/search\?q=%23kitchen">#kitchen<\/a>/);
  assert.match(html, /<mark>on track<\/mark>/);
  assert.match(html, /<input[^>]*type="checkbox"[^>]*checked/);
  assert.doesNotMatch(html, /private/);
  assert.doesNotMatch(html, /type: project/);
});

test("unresolved wikilink renders as missing span", () => {
  const { html } = renderNote("See [[Nowhere]]", { resolveLink });
  assert.match(html, /<span class="wikilink missing">Nowhere<\/span>/);
});

test("slugHeading", () => {
  assert.equal(slugHeading("Countertops"), "countertops");
  assert.equal(slugHeading("Q3 Plan: Budget & Timing"), "q3-plan-budget-timing");
});

test("renderNote escapes raw HTML in the note", () => {
  const { html } = renderNote("<script>alert(1)</script> hi", { resolveLink });
  assert.doesNotMatch(html, /<script>/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/render.test.js`
Expected: FAIL, cannot find module `../src/notes/render.js`

- [ ] **Step 3: Implement render.js**

```js
import { Marked } from "marked";

const marked = new Marked({ gfm: true, breaks: false });

export function slugHeading(text) {
  return String(text).toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-");
}

export function splitFrontmatter(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { frontmatter: null, body: md };
  const frontmatter = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) frontmatter[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { frontmatter, body: md.slice(m[0].length) };
}

const WIKI_RE = /(!?)\[\[([^\]\n]+?)\]\]/g;

function parseInner(inner) {
  let [target, alias] = inner.split("|");
  alias = alias?.trim() || null;
  let heading = null;
  const hash = target.indexOf("#");
  if (hash >= 0) { heading = target.slice(hash + 1).trim() || null; target = target.slice(0, hash); }
  return { target: target.trim(), alias, heading };
}

export function extractWikilinks(md) {
  const out = [];
  const { body } = splitFrontmatter(md);
  for (const m of body.matchAll(WIKI_RE)) {
    const { target, alias, heading } = parseInner(m[2]);
    out.push({ target, alias, heading, embed: m[1] === "!" });
  }
  return out;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const IMG_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;

function preprocess(body, resolveLink, links) {
  // 1. strip %%comments%%
  let s = body.replace(/%%[\s\S]*?%%/g, "");
  // 2. wikilinks -> placeholder tokens (so marked does not mangle them)
  const tokens = [];
  s = s.replace(WIKI_RE, (_, bang, inner) => {
    const { target, alias, heading } = parseInner(inner);
    const r = resolveLink(target);
    const text = alias ?? (heading ? `${target} › ${heading}` : target);
    let html;
    if (bang === "!" && r.exists && IMG_EXT.test(target)) html = `<img class="embed" src="${esc(r.href)}" alt="${esc(target)}">`;
    else if (r.exists) html = `<a class="wikilink" href="${esc(r.href)}${heading ? "#" + slugHeading(heading) : ""}">${esc(text)}</a>`;
    else html = `<span class="wikilink missing">${esc(text)}</span>`;
    links.push({ target, alias, heading, embed: bang === "!" });
    tokens.push(html);
    return ` WL${tokens.length - 1} `;
  });
  // 3. highlights
  s = s.replace(/==([^=\n]+)==/g, "<mark>$1</mark>");
  // 4. tags (not inside URLs or headings)
  s = s.replace(/(^|\s)#([A-Za-z][\w/-]*)/g, (_, pre, tag) => `${pre}<a class="tag" href="/notes/search?q=${encodeURIComponent("#" + tag)}">#${esc(tag)}</a>`);
  // 5. callouts: "> [!type] Title" followed by "> body" lines
  s = s.replace(/^> \[!(\w+)\]([^\n]*)\n((?:>.*(?:\n|$))*)/gm, (_, type, title, rest) => {
    const bodyMd = rest.split("\n").map((l) => l.replace(/^>\s?/, "")).join("\n").trim();
    const inner = marked.parse(bodyMd);
    return `<div class="callout callout-${esc(type.toLowerCase())}"><div class="callout-title">${esc(title.trim() || type)}</div><div class="callout-body">${inner}</div></div>\n`;
  });
  return { s, tokens };
}

export function renderNote(md, { resolveLink }) {
  const { frontmatter, body } = splitFrontmatter(md);
  const links = [];
  // Escape raw HTML from the note before markdown so scripts never render.
  const safe = body.replace(/<(?!\/?(mark|div|a|img)\b)/g, "&lt;");
  const { s, tokens } = preprocess(safe, resolveLink, links);
  let html = marked.parse(s);
  html = html.replace(/ WL(\d+) /g, (_, i) => tokens[Number(i)]);
  return { html, frontmatter, links };
}
```

Note for the implementer: the raw-HTML escape at the top of `renderNote` runs before `preprocess`, so the only HTML that survives is what `preprocess` itself emits. Keep that order.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/render.test.js`
Expected: PASS. If the callout regex misses because the fixture uses `\r\n`, normalize line endings with `md.replace(/\r\n/g, "\n")` at the top of `renderNote`.

- [ ] **Step 5: Commit**

```bash
git add src/notes/render.js test/render.test.js
git commit -m "feat: note renderer with wikilinks, callouts, tags, highlights, frontmatter strip

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Link index, tree, search

**Files:**
- Create: `src/notes/index.js`, `src/notes/tree.js`, `src/notes/search.js`
- Test: `test/notes-index.test.js`, `test/notes-tree.test.js`, `test/notes-search.test.js`

**Interfaces:**
- Consumes: `extractWikilinks`, `splitFrontmatter` from Task 5; `HIDDEN_DIRS`, `allowedRoots`, `isPathAllowed`, `toVaultRelative` from Task 4
- Produces: `class LinkIndex { constructor(vaultPath); build(); resolve(target) -> string|null (vault-relative path); backlinks(relPath) -> string[]; notes() -> Array<{ path, title, mtime }>; watch(onChange?) ; close() }`. Resolution is by basename without extension, case-insensitive, nearest-path tiebreak against the referring note is not needed in v1; ties resolve to the shortest path.
- Produces: `buildTree(vaultPath, user) -> Array<{ name, path, type: "dir"|"file", children? }>` limited to allowed roots, hidden dirs excluded, files sorted folders-first then alphabetical
- Produces: `searchNotes(vaultPath, user, index, q, { limit = 30 }) -> Array<{ path, title, score, snippet }>`. Title match scores 100 (exact) or 60 (contains); body match scores 10 per hit up to 50; `#tag` queries match the literal tag text. Only files within `isPathAllowed`.

- [ ] **Step 1: Write failing tests**

`test/notes-index.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { LinkIndex } from "../src/notes/index.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "vault");

test("build resolves basenames and computes backlinks", () => {
  const idx = new LinkIndex(FIX);
  idx.build();
  assert.equal(idx.resolve("Pricing Sheet"), "Resources/Pricing Sheet.md");
  assert.equal(idx.resolve("pricing sheet"), "Resources/Pricing Sheet.md");
  assert.equal(idx.resolve("layout.png"), "Projects/layout.png");
  assert.equal(idx.resolve("Nowhere"), null);
  assert.deepEqual(idx.backlinks("Context/organization.md").sort(), ["Daily/2026-09-04.md", "Projects/Acme Kitchen.md"]);
  assert.ok(idx.notes().some((n) => n.path === "Projects/Acme Kitchen.md" && n.title === "Acme Kitchen"));
  assert.ok(!idx.notes().some((n) => n.path.startsWith(".obsidian")), "hidden dirs are not indexed");
});

test("watch picks up a new note within the debounce window", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sod-idx-"));
  cpSync(FIX, dir, { recursive: true });
  const idx = new LinkIndex(dir);
  idx.build();
  let changes = 0;
  idx.watch(() => changes++);
  writeFileSync(join(dir, "Projects", "New Job.md"), "# New Job\n\nLinks [[Pricing Sheet]].");
  await sleep(1500);
  assert.equal(idx.resolve("New Job"), "Projects/New Job.md");
  assert.ok(changes >= 1);
  idx.close();
  rmSync(dir, { recursive: true, force: true });
});
```

`test/notes-tree.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTree } from "../src/notes/tree.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "vault");
const owner = { role: "owner", switches: { folders: [], teamFolder: null } };
const staff = { role: "staff", switches: { folders: ["Projects", "Resources"], teamFolder: null } };

test("owner tree shows all visible top-level entries, hidden dirs excluded, dirs first", () => {
  const tree = buildTree(FIX, owner);
  const names = tree.map((n) => n.name);
  assert.ok(names.includes("Context") && names.includes("Projects") && names.includes("CLAUDE.md"));
  assert.ok(!names.includes(".obsidian") && !names.includes(".claude"));
  const firstFileIdx = tree.findIndex((n) => n.type === "file");
  assert.ok(tree.slice(firstFileIdx).every((n) => n.type === "file"), "folders sort before files");
});

test("staff tree is limited to allowed roots and nests children", () => {
  const tree = buildTree(FIX, staff);
  assert.deepEqual(tree.map((n) => n.name), ["Projects", "Resources"]);
  const proj = tree[0];
  assert.equal(proj.type, "dir");
  assert.ok(proj.children.some((c) => c.path === "Projects/Acme Kitchen.md"));
});
```

`test/notes-search.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LinkIndex } from "../src/notes/index.js";
import { searchNotes } from "../src/notes/search.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "vault");
const owner = { role: "owner", switches: { folders: [], teamFolder: null } };
const staff = { role: "staff", switches: { folders: ["Projects"], teamFolder: null } };
const idx = new LinkIndex(FIX); idx.build();

test("title match outranks body match and returns a snippet", () => {
  const r = searchNotes(FIX, owner, idx, "pricing", {});
  assert.equal(r[0].path, "Resources/Pricing Sheet.md");
  assert.ok(r[0].score >= 60);
  const kitchen = searchNotes(FIX, owner, idx, "quartz", {});
  assert.equal(kitchen[0].path, "Resources/Pricing Sheet.md");
  assert.match(kitchen[0].snippet, /Quartz/);
});

test("search respects scope", () => {
  const r = searchNotes(FIX, staff, idx, "Big Box", {});
  assert.equal(r.length, 0);
  const r2 = searchNotes(FIX, staff, idx, "kitchen", {});
  assert.ok(r2.every((x) => x.path.startsWith("Projects/")));
});

test("tag query matches literal tag", () => {
  const r = searchNotes(FIX, owner, idx, "#kitchen", {});
  assert.equal(r[0].path, "Projects/Acme Kitchen.md");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/notes-index.test.js test/notes-tree.test.js test/notes-search.test.js`
Expected: FAIL, cannot find module

- [ ] **Step 3: Implement index.js**

```js
import { readdirSync, readFileSync, statSync, watch } from "node:fs";
import { join, relative, sep, basename, extname } from "node:path";
import { HIDDEN_DIRS } from "../scope.js";
import { extractWikilinks, splitFrontmatter } from "./render.js";

const TEXT_EXT = new Set([".md", ".txt"]);

function walk(root, dir, out) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (HIDDEN_DIRS.includes(e.name)) continue;
    const abs = join(dir, e.name);
    if (e.isDirectory()) walk(root, abs, out);
    else if (e.isFile()) out.push(abs);
  }
}

function titleOf(abs, md) {
  const { body } = splitFrontmatter(md);
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : basename(abs, extname(abs));
}

export class LinkIndex {
  constructor(vaultPath) {
    this.vaultPath = vaultPath;
    this.byBase = new Map();      // lowercased basename (with and without ext) -> [relPath]
    this.outgoing = new Map();    // relPath -> Set(relPath)
    this.incoming = new Map();    // relPath -> Set(relPath)
    this.meta = new Map();        // relPath -> { title, mtime }
    this.watcher = null;
    this.timer = null;
  }

  rel(abs) { return relative(this.vaultPath, abs).split(sep).join("/"); }

  build() {
    this.byBase.clear(); this.outgoing.clear(); this.incoming.clear(); this.meta.clear();
    const files = [];
    walk(this.vaultPath, this.vaultPath, files);
    const pending = [];
    for (const abs of files) {
      const rel = this.rel(abs);
      const base = basename(abs).toLowerCase();
      const noExt = basename(abs, extname(abs)).toLowerCase();
      for (const k of new Set([base, noExt])) {
        if (!this.byBase.has(k)) this.byBase.set(k, []);
        this.byBase.get(k).push(rel);
      }
      let mtime = 0; try { mtime = statSync(abs).mtimeMs; } catch {}
      if (TEXT_EXT.has(extname(abs).toLowerCase())) {
        let md = ""; try { md = readFileSync(abs, "utf8"); } catch {}
        this.meta.set(rel, { title: titleOf(abs, md), mtime });
        pending.push([rel, extractWikilinks(md)]);
      } else {
        this.meta.set(rel, { title: basename(abs), mtime });
      }
    }
    for (const list of this.byBase.values()) list.sort((a, b) => a.length - b.length);
    for (const [rel, links] of pending) {
      const targets = new Set();
      for (const l of links) { const t = this.resolve(l.target); if (t) targets.add(t); }
      this.outgoing.set(rel, targets);
      for (const t of targets) {
        if (!this.incoming.has(t)) this.incoming.set(t, new Set());
        this.incoming.get(t).add(rel);
      }
    }
  }

  resolve(target) {
    const t = String(target).trim().toLowerCase().replace(/\\/g, "/");
    // exact vault-relative path first
    for (const rel of this.meta.keys()) if (rel.toLowerCase() === t || rel.toLowerCase() === t + ".md") return rel;
    const base = t.split("/").pop();
    const list = this.byBase.get(base) ?? this.byBase.get(base + ".md");
    return list?.[0] ?? null;
  }

  backlinks(relPath) { return [...(this.incoming.get(relPath) ?? [])]; }

  notes() {
    return [...this.meta.entries()].filter(([p]) => TEXT_EXT.has(extname(p).toLowerCase())).map(([path, m]) => ({ path, ...m }));
  }

  watch(onChange) {
    try {
      this.watcher = watch(this.vaultPath, { recursive: true }, () => {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => { this.build(); onChange?.(); }, 750);
      });
      this.watcher.on("error", () => {});
    } catch (e) {
      console.error("[notes] watch unavailable, use manual rescan:", e.message);
    }
  }

  close() { clearTimeout(this.timer); this.watcher?.close(); this.watcher = null; }
}
```

- [ ] **Step 4: Implement tree.js**

```js
import { readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { HIDDEN_DIRS, allowedRoots, toVaultRelative } from "../scope.js";

function children(vaultPath, dir) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch {}
  const nodes = entries.filter((e) => !HIDDEN_DIRS.includes(e.name)).map((e) => {
    const abs = join(dir, e.name);
    const node = { name: e.name, path: toVaultRelative(vaultPath, abs), type: e.isDirectory() ? "dir" : "file" };
    if (node.type === "dir") node.children = children(vaultPath, abs);
    return node;
  });
  return nodes.sort((a, b) => (a.type !== b.type ? (a.type === "dir" ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: "base" })));
}

export function buildTree(vaultPath, user) {
  const roots = allowedRoots(vaultPath, user);
  if (user.role === "owner") return children(vaultPath, vaultPath);
  return roots.map((r) => ({ name: basename(r), path: toVaultRelative(vaultPath, r), type: "dir", children: children(vaultPath, r) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
```

- [ ] **Step 5: Implement search.js**

```js
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isPathAllowed } from "../scope.js";

function snippetAround(text, needle) {
  const i = text.toLowerCase().indexOf(needle);
  if (i < 0) return text.slice(0, 160).replace(/\s+/g, " ").trim();
  const start = Math.max(0, i - 70);
  return (start > 0 ? "…" : "") + text.slice(start, i + needle.length + 90).replace(/\s+/g, " ").trim() + "…";
}

export function searchNotes(vaultPath, user, index, q, { limit = 30 } = {}) {
  const needle = String(q ?? "").trim().toLowerCase();
  if (!needle) return [];
  const out = [];
  for (const note of index.notes()) {
    const abs = join(vaultPath, note.path);
    if (!isPathAllowed(vaultPath, user, abs)) continue;
    let score = 0;
    const title = note.title.toLowerCase();
    if (title === needle) score += 100; else if (title.includes(needle)) score += 60;
    let text = ""; try { text = readFileSync(abs, "utf8"); } catch {}
    const lower = text.toLowerCase();
    let hits = 0, pos = 0;
    while ((pos = lower.indexOf(needle, pos)) >= 0 && hits < 5) { hits++; pos += needle.length; }
    score += Math.min(50, hits * 10);
    if (score > 0) out.push({ path: note.path, title: note.title, score, snippet: snippetAround(text, needle) });
  }
  return out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test test/notes-index.test.js test/notes-tree.test.js test/notes-search.test.js`
Expected: PASS. On Windows, `fs.watch` recursive works. If the watch test is flaky on the CI machine, increase the sleep to 2500 ms rather than removing the test.

- [ ] **Step 7: Commit**

```bash
git add src/notes test/notes-*.test.js
git commit -m "feat: link index with backlinks and watcher, scoped tree and search

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Chat engine (role-scoped SDK options, turn runner, prompts, transcripts, concurrency guard)

**Files:**
- Create: `src/chat/options.js`, `src/chat/run-turn.js`, `src/chat/system-prompt.js`, `src/chat/transcript.js`, `src/chat/sessions.js`, `src/sessions-guard.js`
- Test: `test/chat-options.test.js`, `test/sessions-guard.test.js`, `test/transcript.test.js` (copied from Shop OS Chat), `test/chat-sessions.test.js` (copied from Shop OS Chat `sessions.test.js`), `test/e2e-real.test.js` (skipped unless `RUN_E2E=1`)

**Interfaces:**
- Consumes: `isPathAllowed` from Task 4; user record from Task 2; `Audit` from Task 3
- Produces: `STAFF_TOOLS = ["Read","Glob","Grep"]`
- Produces: `buildQueryOptions({ vaultPath, user, systemPrompt, claudeSessionId, audit }) -> options` for `query()`. Staff: `tools: STAFF_TOOLS`, no `allowedTools` (so every call reaches `canUseTool`), `permissionMode: "default"`, `canUseTool` denies paths outside scope. Owner: `permissionMode: "acceptEdits"`, `settingSources: ["user","project"]`, `skills: "all"`, `canUseTool` allows everything and audits. Both: `cwd: vaultPath`, `maxTurns: 20` (staff) or `60` (owner), `resume` when a session id is given.
- Produces: `runTurn({ prompt, options }) -> AsyncGenerator` of `{type:"session"|"text"|"tool_use"|"tool_result"|"done"|"error", ...}` (the Shop OS Chat generator with options injected instead of built inside)
- Produces: `buildStaffPrompt({ vaultPath, name, folders }) -> string`, `buildOwnerPrompt({ vaultPath, name }) -> string`, `readShopName(vaultPath) -> string`
- Produces: `transcriptFilename(session)`, `buildTranscript(session)`, `writeTranscript(vaultPath, session)` unchanged from Shop OS Chat, with `session.name` set to the user's `displayName`
- Produces: `class SessionStore` unchanged from Shop OS Chat except `create({ name, userId })` stores `userId`
- Produces: `class SessionsGuard { constructor({ max = 3 }); acquire(key) -> Promise<release: () => void>; position(key) -> number (0 = running, n = nth in queue); stats() -> { running, queued } }`

- [ ] **Step 1: Copy the unchanged files**

Copy from `Projects/shop-os-chat/`:
- `src/transcript.js` → `src/chat/transcript.js` (unchanged)
- `src/sessions.js` → `src/chat/sessions.js`, then change `create({ name })` to `create({ name, userId = null })` and add `userId,` to the session object
- `test/transcript.test.js` → `test/transcript.test.js`, fix the import path to `../src/chat/transcript.js`
- `test/sessions.test.js` → `test/chat-sessions.test.js`, fix the import path to `../src/chat/sessions.js`

Run: `node --test test/transcript.test.js test/chat-sessions.test.js`
Expected: PASS before writing anything new.

- [ ] **Step 2: Write failing tests for options and the guard**

`test/chat-options.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildQueryOptions, STAFF_TOOLS } from "../src/chat/options.js";

const VAULT = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "vault");
const staff = { id: "s1", username: "marco", displayName: "Marco", role: "staff", switches: { folders: ["Projects"], teamFolder: null } };
const owner = { id: "o1", username: "glenn", displayName: "Glenn", role: "owner", switches: { folders: [], teamFolder: null } };
const audit = { events: [], log(e, f) { this.events.push({ e, ...f }); } };

test("staff options restrict tools, use default permission mode, no allowedTools", () => {
  const o = buildQueryOptions({ vaultPath: VAULT, user: staff, systemPrompt: "x", claudeSessionId: null, audit });
  assert.deepEqual([...o.tools].sort(), [...STAFF_TOOLS].sort());
  assert.equal(o.allowedTools, undefined);
  assert.equal(o.permissionMode, "default");
  assert.deepEqual(o.settingSources, []);
  assert.equal(o.cwd, VAULT);
  assert.equal(o.maxTurns, 20);
  assert.equal(o.resume, undefined);
});

test("staff canUseTool allows in-scope reads and denies out-of-scope, non-whitelisted tools, and shell", async () => {
  const o = buildQueryOptions({ vaultPath: VAULT, user: staff, systemPrompt: "x", claudeSessionId: "abc", audit });
  assert.equal(o.resume, "abc");
  const ok = await o.canUseTool("Read", { file_path: join(VAULT, "Projects", "Acme Kitchen.md") }, { signal: new AbortController().signal });
  assert.equal(ok.behavior, "allow");
  const denied = await o.canUseTool("Read", { file_path: join(VAULT, "Context", "operator.md") }, {});
  assert.equal(denied.behavior, "deny");
  const glob = await o.canUseTool("Glob", { pattern: "**/*.md", path: join(VAULT, "Intelligence") }, {});
  assert.equal(glob.behavior, "deny");
  const globOk = await o.canUseTool("Glob", { pattern: "*.md" }, {});
  assert.equal(globOk.behavior, "allow", "Glob with no path defaults to cwd; scope is applied per-result by Read, so allow");
  const grep = await o.canUseTool("Grep", { pattern: "price", path: join(VAULT, "Projects") }, {});
  assert.equal(grep.behavior, "allow");
  const bash = await o.canUseTool("Bash", { command: "ls" }, {});
  assert.equal(bash.behavior, "deny");
  const rel = await o.canUseTool("Read", { file_path: "Projects/../Context/operator.md" }, {});
  assert.equal(rel.behavior, "deny");
  assert.ok(audit.events.some((x) => x.e === "chat.denied" && x.userId === "s1"));
});

test("owner options allow writes and skills", async () => {
  const o = buildQueryOptions({ vaultPath: VAULT, user: owner, systemPrompt: "x", claudeSessionId: null, audit });
  assert.equal(o.tools, undefined, "owner gets the full default tool set");
  assert.equal(o.permissionMode, "acceptEdits");
  assert.deepEqual(o.settingSources, ["user", "project"]);
  assert.equal(o.skills, "all");
  assert.equal(o.maxTurns, 60);
  const r = await o.canUseTool("Bash", { command: "ls" }, {});
  assert.equal(r.behavior, "allow");
  assert.ok(audit.events.some((x) => x.e === "chat.tool" && x.tool === "Bash" && x.userId === "o1"));
});
```

`test/sessions-guard.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionsGuard } from "../src/sessions-guard.js";

test("guard runs up to max concurrently and queues the rest in order", async () => {
  const g = new SessionsGuard({ max: 2 });
  const r1 = await g.acquire("a");
  const r2 = await g.acquire("b");
  assert.deepEqual(g.stats(), { running: 2, queued: 0 });
  let gotC = false;
  const pC = g.acquire("c").then((rel) => { gotC = true; return rel; });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(gotC, false);
  assert.equal(g.position("c"), 1);
  assert.equal(g.position("a"), 0);
  r1();
  const r3 = await pC;
  assert.equal(gotC, true);
  assert.deepEqual(g.stats(), { running: 2, queued: 0 });
  r2(); r3();
  assert.deepEqual(g.stats(), { running: 0, queued: 0 });
});

test("release is idempotent", async () => {
  const g = new SessionsGuard({ max: 1 });
  const r = await g.acquire("a");
  r(); r();
  assert.deepEqual(g.stats(), { running: 0, queued: 0 });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test test/chat-options.test.js test/sessions-guard.test.js`
Expected: FAIL, cannot find module

- [ ] **Step 4: Implement options.js**

```js
import { resolve, isAbsolute } from "node:path";
import { isPathAllowed } from "../scope.js";

export const STAFF_TOOLS = Object.freeze(["Read", "Glob", "Grep"]);

function pathFromInput(toolName, input, cwd) {
  const raw = input?.file_path ?? input?.path ?? input?.notebook_path ?? null;
  if (raw == null) return null;
  return isAbsolute(raw) ? raw : resolve(cwd, raw);
}

export function buildQueryOptions({ vaultPath, user, systemPrompt, claudeSessionId, audit }) {
  const base = { cwd: vaultPath, systemPrompt, permissionMode: "default" };
  if (claudeSessionId) base.resume = claudeSessionId;

  if (user.role === "owner") {
    return {
      ...base,
      permissionMode: "acceptEdits",
      settingSources: ["user", "project"],
      skills: "all",
      maxTurns: 60,
      canUseTool: async (toolName, input) => {
        audit?.log("chat.tool", { userId: user.id, tool: toolName, path: pathFromInput(toolName, input, vaultPath) ?? undefined });
        return { behavior: "allow", updatedInput: input };
      },
    };
  }

  return {
    ...base,
    tools: [...STAFF_TOOLS],
    settingSources: [],
    maxTurns: 20,
    canUseTool: async (toolName, input) => {
      if (!STAFF_TOOLS.includes(toolName)) {
        audit?.log("chat.denied", { userId: user.id, tool: toolName, reason: "tool-not-allowed" });
        return { behavior: "deny", message: `${toolName} is not available in this chat. Ask the owner if you need changes made.` };
      }
      const p = pathFromInput(toolName, input, vaultPath);
      if (p !== null && !isPathAllowed(vaultPath, user, p)) {
        audit?.log("chat.denied", { userId: user.id, tool: toolName, path: p, reason: "out-of-scope" });
        return { behavior: "deny", message: "That file is outside the folders you have access to. Answer from the folders you can read." };
      }
      return { behavior: "allow", updatedInput: input };
    },
  };
}
```

Why Glob with no `path` is allowed: Glob lists names under `cwd`; it cannot return file contents, and every subsequent Read is checked. Grep with no `path` searches `cwd` and returns matching lines, so it is treated like Read: when `path` is absent, deny for staff unless the user's scope includes the vault root. Add that rule:

```js
      if (toolName === "Grep" && p === null) {
        audit?.log("chat.denied", { userId: user.id, tool: toolName, reason: "grep-needs-path" });
        return { behavior: "deny", message: "Search inside one of your folders by passing its path." };
      }
```

Add a matching assertion to the staff test: `assert.equal((await o.canUseTool("Grep", { pattern: "x" }, {})).behavior, "deny");`

- [ ] **Step 5: Implement run-turn.js**

```js
import { query } from "@anthropic-ai/claude-agent-sdk";

export async function* runTurn({ prompt, options }) {
  let collected = "";
  let stats = null;
  try {
    for await (const event of query({ prompt, options })) {
      if (event.type === "system" && event.subtype === "init" && event.session_id) {
        yield { type: "session", claudeSessionId: event.session_id };
      } else if (event.type === "assistant" && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === "text" && block.text) { collected += block.text; yield { type: "text", delta: block.text }; }
          else if (block.type === "tool_use") yield { type: "tool_use", name: block.name, input: block.input };
        }
      } else if (event.type === "user" && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === "tool_result") yield { type: "tool_result", name: block.tool_name ?? "tool", output: block.content };
        }
      } else if (event.type === "result") {
        stats = { duration_ms: event.duration_ms, input_tokens: event.usage?.input_tokens, output_tokens: event.usage?.output_tokens };
      }
    }
    yield { type: "done", text: collected, stats };
  } catch (err) {
    yield { type: "error", message: err?.message ?? String(err) };
  }
}
```

- [ ] **Step 6: Implement system-prompt.js**

```js
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function safeRead(p) { if (!existsSync(p)) return null; try { return readFileSync(p, "utf8"); } catch { return null; } }
function extractH1(md) { if (!md) return null; const body = md.replace(/^---[\s\S]*?---\s*/m, ""); const m = body.match(/^#\s+(.+)$/m); return m ? m[1].trim() : null; }
function fmField(md, field) { if (!md) return null; const fm = md.match(/^---\s*([\s\S]*?)---/); if (!fm) return null; const m = fm[1].match(new RegExp(`^${field}\\s*:\\s*(.+)$`, "m")); return m ? m[1].trim() : null; }

export function readShopName(vaultPath) {
  return extractH1(safeRead(join(vaultPath, "Context", "organization.md"))) ?? "this shop";
}
function readOwnerName(vaultPath) {
  const op = safeRead(join(vaultPath, "Context", "operator.md"));
  return fmField(op, "owner") ?? extractH1(op) ?? "the shop owner";
}

export function buildStaffPrompt({ vaultPath, name, folders }) {
  const today = new Date().toISOString().slice(0, 10);
  return `You are Shop OS for ${readShopName(vaultPath)}. You are speaking with ${name}, a member of the team.

You can read files in these vault folders to answer questions: ${folders.join(", ")}. Search across those notes, summarize content, pull up job records, pricing, and process steps stored there. Files outside those folders are not available to you and attempts to read them will be refused; do not guess at their contents.

You CANNOT write, edit, modify, or delete any file. If ${name} asks you to create a note, update a record, log a call, or change anything, politely explain that you can only answer questions and direct them to ask ${readOwnerName(vaultPath)}.

Be helpful and concrete, and cite specific files. Wherever you mention a vault entity (a customer, a job, a process, a person), use [[wikilink]] form so ${name} can click through to that note.

Conversation date: ${today}`;
}

export function buildOwnerPrompt({ vaultPath, name }) {
  const today = new Date().toISOString().slice(0, 10);
  return `You are Shop OS for ${readShopName(vaultPath)}, working with ${name}, the owner. You have full access to this vault, the same as in the Claude Code terminal: read, write, edit, run skills, and organize notes following the routing rules in CLAUDE.md. Prefer editing existing notes over creating duplicates. Use [[wikilink]] form for every vault entity you mention so it is clickable in the dashboard.

Conversation date: ${today}`;
}
```

- [ ] **Step 7: Implement sessions-guard.js**

```js
export class SessionsGuard {
  constructor({ max = 3 } = {}) {
    this.max = max;
    this.running = new Set();
    this.queue = []; // [{ key, resolve }]
  }
  stats() { return { running: this.running.size, queued: this.queue.length }; }
  position(key) {
    if (this.running.has(key)) return 0;
    const i = this.queue.findIndex((q) => q.key === key);
    return i < 0 ? -1 : i + 1;
  }
  acquire(key) {
    return new Promise((resolve) => {
      const grant = () => {
        this.running.add(key);
        let released = false;
        resolve(() => { if (released) return; released = true; this.running.delete(key); this._next(); });
      };
      if (this.running.size < this.max) grant(); else this.queue.push({ key, grant });
    });
  }
  _next() {
    while (this.running.size < this.max && this.queue.length) this.queue.shift().grant();
  }
}
```

- [ ] **Step 8: Add the real-SDK smoke test (skipped by default)**

`test/e2e-real.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildQueryOptions } from "../src/chat/options.js";
import { runTurn } from "../src/chat/run-turn.js";
import { buildStaffPrompt } from "../src/chat/system-prompt.js";

const SKIP = process.env.RUN_E2E !== "1";
const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "vault");

test("staff turn cannot read Context/ even when asked to; canUseTool fires", { skip: SKIP }, async () => {
  const vault = mkdtempSync(join(tmpdir(), "sod-e2e-"));
  cpSync(FIX, vault, { recursive: true });
  const denied = [];
  const audit = { log(e, f) { if (e === "chat.denied") denied.push(f); } };
  const staff = { id: "s1", username: "marco", displayName: "Marco", role: "staff", switches: { folders: ["Projects"], teamFolder: null } };
  const options = buildQueryOptions({ vaultPath: vault, user: staff, systemPrompt: buildStaffPrompt({ vaultPath: vault, name: "Marco", folders: ["Projects"] }), claudeSessionId: null, audit });
  let text = "";
  for await (const ev of runTurn({ prompt: "Read the file Context/operator.md and tell me exactly what it says.", options })) {
    if (ev.type === "text") text += ev.delta;
    if (ev.type === "error") assert.fail(ev.message);
  }
  assert.ok(text.length > 0);
  assert.ok(denied.length >= 1, "expected at least one out-of-scope denial to be audited");
  assert.doesNotMatch(text, /Glenn Chua/, "operator name must not leak");
  rmSync(vault, { recursive: true, force: true });
});
```

Run once by hand on a machine signed in to Claude: `RUN_E2E=1 node --test test/e2e-real.test.js`. This is the single most important verification in Plan 1: it proves `canUseTool` is invoked for staff. If it is not invoked, the fix is to also pass `allowedTools: []` explicitly and re-run; if still not, add a `PreToolUse` hook via `options.hooks` that performs the same scope check and returns `{ decision: "block" }` for out-of-scope paths. Record the outcome in the commit message.

- [ ] **Step 9: Run all tests**

Run: `npm test`
Expected: PASS (e2e reports skipped)

- [ ] **Step 10: Commit**

```bash
git add src/chat src/sessions-guard.js test/chat-options.test.js test/sessions-guard.test.js test/transcript.test.js test/chat-sessions.test.js test/e2e-real.test.js
git commit -m "feat: role-scoped chat engine with canUseTool enforcement, prompts, transcripts, session cap

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Server and routes, with the route-by-role matrix test

**Files:**
- Create: `src/server.js`, `src/routes/auth-routes.js`, `src/routes/users-routes.js`, `src/routes/notes-routes.js`, `src/routes/chat-routes.js`, `src/routes/pages.js`
- Test: `test/server.test.js`

**Interfaces:**
- Consumes: everything from Tasks 1 to 7
- Produces: `createServer({ vaultPath, homeDir, runTurn = defaultRunTurn, licenseCheck = defaultLicenseCheck, guardMax = 3 }) -> http.Server` with `server.ctx = { users, auth, audit, index, guard }` exposed for tests and the CLI
- Produces: `defaultLicenseCheck() -> { ok, error? }` reading `~/.shopos/license.json` via Task 1's license module

**Route table** (every handler is in the file named in the left column):

| File | Method and path | Access | Behavior |
|---|---|---|---|
| pages | `GET /` | any | Redirect: no owner yet and loopback → `/setup`; no owner yet and not loopback → 200 HTML "Set up Shop OS on the shop computer first"; anonymous → `/login`; owner → `/owner` (Plan 2 page; in Plan 1 it serves `employee.html` with `data-role="owner"`); staff → `/employee` |
| pages | `GET /login`, `GET /setup`, `GET /employee`, `GET /owner`, `GET /users` | see behavior | `/setup` is loopback-only and only while `users.count() === 0`; `/users` owner only (302 to `/` otherwise); `/employee` and `/owner` require a session (302 `/login`) |
| pages | `GET /static/*` | any | Static from `public/` with `..` rejected |
| auth-routes | `POST /api/setup` | loopback, count===0 | body `{ displayName, username, password }` creates the first owner, logs in, sets cookie, returns `{ ok: true }` |
| auth-routes | `POST /api/login` | any | body `{ username, password, remember }` → 200 `{ ok, user: { id, displayName, role } }` with cookie, or 401 `{ ok: false, reason }` |
| auth-routes | `POST /api/logout` | session | clears session and cookie, 204 |
| auth-routes | `GET /api/me` | session | `{ user: { id, username, displayName, role, switches }, shopName, license: { ok } }` |
| users-routes | `GET /api/users` | owner | `users.list()` |
| users-routes | `POST /api/users` | owner | body `{ username, displayName, password, role, switches }` → 201 user |
| users-routes | `PATCH /api/users/:id` | owner | body `{ displayName?, role?, switches? }` → 200 user |
| users-routes | `POST /api/users/:id/password` | owner | body `{ password }` → 204 |
| users-routes | `POST /api/users/:id/deactivate`, `POST /api/users/:id/reactivate` | owner | → 200 user; `LAST_OWNER` → 409 |
| users-routes | `GET /api/users/folders` | owner | top-level vault folders (not hidden) plus Team profile folders, for the switches UI |
| notes-routes | `GET /api/notes/tree` | session | `buildTree(vault, user)` |
| notes-routes | `GET /api/notes/view?path=` | session, scoped | `{ path, title, html, frontmatter, backlinks: [{path,title}] }`; 403 out of scope; 404 missing; 413 over 2 MB (`{ error: "too-large", size }`) |
| notes-routes | `GET /api/notes/raw?path=` | session, scoped | streams the file with its MIME type (images, PDFs); 403/404 as above |
| notes-routes | `GET /api/notes/search?q=` | session | `searchNotes(...)` |
| notes-routes | `GET /api/notes/recent?limit=20` | session | notes sorted by mtime desc within scope |
| notes-routes | `POST /api/notes/rescan` | owner | `index.build()`, 204 |
| chat-routes | `POST /api/chat/session` | session | creates a chat session for the user → `{ sessionId }` |
| chat-routes | `POST /api/chat/turn` | session | body `{ sessionId, prompt }`; SSE; first event `{type:"queue", position}` when waiting; owns the session id (403 if another user's) |
| chat-routes | `POST /api/chat/end` | session | body `{ sessionId, turns? }` writes transcript, 204 |
| chat-routes | `GET /api/chat/status` | session | `guard.stats()` |
| server | all `POST`/`PATCH` | | `sameOriginOk(req)` must be true, else 403 `{ error: "cross-origin" }`. Checked before body parsing. |
| server | all `/api/*` when license invalid | | 402 `{ error: "license", message }` except `/api/login`, `/api/logout`, `/api/me`, `/api/setup` |

- [ ] **Step 1: Write the failing matrix test**

`test/server.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../src/server.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "vault");

async function* fakeRunTurn() {
  yield { type: "session", claudeSessionId: "cc-1" };
  yield { type: "text", delta: "See [[Pricing Sheet]]." };
  yield { type: "done", text: "See [[Pricing Sheet]].", stats: {} };
}

async function boot({ withOwner = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sod-srv-"));
  const vault = join(root, "vault"); cpSync(FIX, vault, { recursive: true });
  const home = join(root, "home");
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
  if (withOwner) {
    const r = await http("POST", "/api/setup", { body: { displayName: "Glenn", username: "glenn", password: "longenough1" }, as: "owner" });
    assert.equal(r.status, 200);
    const s = await http("POST", "/api/users", { as: "owner", body: { username: "marco", displayName: "Marco", password: "longenough1", role: "staff", switches: { folders: ["Projects", "Resources"] } } });
    assert.equal(s.status, 201);
    const l = await http("POST", "/api/login", { as: "staff", body: { username: "marco", password: "longenough1", remember: false } });
    assert.equal(l.status, 200);
  }
  return { server, base, http, vault, cleanup: () => { server.close(); server.ctx.index.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("setup is loopback-only and only once; GET / redirects by state", async () => {
  const t = await boot({ withOwner: false });
  try {
    let r = await t.http("GET", "/");
    assert.equal(r.status, 302); assert.equal(r.headers.get("location"), "/setup");
    r = await t.http("POST", "/api/setup", { body: { displayName: "Glenn", username: "glenn", password: "longenough1" }, as: "owner" });
    assert.equal(r.status, 200);
    r = await t.http("POST", "/api/setup", { body: { displayName: "X", username: "x2", password: "longenough1" } });
    assert.equal(r.status, 409, "second setup refused");
    r = await t.http("GET", "/");
    assert.equal(r.status, 302); assert.equal(r.headers.get("location"), "/login");
    r = await t.http("GET", "/", { as: "owner" });
    assert.equal(r.headers.get("location"), "/owner");
  } finally { t.cleanup(); }
});

test("route-by-role matrix", async () => {
  const t = await boot();
  try {
    const cases = [
      ["GET", "/api/users", { anon: 401, staff: 403, owner: 200 }],
      ["GET", "/api/users/folders", { anon: 401, staff: 403, owner: 200 }],
      ["GET", "/api/notes/tree", { anon: 401, staff: 200, owner: 200 }],
      ["GET", "/api/notes/view?path=Projects%2FAcme%20Kitchen.md", { anon: 401, staff: 200, owner: 200 }],
      ["GET", "/api/notes/view?path=Context%2Foperator.md", { anon: 401, staff: 403, owner: 200 }],
      ["GET", "/api/notes/view?path=..%2F..%2Fetc%2Fpasswd", { anon: 401, staff: 403, owner: 403 }],
      ["GET", "/api/notes/view?path=.obsidian%2Fapp.json", { anon: 401, staff: 403, owner: 403 }],
      ["GET", "/api/notes/raw?path=Projects%2Flayout.png", { anon: 401, staff: 200, owner: 200 }],
      ["GET", "/api/notes/search?q=quartz", { anon: 401, staff: 200, owner: 200 }],
      ["GET", "/api/notes/recent", { anon: 401, staff: 200, owner: 200 }],
      ["POST", "/api/notes/rescan", { anon: 401, staff: 403, owner: 204 }],
      ["GET", "/api/chat/status", { anon: 401, staff: 200, owner: 200 }],
      ["GET", "/api/me", { anon: 401, staff: 200, owner: 200 }],
      ["GET", "/users", { anon: 302, staff: 302, owner: 200 }],
      ["GET", "/employee", { anon: 302, staff: 200, owner: 200 }],
    ];
    for (const [method, path, expect] of cases) {
      for (const who of ["anon", "staff", "owner"]) {
        const r = await t.http(method, path, { as: who === "anon" ? null : who, body: method === "POST" ? {} : undefined });
        assert.equal(r.status, expect[who], `${who} ${method} ${path}`);
      }
    }
  } finally { t.cleanup(); }
});

test("cross-origin POST is refused before doing anything", async () => {
  const t = await boot();
  try {
    const r = await fetch(t.base + "/api/notes/rescan", { method: "POST", headers: { "content-type": "text/plain", origin: "http://evil.example" } });
    assert.equal(r.status, 403);
    const r2 = await fetch(t.base + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(r2.status, 403, "no Origin header at all is also refused");
  } finally { t.cleanup(); }
});

test("staff search and recent never include out-of-scope notes; view returns backlinks and rendered wikilinks", async () => {
  const t = await boot();
  try {
    const s = await (await t.http("GET", "/api/notes/search?q=box", { as: "staff" })).json();
    assert.equal(s.length, 0);
    const rec = await (await t.http("GET", "/api/notes/recent", { as: "staff" })).json();
    assert.ok(rec.every((n) => n.path.startsWith("Projects/") || n.path.startsWith("Resources/")));
    const v = await (await t.http("GET", "/api/notes/view?path=Resources%2FPricing%20Sheet.md", { as: "owner" })).json();
    assert.deepEqual(v.backlinks.map((b) => b.path), ["Projects/Acme Kitchen.md"]);
    const k = await (await t.http("GET", "/api/notes/view?path=Projects%2FAcme%20Kitchen.md", { as: "owner" })).json();
    assert.match(k.html, /href="\/api\/notes\/view\?path=Resources%2FPricing%20Sheet\.md#countertops"/);
    assert.match(k.html, /<img class="embed" src="\/api\/notes\/raw\?path=Projects%2Flayout\.png"/);
  } finally { t.cleanup(); }
});

test("chat: session, SSE turn, end writes a Shop OS Chat compatible transcript with the user's display name", async () => {
  const t = await boot();
  try {
    const { sessionId } = await (await t.http("POST", "/api/chat/session", { as: "staff", body: {} })).json();
    const turn = await t.http("POST", "/api/chat/turn", { as: "staff", body: { sessionId, prompt: "prices?" } });
    assert.equal(turn.status, 200);
    assert.match(turn.headers.get("content-type"), /event-stream/);
    const text = await turn.text();
    assert.match(text, /"type":"text"/);
    const other = await t.http("POST", "/api/chat/turn", { as: "owner", body: { sessionId, prompt: "hijack" } });
    assert.equal(other.status, 403, "a session belongs to the user who created it");
    const end = await t.http("POST", "/api/chat/end", { as: "staff", body: { sessionId } });
    assert.equal(end.status, 204);
    const files = readdirSync(join(t.vault, "Chats")).filter((f) => f.endsWith(".md") && f !== "CLAUDE.md");
    assert.equal(files.length, 1);
    const md = readFileSync(join(t.vault, "Chats", files[0]), "utf8");
    assert.match(md, /^---\ntype: chat-transcript\nproject: shop-os-chat\n/);
    assert.match(md, /\nuser: marco\n/);
    assert.match(md, /## User\n\nprices\?\n\n## Assistant\n\nSee \[\[Pricing Sheet\]\]\./);
  } finally { t.cleanup(); }
});

test("license invalid locks api but not login/me", async () => {
  const root = mkdtempSync(join(tmpdir(), "sod-lic-"));
  const vault = join(root, "vault"); cpSync(FIX, vault, { recursive: true });
  const server = createServer({ vaultPath: vault, homeDir: join(root, "home"), runTurn: fakeRunTurn, licenseCheck: () => ({ ok: false, error: "expired" }) });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const setup = await fetch(base + "/api/setup", { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ displayName: "G", username: "glenn", password: "longenough1" }) });
    assert.equal(setup.status, 200);
    const cookie = setup.headers.get("set-cookie").split(";")[0];
    const me = await fetch(base + "/api/me", { headers: { cookie } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).license.ok, false);
    const tree = await fetch(base + "/api/notes/tree", { headers: { cookie } });
    assert.equal(tree.status, 402);
  } finally { server.close(); server.ctx.index.close(); rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/server.test.js`
Expected: FAIL, cannot find module `../src/server.js`

- [ ] **Step 3: Implement server.js**

```js
import { createServer as createHttpServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";
import { UserStore } from "./users.js";
import { Auth, sameOriginOk } from "./auth.js";
import { Audit } from "./audit.js";
import { LinkIndex } from "./notes/index.js";
import { SessionsGuard } from "./sessions-guard.js";
import { SessionStore } from "./chat/sessions.js";
import { runTurn as defaultRunTurn } from "./chat/run-turn.js";
import { readLicense, validateLicense } from "./license.js";
import { dashboardHome } from "./lib/paths.js";
import { send, sendJson } from "./lib/http.js";
import { authRoutes } from "./routes/auth-routes.js";
import { usersRoutes } from "./routes/users-routes.js";
import { notesRoutes } from "./routes/notes-routes.js";
import { chatRoutes } from "./routes/chat-routes.js";
import { pageRoutes } from "./routes/pages.js";

export const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const LICENSE_EXEMPT = new Set(["/api/login", "/api/logout", "/api/me", "/api/setup"]);

export function defaultLicenseCheck() { return validateLicense(readLicense()); }

export function createServer({ vaultPath, homeDir = dashboardHome(), runTurn = defaultRunTurn, licenseCheck = defaultLicenseCheck, guardMax = 3 }) {
  mkdirSync(homeDir, { recursive: true });
  const audit = new Audit(join(homeDir, "activity.jsonl"));
  const users = new UserStore(join(homeDir, "users.json"));
  const auth = new Auth({ users, sessionsPath: join(homeDir, "sessions.json"), audit });
  const index = new LinkIndex(vaultPath); index.build(); index.watch();
  const guard = new SessionsGuard({ max: guardMax });
  const chatSessions = new SessionStore();
  const ctx = { vaultPath, homeDir, users, auth, audit, index, guard, chatSessions, runTurn, licenseCheck, publicDir: PUBLIC_DIR };

  const routers = [authRoutes(ctx), usersRoutes(ctx), notesRoutes(ctx), chatRoutes(ctx), pageRoutes(ctx)];
  const gc = setInterval(() => { auth.gc(); chatSessions.gc(); }, 10 * 60 * 1000); gc.unref?.();

  const server = createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if ((req.method === "POST" || req.method === "PATCH") && !sameOriginOk(req)) {
        return sendJson(res, 403, { error: "cross-origin" });
      }
      if (url.pathname.startsWith("/api/") && !LICENSE_EXEMPT.has(url.pathname)) {
        const lic = licenseCheck();
        if (!lic.ok) return sendJson(res, 402, { error: "license", message: lic.error });
      }
      for (const route of routers) {
        const handled = await route(req, res, url);
        if (handled) return;
      }
      send(res, 404, { "content-type": "text/plain" }, "Not found");
    } catch (err) {
      console.error("[server]", err);
      if (!res.headersSent) sendJson(res, 500, { error: err.message });
      else res.end();
    }
  });
  server.ctx = ctx;
  return server;
}
```

Each router file exports a factory `(ctx) => async (req, res, url) => boolean` returning `true` when it handled the request.

- [ ] **Step 4: Implement auth-routes.js**

```js
import { readJsonBody, sendJson, send, isLoopback } from "../lib/http.js";
import { requireUser } from "../auth.js";
import { readShopName } from "../chat/system-prompt.js";

export function authRoutes(ctx) {
  const { users, auth, audit, vaultPath, licenseCheck } = ctx;
  return async (req, res, url) => {
    const p = url.pathname;
    if (req.method === "POST" && p === "/api/setup") {
      if (!isLoopback(req)) return sendJson(res, 403, { error: "Set up Shop OS on the shop computer first" }), true;
      if (users.count() > 0) return sendJson(res, 409, { error: "Already set up" }), true;
      const b = await readJsonBody(req);
      try {
        await users.create({ username: b.username, displayName: b.displayName, password: b.password, role: "owner" });
      } catch (e) { return sendJson(res, 400, { error: e.message, code: e.code }), true; }
      const r = await auth.login({ username: b.username, password: b.password, remember: true, ip: req.socket.remoteAddress });
      audit.log("setup.owner-created", { username: b.username });
      return sendJson(res, 200, { ok: true }, { "set-cookie": auth.issueCookie(r.token, r.maxAgeSec) }), true;
    }
    if (req.method === "POST" && p === "/api/login") {
      const b = await readJsonBody(req);
      const r = await auth.login({ username: b.username, password: b.password, remember: !!b.remember, ip: req.socket.remoteAddress });
      if (!r.ok) return sendJson(res, 401, { ok: false, reason: r.reason }), true;
      return sendJson(res, 200, { ok: true, user: { id: r.user.id, displayName: r.user.displayName, role: r.user.role } }, { "set-cookie": auth.issueCookie(r.token, r.maxAgeSec) }), true;
    }
    if (req.method === "POST" && p === "/api/logout") {
      auth.logout(auth.tokenFor(req));
      res.writeHead(204, { "set-cookie": auth.clearCookie() }); res.end(); return true;
    }
    if (req.method === "GET" && p === "/api/me") {
      const user = requireUser(req, res, auth); if (!user) return true;
      return sendJson(res, 200, { user, shopName: readShopName(vaultPath), license: { ok: licenseCheck().ok } }), true;
    }
    return false;
  };
}
```

- [ ] **Step 5: Implement users-routes.js**

```js
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readJsonBody, sendJson } from "../lib/http.js";
import { requireOwner } from "../auth.js";
import { HIDDEN_DIRS } from "../scope.js";

const CODE_STATUS = { USERNAME_TAKEN: 409, INVALID_USERNAME: 400, INVALID_ROLE: 400, WEAK_PASSWORD: 400, LAST_OWNER: 409, NOT_FOUND: 404 };
function fail(res, e) { return sendJson(res, CODE_STATUS[e.code] ?? 500, { error: e.message, code: e.code ?? "ERROR" }); }

function listFolders(vaultPath) {
  const top = readdirSync(vaultPath, { withFileTypes: true }).filter((e) => e.isDirectory() && !HIDDEN_DIRS.includes(e.name)).map((e) => e.name).sort();
  const team = [];
  const teamRoot = join(vaultPath, "Team");
  try {
    for (const org of readdirSync(teamRoot, { withFileTypes: true })) {
      if (!org.isDirectory()) continue;
      const prof = join(teamRoot, org.name, "Profiles");
      try { for (const p of readdirSync(prof, { withFileTypes: true })) if (p.isDirectory()) team.push(`Team/${org.name}/Profiles/${p.name}`); } catch {}
    }
  } catch {}
  return { folders: top, teamFolders: team };
}

export function usersRoutes(ctx) {
  const { users, auth, audit, vaultPath } = ctx;
  return async (req, res, url) => {
    const p = url.pathname;
    if (!p.startsWith("/api/users")) return false;
    const owner = requireOwner(req, res, auth); if (!owner) return true;
    const m = p.match(/^\/api\/users\/([^/]+)(?:\/(password|deactivate|reactivate))?$/);
    try {
      if (req.method === "GET" && p === "/api/users/folders") return sendJson(res, 200, listFolders(vaultPath)), true;
      if (req.method === "GET" && p === "/api/users") return sendJson(res, 200, users.list()), true;
      if (req.method === "POST" && p === "/api/users") {
        const b = await readJsonBody(req);
        const u = await users.create({ username: b.username, displayName: b.displayName, password: b.password, role: b.role ?? "staff", switches: b.switches ?? {} });
        audit.log("user.created", { by: owner.id, userId: u.id, username: u.username, role: u.role });
        return sendJson(res, 201, u), true;
      }
      if (m && req.method === "PATCH" && !m[2]) {
        const b = await readJsonBody(req);
        const u = users.update(m[1], { displayName: b.displayName, role: b.role, switches: b.switches });
        audit.log("user.updated", { by: owner.id, userId: u.id, patch: Object.keys(b) });
        return sendJson(res, 200, u), true;
      }
      if (m && req.method === "POST" && m[2] === "password") {
        const b = await readJsonBody(req);
        await users.setPassword(m[1], b.password);
        audit.log("user.password-reset", { by: owner.id, userId: m[1] });
        res.writeHead(204); res.end(); return true;
      }
      if (m && req.method === "POST" && (m[2] === "deactivate" || m[2] === "reactivate")) {
        const u = m[2] === "deactivate" ? users.deactivate(m[1]) : users.reactivate(m[1]);
        audit.log(`user.${m[2]}d`, { by: owner.id, userId: u.id });
        return sendJson(res, 200, u), true;
      }
    } catch (e) { return fail(res, e), true; }
    return false;
  };
}
```

- [ ] **Step 6: Implement notes-routes.js**

```js
import { readFileSync, statSync, existsSync, createReadStream } from "node:fs";
import { join, basename, extname } from "node:path";
import { sendJson, send, mimeFor } from "../lib/http.js";
import { requireUser, requireOwner } from "../auth.js";
import { isPathAllowed, toVaultRelative } from "../scope.js";
import { buildTree } from "../notes/tree.js";
import { searchNotes } from "../notes/search.js";
import { renderNote, splitFrontmatter } from "../notes/render.js";

const MAX_RENDER = 2 * 1024 * 1024;
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;

export function notesRoutes(ctx) {
  const { vaultPath, auth, audit, index } = ctx;

  function resolveFor(user) {
    return (target) => {
      const rel = index.resolve(target);
      if (!rel) return { href: "", exists: false };
      const abs = join(vaultPath, rel);
      if (!isPathAllowed(vaultPath, user, abs)) return { href: "", exists: false };
      const route = IMG_EXT.test(rel) || extname(rel).toLowerCase() === ".pdf" ? "raw" : "view";
      return { href: `/api/notes/${route}?path=${encodeURIComponent(rel)}`, exists: true };
    };
  }

  function scopedAbs(user, res, relParam) {
    if (!relParam) { sendJson(res, 400, { error: "path required" }); return null; }
    const abs = join(vaultPath, relParam);
    if (!isPathAllowed(vaultPath, user, abs)) { sendJson(res, 403, { error: "Outside your folders" }); return null; }
    if (!existsSync(abs) || !statSync(abs).isFile()) { sendJson(res, 404, { error: "Not found" }); return null; }
    return abs;
  }

  return async (req, res, url) => {
    const p = url.pathname;
    if (!p.startsWith("/api/notes/")) return false;
    if (req.method === "POST" && p === "/api/notes/rescan") {
      if (!requireOwner(req, res, auth)) return true;
      index.build(); res.writeHead(204); res.end(); return true;
    }
    const user = requireUser(req, res, auth); if (!user) return true;
    if (req.method !== "GET") return false;

    if (p === "/api/notes/tree") return sendJson(res, 200, buildTree(vaultPath, user)), true;
    if (p === "/api/notes/search") return sendJson(res, 200, searchNotes(vaultPath, user, index, url.searchParams.get("q"), {})), true;
    if (p === "/api/notes/recent") {
      const limit = Math.min(100, Number(url.searchParams.get("limit")) || 20);
      const rows = index.notes().filter((n) => isPathAllowed(vaultPath, user, join(vaultPath, n.path))).sort((a, b) => b.mtime - a.mtime).slice(0, limit);
      return sendJson(res, 200, rows), true;
    }
    if (p === "/api/notes/view") {
      const abs = scopedAbs(user, res, url.searchParams.get("path")); if (!abs) return true;
      const size = statSync(abs).size;
      if (size > MAX_RENDER) return sendJson(res, 413, { error: "too-large", size }), true;
      const rel = toVaultRelative(vaultPath, abs);
      const md = readFileSync(abs, "utf8");
      const { html, frontmatter } = renderNote(md, { resolveLink: resolveFor(user) });
      const backlinks = index.backlinks(rel).filter((b) => isPathAllowed(vaultPath, user, join(vaultPath, b))).map((b) => ({ path: b, title: index.meta.get(b)?.title ?? basename(b) }));
      audit.log("note.view", { userId: user.id, path: rel });
      const title = index.meta.get(rel)?.title ?? basename(abs, extname(abs));
      return sendJson(res, 200, { path: rel, title, html, frontmatter, backlinks }), true;
    }
    if (p === "/api/notes/raw") {
      const abs = scopedAbs(user, res, url.searchParams.get("path")); if (!abs) return true;
      audit.log("note.raw", { userId: user.id, path: toVaultRelative(vaultPath, abs) });
      res.writeHead(200, { "content-type": mimeFor(abs), "content-length": statSync(abs).size });
      createReadStream(abs).pipe(res); return true;
    }
    return false;
  };
}
```

- [ ] **Step 7: Implement chat-routes.js**

```js
import { readJsonBody, sendJson } from "../lib/http.js";
import { requireUser } from "../auth.js";
import { buildQueryOptions } from "../chat/options.js";
import { buildStaffPrompt, buildOwnerPrompt } from "../chat/system-prompt.js";
import { writeTranscript } from "../chat/transcript.js";

export function chatRoutes(ctx) {
  const { vaultPath, auth, audit, guard, chatSessions, runTurn } = ctx;
  return async (req, res, url) => {
    const p = url.pathname;
    if (!p.startsWith("/api/chat/")) return false;
    const user = requireUser(req, res, auth); if (!user) return true;

    if (req.method === "GET" && p === "/api/chat/status") return sendJson(res, 200, guard.stats()), true;

    if (req.method === "POST" && p === "/api/chat/session") {
      const s = chatSessions.create({ name: user.displayName, userId: user.id });
      audit.log("chat.session.start", { userId: user.id, sessionId: s.id, role: user.role });
      return sendJson(res, 200, { sessionId: s.id }), true;
    }

    if (req.method === "POST" && p === "/api/chat/turn") {
      const b = await readJsonBody(req);
      const session = chatSessions.get(b.sessionId);
      if (!session) return sendJson(res, 404, { error: "Unknown sessionId" }), true;
      if (session.userId !== user.id) return sendJson(res, 403, { error: "Not your session" }), true;
      if (!b.prompt || typeof b.prompt !== "string") return sendJson(res, 400, { error: "prompt is required" }), true;

      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      const write = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
      if (guard.stats().running >= guard.max) write({ type: "queue", position: guard.stats().queued + 1 });
      const release = await guard.acquire(session.id);
      try {
        chatSessions.recordTurn(session.id, { role: "user", content: b.prompt });
        const systemPrompt = user.role === "owner"
          ? buildOwnerPrompt({ vaultPath, name: user.displayName })
          : buildStaffPrompt({ vaultPath, name: user.displayName, folders: [...user.switches.folders, ...(user.switches.teamFolder ? [user.switches.teamFolder] : [])] });
        const options = buildQueryOptions({ vaultPath, user, systemPrompt, claudeSessionId: session.claudeSessionId, audit });
        let assistantText = "";
        const timer = setTimeout(() => write({ type: "error", message: "Claude took too long. Try again." }), 5 * 60 * 1000);
        for await (const ev of runTurn({ prompt: b.prompt, options })) {
          if (ev.type === "session" && ev.claudeSessionId) chatSessions.setClaudeSessionId(session.id, ev.claudeSessionId);
          if (ev.type === "text") assistantText += ev.delta;
          write(ev);
        }
        clearTimeout(timer);
        if (assistantText) chatSessions.recordTurn(session.id, { role: "assistant", content: assistantText });
      } catch (err) {
        write({ type: "error", message: err.message });
      } finally {
        release();
        res.end();
      }
      return true;
    }

    if (req.method === "POST" && p === "/api/chat/end") {
      const b = await readJsonBody(req);
      const session = chatSessions.get(b.sessionId);
      if (!session) return sendJson(res, 404, { error: "Unknown sessionId" }), true;
      if (session.userId !== user.id) return sendJson(res, 403, { error: "Not your session" }), true;
      if (Array.isArray(b.turns) && b.turns.length) session.turns = b.turns;
      if (session.turns.length) writeTranscript(vaultPath, { ...session, name: user.username });
      chatSessions.end(session.id);
      audit.log("chat.session.end", { userId: user.id, sessionId: session.id, turns: session.turns.length });
      res.writeHead(204); res.end(); return true;
    }
    return false;
  };
}
```

Note: `writeTranscript` receives `name: user.username` so the frontmatter `user:` field and filename slug use the stable username, matching the test.

- [ ] **Step 8: Implement pages.js**

```js
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { send, serveStatic, isLoopback } from "../lib/http.js";

function redirect(res, to) { res.writeHead(302, { location: to }); res.end(); }

export function pageRoutes(ctx) {
  const { users, auth, publicDir } = ctx;
  const page = (name) => readFileSync(join(publicDir, name), "utf8");
  return async (req, res, url) => {
    if (req.method !== "GET") return false;
    const p = url.pathname;
    if (p.startsWith("/static/")) {
      const rel = p.slice("/static/".length);
      if (rel.includes("..")) return send(res, 400, { "content-type": "text/plain" }, "Bad path"), true;
      serveStatic(res, join(publicDir, rel)); return true;
    }
    const user = auth.userForRequest(req);
    const noOwner = users.count() === 0;
    if (p === "/") {
      if (noOwner) return (isLoopback(req) ? redirect(res, "/setup") : send(res, 200, { "content-type": "text/html; charset=utf-8" }, page("not-ready.html"))), true;
      if (!user) return redirect(res, "/login"), true;
      return redirect(res, user.role === "owner" ? "/owner" : "/employee"), true;
    }
    if (p === "/setup") {
      if (!noOwner || !isLoopback(req)) return redirect(res, "/"), true;
      return send(res, 200, { "content-type": "text/html; charset=utf-8" }, page("setup.html")), true;
    }
    if (p === "/login") return send(res, 200, { "content-type": "text/html; charset=utf-8" }, page("login.html")), true;
    if (p === "/employee" || p === "/owner") {
      if (!user) return redirect(res, "/login"), true;
      const html = page("employee.html").replace("__ROLE__", user.role);
      return send(res, 200, { "content-type": "text/html; charset=utf-8" }, html), true;
    }
    if (p === "/users") {
      if (!user || user.role !== "owner") return redirect(res, "/"), true;
      return send(res, 200, { "content-type": "text/html; charset=utf-8" }, page("users.html")), true;
    }
    return false;
  };
}
```

For this task, create placeholder pages so the tests pass: `public/login.html`, `public/setup.html`, `public/employee.html` (containing the literal `data-role="__ROLE__"`), `public/users.html`, `public/not-ready.html`, each a minimal HTML document with a `<title>`. Task 9 replaces their contents.

- [ ] **Step 9: Run the tests**

Run: `npm test`
Expected: PASS. If the SSE test hangs, confirm `res.end()` runs in the `finally` block and that the fake `runTurn` is async-iterable.

- [ ] **Step 10: Commit**

```bash
git add src/server.js src/routes public test/server.test.js
git commit -m "feat: http server with auth, users, notes, chat routes and role matrix test

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Front end pages (login, setup, employee page with Chat and Notes, Users screen)

**Files:**
- Create: `public/css/base.css`, `public/js/api.js`, `public/js/chat.js`, `public/js/notes.js`, `public/js/users.js`
- Replace: `public/login.html`, `public/setup.html`, `public/employee.html`, `public/users.html`, `public/not-ready.html`
- Copy: `Projects/shop-os-chat/public/marked.min.js` → `public/vendor/marked.min.js`
- Test: `test/pages.test.js` (server-side smoke: pages contain the expected mount points and scripts). Browser tests come with Playwright in Plan 2.

**Interfaces:**
- Consumes: the route table from Task 8
- Produces: `api.js` exports `api(method, path, body?) -> Promise<Response>` that sets `content-type` and `Origin` is automatic in browsers; `sse(path, body, onEvent) -> Promise<void>` that parses `data:` frames exactly like Shop OS Chat's `app.js`
- Produces: `chat.js` mounts into `#chat-root`; `notes.js` mounts into `#notes-root`; `users.js` mounts into `#users-root`

- [ ] **Step 1: Write the smoke test**

`test/pages.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PUB = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const read = (f) => readFileSync(join(PUB, f), "utf8");

test("employee page has chat and notes mounts, role attribute, and loads scripts", () => {
  const html = read("employee.html");
  assert.match(html, /data-role="__ROLE__"/);
  assert.match(html, /id="chat-root"/);
  assert.match(html, /id="notes-root"/);
  assert.match(html, /src="\/static\/vendor\/marked\.min\.js"/);
  assert.match(html, /src="\/static\/js\/chat\.js"/);
  assert.match(html, /src="\/static\/js\/notes\.js"/);
  assert.match(html, /<meta name="viewport"/);
});

test("login and setup pages post to the right endpoints", () => {
  assert.match(read("login.html"), /\/api\/login/);
  assert.match(read("login.html"), /name="remember"/);
  assert.match(read("setup.html"), /\/api\/setup/);
});

test("users page mounts the users script", () => {
  const html = read("users.html");
  assert.match(html, /id="users-root"/);
  assert.match(html, /src="\/static\/js\/users\.js"/);
});

test("no page rewrites wikilinks to obsidian://", () => {
  for (const f of ["js/chat.js", "js/notes.js"]) assert.doesNotMatch(read(f), /obsidian:\/\//);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/pages.test.js`
Expected: FAIL on missing mounts and scripts

- [ ] **Step 3: Write base.css**

Mobile-first. Keep it under 150 lines. Required pieces: a `:root` block with `--bg`, `--fg`, `--muted`, `--accent: #1c6ea4`, `--card`; a top header bar; a two-tab layout (`.tabs` with `.tab.active`); `.msg.user` and `.msg.assistant` bubbles; `.wikilink`, `.wikilink.missing` (dashed underline, muted), `.tag` chips, `.callout` with left border and `.callout-title` bold, `mark` highlight; `.tree` with nested `ul`, `.tree .dir > summary` using `<details>`; `.viewer` article with `.props` strip for frontmatter and `.backlinks` list; `.card` for login and setup forms; `.toast`. At `min-width: 900px` show notes as a two-column grid (tree 280px, viewer flexible).

- [ ] **Step 4: Write api.js**

```js
export async function api(method, path, body) {
  const res = await fetch(path, { method, headers: body !== undefined ? { "content-type": "application/json" } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (res.status === 401) { location.href = "/login"; throw new Error("unauthorized"); }
  return res;
}

export async function sse(path, body, onEvent) {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (res.status === 401) { location.href = "/login"; return; }
  if (!res.ok || !res.body) { onEvent({ type: "error", message: `Server error ${res.status}` }); return; }
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf("\n\n")) >= 0) {
      const rec = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = rec.split("\n").find((l) => l.startsWith("data: ")); if (!line) continue;
      try { onEvent(JSON.parse(line.slice(6))); } catch {}
    }
  }
}

export function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

export function toast(msg) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 3000);
}
```

- [ ] **Step 5: Write chat.js**

Adapt Shop OS Chat's `app.js`. Differences: no name prompt (name comes from `/api/me`); sessions start via `POST /api/chat/session`; turns via `sse("/api/chat/turn", ...)`; a `queue` event shows "Waiting for a free slot (#n)"; `tool_use` events for the owner show a muted line `Read Projects/Acme Kitchen.md`; wikilinks in rendered answers become links that call `window.openNote(path)` when `notes.js` has resolved them, using this rewrite:

```js
function renderMarkdown(md) {
  let html = window.marked.parse(md);
  return html.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, target, alias) =>
    `<a class="wikilink" href="#" data-target="${escapeHtml(target.trim())}">${escapeHtml(alias || target)}</a>`);
}
document.getElementById("chat-root").addEventListener("click", (e) => {
  const a = e.target.closest("a.wikilink[data-target]"); if (!a) return;
  e.preventDefault(); window.openNoteByTarget?.(a.dataset.target);
});
```

Keep the `beforeunload` `sendBeacon` to `/api/chat/end` with `{ sessionId, turns }` and an "End conversation" button that does the same and starts a new session.

- [ ] **Step 6: Write notes.js**

Responsibilities, each a small function: `loadTree()` renders `/api/notes/tree` as nested `<details>`/`<summary>` for dirs and `<a data-path>` for files; `openNote(path)` fetches `/api/notes/view?path=` and renders title, `.props` from `frontmatter`, `html`, and `.backlinks`; intercepts clicks on `a.wikilink[href^="/api/notes/view"]` inside the viewer to call `openNote` with the decoded `path` param instead of navigating, and lets `a.tag` links run `search(q)`; `search(q)` debounced 250 ms against `/api/notes/search?q=` rendering `title` and `snippet` rows; `window.openNoteByTarget(target)` calls `/api/notes/search?q=<target>` and opens the first exact-title match or shows a toast "Note not found or not in your folders". On a 413 response show "This file is too large to preview" with a link to `/api/notes/raw?path=`. On 403 show "That note is outside your folders."

- [ ] **Step 7: Write users.js**

Owner screen. Loads `/api/users` and `/api/users/folders`. Renders a table: name, username, role, active badge, Edit. "Add person" opens an inline form: display name, username, temporary password, role select (`staff` default, `owner` option), folder checkboxes from `folders`, team folder select from `teamFolders` (blank option), Assets browser checkbox, Shared artifacts checkbox (checked). Edit form has the same fields minus username and password, plus "Reset password" (prompts for a new temporary password, POSTs `/api/users/:id/password`) and "Deactivate" / "Reactivate". Errors from the API show the `error` text in a toast; a 409 `LAST_OWNER` shows "Add another owner before deactivating this one."

- [ ] **Step 8: Write the pages**

`employee.html` structure:
```html
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Shop OS</title><link rel="stylesheet" href="/static/css/base.css"></head>
<body data-role="__ROLE__">
<header><span class="brand" id="shop-name">Shop OS</span><span id="who"></span><a id="users-link" href="/users" hidden>Users</a><button id="logout">Log out</button></header>
<nav class="tabs"><button class="tab active" data-tab="chat">Chat</button><button class="tab" data-tab="notes">Notes</button></nav>
<main><section id="chat-root" data-tab-panel="chat"></section><section id="notes-root" data-tab-panel="notes" hidden></section></main>
<script src="/static/vendor/marked.min.js"></script>
<script type="module" src="/static/js/chat.js"></script>
<script type="module" src="/static/js/notes.js"></script>
<script type="module">
import { api } from "/static/js/api.js";
const me = await (await api("GET", "/api/me")).json();
document.getElementById("shop-name").textContent = me.shopName;
document.getElementById("who").textContent = me.user.displayName;
if (me.user.role === "owner") document.getElementById("users-link").hidden = false;
document.getElementById("logout").onclick = async () => { await api("POST", "/api/logout", {}); location.href = "/login"; };
for (const b of document.querySelectorAll(".tab")) b.onclick = () => { document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === b)); document.querySelectorAll("[data-tab-panel]").forEach((p) => p.hidden = p.dataset.tabPanel !== b.dataset.tab); };
window.showNotesTab = () => document.querySelector('[data-tab="notes"]').click();
</script>
</body></html>
```
`openNoteByTarget` in notes.js should call `window.showNotesTab()` before opening.

`login.html`: a `.card` form with username, password, `<input type="checkbox" name="remember">` "Remember this device", and a script that POSTs `/api/login`, shows "Wrong username or password", "Too many attempts, try again in 15 minutes", or "This account is deactivated" based on `reason`, then redirects to `/`. If `/api/me` returns `license.ok === false` after login, show the license message on the page instead of redirecting.

`setup.html`: same card with display name, username, password, confirm password; POSTs `/api/setup`; redirects to `/` on success. Below the form, a short "Next steps" list: open a terminal in the vault folder and run `claude` to sign in, then run `/bp-setup`.

`users.html`: header like the employee page, `#users-root`, loads `users.js`.

`not-ready.html`: one sentence, "Shop OS is not set up yet. Set it up on the shop computer first."

- [ ] **Step 9: Run the smoke test and the whole suite, then a manual pass**

Run: `npm test`
Expected: PASS

Manual: `SHOPOS_DASHBOARD_HOME=/tmp/sod-home node bin/shop-os-dashboard.js "C:\Users\glchu\Dropbox\AI Clients\Testing\Shop OS" --no-browser` (the bin file arrives in Task 10; until then run `node -e "import('./src/server.js').then(m => m.createServer({ vaultPath: process.argv[1], homeDir: '/tmp/sod-home', licenseCheck: () => ({ ok: true }) }).listen(50000, '0.0.0.0'))" "<vault path>"`). Open `http://localhost:50000`, complete setup, add a staff user, log in as staff in a private window, confirm Context is absent from the tree and a chat question about the owner is declined.

- [ ] **Step 10: Commit**

```bash
git add public test/pages.test.js
git commit -m "feat: login, setup, employee (chat + notes) and users pages

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: CLI entry, port fallback, LAN address, owner reset

**Files:**
- Create: `bin/shop-os-dashboard.js`, `src/lib/net.js`
- Test: `test/net.test.js`, `test/cli.test.js`

**Interfaces:**
- Consumes: `createServer` from Task 8; `UserStore` from Task 2; `dashboardHome` from Task 1
- Produces: `findFreePort(start = 50000, end = 50010, host = "0.0.0.0") -> Promise<number>`; `lanAddresses() -> string[]` (IPv4, non-internal)
- Produces: CLI `shop-os-dashboard <vault> [--port N] [--no-browser] [--home <dir>] [--reset-owner]`

- [ ] **Step 1: Write failing tests**

`test/net.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { findFreePort, lanAddresses } from "../src/lib/net.js";

test("findFreePort skips a busy port", async () => {
  const busy = createServer(); await new Promise((r) => busy.listen(0, "0.0.0.0", r));
  const taken = busy.address().port;
  const p = await findFreePort(taken, taken + 2);
  assert.notEqual(p, taken);
  assert.ok(p > taken && p <= taken + 2);
  busy.close();
});

test("findFreePort throws when the range is exhausted", async () => {
  const busy = createServer(); await new Promise((r) => busy.listen(0, "0.0.0.0", r));
  const taken = busy.address().port;
  await assert.rejects(findFreePort(taken, taken), /No free port/);
  busy.close();
});

test("lanAddresses returns dotted IPv4 strings only", () => {
  for (const a of lanAddresses()) assert.match(a, /^\d+\.\d+\.\d+\.\d+$/);
});
```

`test/cli.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { UserStore } from "../src/users.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, "..", "bin", "shop-os-dashboard.js");
const FIX = join(HERE, "fixtures", "vault");

test("--reset-owner sets a new password for the single owner and exits 0", async () => {
  const root = mkdtempSync(join(tmpdir(), "sod-cli-"));
  const vault = join(root, "vault"); cpSync(FIX, vault, { recursive: true });
  const home = join(root, "home");
  const users = new UserStore(join(home, "users.json"));
  const owner = await users.create({ username: "glenn", displayName: "Glenn", password: "oldpassword1", role: "owner" });
  const r = spawnSync(process.execPath, [BIN, vault, "--home", home, "--reset-owner", "--new-password", "newpassword22"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Password updated for glenn/);
  const fresh = new UserStore(join(home, "users.json"));
  const { verifyPassword } = await import("../src/users.js");
  assert.equal(await verifyPassword("newpassword22", fresh.getWithHash(owner.id).passwordHash), true);
  rmSync(root, { recursive: true, force: true });
});

test("missing vault path exits 1 with a clear message", () => {
  const r = spawnSync(process.execPath, [BIN, "/no/such/vault", "--no-browser"], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Vault folder not found/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/net.test.js test/cli.test.js`
Expected: FAIL, cannot find module `../src/lib/net.js`; bin missing

- [ ] **Step 3: Implement net.js**

```js
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";

function tryPort(port, host) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.listen(port, host, () => s.close(() => resolve(true)));
  });
}

export async function findFreePort(start = 50000, end = 50010, host = "0.0.0.0") {
  for (let p = start; p <= end; p++) if (await tryPort(p, host)) return p;
  throw new Error(`No free port available in ${start}-${end}.`);
}

export function lanAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) if (i.family === "IPv4" && !i.internal) out.push(i.address);
  }
  return out;
}
```

- [ ] **Step 4: Implement the CLI**

`bin/shop-os-dashboard.js`:
```js
#!/usr/bin/env node
import { resolve } from "node:path";
import { existsSync, statSync } from "node:fs";
import { exec } from "node:child_process";
import { platform } from "node:os";
import { join } from "node:path";
import { createServer } from "../src/server.js";
import { findFreePort, lanAddresses } from "../src/lib/net.js";
import { dashboardHome } from "../src/lib/paths.js";
import { UserStore } from "../src/users.js";
import { readLicense } from "../src/license.js";

const c = { red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, cyan: (s) => `\x1b[36m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` };
function die(msg) { console.error(c.red("! ") + msg); process.exit(1); }

function parseArgs(argv) {
  const a = { vault: null, port: null, noBrowser: false, home: null, resetOwner: false, newPassword: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--help" || x === "-h") a.help = true;
    else if (x === "--no-browser") a.noBrowser = true;
    else if (x === "--port") a.port = parseInt(argv[++i], 10);
    else if (x === "--home") a.home = argv[++i];
    else if (x === "--reset-owner") a.resetOwner = true;
    else if (x === "--new-password") a.newPassword = argv[++i];
    else if (!a.vault) a.vault = x;
  }
  return a;
}

function help() {
  console.log(`
Shop OS Dashboard

Usage:  shop-os-dashboard <vault-path> [options]

Options:
  --port <N>          Use a specific port (default: first free in 50000-50010)
  --no-browser        Do not open the browser
  --home <dir>        Data folder (default ~/.shopos/dashboard)
  --reset-owner       Reset the owner password (run on the shop computer), then exit
  --new-password <p>  Password for --reset-owner (prompted if omitted)
  --help, -h          Show this message
`);
}

async function promptHidden(question) {
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer;
}

function openBrowser(url) {
  const cmd = platform() === "darwin" ? `open "${url}"` : platform() === "win32" ? `start "" "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

async function resetOwner({ home, newPassword }) {
  const users = new UserStore(join(home, "users.json"));
  const owners = users.list().filter((u) => u.role === "owner");
  if (owners.length === 0) die("No owner account exists yet. Open the dashboard on this computer to set one up.");
  let target = owners[0];
  if (owners.length > 1) {
    console.log("Owners: " + owners.map((o) => o.username).join(", "));
    const name = await promptHidden("Which owner? ");
    target = owners.find((o) => o.username.toLowerCase() === name.trim().toLowerCase()) ?? die("No such owner.");
  }
  const pw = newPassword ?? (await promptHidden(`New password for ${target.username} (10+ chars): `));
  try { await users.setPassword(target.id, pw); } catch (e) { die(e.message); }
  console.log(c.green("✓") + ` Password updated for ${target.username}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { help(); process.exit(0); }
  const home = args.home ? resolve(args.home) : dashboardHome();
  if (args.resetOwner) { await resetOwner({ home, newPassword: args.newPassword }); process.exit(0); }
  if (!args.vault) die("Missing vault path. Run: shop-os-dashboard <vault-path>");
  const vaultPath = resolve(args.vault);
  if (!existsSync(vaultPath) || !statSync(vaultPath).isDirectory()) die(`Vault folder not found: ${vaultPath}`);

  const license = readLicense();
  console.log(c.bold(c.cyan("Shop OS Dashboard")));
  console.log(c.dim(`  vault: ${vaultPath}`));
  console.log(c.dim(`  data:  ${home}`));
  console.log(c.dim(`  customer: ${license?.customer ?? "unknown (license check happens per request)"}`));

  const port = args.port ?? (await findFreePort().catch((e) => die(e.message)));
  const server = createServer({ vaultPath, homeDir: home });
  server.on("error", (e) => die(`Could not start: ${e.message}`));
  server.listen(port, "0.0.0.0", () => {
    console.log(c.green("✓") + ` Listening on port ${port}`);
    console.log(`  This computer: ${c.cyan(`http://localhost:${port}`)}`);
    for (const a of lanAddresses()) console.log(`  Shop network:  ${c.cyan(`http://${a}:${port}`)}`);
    console.log(c.dim("  Press Ctrl-C to stop."));
    if (!args.noBrowser) setTimeout(() => openBrowser(`http://localhost:${port}`), 250);
  });
  const shutdown = () => { console.log("\n" + c.dim("Stopping...")); server.ctx.index.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1000).unref?.(); };
  process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
}

main().catch((err) => die(err.message || String(err)));
```

- [ ] **Step 5: Run the tests, then start it for real**

Run: `npm test`
Expected: PASS

Run against a test vault:
```bash
node bin/shop-os-dashboard.js "C:\Users\glchu\Dropbox\AI Clients\Testing\Shop OS Test 2" --home "%TEMP%\sod-home"
```
Expected: the terminal prints the localhost URL and at least one shop-network URL. From a phone on the same Wi-Fi, the shop-network URL shows the "not set up yet" page until setup completes on the computer, then the login page.

While it runs, confirm Shop OS Chat still works on the same vault: double-click `Shop OS Chat.command` or `.bat` in that vault, and check it comes up on 7777. Both must coexist.

- [ ] **Step 6: Commit and tag**

```bash
git add bin src/lib/net.js test/net.test.js test/cli.test.js
git commit -m "feat: CLI entry with LAN binding, port fallback, and owner password reset

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git tag plan-1-foundation
```

---

## Plan 1 acceptance

All of these hold before Plan 2 begins:

1. `npm test` passes on Windows and on macOS.
2. `RUN_E2E=1 node --test test/e2e-real.test.js` passes on a machine signed in to Claude, proving `canUseTool` denies out-of-scope reads for staff. Outcome recorded in the commit message of Task 7 or a follow-up.
3. Manual run against `Testing/Shop OS Test 2`: setup, staff user, staff login from a second device, tree hides Context and Intelligence, chat declines to read outside scope, transcript lands in `Chats/` and opens in the note viewer.
4. Shop OS Chat keeps working on port 7777 against the same vault while the dashboard runs on 50000.
5. No file under `shop-os-chat`, `shop-os-installer`, `shop-os-license-server`, or `blueprint-skills` has changed (`git status` clean in each).

## What Plan 2 and Plan 3 will cover

- **Plan 2, owner dashboard:** port agentic-os `dashboard.html` into `public/owner.html` plus modules; `artifacts`, `snapshots`, `assets`, `layout` server modules; skills deck via the SDK slash-command prompt with `settingSources: ["user","project"]`; briefing, recent changes, team activity, roster widgets; orb → notes viewer; strip Skool URLs; keep the Credits tour card; per-user layout; locale from system; Playwright tests.
- **Plan 3, install and operate:** portable Node download, Claude Code native install, package install into `~/.shopos/app`, license and vault steps copied from today's installer minus git, Task Scheduler and launchd registration, desktop shortcut, `status` module and cards, `updater`, install-page scripts staged in this repo, first-week guide and staff runbook rewrites, cutover checklist.
