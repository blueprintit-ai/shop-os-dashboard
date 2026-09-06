---
type: project-index
project: shop-os-dashboard
status: in-progress
tags: [shop-os, dashboard, foundation, agentic-os, auth, note-viewer, installer]
---

## What this is

Shop OS Dashboard: one local Node server that becomes the center access point for Shop OS. Owner mission-control front end derived from Rubric Agentic OS (CC BY 4.0), a read-only note viewer that replaces Obsidian, and per-person logins with owner-managed permissions. Absorbs [[Projects/shop-os-chat|Shop OS Chat]] as the employee experience. Runs on the shop computer, reachable on the shop LAN.

## Status

> [!success] Design spec approved 2026-09-05. Plan 1 of 3 (Foundation) implemented (branch `foundation-implementation`). Plan 2 of 3 (Owner dashboard port) implemented 2026-09-06 on branch `owner-dashboard-implementation` — all 14 tasks complete, including the final Playwright browser pass and full role-matrix audit; the branch now goes to a whole-branch final review before merge. Plan 3 (installer) is next and has not been started.
> Built in a new repo and package alongside the current system. No shipped repo is modified until cutover.

## Links

- [[Projects/shop-os-dashboard/specs/2026-09-05-shop-os-dashboard-design|Design spec]]
- [[Projects/shop-os-dashboard/plans/2026-09-05-shop-os-dashboard-foundation|Plan 1: Foundation]] (server, auth, notes, chat, employee page, Users screen)
- [[Projects/shop-os-dashboard/plans/2026-09-05-shop-os-dashboard-owner-dashboard|Plan 2: Owner dashboard]] (ring/widgets port, artifacts, assets, skills runner, settings, users activity, browser tests)
- [[Projects/shop-os-chat|Shop OS Chat]] (engine source)
- [[Projects/shop-os-installer|Shop OS installer]] (install logic source, Plan 3, not started)
- [[Projects/shop-os-license-server|License server]] (reused unchanged)
- Reference kits: `Dropbox/Robonuggets/agentic-os`, `Dropbox/Robonuggets/second-brain` (CC BY 4.0, NOTICE.md in each)

## Package

To start the dashboard:
```bash
shop-os-dashboard "<vault path>"
```

To run tests:
```bash
npm test
```
