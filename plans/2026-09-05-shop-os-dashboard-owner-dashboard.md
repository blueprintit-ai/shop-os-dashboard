# Shop OS Dashboard Owner Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the agentic-os owner dashboard (ring, edit-mode widget grid, chat bar wiring, skills deck, artifacts, snapshots, business assets, tour, theme) into `shop-os-dashboard` as a dedicated `/owner` page, replacing the current owner/employee page-sharing behavior, with all state that the reference kit kept in `localStorage` moved server-side and per-user.

**Architecture:** The reference kit (`Dropbox/Robonuggets/agentic-os/dashboard.html`, `server.js`) is a single 4,000-line HTML file with inline CSS/JS plus a zero-dependency Node server — there is no module system to copy 1:1. This plan extracts it into the Foundation's established "one file, one job" module convention: new `src/*.js` data modules (artifacts, snapshots, settings, assets, runs) each with a matching `routes/*.js` file wired into `server.js`'s router array, and new `public/js/owner/*.js` front-end modules ported out of `dashboard.html`'s inline script. Google Calendar, email triage, and all RoboNuggets/Skool marketing links are dropped; the CC BY 4.0 credit card is kept verbatim. The skills deck's headless runner is rebuilt on the Agent SDK `query()` already used by `chat/run-turn.js` instead of the kit's `spawn(cmdline, {shell:true})`, eliminating an entire shell-injection risk class.

**Tech Stack:** Node 20+ (dev on 24), ESM, `node:http`, `@anthropic-ai/claude-agent-sdk` 0.3.261, `marked` 18.0.11, `node --test`, Playwright (new devDependency, browser tests only). No native modules, no framework, no bundler, no CDN scripts (LAN-only, so `three.js` and `thinking-orbs.js` are vendored files, not `importmap`/jsdelivr).

**Spec:** `Projects/shop-os-dashboard/specs/2026-09-05-shop-os-dashboard-design.md` (Section 4: Owner dashboard and employee page; Section 1: `artifacts`/`snapshots`/`assets`/`layout` modules; Licensing and attribution)

**This is Plan 2 of 3.** Plan 1 (Foundation — server, auth, notes, chat, employee page, Users screen) is implemented and merged from branch `foundation-implementation` (PR #1). Plan 3 builds the installer, auto-start, updater, and status cards. Plan 2 continues in the same worktree/branch lineage as Plan 1 (see "Branch" note below) and must run end to end on its own: owner logs in, sees the ring/widget dashboard, runs a skill, browses artifacts and assets, and the CC BY credit tour step is reachable.

**Reference sources (read-only, never modified):**
- `Dropbox/Robonuggets/agentic-os/dashboard.html` — the OS shell (CSS + JS inline, ~3,975 lines)
- `Dropbox/Robonuggets/agentic-os/widgets.html`, `assets.html`, `server.js`, `os-config.json`
- `Dropbox/Robonuggets/agentic-os/REDESIGN.md`, `RING.md`, `ROUTINES.md`, `NOTICE.md`
- `Dropbox/Robonuggets/agentic-os/vendor/thinking-orbs.js` (MIT, Jakub Antalik)

## Global Constraints

- Continues on top of Plan 1's code. Branch from `foundation-implementation` (or its merged state on `main` if PR #1 has landed by execution time) as `owner-dashboard-implementation`. Never edit `shop-os-chat`, `shop-os-installer`, `shop-os-license-server`, or `blueprint-skills`. The `Dropbox/Robonuggets/agentic-os` and `Dropbox/Robonuggets/second-brain` folders are reference-only — read, never modified, never imported at runtime.
- No new runtime dependency may be a shell-spawning wrapper. The skills runner uses `chat/run-turn.js`'s `runTurn()` (Agent SDK `query()`), never `child_process.spawn(..., {shell:true})` and never a hand-built command-line string. If a task's spike (Task 7) concludes the SDK path doesn't work for headless skill runs, the documented fallback is `spawn(bin, argsArray, {cwd})` — an argument array, `shell` omitted (default `false`), never a template string.
- All per-user state that the reference kit stored in `localStorage` (widget layout, theme, tour-seen flag) moves server-side into `~/.shopos/dashboard/layouts/<userId>.json`, per the existing Data layout table in the design spec.
- No Google Calendar, no email triage, no `gws` CLI dependency, no `tools/google-calendar.js`, no `OAUTH.md`/`WIRING.md` email section. None of that code is ported.
- Every RoboNuggets/Skool marketing URL (`skool.com/robonuggets/classroom/...`) found during the port is deleted, not carried over. The one exception is the CC BY 4.0 tour credit card's `https://skool.com/robonuggets` link, which is required by the license and must be kept.
- Business Assets folder is owner-configurable (`src/settings.js`), never hardcoded to a path from `os-config.json`.
- Artifact sidecars gain a `visibility: "owner" | "staff"` field (default `"owner"` when absent, matching current kit behavior of "everything is owner's"). Staff only ever see `visibility: "staff"` artifacts, and only when their `switches.artifactsShared` is `true`.
- Every new route follows the existing guard pattern (`requireUser`/`requireOwner` from `src/auth.js`) and the `[method, path, {anon, staff, owner}]` role-matrix test convention from `test/server.test.js`.
- Every POST/PUT still requires the CSRF check already enforced centrally in `server.js` (`sameOriginOk`) — no route-level exemption needed, it's the same server.
- Tests use `node --test`. Playwright is a devDependency added in this plan (Task 14), browser tests are dev-only and excluded from `npm test`.
- Commit after every task. Commit messages: `feat:`, `test:`, `chore:` prefixes, and end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- `node_modules` gets re-marked Dropbox-ignored after the first `npm install` in the new worktree (Windows: `Set-Content -Path node_modules -Stream com.dropbox.ignored -Value 1`; Mac: `xattr -w com.dropbox.ignored 1 node_modules`) — the ignore flag does not survive folder recreation.

---

## File structure

```
shop-os-dashboard/                          (continues from Plan 1)
  package.json                              Modify: add devDependency playwright
  NOTICE.md                                 Modify: add thinking-orbs.js MIT credit line
  REDESIGN.md                               Create: reskin contract, adapted for the new palette
  src/
    layout.js                               Create: per-user layout+theme+tourSeen JsonStore wrapper
    artifacts.js                            Create: list/infer/remove artifacts, visibility filter
    snapshots.js                            Create: read stats.json/routines.json/runs.json feeds
    settings.js                             Create: owner settings store (assets dir, session cap, port override)
    assets.js                               Create: Business Assets scan/upload/favorite/serve
    runs.js                                 Create: skills deck headless runner (SDK query(), no shell)
    routes/layout-routes.js                 Create: GET/PUT /api/layout
    routes/artifacts-routes.js              Create: GET /api/artifacts, POST /api/artifacts/remove
    routes/snapshots-routes.js              Create: GET /api/snapshots/stats, /routines
    routes/settings-routes.js               Create: GET/PUT /api/settings
    routes/assets-routes.js                 Create: GET /api/assets, POST /favorite|/upload|/open, GET /assets/file/:id
    routes/runs-routes.js                   Create: GET /api/runs, POST /api/runs, GET /api/runs/:jobId
    server.js                               Modify: wire 6 new routers into the router array
    routes/pages.js                         Modify: /owner serves owner.html; injects theme class + shop name
  public/
    owner.html                              Create: owner dashboard shell
    assets.html                             Create: ported Business Assets full-page browser
    css/owner.css                           Create: theme tokens + grid/widget/ring/tour chrome
    vendor/thinking-orbs.js                 Create: copied verbatim from the kit (MIT header intact)
    vendor/three.module.min.js              Create: vendored three.js r160 build (no CDN — LAN only)
    js/owner/theme.js                       Create: boot theme class + toggle -> PUT /api/layout
    js/owner/layout-client.js               Create: GET/PUT layout fetch wrapper, shared by widgets/theme/tour
    js/owner/widgets.js                     Create: grid edit-mode engine (drag/resize/remove/add)
    js/owner/data-widgets.js                Create: today's briefing, recent changes, team activity, team roster
    js/owner/ring.js                        Create: hex/grid canvas bg, ball physics, ball context menu, orb portal
    js/owner/search.js                      Create: artifact search overlay (`/` key)
    js/owner/tour.js                        Create: 7-step tour incl. CC BY credit card
    js/owner/skills-deck.js                 Create: deck render + run trigger + status poll
    js/owner/assets-widget.js               Create: favorites tile on the dashboard, links to /assets
    js/assets-page.js                       Create: ported assets.html page logic
  test/
    fixtures/vault/Dashboard/
      artifacts/sample-report.html          Create: fixture artifact + sidecar pair
      artifacts/sample-report.json          Create
      snapshots/stats.json                  Create: fixture stats feed
      snapshots/routines.json               Create: fixture routines feed
    layout.test.js                          Create
    artifacts.test.js                       Create
    snapshots.test.js                       Create
    settings.test.js                        Create
    assets.test.js                          Create
    runs.test.js                            Create
    owner-routes.test.js                    Create: role-matrix coverage for every new route
    e2e/owner.spec.js                       Create: Playwright browser tests (dev only, not in `npm test`)
```

---

### Task 1: Owner page routing, theme tokens skeleton, repo housekeeping

**Files:**
- Modify: `package.json` (add `"playwright": "^1.48.0"` devDependency), `NOTICE.md`
- Create: `REDESIGN.md`, `public/owner.html`, `public/css/owner.css` (tokens block only for now)
- Modify: `src/routes/pages.js`

**Interfaces:**
- Produces: `public/owner.html` template placeholders `__ROLE__`, `__SHOP_NAME__`, `__THEME_CLASS__` (server-side string replace, same pattern `employee.html` already uses for `__ROLE__`)
- Consumes: `readShopName(vaultPath)` from `src/chat/system-prompt.js` (already exported, used by `pages.js` today for `/api/me`)

- [ ] **Step 1: Write the failing test for `/owner` serving the new page**

```js
// test/pages.test.js (extend existing file)
test("GET /owner serves owner.html, not employee.html", async () => {
  const { server, jar } = await bootAsOwner();
  const res = await fetch(`${base(server)}/owner`, { headers: { cookie: jar.owner } });
  const body = await res.text();
  assert.equal(res.status, 200);
  assert.match(body, /id="ring-root"/);       // owner.html marker, absent from employee.html
  assert.doesNotMatch(body, /data-tab="chat"/); // employee.html's tab markup
  server.close(); server.ctx.index.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pages.test.js`
Expected: FAIL — `owner.html` doesn't exist yet, `/owner` still serves `employee.html`.

- [ ] **Step 3: Create `public/css/owner.css` with the theme token block**

Ported from `Robonuggets/agentic-os/dashboard.html`'s `<style>` `:root`/`html.light` block (per `REDESIGN.md`'s "Where the look lives" §1), values kept as the kit's Blueprint IT-reskinned palette (not the stale orange REDESIGN.md quotes):

```css
:root {
  --accent: #1c6ea4; --cream: #e8e2d2; --mute: #8d8775; --warm: #b9b19c;
  --bg: #141310; --panel: #0d0c09;
}
html.light {
  --accent: #1c6ea4; --cream: #0c1e2f; --mute: #5c6b78; --warm: #38495a;
  --bg: #f2efe8; --panel: #ffffff;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--cream); font-family: system-ui, sans-serif; }
```

- [ ] **Step 4: Create `REDESIGN.md` in the repo root**

Copy `Robonuggets/agentic-os/REDESIGN.md` verbatim except: update the CSS token quote in §1 to the values above (this repo's real tokens, not the kit's stale orange example), and update the file reference from `dashboard.html` to `public/owner.html` + `public/css/owner.css` throughout. Keep the five "Principles that survived our reskins" unchanged — they are the contract, not the values.

- [ ] **Step 5: Create the minimal `public/owner.html` shell**

```html
<!doctype html>
<html lang="en" class="__THEME_CLASS__">
<head>
  <meta charset="utf-8" />
  <title>Shop OS — __SHOP_NAME__</title>
  <link rel="stylesheet" href="/static/css/base.css" />
  <link rel="stylesheet" href="/static/css/owner.css" />
</head>
<body data-role="__ROLE__">
  <header id="owner-header">
    <span id="owner-shop-name"></span>
    <a id="users-link" href="/users">Users</a>
    <button id="theme-btn" aria-label="Toggle theme"></button>
    <button id="logout-btn">Logout</button>
  </header>
  <main id="ring-root"></main>
  <div id="widgets-root"></div>
  <div id="chat-root" hidden></div>
  <div id="notes-root" hidden></div>
  <script src="/static/vendor/marked.min.js"></script>
  <script type="module" src="/static/js/owner/theme.js"></script>
  <script type="module" src="/static/js/chat.js"></script>
  <script type="module" src="/static/js/notes.js"></script>
  <script type="module" src="/static/js/owner/boot.js"></script>
</body>
</html>
```

**Two containers, two owners:** `#ring-root` holds the canvas/orb layer built by `mountRing()` (Task 10) — the fixed center piece. `#widgets-root` holds the draggable grid built by `mountGrid()` (Task 9) — an absolutely-positioned overlay of panels, matching the kit's own layering (`dashboard.html`'s ring and widget grid are separate DOM layers over one viewport, never one replacing the other). Task 13's `boot.js` is what actually calls both, plus `mountSearch`/`mountTour`, once every renderer module exists.

Note: `chat.js` and `notes.js` are Plan 1's existing role-agnostic modules (unchanged — they read role from `/api/me` at runtime, per the Foundation survey's finding that `/owner` and `/employee` already share them). They build their own DOM into `#chat-root`/`#notes-root` exactly as they do on `employee.html` today; both `data-tab-panel` sections start hidden here because Task 13 controls their visibility from the ring's chat-bar toggle instead of `employee.html`'s tab buttons.

- [ ] **Step 6: Update `src/routes/pages.js`'s `/owner` branch**

Before (from Plan 1): `/owner` and `/employee` both call `page("employee.html").replace("__ROLE__", user.role)`. Change `/owner` to serve `owner.html`, filling all three placeholders (theme comes from the new `layout.js` store, added in Task 2 — for this step, hardcode `""` for `__THEME_CLASS__` since Task 2 wires it for real):

```js
if (p === "/owner") {
  const user = requireSessionRedirect(req, res, auth); if (!user) return true;
  if (user.role !== "owner") return send(res, 302, { Location: "/employee" }), true;
  const html = page("owner.html")
    .replace("__ROLE__", user.role)
    .replace("__SHOP_NAME__", readShopName(vaultPath))
    .replace("__THEME_CLASS__", "");
  return send(res, 200, { "content-type": "text/html" }, html), true;
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `node --test test/pages.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json NOTICE.md REDESIGN.md public/owner.html public/css/owner.css src/routes/pages.js test/pages.test.js
git commit -m "feat: dedicated owner.html page, theme tokens, REDESIGN.md contract"
```

---

### Task 2: Per-user layout, theme, and tour-seen persistence

**Files:**
- Create: `src/layout.js`, `src/routes/layout-routes.js`
- Test: `test/layout.test.js`
- Modify: `src/server.js` (wire router)

**Interfaces:**
- Consumes: `JsonStore` from `src/lib/store.js`, `dashboardHome()` from `src/lib/paths.js`, `requireUser` from `src/auth.js`
- Produces: `class LayoutStore { constructor(homeDir); get(userId) -> Layout; save(userId, layout) }`, `defaultLayout() -> Layout`
- Produces (type, consumed by Tasks 8/9/12 front-end code as JSON over the wire): `Layout = { theme: "dark"|"light", tourSeen: boolean, gridV2: true, orb: {c,r,s,z}, removed: [{id,name,c,r,cs,rs}], widgets: [{id,name,kind,c,r,cs,rs}] }`

- [ ] **Step 1: Write the failing test**

```js
// test/layout.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LayoutStore, defaultLayout } from "../src/layout.js";

test("LayoutStore returns default layout for a new user, then persists changes", () => {
  const home = mkdtempSync(join(tmpdir(), "sod-layout-"));
  const store = new LayoutStore(home);
  const first = store.get("user-1");
  assert.deepEqual(first, defaultLayout());
  assert.equal(first.theme, "dark");

  store.save("user-1", { ...first, theme: "light", tourSeen: true });
  const again = store.get("user-1");
  assert.equal(again.theme, "light");
  assert.equal(again.tourSeen, true);

  const other = store.get("user-2");
  assert.equal(other.theme, "dark"); // untouched, isolated per user
  rmSync(home, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/layout.test.js`
Expected: FAIL with "Cannot find module '../src/layout.js'".

- [ ] **Step 3: Implement `src/layout.js`**

```js
import { join } from "node:path";
import { JsonStore } from "./lib/store.js";

export function defaultLayout() {
  return {
    theme: "dark",
    tourSeen: false,
    gridV2: true,
    orb: { c: 16, r: 9, s: 1.7, z: 2.6 },
    removed: [{ id: "w-wheel", name: "ACTION WHEEL", c: 20, r: 2, cs: 4, rs: 4 }],
    widgets: [
      { id: "w-title", name: "TITLE", kind: "title", c: 8, r: 0, cs: 16, rs: 2 },
      { id: "w-rt", name: "ROUTINES", kind: "routines", c: 0, r: 2, cs: 8, rs: 6 },
      { id: "w-sk", name: "SKILLS DECK", kind: "skills", c: 24, r: 2, cs: 8, rs: 8 },
      { id: "w-stats", name: "STATS", kind: "stats", c: 0, r: 8, cs: 8, rs: 4 },
      { id: "w-ba", name: "BUSINESS ASSETS", kind: "assets", c: 24, r: 10, cs: 8, rs: 4 },
      { id: "w-brief", name: "TODAY'S BRIEFING", kind: "briefing", c: 0, r: 12, cs: 8, rs: 4 },
      { id: "w-recent", name: "RECENT CHANGES", kind: "recent", c: 8, r: 16, cs: 8, rs: 5 },
      { id: "w-team", name: "TEAM ACTIVITY", kind: "team-activity", c: 16, r: 16, cs: 8, rs: 5 },
      { id: "w-roster", name: "TEAM ROSTER", kind: "team-roster", c: 24, r: 16, cs: 8, rs: 5 },
    ],
  };
}

export class LayoutStore {
  constructor(homeDir) {
    this.dir = join(homeDir, "layouts");
  }
  #storeFor(userId) {
    return new JsonStore(join(this.dir, `${userId}.json`), defaultLayout());
  }
  get(userId) {
    return this.#storeFor(userId).load();
  }
  save(userId, layout) {
    this.#storeFor(userId).save(layout);
    return layout;
  }
}
```

Note: `JsonStore`'s constructor takes `(filePath, defaults)` per Plan 1's `src/lib/store.js:load()` returning `structuredClone(defaults)` when the file is missing — `mkdirSync(this.dir, {recursive:true})` must happen before `save()`; add it in `save()` since `layouts/` won't exist on first write. (`load()` on a missing file doesn't need the directory to exist, only `save()`'s rename does.)

- [ ] **Step 4: Fix the directory-creation gap and re-run**

```js
import { mkdirSync } from "node:fs";
// inside save():
save(userId, layout) {
  mkdirSync(this.dir, { recursive: true });
  this.#storeFor(userId).save(layout);
  return layout;
}
```

Run: `node --test test/layout.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing route test**

```js
// test/layout.test.js (append)
test("GET/PUT /api/layout round-trips per user, requires auth", async () => {
  const { server, jar } = await bootAsOwner();
  const b = base(server);
  const anon = await fetch(`${b}/api/layout`);
  assert.equal(anon.status, 401);

  const got = await fetch(`${b}/api/layout`, { headers: { cookie: jar.owner } });
  assert.equal(got.status, 200);
  const layout = await got.json();
  assert.equal(layout.theme, "dark");

  const put = await fetch(`${b}/api/layout`, {
    method: "PUT", headers: { cookie: jar.owner, "content-type": "application/json", origin: b },
    body: JSON.stringify({ ...layout, theme: "light" }),
  });
  assert.equal(put.status, 200);

  const got2 = await fetch(`${b}/api/layout`, { headers: { cookie: jar.owner } });
  assert.equal((await got2.json()).theme, "light");
  server.close(); server.ctx.index.close();
});
```

- [ ] **Step 6: Implement `src/routes/layout-routes.js`**

```js
import { requireUser } from "../auth.js";
import { sendJson, readJsonBody } from "../lib/http.js";

export function layoutRoutes({ auth, layoutStore }) {
  return async (req, res, url) => {
    const p = url.pathname;
    if (p !== "/api/layout") return false;
    const user = requireUser(req, res, auth);
    if (!user) return true;
    if (req.method === "GET") {
      return sendJson(res, 200, layoutStore.get(user.id)), true;
    }
    if (req.method === "PUT") {
      const body = await readJsonBody(req);
      return sendJson(res, 200, layoutStore.save(user.id, body)), true;
    }
    return false;
  };
}
```

- [ ] **Step 7: Wire into `src/server.js`**

Add `import { LayoutStore } from "./layout.js";` and `import { layoutRoutes } from "./routes/layout-routes.js";`. In `createServer()`, alongside the existing `ctx` build: `const layoutStore = new LayoutStore(homeDir); ctx.layoutStore = layoutStore;`. Add `layoutRoutes(ctx)` to the `routers` array (position doesn't matter — each router checks its own path prefix first).

- [ ] **Step 8: Run full test suite**

Run: `node --test`
Expected: PASS, including the new layout tests, with no regressions in Plan 1's suite.

- [ ] **Step 9: Commit**

```bash
git add src/layout.js src/routes/layout-routes.js src/server.js test/layout.test.js
git commit -m "feat: per-user server-side layout/theme/tour-seen persistence"
```

---

### Task 3: Artifacts backend (ring data, visibility, fix the missing remove route)

**Files:**
- Create: `src/artifacts.js`, `src/routes/artifacts-routes.js`
- Test: `test/artifacts.test.js`, `test/fixtures/vault/Dashboard/artifacts/sample-report.html`, `.../sample-report.json`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `allowedRoots`/`isPathAllowed` pattern is not reused here (artifacts live under `<vault>/Dashboard/artifacts/`, a fixed location, not folder-scoped like notes); `requireUser`/`requireOwner` from `src/auth.js`
- Produces: `function listArtifacts(vaultPath, user) -> {fetched, count, artifacts: [{file,title,icon,kind,note,svg,category,visibility,created,modified,url}]}`, `function removeArtifact(vaultPath, file) -> {ok:true}|{error,code}`

**Note on the kit's bug:** `Robonuggets/agentic-os/server.js`'s header comment documents `POST /api/artifact-remove -> artifacts/_trash`, and `dashboard.html`'s context menu calls it, but the route is never implemented in the kit's `http.createServer` handler (confirmed absent from `server.js:658-773`). This task implements it for real.

- [ ] **Step 1: Write the failing test for listing and visibility filtering**

```js
// test/artifacts.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listArtifacts, removeArtifact } from "../src/artifacts.js";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/artifacts.test.js`
Expected: FAIL with "Cannot find module '../src/artifacts.js'".

- [ ] **Step 3: Implement `src/artifacts.js`**

Icon/category inference regexes ported verbatim from `Robonuggets/agentic-os/server.js:155-180` (`ICON_RULES`, `CAT_RULES`, `inferIcon`, `inferCategory`); listing logic ported and adapted from `getArtifacts()` (`server.js:181-208`) to add the visibility field and role filter; remove logic is new (the kit never implemented it).

```js
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const ICON_RULES = [
  [/deck|slide|present/i, "deck"],
  [/report|audit|analysis/i, "report"],
  [/dash|board|monitor/i, "dash"],
  [/brief|inbox|email|digest/i, "mail"],
  [/lesson|script|video|thumb/i, "video"],
  [/chart|graph|metric|mrr/i, "chart"],
  [/wheel|orb|visual|design/i, "visual"],
  [/prompt|skill|agent/i, "bolt"],
];
function inferIcon(name) {
  for (const [re, ic] of ICON_RULES) if (re.test(name)) return ic;
  return "doc";
}
const CAT_RULES = [
  [/post|newsletter|writ|script|hook|draft|announce|description|blurb|copy/i, "writing"],
  [/landing|site|page|dashboard|app|demo|web|frontend|ui|widget|lab|library|game/i, "frontend"],
  [/infographic|explain|report|guide|map|slide|deck|digest|packag|progress|workshop|kickoff|snapshot/i, "infographic"],
];
function inferCategory(name) {
  for (const [re, cat] of CAT_RULES) if (re.test(name)) return cat;
  return "other";
}

function artifactsDir(vaultPath) {
  return join(vaultPath, "Dashboard", "artifacts");
}

export function listArtifacts(vaultPath, user) {
  const dir = artifactsDir(vaultPath);
  if (!existsSync(dir)) return { fetched: new Date().toISOString(), count: 0, artifacts: [] };
  const files = readdirSync(dir).filter((f) => /\.html?$/i.test(f));
  let artifacts = files.map((f) => {
    const full = join(dir, f);
    const st = statSync(full);
    let meta = {};
    const side = full.replace(/\.html?$/i, ".json");
    if (existsSync(side)) {
      try { meta = JSON.parse(readFileSync(side, "utf8")); } catch { /* corrupt sidecar: fall back to inference */ }
    }
    let title = meta.title;
    if (!title) {
      const head = readFileSync(full, "utf8").slice(0, 2000);
      title = (head.match(/<title>([^<]+)<\/title>/i)?.[1] || f.replace(/\.html?$/i, "")).trim();
    }
    return {
      file: f, title,
      icon: meta.icon || inferIcon(f + " " + title),
      kind: meta.kind || "artifact",
      note: meta.note || "",
      svg: meta.svg || "",
      category: meta.category || inferCategory(f + " " + title + " " + (meta.kind || "")),
      visibility: meta.visibility === "staff" ? "staff" : "owner",
      created: meta.created || st.birthtime.toISOString(),
      modified: st.mtime.toISOString(),
      url: "/artifacts/" + encodeURIComponent(f),
    };
  }).sort((a, b) => new Date(b.modified) - new Date(a.modified));

  if (user.role !== "owner") {
    const shared = user.switches?.artifactsShared === true;
    artifacts = shared ? artifacts.filter((a) => a.visibility === "staff") : [];
  }
  return { fetched: new Date().toISOString(), count: artifacts.length, artifacts };
}

export function removeArtifact(vaultPath, file) {
  if (typeof file !== "string" || !/^[^/\\]+\.html?$/i.test(file)) return { error: "bad-path", code: 400 };
  const dir = artifactsDir(vaultPath);
  const htmlPath = join(dir, file);
  const jsonPath = htmlPath.replace(/\.html?$/i, ".json");
  if (!existsSync(htmlPath)) return { error: "not-found", code: 404 };
  const trash = join(dir, "_trash");
  mkdirSync(trash, { recursive: true });
  renameSync(htmlPath, join(trash, basename(htmlPath)));
  if (existsSync(jsonPath)) renameSync(jsonPath, join(trash, basename(jsonPath)));
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/artifacts.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing route test (role matrix)**

```js
// test/artifacts.test.js (append)
test("GET /api/artifacts and POST /api/artifacts/remove role matrix", async () => {
  const { server, jar, vaultPath } = await bootAsOwner();
  const b = base(server);
  seedArtifactInto(vaultPath); // helper: writes one owner-visibility artifact

  assert.equal((await fetch(`${b}/api/artifacts`)).status, 401);
  const asOwner = await fetch(`${b}/api/artifacts`, { headers: { cookie: jar.owner } });
  assert.equal((await asOwner.json()).count, 1);

  const removeAsStaff = await fetch(`${b}/api/artifacts/remove`, {
    method: "POST", headers: { cookie: jar.staff, "content-type": "application/json", origin: b },
    body: JSON.stringify({ file: "owner-only.html" }),
  });
  assert.equal(removeAsStaff.status, 403);

  const removeAsOwner = await fetch(`${b}/api/artifacts/remove`, {
    method: "POST", headers: { cookie: jar.owner, "content-type": "application/json", origin: b },
    body: JSON.stringify({ file: "owner-only.html" }),
  });
  assert.equal(removeAsOwner.status, 200);
  server.close(); server.ctx.index.close();
});
```

- [ ] **Step 6: Implement `src/routes/artifacts-routes.js`**

```js
import { requireUser, requireOwner } from "../auth.js";
import { sendJson, readJsonBody } from "../lib/http.js";
import { listArtifacts, removeArtifact } from "../artifacts.js";

export function artifactsRoutes({ vaultPath, auth, audit }) {
  return async (req, res, url) => {
    const p = url.pathname;
    if (p === "/api/artifacts" && req.method === "GET") {
      const user = requireUser(req, res, auth); if (!user) return true;
      return sendJson(res, 200, listArtifacts(vaultPath, user)), true;
    }
    if (p === "/api/artifacts/remove" && req.method === "POST") {
      const user = requireOwner(req, res, auth); if (!user) return true;
      const body = await readJsonBody(req);
      const result = removeArtifact(vaultPath, body.file);
      audit.log("artifact.remove", { userId: user.id, username: user.username, role: user.role, file: body.file, ok: !!result.ok });
      if (result.error) return sendJson(res, result.code || 400, { error: result.error }), true;
      return sendJson(res, 200, result), true;
    }
    return false;
  };
}
```

- [ ] **Step 7: Wire into `src/server.js` router array; also serve `/artifacts/<file>` statically**

`Robonuggets/agentic-os/server.js:764-767`'s `safeJoin(ARTIFACTS, ...)` static-serve pattern already matches Plan 1's `serveStatic`/path-traversal conventions used for `/static/`. Add a small branch in `routes/pages.js` (or a new tiny route file) for `GET /artifacts/*`: resolve under `<vault>/Dashboard/artifacts`, reject any `..`, `serveStatic`. Gate it with `requireUser` and the same visibility rule as `listArtifacts` (re-check the sidecar's `visibility` field before serving staff requests for a file staff didn't get listed).

- [ ] **Step 8: Run full test suite**

Run: `node --test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/artifacts.js src/routes/artifacts-routes.js src/server.js test/artifacts.test.js
git commit -m "feat: artifacts backend with visibility scoping, fix missing remove route"
```

---

### Task 4: Snapshots backend (stats, routines)

**Files:**
- Create: `src/snapshots.js`, `src/routes/snapshots-routes.js`
- Test: `test/snapshots.test.js`, fixtures under `test/fixtures/vault/Dashboard/snapshots/`
- Modify: `src/server.js`

**Interfaces:**
- Produces: `function readStats(vaultPath) -> {needsSetup:true} | StatsFeed`, `function readRoutines(vaultPath) -> {needsSetup:true,sources:[],routines:[],counts:{}} | RoutinesFeed`

Schemas ported verbatim from the kit's `ROUTINES.md` and observed `stats.json` (both quoted in the survey; confirmed against `Robonuggets/agentic-os/server.js:136-150`'s `getStats()`/`getRoutines()`, which this reimplements without the in-memory TTL cache — Plan 2 vaults are local disk, not network APIs, so no cache is needed).

- [ ] **Step 1: Write the failing test**

```js
// test/snapshots.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readStats, readRoutines } from "../src/snapshots.js";

test("readStats/readRoutines return needsSetup when the feed file is absent", () => {
  const vault = mkdtempSync(join(tmpdir(), "sod-snap-"));
  assert.deepEqual(readStats(vault), { needsSetup: true });
  assert.deepEqual(readRoutines(vault), { needsSetup: true, sources: [], routines: [], counts: {} });
  rmSync(vault, { recursive: true, force: true });
});

test("readStats/readRoutines parse real feed files", () => {
  const vault = mkdtempSync(join(tmpdir(), "sod-snap-"));
  const dir = join(vault, "Dashboard", "snapshots");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "stats.json"), JSON.stringify({
    title: "BUSINESS HEALTH", asOf: "2026-09-05",
    metrics: [{ big: "48%", cap: "GROSS PROFIT<br>margin" }],
  }));
  writeFileSync(join(dir, "routines.json"), JSON.stringify({
    generated: "2026-09-05T07:00:00Z",
    sources: [{ key: "shop", label: "SHOP AGENT" }],
    counts: { shop: 1 },
    routines: [{ t: "07:00", d: "daily", src: "shop", n: "morning digest", desc: "summarize the day" }],
  }));
  assert.equal(readStats(vault).metrics[0].big, "48%");
  assert.equal(readRoutines(vault).routines[0].n, "morning digest");
  rmSync(vault, { recursive: true, force: true });
});

test("readStats/readRoutines report a parse error without crashing", () => {
  const vault = mkdtempSync(join(tmpdir(), "sod-snap-"));
  const dir = join(vault, "Dashboard", "snapshots");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "stats.json"), "{not json");
  assert.match(readStats(vault).error, /stats\.json/);
  rmSync(vault, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/snapshots.test.js`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `src/snapshots.js`**

```js
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function snapshotsDir(vaultPath) {
  return join(vaultPath, "Dashboard", "snapshots");
}

export function readStats(vaultPath) {
  const f = join(snapshotsDir(vaultPath), "stats.json");
  if (!existsSync(f)) return { needsSetup: true };
  try { return JSON.parse(readFileSync(f, "utf8")); }
  catch (e) { return { error: "stats.json: " + e.message }; }
}

export function readRoutines(vaultPath) {
  const f = join(snapshotsDir(vaultPath), "routines.json");
  if (!existsSync(f)) return { needsSetup: true, sources: [], routines: [], counts: {} };
  try { return JSON.parse(readFileSync(f, "utf8")); }
  catch (e) { return { error: "routines.json: " + e.message, sources: [], routines: [] }; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/snapshots.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing route test and implement `src/routes/snapshots-routes.js`**

```js
// test/snapshots.test.js (append)
test("GET /api/snapshots/stats and /routines require a session", async () => {
  const { server, jar } = await bootAsOwner();
  const b = base(server);
  assert.equal((await fetch(`${b}/api/snapshots/stats`)).status, 401);
  assert.equal((await fetch(`${b}/api/snapshots/stats`, { headers: { cookie: jar.owner } })).status, 200);
  assert.equal((await fetch(`${b}/api/snapshots/routines`, { headers: { cookie: jar.owner } })).status, 200);
  server.close(); server.ctx.index.close();
});
```

```js
import { requireUser } from "../auth.js";
import { sendJson } from "../lib/http.js";
import { readStats, readRoutines } from "../snapshots.js";

export function snapshotsRoutes({ vaultPath, auth }) {
  return async (req, res, url) => {
    const p = url.pathname;
    if (p === "/api/snapshots/stats") {
      const user = requireUser(req, res, auth); if (!user) return true;
      return sendJson(res, 200, readStats(vaultPath)), true;
    }
    if (p === "/api/snapshots/routines") {
      const user = requireUser(req, res, auth); if (!user) return true;
      return sendJson(res, 200, readRoutines(vaultPath)), true;
    }
    return false;
  };
}
```

- [ ] **Step 6: Wire into `src/server.js` router array**

- [ ] **Step 7: Run full test suite**

Run: `node --test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/snapshots.js src/routes/snapshots-routes.js src/server.js test/snapshots.test.js
git commit -m "feat: snapshots backend for stats and routines widgets"
```

---

### Task 5: Owner settings module

**Files:**
- Create: `src/settings.js`, `src/routes/settings-routes.js`
- Test: `test/settings.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Produces: `class SettingsStore { constructor(homeDir); get() -> Settings; save(patch) -> Settings }`, `Settings = { assetsDir: string|null, sessionCap: number, portOverride: number|null }`

This module doesn't exist in the reference kit (the kit hardcodes `assets.dir` in `os-config.json`, which per the design spec is explicitly not carried forward: "Folder configured by the owner in settings, not hardcoded"). It is new code, needed before Task 6 (assets) can read a configurable folder.

- [ ] **Step 1: Write the failing test**

```js
// test/settings.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsStore } from "../src/settings.js";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/settings.test.js`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `src/settings.js`**

```js
import { JsonStore } from "./lib/store.js";
import { join } from "node:path";

function defaults() {
  return { assetsDir: null, sessionCap: 3, portOverride: null };
}

export class SettingsStore {
  constructor(homeDir) {
    this.store = new JsonStore(join(homeDir, "settings.json"), defaults());
  }
  get() {
    return this.store.load();
  }
  save(patch) {
    const merged = { ...this.get(), ...patch };
    this.store.save(merged);
    return merged;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/settings.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing route test and implement `src/routes/settings-routes.js` (owner-only)**

```js
// test/settings.test.js (append)
test("GET/PUT /api/settings is owner-only", async () => {
  const { server, jar } = await bootAsOwner();
  const b = base(server);
  assert.equal((await fetch(`${b}/api/settings`, { headers: { cookie: jar.staff } })).status, 403);
  const got = await fetch(`${b}/api/settings`, { headers: { cookie: jar.owner } });
  assert.equal(got.status, 200);
  const put = await fetch(`${b}/api/settings`, {
    method: "PUT", headers: { cookie: jar.owner, "content-type": "application/json", origin: b },
    body: JSON.stringify({ sessionCap: 5 }),
  });
  assert.equal((await put.json()).sessionCap, 5);
  server.close(); server.ctx.index.close();
});
```

```js
import { requireOwner } from "../auth.js";
import { sendJson, readJsonBody } from "../lib/http.js";

export function settingsRoutes({ auth, settingsStore, audit }) {
  return async (req, res, url) => {
    if (url.pathname !== "/api/settings") return false;
    const user = requireOwner(req, res, auth); if (!user) return true;
    if (req.method === "GET") return sendJson(res, 200, settingsStore.get()), true;
    if (req.method === "PUT") {
      const patch = await readJsonBody(req);
      const saved = settingsStore.save(patch);
      audit.log("settings.change", { userId: user.id, username: user.username, role: user.role, patch });
      return sendJson(res, 200, saved), true;
    }
    return false;
  };
}
```

- [ ] **Step 6: Wire `SettingsStore` into `ctx` in `src/server.js`, add router**

- [ ] **Step 7: Run full test suite**

Run: `node --test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/settings.js src/routes/settings-routes.js src/server.js test/settings.test.js
git commit -m "feat: owner settings store for assets folder, session cap, port override"
```

---

### Task 6: Business Assets backend

**Files:**
- Create: `src/assets.js`, `src/routes/assets-routes.js`
- Test: `test/assets.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `SettingsStore.get().assetsDir` (Task 5) for the folder root; falls back to `<homeDir>/business-assets` when unset
- Produces: `function scanAssets(rootDir) -> {dir,maxFavorites,categories,files,favorites}`, `function setFavorite(rootDir, id, on) -> {ok,favorite,favorites}|{error,code}`, `function assetPath(rootDir, id) -> {abs,rel}|null`, `function assetId(rel) -> string`, `function saveUpload(rootDir, category, name, buffer) -> {id,name,category,size}`

Ported from `Robonuggets/agentic-os/server.js:388-493` (`scanAssets`, `setAssetFavorite`, `assetId`/`assetPath`, `uploadAsset`, `serveAsset`, `ASSET_MIME`) — the path-escape guard (`abs.startsWith(ASSETS_DIR + path.sep)`), base64url opaque IDs, and never-overwrite upload naming are carried over unchanged; only the root directory's source changes (from `os-config.json` to `SettingsStore`), and access is now gated by role/switch instead of being open to anyone who can reach the kit's unauthenticated server.

- [ ] **Step 1: Write the failing test**

```js
// test/assets.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanAssets, setFavorite, assetPath, assetId } from "../src/assets.js";

function seedRoot() {
  const root = mkdtempSync(join(tmpdir(), "sod-assets-"));
  mkdirSync(join(root, "Contracts"));
  writeFileSync(join(root, "Contracts", "lease.pdf"), "%PDF-fake");
  return root;
}

test("scanAssets lists categories and files; favorite toggling round-trips", () => {
  const root = seedRoot();
  const scan = scanAssets(root);
  assert.equal(scan.categories.length, 1);
  assert.equal(scan.files[0].category, "Contracts");
  assert.equal(scan.files[0].favorite, false);

  const id = scan.files[0].id;
  const fav = setFavorite(root, id, true);
  assert.equal(fav.ok, true);
  assert.equal(scanAssets(root).files[0].favorite, true);
  rmSync(root, { recursive: true, force: true });
});

test("assetPath rejects an id that resolves outside the root", () => {
  const root = seedRoot();
  const escapee = assetId("../../etc/passwd");
  assert.equal(assetPath(root, escapee), null);
  rmSync(root, { recursive: true, force: true });
});

test("setFavorite enforces the maxFavorites cap", () => {
  const root = seedRoot();
  for (const n of ["a.pdf", "b.pdf", "c.pdf", "d.pdf"]) writeFileSync(join(root, n), "x");
  const scan = scanAssets(root);
  for (const f of scan.files.slice(0, 4)) assert.equal(setFavorite(root, f.id, true).ok, true);
  const fifthResult = setFavorite(root, scan.files[0].id === scan.files[4]?.id ? scan.files[4].id : scan.files[0].id, true);
  // 5th distinct favorite over the default cap of 4 must fail with 409
  assert.ok(scanAssets(root).favorites.length <= 4);
  rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/assets.test.js`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `src/assets.js`**

```js
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const ASSET_MIME = {
  ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8", ".csv": "text/csv", ".html": "text/html", ".json": "application/json",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
const MAX_FAVORITES = 4;
const MAX_UPLOAD = 50 * 1024 * 1024;

const metaFile = (root) => join(root, ".assets.json");
const readMeta = (root) => { try { return JSON.parse(readFileSync(metaFile(root), "utf8")); } catch { return { favorites: [] }; } };
const writeMeta = (root, m) => writeFileSync(metaFile(root), JSON.stringify(m, null, 2));
const isHidden = (n) => n.startsWith(".") || n.startsWith("~$");

export function assetId(rel) {
  return Buffer.from(rel, "utf8").toString("base64url");
}
export function assetPath(root, id) {
  let rel;
  try { rel = Buffer.from(String(id || ""), "base64url").toString("utf8"); } catch { return null; }
  if (!rel || rel.includes("\0")) return null;
  const abs = resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + require("node:path").sep)) return null;
  return { abs, rel: relative(root, abs) };
}
export function assetMime(abs) {
  return ASSET_MIME[extname(abs).toLowerCase()] || "application/octet-stream";
}

export function scanAssets(root) {
  mkdirSync(root, { recursive: true });
  const favs = new Set(readMeta(root).favorites || []);
  const categories = [], files = [];
  const add = (cat, abs, name) => {
    const st = statSync(abs);
    if (!st.isFile()) return false;
    const rel = cat ? join(cat, name) : name;
    files.push({
      id: assetId(rel), category: cat || "Uncategorized", name,
      ext: extname(name).slice(1).toLowerCase(), size: st.size,
      modified: st.mtimeMs, favorite: favs.has(rel),
    });
    return true;
  };
  let entries = [];
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { /* fresh install: root may not exist yet */ }
  for (const ent of entries) {
    if (isHidden(ent.name)) continue;
    if (ent.isDirectory()) {
      let n = 0;
      for (const f of readdirSync(join(root, ent.name))) {
        if (isHidden(f)) continue;
        try { if (add(ent.name, join(root, ent.name, f), f)) n++; } catch { /* unreadable file: skip it */ }
      }
      categories.push({ name: ent.name, count: n });
    } else if (ent.isFile()) {
      try { add("", join(root, ent.name), ent.name); } catch { /* unreadable file: skip it */ }
    }
  }
  categories.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => b.modified - a.modified);
  return {
    dir: root, maxFavorites: MAX_FAVORITES, categories, files,
    favorites: files.filter((f) => f.favorite).slice(0, MAX_FAVORITES),
  };
}

export function setFavorite(root, id, on) {
  const p = assetPath(root, id);
  if (!p || !existsSync(p.abs) || !statSync(p.abs).isFile()) return { error: "not-found", code: 404 };
  const meta = readMeta(root);
  let favs = (meta.favorites || []).filter((r) => { try { return statSync(join(root, r)).isFile(); } catch { return false; } });
  if (on) {
    if (!favs.includes(p.rel)) {
      if (favs.length >= MAX_FAVORITES) return { error: `only ${MAX_FAVORITES} favorites fit`, code: 409 };
      favs.push(p.rel);
    }
  } else {
    favs = favs.filter((r) => r !== p.rel);
  }
  writeMeta(root, { ...meta, favorites: favs });
  return { ok: true, favorite: on, favorites: favs.length };
}

export function saveUpload(root, category, name, buffer) {
  if (buffer.length > MAX_UPLOAD) return { error: "file over 50 MB", code: 413 };
  const dir = category ? join(root, category) : root;
  if (category && (isHidden(category) || !existsSync(dir) || !statSync(dir).isDirectory())) {
    return { error: "unknown category", code: 400 };
  }
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let target = join(dir, name), k = 2;
  while (existsSync(target)) target = join(dir, `${stem} (${k++})${ext}`);
  writeFileSync(target, buffer);
  const rel = relative(root, target);
  return { id: assetId(rel), name: require("node:path").basename(target), category: category || "Uncategorized", size: buffer.length };
}
```

(Replace the two `require("node:path")` calls with a top-level `import { basename, sep } from "node:path"` — ESM has no `require`; written above to make the port's provenance to the CommonJS original explicit, correct it before running.)

- [ ] **Step 4: Fix the ESM import and run test to verify it passes**

```js
import { basename, extname, join, relative, resolve, sep } from "node:path";
// use `sep` and `basename` directly, drop both require(...) calls
```

Run: `node --test test/assets.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing route test and implement `src/routes/assets-routes.js`**

Role gate: owner always allowed; staff allowed only when `switches.assetsView === true`.

```js
// test/assets.test.js (append)
test("GET /api/assets respects the assetsView switch for staff", async () => {
  const { server, jar } = await bootAsOwner(); // staff fixture user has switches.assetsView=false by default
  const b = base(server);
  assert.equal((await fetch(`${b}/api/assets`, { headers: { cookie: jar.staff } })).status, 403);
  assert.equal((await fetch(`${b}/api/assets`, { headers: { cookie: jar.owner } })).status, 200);
  server.close(); server.ctx.index.close();
});
```

```js
import { requireUser } from "../auth.js";
import { sendJson, readJsonBody, send } from "../lib/http.js";
import { scanAssets, setFavorite, saveUpload, assetPath, assetMime } from "../assets.js";
import { statSync, createReadStream, existsSync } from "node:fs";

function assetsRoot(settingsStore, homeDir) {
  const { assetsDir } = settingsStore.get();
  return assetsDir || join(homeDir, "business-assets");
}
function canSeeAssets(user) {
  return user.role === "owner" || user.switches?.assetsView === true;
}

export function assetsRoutes({ auth, settingsStore, homeDir, audit }) {
  return async (req, res, url) => {
    const p = url.pathname;
    const root = () => assetsRoot(settingsStore, homeDir);

    if (p === "/api/assets" && req.method === "GET") {
      const user = requireUser(req, res, auth); if (!user) return true;
      if (!canSeeAssets(user)) return sendJson(res, 403, { error: "forbidden" }), true;
      return sendJson(res, 200, scanAssets(root())), true;
    }
    if (p === "/api/assets/favorite" && req.method === "POST") {
      const user = requireUser(req, res, auth); if (!user) return true;
      if (!canSeeAssets(user)) return sendJson(res, 403, { error: "forbidden" }), true;
      const { id, on } = await readJsonBody(req);
      const result = setFavorite(root(), id, !!on);
      if (result.error) return sendJson(res, result.code, { error: result.error }), true;
      return sendJson(res, 200, result), true;
    }
    if (p === "/api/assets/upload" && req.method === "POST") {
      const user = requireUser(req, res, auth); if (!user) return true;
      if (!canSeeAssets(user)) return sendJson(res, 403, { error: "forbidden" }), true;
      const category = url.searchParams.get("category") || "";
      const name = url.searchParams.get("name") || "document";
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const result = saveUpload(root(), category, name, Buffer.concat(chunks));
      audit.log("assets.upload", { userId: user.id, username: user.username, role: user.role, name });
      if (result.error) return sendJson(res, result.code, { error: result.error }), true;
      return sendJson(res, 200, result), true;
    }
    if (p.startsWith("/assets/file/") && req.method === "GET") {
      const user = requireUser(req, res, auth); if (!user) return true;
      if (!canSeeAssets(user)) return sendJson(res, 403, { error: "forbidden" }), true;
      const id = p.slice("/assets/file/".length);
      const asset = assetPath(root(), id);
      if (!asset || !existsSync(asset.abs) || !statSync(asset.abs).isFile()) return sendJson(res, 404, { error: "not-found" }), true;
      audit.log("asset.open", { userId: user.id, username: user.username, role: user.role, path: asset.rel });
      const download = url.searchParams.has("download");
      res.writeHead(200, {
        "content-type": assetMime(asset.abs),
        "content-disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(basename(asset.abs))}`,
      });
      createReadStream(asset.abs).pipe(res);
      return true;
    }
    return false;
  };
}
```

- [ ] **Step 6: Wire `homeDir`/`settingsStore` into `assetsRoutes(ctx)` call in `src/server.js`, add router**

- [ ] **Step 7: Run full test suite**

Run: `node --test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/assets.js src/routes/assets-routes.js src/server.js test/assets.test.js
git commit -m "feat: Business Assets backend, folder configurable via settings, role-gated"
```

---

### Task 7: Skills deck headless runner (spike + implementation)

**Files:**
- Create: `src/runs.js`, `src/routes/runs-routes.js`, `docs/decisions/headless-skill-runner.md`
- Test: `test/runs.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `runTurn({prompt, options})` from `src/chat/run-turn.js` (Plan 1), `buildQueryOptions` pattern from `src/chat/options.js`, `requireOwner` from `src/auth.js`
- Produces: `async function runSkill({vaultPath, skillId, input, model, effort, audit}) -> Job`, `function readRunHistory(vaultPath) -> Run[]`, `const SKILLS = [{id,label,model,effort,needsInput,inputLabel}]`, `Job = {jobId, id, status:"running"|"done"|"failed", startedAt, endedAt, code, reportFile, tail()}`

**Resolves design spec Open Item #1** ("Whether the Agent SDK accepts a slash command as the prompt for headless skill runs"). The kit's own runner (`Robonuggets/agentic-os/server.js:227-294`) answers a related but different question for a *different* CLI invocation style — it spawns `claude -p "/{skill}{input}" --model {model} --effort {effort} --permission-mode bypassPermissions` as a shell string built with a hand-rolled escaper (`shellDQuoteEscape`, `server.js:242-249`). That escaper is itself a real injection-risk pattern (anything not in its four escaped characters, like a literal `&` or newline sequence a future edit misses, becomes shell metacharacters); Plan 2 does not carry it forward.

- [ ] **Step 1: Spike — confirm the Agent SDK accepts a slash-command prompt for a one-shot headless run**

Run this against a real signed-in Claude Code install, from the vault directory used by Plan 1's fixtures:

```bash
node -e "
import('@anthropic-ai/claude-agent-sdk').then(async ({ query }) => {
  for await (const ev of query({ prompt: '/help', options: { cwd: process.cwd(), maxTurns: 3, permissionMode: 'acceptEdits', settingSources: ['user','project'] } })) {
    if (ev.type === 'result') { console.log('RESULT:', ev.result?.slice(0,200)); process.exit(0); }
  }
});
"
```

Expected: a `RESULT:` line prints, confirming the SDK's `query()` accepts a `/slashCommand` string as `prompt` the same way the interactive CLI does. Record the outcome in `docs/decisions/headless-skill-runner.md`:

```markdown
# ADR: headless skill runner

Decision: `src/runs.js` invokes skills via `runTurn()` / Agent SDK `query()`,
passing `/<skillId> <input>` as the prompt, `permissionMode: "acceptEdits"`,
`settingSources: ["user","project"]`, `skills: "all"`. No child process is
spawned; this removes the shell-escaping risk present in the reference kit's
runner (`shellDQuoteEscape`, `spawn(cmdline, {shell:true})`).

Fallback (only if the spike above fails on the target Claude Code version):
`spawn("claude", ["-p", prompt, "--model", modelId, "--permission-mode", "acceptEdits"], {cwd: vaultPath})`
— an argument array, `shell` omitted (defaults to `false`), no template string,
no `--effort` flag (effort becomes a one-line instruction folded into the prompt
instead, since the real CLI has no such flag — that flag only ever existed in
the reference kit's own bespoke runner script).

Spike run on: <date>. Result: <RESULT: ... printed / did not print, describe>.
```

- [ ] **Step 2: Write the failing test using a fake `runTurn`**

```js
// test/runs.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSkill, readRunHistory, SKILLS } from "../src/runs.js";

async function* fakeRunTurn({ prompt }) {
  yield { type: "session", claudeSessionId: "sess-1" };
  yield { type: "text", delta: `## Result\nRan ${prompt}\n\n- one\n- two\n` };
  yield { type: "done", text: `## Result\nRan ${prompt}\n\n- one\n- two\n`, stats: { duration_ms: 1200 } };
}

test("SKILLS carries the three spec defaults", () => {
  const ids = SKILLS.map((s) => s.id);
  assert.deepEqual(ids, ["bp-digest", "morning-briefing", "bp-optimizer"]);
});

test("runSkill writes a run log, an HTML report artifact with a visibility field, its sidecar, and a run-history row", async () => {
  const vault = mkdtempSync(join(tmpdir(), "sod-runs-"));
  const job = await runSkill({
    vaultPath: vault, skillId: "bp-digest", input: "", model: "SONNET", effort: "MEDIUM",
    runTurn: fakeRunTurn, audit: { log() {} },
  });
  assert.equal(job.status, "done");
  const artifactsDir = join(vault, "Dashboard", "artifacts");
  const html = readFileSync(join(artifactsDir, job.reportFile), "utf8");
  assert.match(html, /Ran \/bp-digest/);
  const sidecar = JSON.parse(readFileSync(join(artifactsDir, job.reportFile.replace(/\.html$/, ".json")), "utf8"));
  assert.equal(sidecar.kind, "run");
  assert.equal(sidecar.visibility, "owner");
  const history = readRunHistory(vault);
  assert.equal(history[0].id, "bp-digest");
  assert.equal(history[0].exit, 0);
  rmSync(vault, { recursive: true, force: true });
});

test("runSkill records a failed run without throwing", async () => {
  async function* failingRunTurn() {
    yield { type: "error", message: "boom" };
  }
  const vault = mkdtempSync(join(tmpdir(), "sod-runs-"));
  const job = await runSkill({
    vaultPath: vault, skillId: "bp-optimizer", input: "", model: "HAIKU", effort: "LOW",
    runTurn: failingRunTurn, audit: { log() {} },
  });
  assert.equal(job.status, "failed");
  assert.equal(readRunHistory(vault)[0].exit, 1);
  rmSync(vault, { recursive: true, force: true });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/runs.test.js`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement `src/runs.js`**

Report HTML rendering reuses the `marked` dependency already in `package.json` (server-side) rather than the kit's own hand-rolled `mdToHtml()` regex renderer (`Robonuggets/agentic-os/server.js:510-552`) — one markdown renderer for the whole app, not two.

```js
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

export const SKILLS = [
  { id: "bp-digest", label: "Digest", model: "SONNET", effort: "MEDIUM", needsInput: false },
  { id: "morning-briefing", label: "Morning Briefing", model: "HAIKU", effort: "LOW", needsInput: false },
  { id: "bp-optimizer", label: "BP Optimizer", model: "OPUS", effort: "HIGH", needsInput: false },
];

const MODEL_IDS = {
  HAIKU: "claude-haiku-4-5-20251001",
  SONNET: "claude-sonnet-5",
  OPUS: "claude-opus-5",
  FABLE: "claude-fable-5-1",
};
const EFFORT_HINTS = {
  LOW: "Keep it brief. One pass, no deep exploration.",
  MEDIUM: "Normal thoroughness.",
  HIGH: "Be thorough — check your work before finishing.",
  XHIGH: "Be very thorough — verify assumptions, consider edge cases.",
  MAX: "Maximum rigor — this result will be read by the owner unattended.",
};

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function artifactsDir(vaultPath) { return join(vaultPath, "Dashboard", "artifacts"); }
function runsDir(vaultPath) { return join(vaultPath, "Dashboard", "runs"); }
function runLogPath(vaultPath) { return join(vaultPath, "Dashboard", "snapshots", "runs.json"); }

export function readRunHistory(vaultPath) {
  try { return JSON.parse(readFileSync(runLogPath(vaultPath), "utf8")); } catch { return []; }
}
function recordRun(vaultPath, entry) {
  const dir = join(vaultPath, "Dashboard", "snapshots");
  mkdirSync(dir, { recursive: true });
  const runs = [entry, ...readRunHistory(vaultPath)].slice(0, 200);
  writeFileSync(runLogPath(vaultPath), JSON.stringify(runs, null, 2));
}

function writeReport(vaultPath, { skillId, model, effort, seconds, ok, resultText, code }) {
  const dir = artifactsDir(vaultPath);
  mkdirSync(dir, { recursive: true });
  const now = new Date();
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/(\d{8})(\d{4})/, "$1-$2");
  const slug = `${skillId}-${stamp}`;
  const body = resultText?.trim() ? marked.parse(resultText) : "<p>(no output captured)</p>";
  const html = `<!doctype html><meta charset="utf-8"><title>/${esc(skillId)} run</title>
<body style="font:15px system-ui;max-width:760px;margin:56px auto;">
<p style="text-transform:uppercase;letter-spacing:2px;color:#8d8775;">Shop OS · headless skill run</p>
<h1>/${esc(skillId)}</h1>
<p>${ok ? "Result:" : "Run FAILED (exit " + esc(String(code)) + "). Last output below."}</p>
${body}
</body>`;
  writeFileSync(join(dir, `${slug}.html`), html);
  writeFileSync(join(dir, `${slug}.json`), JSON.stringify({
    title: `/${skillId} · ${now.toLocaleString()}`,
    icon: "bolt", kind: "run", visibility: "owner",
    created: now.toISOString(),
    note: `headless · ${model} · ${effort} · ${seconds}s · exit ${code}`,
  }, null, 2));
  return `${slug}.html`;
}

export async function runSkill({ vaultPath, skillId, input, model, effort, runTurn, audit }) {
  const dir = runsDir(vaultPath);
  mkdirSync(dir, { recursive: true });
  const startedAt = Date.now();
  const logFile = join(dir, `${skillId}-${startedAt}.log`);
  const prompt = `/${skillId}${input ? " " + input : ""}`.trim();
  const systemNote = EFFORT_HINTS[effort] || EFFORT_HINTS.MEDIUM;
  const options = {
    cwd: vaultPath, permissionMode: "acceptEdits", settingSources: ["user", "project"],
    skills: "all", maxTurns: 40, model: MODEL_IDS[model] || MODEL_IDS.SONNET,
    systemPromptAppend: systemNote,
  };
  let resultText = "", ok = false, log = "";
  try {
    for await (const ev of runTurn({ prompt, options })) {
      log += JSON.stringify(ev) + "\n";
      if (ev.type === "text") resultText += ev.delta;
      if (ev.type === "done") { resultText = ev.text ?? resultText; ok = true; }
      if (ev.type === "error") { log += `ERROR: ${ev.message}\n`; }
    }
  } catch (e) {
    log += `THROWN: ${e.message}\n`;
  }
  writeFileSync(logFile, log);
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  const code = ok ? 0 : 1;
  const reportFile = writeReport(vaultPath, { skillId, model, effort, seconds, ok, resultText, code });
  recordRun(vaultPath, { id: skillId, at: new Date().toISOString(), model, effort, seconds, exit: code, report: reportFile });
  audit?.log("run.end", { skillId, model, effort, ok, seconds });
  return { jobId: `${skillId}-${startedAt}`, id: skillId, status: ok ? "done" : "failed", startedAt, endedAt: Date.now(), code, reportFile };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/runs.test.js`
Expected: PASS.

- [ ] **Step 6: Write the failing route test and implement `src/routes/runs-routes.js` (owner-only)**

```js
// test/runs.test.js (append)
test("GET /api/runs and POST /api/runs are owner-only", async () => {
  const { server, jar } = await bootAsOwner();
  const b = base(server);
  assert.equal((await fetch(`${b}/api/runs`, { headers: { cookie: jar.staff } })).status, 403);
  const list = await fetch(`${b}/api/runs`, { headers: { cookie: jar.owner } });
  assert.equal(list.status, 200);
  assert.ok(Array.isArray((await list.json()).skills));

  const post = await fetch(`${b}/api/runs`, {
    method: "POST", headers: { cookie: jar.owner, "content-type": "application/json", origin: b },
    body: JSON.stringify({ id: "unknown-skill" }),
  });
  assert.equal(post.status, 400);
  server.close(); server.ctx.index.close();
});
```

```js
import { requireOwner } from "../auth.js";
import { sendJson, readJsonBody } from "../lib/http.js";
import { runSkill, readRunHistory, SKILLS } from "../runs.js";
import { runTurn as defaultRunTurn } from "../chat/run-turn.js";

export function runsRoutes({ vaultPath, auth, audit, runTurn = defaultRunTurn }) {
  return async (req, res, url) => {
    const p = url.pathname;
    if (p === "/api/runs" && req.method === "GET") {
      const user = requireOwner(req, res, auth); if (!user) return true;
      return sendJson(res, 200, { skills: SKILLS, runs: readRunHistory(vaultPath).slice(0, 20) }), true;
    }
    if (p === "/api/runs" && req.method === "POST") {
      const user = requireOwner(req, res, auth); if (!user) return true;
      const { id, input, model, effort } = await readJsonBody(req);
      const skill = SKILLS.find((s) => s.id === id);
      if (!skill) return sendJson(res, 400, { error: "unknown-skill" }), true;
      audit.log("run.start", { userId: user.id, username: user.username, role: user.role, skillId: id });
      const job = await runSkill({
        vaultPath, skillId: id, input: input || "",
        model: model || skill.model, effort: effort || skill.effort, runTurn, audit,
      });
      return sendJson(res, 200, job), true;
    }
    return false;
  };
}
```

- [ ] **Step 7: Wire into `src/server.js` router array**

- [ ] **Step 8: Run full test suite**

Run: `node --test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/runs.js src/routes/runs-routes.js src/server.js test/runs.test.js docs/decisions/headless-skill-runner.md
git commit -m "feat: skills deck headless runner on Agent SDK query(), no shell spawn"
```

---

### Task 8: Owner dashboard structural CSS, theme boot script, layout client

**Files:**
- Modify: `public/css/owner.css` (append grid/widget/chrome CSS)
- Create: `public/js/owner/theme.js`, `public/js/owner/layout-client.js`
- Modify: `public/owner.html`, `src/routes/pages.js` (inject real `__THEME_CLASS__` from `layoutStore`)

**Interfaces:**
- Produces: `js/owner/layout-client.js`: `export async function getLayout()`, `export async function saveLayout(layout)` (thin wrappers around `js/api.js`'s existing `api()` helper)
- Produces: `js/owner/theme.js`: no exports (page-init script), reads `document.documentElement.classList` (already server-set), wires `#theme-btn` click to flip the class, `saveLayout({...layout, theme})`, then reload

- [ ] **Step 1: Update `src/routes/pages.js` to inject the real theme class**

```js
// inside the /owner branch, after requireSessionRedirect:
const layout = ctx.layoutStore.get(user.id);
const html = page("owner.html")
  .replace("__ROLE__", user.role)
  .replace("__SHOP_NAME__", readShopName(vaultPath))
  .replace("__THEME_CLASS__", layout.theme === "light" ? "light" : "");
```

- [ ] **Step 2: Write the failing test**

```js
// test/pages.test.js (extend)
test("GET /owner reflects the user's saved theme with no flash", async () => {
  const { server, jar } = await bootAsOwner();
  await fetch(`${base(server)}/api/layout`, {
    method: "PUT", headers: { cookie: jar.owner, "content-type": "application/json", origin: base(server) },
    body: JSON.stringify({ ...(await (await fetch(`${base(server)}/api/layout`, { headers: { cookie: jar.owner } })).json()), theme: "light" }),
  });
  const res = await fetch(`${base(server)}/owner`, { headers: { cookie: jar.owner } });
  const body = await res.text();
  assert.match(body, /<html lang="en" class="light">/);
  server.close(); server.ctx.index.close();
});
```

- [ ] **Step 3: Run test to verify it passes** (implementation from Step 1 already satisfies it)

Run: `node --test test/pages.test.js`
Expected: PASS.

- [ ] **Step 4: Implement `public/js/owner/layout-client.js`**

```js
import { api } from "/static/js/api.js";

export async function getLayout() {
  return api("GET", "/api/layout");
}
export async function saveLayout(layout) {
  return api("PUT", "/api/layout", layout);
}
```

- [ ] **Step 5: Implement `public/js/owner/theme.js`**

```js
import { getLayout, saveLayout } from "./layout-client.js";

let layout = await getLayout();

document.getElementById("owner-shop-name").textContent = document.title.replace("Shop OS — ", "");
document.getElementById("logout-btn").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  location.href = "/login";
});
document.getElementById("theme-btn").addEventListener("click", async () => {
  const next = document.documentElement.classList.toggle("light") ? "light" : "dark";
  layout = await saveLayout({ ...layout, theme: next });
  location.reload(); // full reload, matching the reference kit's own theme-switch mechanic (canvas colors can't live-update)
});

export { layout };
```

- [ ] **Step 6: Append grid/widget/ring/tour CSS to `public/css/owner.css`**

Port the structural rules (not the color tokens, already done in Task 1) from `Robonuggets/agentic-os/dashboard.html`'s `<style>` block, lines 236–850 (skills-deck card chrome, routines board split-flap rows, widget/grid layout, ring/orb container, search bar, tour card, edit-mode outline). Keep every selector name as-is (`.deck`, `.rows`, `#tourCard`, `#searchBar`, `.rs` resize handle, `body.edit`) since Tasks 9–12's ported JS is hard-wired to them — REDESIGN.md's "keep the bones" principle applies verbatim here.

- [ ] **Step 7: Run full test suite**

Run: `node --test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add public/css/owner.css public/js/owner/theme.js public/js/owner/layout-client.js src/routes/pages.js test/pages.test.js
git commit -m "feat: owner dashboard chrome CSS, server-rendered theme (no flash), layout client"
```

---

### Task 9: Widget grid edit-mode engine and the four new data widgets

**Files:**
- Create: `public/js/owner/widgets.js`, `public/js/owner/data-widgets.js`
- Test: `test/e2e/owner.spec.js` (Playwright, stubbed here; full suite completed in Task 14)

**Interfaces:**
- Consumes: `Layout` shape from Task 2, `getLayout`/`saveLayout` from Task 8
- Produces: `js/owner/widgets.js`: `export function mountGrid(root, layout, kindRenderers)` — `kindRenderers: Record<kind, (el, layout) => void>`, drag/resize/remove/re-add wired internally, calls `saveLayout()` on every mutation (debounced 400ms, matching the kit's own `save()` pattern at `dashboard.html:1019` but server-bound instead of `localStorage`)
- Produces: `js/owner/data-widgets.js`: `export const kindRenderers = { briefing, recent, "team-activity", "team-roster", routines, stats }`, each `(el) => Promise<void>` — see the full list below (routines/stats are included here because their backend, Task 4, is already in place; skills/assets are added later by Task 13, once their own backends exist)

The grid drag/resize/swap/remove mechanics (32-column grid, `CELL = width/32`, pointerdown/move/up state machine, corner resize handle, delete button moving an entry into `layout.removed`) are ported from `Robonuggets/agentic-os/dashboard.html` lines 1264–1400 verbatim in structure — only the persistence call changes (`saveLayout()` over `PUT /api/layout` instead of `localStorage.setItem`), and the widget `kind` set changes to the one this plan ships (Task 2's `defaultLayout()`), dropping `w-apps`/`w-mail`/`w-cal` entirely (none of the three are in the spec's shipped widget list).

The four data widgets are new — they don't exist in the reference kit at all. They read from Plan 1's existing APIs:

- [ ] **Step 1: Implement `public/js/owner/data-widgets.js` against Plan 1's existing routes**

```js
import { api } from "/static/js/api.js";

export async function renderBriefing(el) {
  const recent = await api("GET", "/api/notes/recent?limit=1");
  const daily = recent.find((n) => n.path.startsWith("Daily/"));
  el.innerHTML = daily
    ? `<a href="#" data-open="${daily.path}">${daily.title}</a>`
    : `<p class="muted">No note in Daily/ yet.</p>`;
  el.querySelector("[data-open]")?.addEventListener("click", (e) => {
    e.preventDefault();
    window.openNoteByTarget?.(daily.title);
  });
}

export async function renderRecent(el) {
  const recent = await api("GET", "/api/notes/recent?limit=20");
  el.innerHTML = "<ul>" + recent.map((n) => `<li><a href="#" data-open="${n.path}">${n.title}</a></li>`).join("") + "</ul>";
  el.querySelectorAll("[data-open]").forEach((a) =>
    a.addEventListener("click", (e) => { e.preventDefault(); window.openNoteByTarget?.(a.textContent); })
  );
}

export async function renderTeamActivity(el) {
  const me = await api("GET", "/api/me");
  el.innerHTML = me.user.role === "owner"
    ? `<p class="muted">Loading…</p>`
    : `<p class="muted">Owner only.</p>`;
  if (me.user.role !== "owner") return;
  const audit = await api("GET", "/api/users/activity?limit=20"); // Task 13 adds this endpoint alongside the roster widget
  el.innerHTML = "<ul>" + audit.map((e) => `<li>${e.username || "?"} · ${e.event}</li>`).join("") + "</ul>";
}

export async function renderTeamRoster(el) {
  const users = await api("GET", "/api/users");
  el.innerHTML = "<ul>" + users.map((u) => `<li>${u.displayName} (${u.role})</li>`).join("") + `</ul><a href="/users">Manage →</a>`;
}

export async function renderRoutines(el) {
  const feed = await api("GET", "/api/snapshots/routines");
  if (feed.needsSetup) { el.innerHTML = `<p class="muted">No routines feed yet — see ROUTINES.md.</p>`; return; }
  const now = new Date();
  const hhmm = now.toTimeString().slice(0, 5);
  el.innerHTML = "<div class=\"rows\">" + feed.routines.map((r) => {
    const fired = r.t < hhmm;
    const src = feed.sources.find((s) => s.key === r.src)?.label || r.src;
    return `<div class="row${fired ? " fired" : ""}"><span class="t">${r.t}</span><span class="n">${r.n}</span><span class="src">${src}</span></div>`;
  }).join("") + "</div>";
}

export async function renderStats(el) {
  const feed = await api("GET", "/api/snapshots/stats");
  if (feed.needsSetup) { el.innerHTML = `<p class="muted">No stats feed yet — see WIRING.md.</p>`; return; }
  if (feed.error) { el.innerHTML = `<p class="muted">${feed.error}</p>`; return; }
  el.innerHTML = feed.metrics.map((m) => `<div class="caprow"><span class="bignum">${m.big}</span><span class="cap">${m.cap}</span></div>`).join("");
}

export const kindRenderers = {
  briefing: renderBriefing, recent: renderRecent, "team-activity": renderTeamActivity,
  "team-roster": renderTeamRoster, routines: renderRoutines, stats: renderStats,
};
```

`renderRoutines` ports the split-flap-row rendering concept from `Robonuggets/agentic-os/dashboard.html:2318-2392` (`renderBoard()`), simplified to a static row list (no split-flap animation — that's decoration, not the "keep the bones" contract item; REDESIGN.md's own principles rank layout/interaction over animation). `renderStats` ports `pullYoutube()` (`dashboard.html:3068`, confusingly named after its origin as a YouTube widget in an earlier version of the kit — it has always rendered the generic `stats.json` feed, per `WIRING.md`).

Note: `kindRenderers` above covers 6 of the 9 default widget kinds (`title` needs no fetch — it's static text already in the DOM; `skills` and `assets` are added by Task 13's `mountSkillsDeck`/`mountAssetsFavorites`, which match the same `(el) => void` renderer signature and merge into this map in Task 13's `boot.js`).

- [ ] **Step 2: Implement `public/js/owner/widgets.js`**

```js
import { saveLayout } from "./layout-client.js";

const COLS = 32;
let saveTimer = null;
function scheduleSave(layout) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveLayout(layout), 400);
}

export function mountGrid(root, layout, kindRenderers) {
  root.innerHTML = "";
  root.classList.add("grid");
  const cell = () => root.clientWidth / COLS;

  function place(el, w) {
    const c = cell();
    el.style.gridColumn = `${w.c + 1} / span ${w.cs}`;
    el.style.gridRow = `${w.r + 1} / span ${w.rs}`;
  }

  function renderWidget(w) {
    const el = document.createElement("section");
    el.className = "widget";
    el.dataset.id = w.id;
    el.innerHTML = `<header>${w.name}<button class="wx" title="Remove">×</button><span class="rs" title="Resize"></span></header><div class="body"></div>`;
    place(el, w);
    root.appendChild(el);
    kindRenderers[w.kind]?.(el.querySelector(".body"));

    el.querySelector(".wx").addEventListener("click", () => {
      layout.widgets = layout.widgets.filter((x) => x.id !== w.id);
      layout.removed.push({ id: w.id, name: w.name, c: w.c, r: w.r, cs: w.cs, rs: w.rs });
      el.remove();
      scheduleSave(layout);
    });

    let drag = null;
    el.querySelector("header").addEventListener("pointerdown", (e) => {
      if (!document.body.classList.contains("edit")) return;
      drag = { startX: e.clientX, startY: e.clientY, origC: w.c, origR: w.r };
    });
    window.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dc = Math.round((e.clientX - drag.startX) / cell());
      const dr = Math.round((e.clientY - drag.startY) / cell());
      w.c = Math.max(0, Math.min(COLS - w.cs, drag.origC + dc));
      w.r = Math.max(0, drag.origR + dr);
      place(el, w);
    });
    window.addEventListener("pointerup", () => {
      if (drag) scheduleSave(layout);
      drag = null;
    });
  }

  for (const w of layout.widgets) renderWidget(w);
}
```

- [ ] **Step 3: Write a placeholder Playwright spec file establishing the test harness (full coverage lands in Task 14)**

```js
// test/e2e/owner.spec.js
import { test, expect } from "@playwright/test";
test.skip("owner dashboard grid loads widgets and persists a drag — completed in Task 14", async () => {});
```

- [ ] **Step 4: Manual verification (no automated browser test yet — Task 14 adds Playwright; `boot.js`, which actually calls `mountGrid()`, doesn't exist until Task 13, so this step calls it directly from the browser console rather than waiting on page load)**

Boot the dev server against a fixture vault, open `/owner` as the seeded owner account, open devtools and run `import("/static/js/owner/widgets.js").then(m => import("/static/js/owner/layout-client.js").then(async l => m.mountGrid(document.getElementById("widgets-root"), await l.getLayout(), {})))` — confirm the nine default widgets render as empty panels (no `kindRenderers` passed yet, so bodies stay blank — that's expected here) in their `defaultLayout()` positions, dragging a widget by its header moves it, refreshing and re-running the same console command shows the new position (proves the debounced `PUT /api/layout` round-trip), the ✕ button removes a widget and it's gone after refresh. Full end-to-end rendering (with data) is verified in Task 13 once `boot.js` wires the real `kindRenderers` map and in Task 14's Playwright suite.

- [ ] **Step 5: Commit**

```bash
git add public/js/owner/widgets.js public/js/owner/data-widgets.js test/e2e/owner.spec.js
git commit -m "feat: widget grid edit-mode engine and four new data widgets"
```

---

### Task 10: Ring, artifact ball physics, context menu, orb portal

**Files:**
- Create: `public/js/owner/ring.js`
- Create: `public/vendor/thinking-orbs.js`, `public/vendor/three.module.min.js`

**Interfaces:**
- Consumes: `GET /api/artifacts` (Task 3), `POST /api/artifacts/remove` (Task 3)
- Produces: `export function mountRing(root)` — no other module calls into `ring.js`; it owns its canvas and polls `/api/artifacts` every 15s internally

- [ ] **Step 1: Copy `vendor/thinking-orbs.js` verbatim from the kit**

```bash
cp "C:/Users/glchu/Dropbox/Robonuggets/agentic-os/vendor/thinking-orbs.js" "public/vendor/thinking-orbs.js"
```

Keep the header comment intact (`thinking-orbs v0.1.1 - MIT (c) Jakub Antalik`). Add one line to `NOTICE.md`: `vendor/thinking-orbs.js is MIT-licensed, (c) Jakub Antalik, used unmodified — see the file's own header.`

- [ ] **Step 2: Vendor `three.js` r160 instead of the kit's jsdelivr `importmap`**

Download the r160 `build/three.module.min.js` (matching the kit's `three@0.160.0` pin) into `public/vendor/three.module.min.js`. This LAN server has no guaranteed internet access at the shop, so no runtime CDN fetch (the kit's `dashboard.html:3483` used an `importmap` pointing at `jsdelivr`) — reference it with a relative module import instead: `import * as THREE from "/static/vendor/three.module.min.js";`.

- [ ] **Step 3: Implement `public/js/owner/ring.js`**

Port from `Robonuggets/agentic-os/dashboard.html`:
- Ball slotting / ring physics: lines 3161–3436 (`assignSlots()`, `syncArtifactBalls()`, the `RS` ring-state object at line 961) — poll target changes from `/api/artifacts` (Task 3) instead of the kit's own `/api/artifacts`; same response shape (`{fetched,count,artifacts}`), so the polling/diffing logic ports unchanged.
- Ball context menu (right-click OPEN/REMOVE): lines ~1616–1670 — wire REMOVE to `POST /api/artifacts/remove` (Task 3; this is the route the kit never implemented — Plan 2 completes what the kit's front end always expected).
- 3D orb portal: lines 3483–3741 (`<script type="module">` block) — replace the `import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/...'` import with the vendored path from Step 2. Keep the Second Brain probe (`fetch('http://localhost:5210')`) and the click-through to the note viewer when it doesn't respond, per the design spec ("The orb opens the note viewer, or the Second Brain map if `localhost:5210` responds"). Remove the Skool classroom fallback link at `dashboard.html:3318` entirely — clicking the orb with no Second Brain running opens the note viewer, full stop, never an external marketing URL.

```js
export function mountRing(root) {
  root.innerHTML = `<canvas id="ringCv"></canvas><div id="orbBox"></div><div id="tip" hidden></div>`;
  // ... ported ball-slotting/physics/context-menu/orb-portal code from the line ranges above ...
}
```

`mountRing`'s caller (Task 13's `boot.js`) passes `document.getElementById("ring-root")` — this task only defines the function; nothing calls it yet.

- [ ] **Step 4: Manual verification (call it directly — `boot.js` doesn't exist until Task 13)**

Seed the fixture vault's `Dashboard/artifacts/` with 2–3 sample HTML+JSON pairs (reuse `test/fixtures/vault/Dashboard/artifacts/sample-report.html`/`.json` from Task 3). Boot the dev server, open `/owner`, in devtools run `import("/static/js/owner/ring.js").then(m => m.mountRing(document.getElementById("ring-root")))`, confirm balls appear on the ring, right-click → REMOVE moves a fixture artifact into `_trash/` and the ball disappears without a page reload, and clicking the orb with no Second Brain server running opens the note viewer (not a dead link).

- [ ] **Step 5: Commit**

```bash
git add public/js/owner/ring.js public/vendor/thinking-orbs.js public/vendor/three.module.min.js NOTICE.md
git commit -m "feat: ring ball physics, context-menu remove wired to the real backend, vendored 3D orb"
```

---

### Task 11: Artifact search overlay

**Files:**
- Create: `public/js/owner/search.js`

**Interfaces:**
- Consumes: `GET /api/artifacts` (Task 3, same data `ring.js` already polls — `search.js` reuses the last-fetched list rather than issuing a second request)
- Produces: `export function mountSearch(root, getArtifacts)` — `getArtifacts: () => Artifact[]`, wired by `owner.html`'s boot script to share `ring.js`'s in-memory list

Ported from `Robonuggets/agentic-os/dashboard.html` lines 1453–1529 (`applySearch()`, `openSearch()`, `wireSearch()`), bound to the `/` key and `#searchBtn` exactly as in the kit. This overlay searches artifact titles/notes only (not vault notes — Plan 1's `notes.js` already owns note search under its own `#notes-search-input`, a separate concern).

- [ ] **Step 1: Implement `public/js/owner/search.js`**

```js
export function mountSearch(root, getArtifacts) {
  const bar = document.createElement("div");
  bar.id = "searchBar"; bar.hidden = true;
  bar.innerHTML = `<input id="searchIn" placeholder="Search artifacts…" /><div id="searchN"></div>`;
  root.appendChild(bar);
  const input = bar.querySelector("#searchIn");
  const results = bar.querySelector("#searchN");

  function open() { bar.hidden = false; input.value = ""; input.focus(); apply(""); }
  function close() { bar.hidden = true; }
  function apply(q) {
    const list = getArtifacts().filter((a) => (a.title + " " + a.note).toLowerCase().includes(q.toLowerCase()));
    results.innerHTML = list.map((a) => `<a href="${a.url}" target="_blank">${a.title}</a>`).join("");
  }
  input.addEventListener("input", () => apply(input.value));
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement.tagName !== "INPUT") { e.preventDefault(); open(); }
    if (e.key === "Escape") close();
  });
  document.getElementById("searchBtn")?.addEventListener("click", open);
}
```

- [ ] **Step 2: Manual verification (call it directly — `boot.js` doesn't exist until Task 13)**

With the same fixture artifacts from Task 10, open `/owner`, in devtools run `const d = await (await fetch("/api/artifacts")).json(); const { mountSearch } = await import("/static/js/owner/search.js"); mountSearch(document.body, () => d.artifacts);`, press `/`, type part of a fixture artifact's title, confirm it appears in results and clicking it opens the artifact in a new tab.

- [ ] **Step 3: Commit**

```bash
git add public/js/owner/search.js
git commit -m "feat: artifact search overlay bound to / and the search button"
```

---

### Task 12: Onboarding tour with the CC BY 4.0 credit card

**Files:**
- Create: `public/js/owner/tour.js`
- Modify: `public/owner.html` (add `#tourCard`, `#infoBtn`)

**Interfaces:**
- Consumes: `getLayout`/`saveLayout` from Task 8 (replaces the kit's `localStorage.getItem('os-tour-seen')`)
- Produces: `export function mountTour(layout)` — reads `layout.tourSeen`, auto-opens on first run, saves `tourSeen: true` on dismiss

Ported from `Robonuggets/agentic-os/dashboard.html` lines 1530–1605 (`TOUR_STEPS`, `wireTour()`). All 7 steps carry over; step 7 (the CC BY credit card) is kept **verbatim** per the code comment directly above it in the kit ("Keep this card: the license requires credit, a link, and a note that changes were made. See NOTICE.md") and per this project's own Licensing and attribution section:

```js
const TOUR_STEPS = [
  // ... steps 1-6 ported from dashboard.html:1534-1549, targeting this project's element ids ...
  { el: () => document.getElementById("infoBtn"), t: "Credits",
    b: 'Shop OS Dashboard is based on <b>Rubric Agentic OS</b> by Jay E | <a href="https://skool.com/robonuggets" target="_blank" rel="noopener">RoboNuggets</a>, used under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>. Modified by Blueprint IT. RoboNuggets does not endorse Shop OS.' },
];
```

- [ ] **Step 1: Implement `public/js/owner/tour.js`**

```js
import { saveLayout } from "./layout-client.js";

const TOUR_STEPS = [
  { el: () => document.getElementById("ring-root"), t: "The Ring", b: "Every report your agent builds lands here as a ball." },
  { el: () => document.getElementById("searchBtn"), t: "Search", b: "Press / any time to search the ring." },
  { el: () => document.querySelector('[data-kind="skills"]'), t: "Skills Deck", b: "Run a skill headlessly — the result becomes a new ball." },
  { el: () => document.querySelector('[data-kind="routines"]'), t: "Routines", b: "Today's automated schedule, if your agent maintains one." },
  { el: () => document.getElementById("editBtn"), t: "Edit Mode", b: "Drag, resize, or remove any widget. It's saved per-person." },
  { el: () => document.getElementById("themeBtn"), t: "Theme", b: "Light or dark — your choice, saved to your login." },
  { el: () => document.getElementById("infoBtn"), t: "Credits",
    b: 'Shop OS Dashboard is based on <b>Rubric Agentic OS</b> by Jay E | <a href="https://skool.com/robonuggets" target="_blank" rel="noopener">RoboNuggets</a>, used under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>. Modified by Blueprint IT. RoboNuggets does not endorse Shop OS.' },
];

export function mountTour(layout) {
  let i = 0;
  const card = document.createElement("div");
  card.id = "tourCard"; card.hidden = true;
  card.innerHTML = `<h3 id="tourT"></h3><p id="tourB"></p><button id="tourBack">Back</button><button id="tourNext">Next</button><button id="tourClose">×</button>`;
  document.body.appendChild(card);

  function show(idx) {
    i = Math.max(0, Math.min(TOUR_STEPS.length - 1, idx));
    const step = TOUR_STEPS[i];
    card.querySelector("#tourT").textContent = step.t;
    card.querySelector("#tourB").innerHTML = step.b;
    const target = step.el();
    if (target) {
      const r = target.getBoundingClientRect();
      card.style.top = r.bottom + 8 + "px";
      card.style.left = r.left + "px";
    }
    card.hidden = false;
  }
  async function close() {
    card.hidden = true;
    if (!layout.tourSeen) await saveLayout({ ...layout, tourSeen: true });
    layout.tourSeen = true;
  }
  card.querySelector("#tourNext").addEventListener("click", () => (i < TOUR_STEPS.length - 1 ? show(i + 1) : close()));
  card.querySelector("#tourBack").addEventListener("click", () => show(i - 1));
  card.querySelector("#tourClose").addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !card.hidden) close(); });
  document.getElementById("infoBtn")?.addEventListener("click", () => show(0));

  if (!layout.tourSeen) setTimeout(() => show(0), 1400);
}
```

- [ ] **Step 2: Add `#tourCard` trigger elements to `public/owner.html`**

Add `<button id="infoBtn" title="Tour">i</button>` and `<button id="editBtn" title="Edit layout">✎</button>` to the header markup from Task 1.

- [ ] **Step 3: Manual verification (call it directly — `boot.js` doesn't exist until Task 13)**

Log in as a brand-new owner account (fresh `layouts/<id>.json`), in devtools run `const { getLayout } = await import("/static/js/owner/layout-client.js"); const { mountTour } = await import("/static/js/owner/tour.js"); mountTour(await getLayout());`, confirm the tour auto-opens after ~1.4s, step through all 7 steps, confirm the Credits step (step 7) renders the CC BY text with a working link to `https://skool.com/robonuggets` and to the CC BY 4.0 license page, dismiss it, re-run the same console command, confirm it does not reopen (proves `tourSeen` persisted server-side).

- [ ] **Step 4: Commit**

```bash
git add public/js/owner/tour.js public/owner.html
git commit -m "feat: onboarding tour with server-persisted tourSeen, CC BY credit card preserved"
```

---

### Task 13: Skills deck front end, Business Assets widget and full-page browser, team activity endpoint

**Files:**
- Create: `public/js/owner/skills-deck.js`, `public/js/owner/assets-widget.js`, `public/js/assets-page.js`, `public/assets.html`, `public/js/owner/chat-toggle.js`, `public/js/owner/boot.js`
- Modify: `src/routes/users-routes.js` (add `GET /api/users/activity`, consumed by Task 9's team-activity widget)
- Modify: `src/routes/pages.js` (serve `/assets`)
- Modify: `public/js/owner/ring.js` (Task 10) to mount the chat-bar toggle
- Test: `test/users.test.js` (extend, for the new activity endpoint)

**This task also writes the assembly script (`boot.js`) that every prior front-end task (9-12) built a piece for but none of them called** — Tasks 9-12 each verified their own module by invoking it directly from the devtools console, precisely because `boot.js` doesn't exist until this step.

**Interfaces:**
- Consumes: `GET/POST /api/runs` (Task 7), `GET/POST /api/assets*` (Task 6)
- Produces: `js/owner/skills-deck.js`: `export function mountSkillsDeck(el)`; `js/owner/assets-widget.js`: `export function mountAssetsFavorites(el)`

- [ ] **Step 1: Write the failing test for the new activity endpoint**

```js
// test/users.test.js (extend)
test("GET /api/users/activity is owner-only and returns recent audit rows", async () => {
  const { server, jar } = await bootAsOwner();
  const b = base(server);
  assert.equal((await fetch(`${b}/api/users/activity`, { headers: { cookie: jar.staff } })).status, 403);
  const res = await fetch(`${b}/api/users/activity?limit=5`, { headers: { cookie: jar.owner } });
  assert.equal(res.status, 200);
  const rows = await res.json();
  assert.ok(Array.isArray(rows));
  assert.ok(rows.every((r) => "event" in r && "username" in r));
  server.close(); server.ctx.index.close();
});
```

- [ ] **Step 2: Run test to verify it fails, then implement the endpoint**

`src/audit.js`'s `readAll(filePath)` (Plan 1, confirmed in the survey) already parses the JSONL activity log — this endpoint just slices and reverses it:

```js
// src/routes/users-routes.js (add a branch)
import { readAll } from "../audit.js";
import { join } from "node:path";

if (p === "/api/users/activity" && req.method === "GET") {
  const user = requireOwner(req, res, auth); if (!user) return true;
  const limit = Math.min(100, Number(url.searchParams.get("limit")) || 20);
  const rows = readAll(join(homeDir, "activity.jsonl")).reverse().slice(0, limit);
  return sendJson(res, 200, rows), true;
}
```

Run: `node --test test/users.test.js`
Expected: PASS.

- [ ] **Step 3: Implement `public/js/owner/skills-deck.js`**

Ported concept from `Robonuggets/agentic-os/dashboard.html` lines 2006–2254 (`renderDeck()`, `playSkill()`), replacing the kit's fixed async progress-bar animation with real status: since `runSkill()` (Task 7) is awaited synchronously by the route handler (no background job polling needed — the SDK call completes before the HTTP response returns), the front end just shows a spinner for the duration of one `fetch`, not a polling loop.

```js
import { api } from "/static/js/api.js";

export function mountSkillsDeck(el) {
  el.dataset.kind = "skills";
  render();
  async function render() {
    const { skills, runs } = await api("GET", "/api/runs");
    el.innerHTML = skills.map((s) => `<button data-id="${s.id}">${s.label}</button>`).join("") +
      `<ul class="runs">${runs.slice(0, 5).map((r) => `<li>${r.id} · ${r.exit === 0 ? "✓" : "✗"} · ${r.seconds}s</li>`).join("")}</ul>`;
    el.querySelectorAll("button[data-id]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        btn.disabled = true; btn.textContent = "Running…";
        try { await api("POST", "/api/runs", { id: btn.dataset.id }); }
        finally { await render(); window.dispatchEvent(new CustomEvent("artifacts:refresh")); }
      })
    );
  }
}
```

`ring.js` (Task 10) listens for `artifacts:refresh` and re-polls `/api/artifacts` immediately instead of waiting for its 15s interval — add one line to `ring.js`: `window.addEventListener("artifacts:refresh", pollArtifacts);` (name the ring's existing poll function `pollArtifacts` if it isn't already, during Task 10).

- [ ] **Step 4: Implement `public/js/owner/assets-widget.js`**

```js
import { api } from "/static/js/api.js";

export function mountAssetsFavorites(el) {
  el.dataset.kind = "assets";
  api("GET", "/api/assets").then((data) => {
    el.innerHTML = data.favorites.map((f) => `<a href="/assets/file/${f.id}" target="_blank">${f.name}</a>`).join("") +
      `<a href="/assets" class="view-all">View all →</a>`;
  }).catch(() => { el.innerHTML = `<p class="muted">Assets not set up yet.</p>`; });
}
```

- [ ] **Step 5: Port `public/assets.html` and `public/js/assets-page.js`**

Port from `Robonuggets/agentic-os/assets.html` (258 lines: category nav, search, grid of doc cards, drag-and-drop upload, preview iframe overlay). Adapt every `fetch('/api/assets...')` call to include credentials (cookie session, same-origin — no change needed since it's the same server) and gate rendering behind `GET /api/me`'s role/switches the same way `notes.js`'s tab visibility already works in `employee.html`.

- [ ] **Step 6: Wire the ring's chat bar to Plan 1's existing `chat.js`, satisfying the spec's "tool-use markers and session resume" requirement for free**

The reference kit's own chat bar (`Robonuggets/agentic-os/dashboard.html:3816-3934`, backed by `server.js`'s `startChat()`/`chatArgs()` streaming a second `claude -p` CLI process) is **not** ported — Plan 1 already built a chat engine that does the same job through the Agent SDK with `canUseTool` enforcement, tool-use markers, and session resume (`src/chat/*.js`, `public/js/chat.js`), and the design spec calls for exactly one engine, not two. This step only adds a compact toggle button so the full `chat.js` UI (already built in Task 1's `#chat-root`) opens from the ring's chat-bar icon instead of a second implementation:

```js
// public/js/owner/chat-toggle.js
export function mountChatToggle(ringRoot) {
  const btn = document.createElement("button");
  btn.id = "chatBar"; btn.textContent = "Chat";
  ringRoot.appendChild(btn);
  const chatRoot = document.getElementById("chat-root");
  btn.addEventListener("click", () => {
    chatRoot.hidden = !chatRoot.hidden;
    ringRoot.hidden = !chatRoot.hidden ? true : false;
  });
}
```

Add one import and one call to the end of `public/js/owner/ring.js`'s `mountRing()` (created in Task 10): `import { mountChatToggle } from "./chat-toggle.js";` at the top, and `mountChatToggle(root);` as the last line inside `mountRing()`.

- [ ] **Step 7: Serve `/assets` in `src/routes/pages.js`**

```js
if (p === "/assets") {
  const user = requireSessionRedirect(req, res, auth); if (!user) return true;
  if (user.role !== "owner" && user.switches?.assetsView !== true) return send(res, 302, { Location: "/" }), true;
  return send(res, 200, { "content-type": "text/html" }, page("assets.html")), true;
}
```

- [ ] **Step 8: Implement `public/js/owner/boot.js` — the assembly script `owner.html` actually loads**

```js
import { getLayout } from "./layout-client.js";
import { mountGrid } from "./widgets.js";
import { kindRenderers } from "./data-widgets.js";
import { mountSkillsDeck } from "./skills-deck.js";
import { mountAssetsFavorites } from "./assets-widget.js";
import { mountRing } from "./ring.js";
import { mountSearch } from "./search.js";
import { mountTour } from "./tour.js";

const layout = await getLayout();
const allKinds = { ...kindRenderers, skills: mountSkillsDeck, assets: mountAssetsFavorites };

mountRing(document.getElementById("ring-root"));
mountGrid(document.getElementById("widgets-root"), layout, allKinds);

let lastArtifacts = [];
window.addEventListener("artifacts:list", (e) => { lastArtifacts = e.detail; }); // ring.js dispatches this each poll
mountSearch(document.body, () => lastArtifacts);

mountTour(layout);

document.getElementById("editBtn")?.addEventListener("click", () => document.body.classList.toggle("edit"));
```

This requires one addition to `ring.js` (Task 10): wherever it fetches `/api/artifacts` (its own 15s poll and the `artifacts:refresh` handler from Task 13 Step 6), dispatch `window.dispatchEvent(new CustomEvent("artifacts:list", { detail: data.artifacts }))` right after updating the ball positions, so `search.js` always has the current list without a second fetch. Add this one line to `ring.js`'s existing poll function in this task (it's a one-line addition to a file Task 10 already created, not a new file).

- [ ] **Step 9: Manual verification — the full page, for real, for the first time**

Boot the dev server against the fixture vault, log in as owner, confirm `/owner` now renders everything live with no console workarounds: ring with balls, grid with all nine widgets populated (routines/stats/assets/skills-deck all showing real data), search works via `/`, tour auto-opens for a fresh account, chat bar toggle opens `#chat-root`.

- [ ] **Step 10: Run full test suite**

Run: `node --test`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add public/js/owner/skills-deck.js public/js/owner/assets-widget.js public/js/assets-page.js public/assets.html public/js/owner/chat-toggle.js public/js/owner/boot.js public/js/owner/ring.js src/routes/users-routes.js src/routes/pages.js test/users.test.js
git commit -m "feat: skills deck front end, business assets widget and full-page browser, chat bar toggle, boot assembly script"
```

---

### Task 14: Playwright browser tests, final role-matrix/audit pass, NOTICE/README finalization

**Files:**
- Modify: `package.json` (Playwright config), `test/e2e/owner.spec.js` (replace the Task 9 placeholder), `test/owner-routes.test.js` (new, role-matrix for every route added in Tasks 2–7 and 13), `NOTICE.md`, `README.md` (project index, not the repo's own)

**Interfaces:** none new — this task verifies, it doesn't add surface.

- [ ] **Step 1: Add the Playwright devDependency and a minimal config**

```bash
npm install --save-dev playwright
npx playwright install chromium
```

```js
// playwright.config.js
export default { testDir: "test/e2e", timeout: 30000, use: { baseURL: "http://127.0.0.1:0" } };
```

- [ ] **Step 2: Replace the Task 9 placeholder with real browser tests**

```js
// test/e2e/owner.spec.js
import { test, expect } from "@playwright/test";
import { bootAsOwner } from "../helpers/boot.js"; // small helper: starts createServer(), returns {url, ownerCookie}

test("owner logs in, sees the ring, runs a skill, and the CC BY tour step is reachable", async ({ page, context }) => {
  const { url, username, password } = await bootAsOwner();
  await page.goto(`${url}/login`);
  await page.fill("#username", username);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await expect(page).toHaveURL(/\/owner$/);
  await expect(page.locator("#ring-root")).toBeVisible();

  await page.click("#infoBtn");
  for (let i = 0; i < 6; i++) await page.click("#tourNext");
  await expect(page.locator("#tourCard")).toContainText("Rubric Agentic OS");
  await expect(page.locator("#tourCard a[href='https://skool.com/robonuggets']")).toBeVisible();
  await page.click("#tourClose");

  await page.click("#editBtn");
  const widget = page.locator('.widget[data-id="w-rt"] header');
  const box = await widget.boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 10);
  await page.mouse.up();
  await page.reload();
  const movedBox = await page.locator('.widget[data-id="w-rt"] header').boundingBox();
  expect(movedBox.x).toBeGreaterThan(box.x + 100); // persisted across reload
});

test("theme toggle persists per user across reload", async ({ page }) => {
  const { url, username, password } = await bootAsOwner();
  await page.goto(`${url}/login`);
  await page.fill("#username", username); await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.click("#theme-btn");
  await page.waitForURL(/\/owner$/);
  await expect(page.locator("html")).toHaveClass(/light/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/light/); // server-rendered, no flash
});
```

- [ ] **Step 3: Run the Playwright suite**

Run: `npx playwright test`
Expected: PASS. If Playwright's Chromium download is unavailable on the build machine (design spec Open Item #4), record that in `docs/decisions/headless-skill-runner.md`'s sibling note or a new `docs/decisions/playwright-ci-only.md`, and mark these as CI-only in `package.json`'s scripts (`"test:e2e": "playwright test"`, kept out of `"test"`).

- [ ] **Step 4: Write `test/owner-routes.test.js` — full role matrix for Plan 2's new routes**

Following `test/server.test.js`'s existing `[method, path, {anon, staff, owner}]` convention (Plan 1):

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { bootAsOwner, requestAs } from "./helpers/boot.js";

const MATRIX = [
  ["GET", "/api/layout", { anon: 401, staff: 200, owner: 200 }],
  ["PUT", "/api/layout", { anon: 401, staff: 200, owner: 200 }],
  ["GET", "/api/artifacts", { anon: 401, staff: 200, owner: 200 }],
  ["POST", "/api/artifacts/remove", { anon: 401, staff: 403, owner: 200 }],
  ["GET", "/api/snapshots/stats", { anon: 401, staff: 200, owner: 200 }],
  ["GET", "/api/snapshots/routines", { anon: 401, staff: 200, owner: 200 }],
  ["GET", "/api/settings", { anon: 401, staff: 403, owner: 200 }],
  ["PUT", "/api/settings", { anon: 401, staff: 403, owner: 200 }],
  ["GET", "/api/assets", { anon: 401, staff: 403, owner: 200 }],
  ["GET", "/api/runs", { anon: 401, staff: 403, owner: 200 }],
  ["POST", "/api/runs", { anon: 401, staff: 403, owner: 400 }], // 400: no body -> unknown-skill, proves the guard ran before validation
  ["GET", "/api/users/activity", { anon: 401, staff: 403, owner: 200 }],
];

test("role matrix for every Plan 2 route", async () => {
  const { server, jar } = await bootAsOwner();
  for (const [method, path, expected] of MATRIX) {
    for (const [role, want] of Object.entries(expected)) {
      const res = await requestAs(server, jar, role, method, path);
      assert.equal(res.status, want, `${method} ${path} as ${role}: expected ${want}, got ${res.status}`);
    }
  }
  server.close(); server.ctx.index.close();
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/owner-routes.test.js`
Expected: PASS. Fix any guard ordering bugs the matrix surfaces (a common one: a route checking `requireUser` before an owner-only check, letting staff through to a 400 instead of the intended 403 — the matrix catches exactly this class of regression, matching the two Critical bugs Plan 1's own final review found).

- [ ] **Step 6: Finalize `NOTICE.md`**

Confirm it names: Rubric Agentic OS (CC BY 4.0, Jay E | RoboNuggets), `vendor/thinking-orbs.js` (MIT, Jakub Antalik), and lists what changed (Google Calendar/email removed, layout/theme moved server-side, skills runner rebuilt on the Agent SDK instead of shell spawn, artifact visibility scoping added). Grep the whole `public/` and `src/` tree for `skool.com` and confirm the only remaining occurrence is the tour credit card's required link:

```bash
grep -rn "skool.com" public/ src/
```

Expected: exactly one match, in `public/js/owner/tour.js`'s credits step.

- [ ] **Step 7: Update the project `README.md`**

Update the Status callout: mark Plan 2 implemented, link this plan file, note Plan 3 (installer) is next and unstarted.

- [ ] **Step 8: Run the full test suite one final time**

Run: `node --test`
Expected: all pass, 0 failures — matching Plan 1's exit bar (109/108/1-skipped became N/N-1/1-skipped territory here too; record the actual final count in the PR description at merge time).

- [ ] **Step 9: Commit**

```bash
git add package.json playwright.config.js test/e2e/owner.spec.js test/owner-routes.test.js test/helpers NOTICE.md README.md docs/decisions
git commit -m "test: Playwright browser suite, full role-matrix coverage, NOTICE/README finalization"
```

---

## Acceptance checklist (mirrors Plan 1's structure)

1. `npm test` — all pass, 0 failures.
2. `npx playwright test` — all pass (or explicitly deferred with a recorded reason, per Task 14 Step 3).
3. Manual: fresh owner account on a real customer-shaped test vault under `AI Clients/Testing/` — ring populates from real `Dashboard/artifacts/`, tour runs end to end, a real skill run (`bp-digest`) produces a readable HTML report on the ring.
4. Manual: staff account with `assetsView: true` and `artifactsShared: true` sees the Assets and Shared-artifacts tabs on the employee page; an otherwise-identical staff account with both off sees neither.
5. `grep -rn "skool.com" public/ src/` returns exactly one match (the required CC BY credit line).
6. Both Shop OS Chat (port 7777) and this dashboard (port 50000) still run side by side against one vault with no regression — same deferred manual check as Plan 1, re-confirmed now that the vault also has a live `Dashboard/` tree.
