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

`/owner` is the RoboNuggets "Rubric Agentic OS" page served essentially verbatim (CC BY 4.0, see NOTICE.md). It is not hand-maintained: `tools/sync-kit.mjs` regenerates `public/owner.html`, `widgets.html`, `assets.html` and `vendor/thinking-orbs.js` from the kit folder with a short list of named substitutions, and `test/kit-parity.test.js` keeps them honest. Its API is provided by `src/routes/kit-compat-routes.js` on top of the product's data (vault snapshots, runs, artifacts, assets, chat). Layout, look and dashboard profiles live in the browser's localStorage, as in the kit. How to re-sync is in REDESIGN.md.

## Package

To start the dashboard:
```bash
shop-os-dashboard "<vault path>"
```

To run tests:
```bash
npm test
```
