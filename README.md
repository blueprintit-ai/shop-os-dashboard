---
type: project-index
project: shop-os-dashboard
status: planning
tags: [shop-os, dashboard, foundation, agentic-os, auth, note-viewer, installer]
---

## What this is

Shop OS Dashboard: one local Node server that becomes the center access point for Shop OS. Owner mission-control front end derived from Rubric Agentic OS (CC BY 4.0), a read-only note viewer that replaces Obsidian, and per-person logins with owner-managed permissions. Absorbs [[Projects/shop-os-chat|Shop OS Chat]] as the employee experience. Runs on the shop computer, reachable on the shop LAN.

## Status

> [!success] Design spec approved 2026-09-05. Plan 1 of 3 (Foundation) written 2026-09-05, ready to execute. Plans 2 (owner dashboard port) and 3 (installer) follow after Plan 1 lands.
> Built in a new repo and package alongside the current system. No shipped repo is modified until cutover.

## Links

- [[Projects/shop-os-dashboard/specs/2026-09-05-shop-os-dashboard-design|Design spec]]
- [[Projects/shop-os-dashboard/plans/2026-09-05-shop-os-dashboard-foundation|Plan 1: Foundation]] (server, auth, notes, chat, employee page, Users screen)
- [[Projects/shop-os-chat|Shop OS Chat]] (engine source)
- [[Projects/shop-os-installer|Shop OS installer]] (install logic source)
- [[Projects/shop-os-license-server|License server]] (reused unchanged)
- Reference kits: `Dropbox/Robonuggets/agentic-os`, `Dropbox/Robonuggets/second-brain` (CC BY 4.0, NOTICE.md in each)
