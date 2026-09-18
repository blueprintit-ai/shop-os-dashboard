---
type: project-index
project: shop-os-dashboard
status: in-progress
tags: [shop-os, dashboard, foundation, agentic-os, auth, note-viewer, installer]
---

## What this is

Shop OS Dashboard: one local Node server that becomes the center access point for Shop OS. Owner mission-control front end derived from Rubric Agentic OS (CC BY 4.0), a read-only note viewer that replaces Obsidian, and per-person logins with owner-managed permissions. Absorbs [[Projects/shop-os-chat|Shop OS Chat]] as the employee experience. Runs on the shop computer, reachable on the shop LAN.

## Status

> [!success] Design spec approved 2026-09-05. Plan 1 of 3 (Foundation) and Plan 2 of 3 (owner dashboard port, the Robonuggets-derived UI) are both merged to `main` (PR #1, PR #2). Plan 3 (installer integration) has no plan doc yet and is next.
> Built in a new repo and package alongside the current system. No shipped repo is modified until cutover.

> [!warning] Before this replaces [[Projects/shop-os-chat|Shop OS Chat]] in production: a manual run against a real customer-shaped vault, and confirming Shop OS Chat keeps working on port 7777 against the same vault while this runs on 50000. Neither has been done yet, regardless of what's merged.

## Links

- [[Projects/shop-os-dashboard/specs/2026-09-05-shop-os-dashboard-design|Design spec]]
- [[Projects/shop-os-dashboard/plans/2026-09-05-shop-os-dashboard-foundation|Plan 1: Foundation]] (server, auth, notes, chat, employee page, Users screen) — merged via PR #1
- [[Projects/shop-os-dashboard/plans/2026-09-05-shop-os-dashboard-owner-dashboard|Plan 2: Owner Dashboard]] (ring, widgets, skills deck, artifacts, snapshots, business assets, tour, theme) — merged via PR #2
- [[Projects/shop-os-chat|Shop OS Chat]] (engine source)
- [[Projects/shop-os-installer|Shop OS installer]] (install logic source; Plan 3, not started; Plans 1-2 confirmed not to touch it)
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
