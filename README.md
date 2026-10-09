---
type: project-index
project: shop-os-dashboard
status: in-progress
tags: [shop-os, dashboard, foundation, agentic-os, auth, note-viewer, installer]
---

## What this is

Blueprint OS Dashboard: one local Node server that becomes the center access point for Blueprint OS. Owner mission-control front end derived from Rubric Agentic OS (CC BY 4.0), a read-only note viewer that replaces Obsidian, and per-person logins with owner-managed permissions. Absorbs [[Projects/shop-os-chat|Blueprint OS Chat]] as the employee experience. Runs on the shop computer, reachable on the shop LAN.

## Status

> [!success] Design spec approved 2026-09-05. Plan 1 of 3 (Foundation) and Plan 2 of 3 (owner dashboard port, the Robonuggets-derived UI) are both merged to `main` (PR #1, PR #2). Plan 3 of 3 (installer: portable Node, git-free marketplaces, auto-start, status/updater, LAN QR) is planned as of 2026-09-18, not yet implemented.
> Built in a new repo and package alongside the current system. No shipped repo is modified until cutover.

> [!warning] Before this replaces [[Projects/shop-os-chat|Blueprint OS Chat]] in production: a manual run against a real customer-shaped vault, and confirming Blueprint OS Chat keeps working on port 7777 against the same vault while this runs on 50000. Neither has been done yet, regardless of what's merged.

## Links

- [[Projects/shop-os-dashboard/specs/2026-09-05-shop-os-dashboard-design|Design spec]]
- [[Projects/shop-os-dashboard/plans/2026-09-05-shop-os-dashboard-foundation|Plan 1: Foundation]] (server, auth, notes, chat, employee page, Users screen) — merged via PR #1
- [[Projects/shop-os-dashboard/plans/2026-09-05-shop-os-dashboard-owner-dashboard|Plan 2: Owner Dashboard]] (ring, widgets, skills deck, artifacts, snapshots, business assets, tour, theme) — merged via PR #2
- [[Projects/shop-os-dashboard/plans/2026-09-18-shop-os-dashboard-installer|Plan 3: Installer]] (portable Node, git-free marketplaces, vault setup, auto-start, status/updater, LAN QR) — planned 2026-09-18, not started
- [[Projects/shop-os-chat|Blueprint OS Chat]] (engine source)
- [[Projects/shop-os-installer|Blueprint OS installer]] (install logic source; Plans 1-3 confirmed not to touch it)
- [[Projects/shop-os-license-server|License server]] (reused unchanged)
- Reference kits: RoboNuggets `agentic-os` (the owner page is synced from it) and `second-brain` (CC BY 4.0, NOTICE.md in each)

## Owner page

`/owner` is the RoboNuggets "Rubric Agentic OS" page served essentially verbatim (CC BY 4.0, see NOTICE.md). It is not hand-maintained: `tools/sync-kit.mjs` regenerates `public/owner.html`, `widgets.html`, `assets.html` and `vendor/thinking-orbs.js` from the kit folder with a short list of named substitutions, and `test/kit-parity.test.js` keeps them honest. Its API is provided by `src/routes/kit-compat-routes.js` on top of the product's data (vault snapshots, runs, artifacts, assets). Layout, look and dashboard profiles live in the browser's localStorage, as in the kit. How to re-sync is in REDESIGN.md.

The deployed owner page has no in-page chat: the kit's bottom chat bar (and its account popover) is removed by sync rules, so there is no `/api/chat` kit endpoint either. To talk to Claude, use Claude Code from the vault folder (employees keep the Chat tab on `/employee`). Log out is the last icon on the owner page's toolbar, after Users and the status dot.

## Staff chat shortcut

Staff sign in on the same dashboard and land on `/employee` (Chat and Notes, read-only, limited to the folders the owner ticks on `/users`). Two ways to reach it:

- **On the shop computer:** the installer puts a second desktop icon, "Blueprint OS Staff Chat", next to "Blueprint OS" (a `.lnk` on Windows, an `.app` on Mac). It runs the dashboard with `--open /employee`: the browser opens `http://localhost:<port>/employee`, whether it had to start the server or attached to the one already running. `--open <path>` is validated (must start with `/`, no `//`, no scheme, only letters, digits and `/ _ - . ? = & %`, 100 characters at most).
- **From their own computers:** the owner's `/users` page has a "Staff chat on their own computers" section: the address `http://<shop-computer-LAN-address>:<port>/employee` (same best-address pick as the phone QR, other candidates listed), its QR code, and downloads from `GET /api/users/staff-shortcut?format=url|webloc|bookmark` (owner only; a Windows `.url`, a Mac `.webloc`, or a plain text file with the link). The file contains the address and nothing else. The address works while the shop computer is on and on the same network; a DHCP reservation on the router keeps it from changing.

## Private files (staff never see them)

Staff (any role other than owner) can never read, list, search, link to, or have the chat read anything private; the owner sees everything. A file or folder is private when:

1. any path segment is named `Private` (any case; at any depth: `Private/...`, `Raw/Private/...`, `Resources/Private/...`),
2. a markdown note has `private: true` (or `yes`) in its front matter, or its front matter is opened but never closed within the first 64 KB,
3. the owner lists it in `<vault>/Dashboard/private-paths.json`: `{ "paths": ["Team/Salaries", "Context/payroll.md"], "patterns": ["salary*", "*payroll*", "bank-*"] }`. Paths are vault-relative prefixes; patterns are case-insensitive, `*` is the only wildcard, and each is matched against every path segment (names compare in Unicode NFC). The file is re-read when it changes (no restart). Entries that cannot be used (a pattern with `/`, a path with `..` or a drive letter, over the limits, unknown keys such as `"path"`) are skipped and logged to the activity log (`private.config-entry-ignored`). If the file exists but cannot be used at all (bad JSON, a trailing comma, wrong shape) and no earlier good list was loaded, staff are denied EVERY path until it is fixed (`private.config-invalid`); if a good list was loaded earlier it stays in force. `privateListStatus()` in `src/scope.js` reports which state the list is in and how many entries were ignored, for the Users page, or
4. it is under the vault's top-level `Chats/` folder (conversation transcripts; owner transcripts also carry `private: true`).

`src/scope.js` `isPathAllowed` (or a `createScope` for a whole walk) is the one check every route uses, applied to the real path (links and junctions into Private are refused). For staff every "no" is the same `404 {"error":"Not available"}` whether the file is private, listed, outside their folders or missing. Staff chat gets `Read` plus two in-process tools, `search` and `list` (`src/chat/vault-tools.js`), instead of the SDK's built-in Grep and Glob, which return matches from every file below a folder. A staff prompt is made inert before the engine sees it (`src/chat/prompt-guard.js`): `@path` mentions are expanded by Claude Code itself, before any tool check, so every `@` gets a zero-width space, and a prompt that starts with `/` or `!` is prefixed with plain words so it cannot run a slash command or shell line. The stats, routines and snapshot feeds are owner-only.

**Known limits.** What is not covered:

- Hard links the owner creates to a private file cannot be detected (only symlinks, junctions and names are).
- Only `private: true` / `yes` / `on` / `1` written as a plain `key: value` front matter line is recognized. YAML flow style (`{private: true}`), anchors and aliases, `!!bool` tags, list forms and a nested `private` are not.
- Anyone who opens the vault directly (Dropbox, Obsidian, the file system, a backup) is outside the dashboard's control.
- The AI used by the owner (terminal or owner chat) still sees everything; anything it writes into a normal folder is no longer private. Keep derived notes in `Private/`.
- The staff list/Read answers do not reveal whether a name exists, but a staff member who already knows a path's parent folder can see that a granted folder has other entries only through what `list` shows, which omits private ones.

## Second Brain page

`/brain` (owner only; staff are sent to `/notes`) is the RoboNuggets "Second Brain" map, served essentially verbatim (CC BY 4.0, see NOTICE.md) and generated by `tools/sync-brain.mjs` with its own lock (`tools/sync-brain.lock.json`) and parity test. It shows the vault as four rings: Memory (notes, by department/folder), Skills, Routines (the snapshot feed) and Applications (`Dashboard/apps.json`). The engine is `src/brain/` and `src/routes/brain-routes.js` (`/api/brain/*`): capped scan, cached until the notes watcher sees a change, files read only inside the vault. How to re-sync is in REDESIGN.md.

## Package

To start the dashboard:
```bash
shop-os-dashboard "<vault path>" [--port N] [--no-browser] [--open /employee]
```

To run tests:
```bash
npm test
```
