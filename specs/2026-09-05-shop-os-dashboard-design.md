---
type: design-spec
project: shop-os-dashboard
date: 2026-09-05
status: approved
approved-by: Glenn
approved-on: 2026-09-05
tags: [shop-os, design-spec, dashboard, foundation, agentic-os, rubric, auth, note-viewer, installer]
---

## Overview

Shop OS Dashboard is a single local Node server that becomes the center access point for Shop OS. It replaces Obsidian as the human-facing view of the vault, absorbs [[Projects/shop-os-chat|Shop OS Chat]] as its employee experience, and gives the owner a mission-control front end derived from Rubric Agentic OS (Jay E | RoboNuggets, CC BY 4.0). It runs on the shop computer, is reachable on the shop's local network, and gives every person their own login with owner-managed permissions.

The build happens in a new repo and package, alongside the current system, with no edits to shipped code. Cutover is a deliberate, reversible switch once the new system is proven.

## Decisions already made

| Decision | Choice | Why |
|---|---|---|
| Note interaction model | Read-only viewer plus chat. Owner reads, then tells Claude to change things. | Matches the current first-week guide. Removes the whole editor problem. |
| Center of the product | The agentic-os dashboard shell | Owner wanted mission control as the front door |
| Users | Owner now; each employee gets a limited login; owner manages access | Mirrors the [[Projects/capital-discount-furniture|CDF]] model the owner already runs |
| Where it runs | Shop computer as LAN server | Keeps local-first, no hosting bill, covers walk-up and own-device |
| Codebase base | Shop OS Chat's engine, agentic-os's shell (Approach 1) | SDK tool whitelist per role is the correct security boundary; no shell-string runner, no bypass-permissions default on a LAN server |
| Isolation | New repo, package, port, and data folders; existing repos untouched until cutover | Owner requirement: do not break the current Shop OS |

## Goals

- One URL for the whole shop: owner cockpit and employee door in the same product.
- Remove Obsidian, Git, Python, Homebrew, WinGet, and administrator rights from the install. Prerequisites become Node and Claude Code.
- Per-person logins with owner-managed permissions, enforced in code.
- Preserve every agentic-os feature the owner cares about: ring, search, widgets, chat bar with tool markers, skills deck, business assets, theme, tour.
- Zero changes to the vault's conventions. Existing skills keep working in Claude Code.

## Non-goals (v1)

- Note editing, graph view, canvas, Bases.
- Hosted or cloud deployment. Localhost and LAN only.
- HTTPS on the LAN.
- Google Calendar and email triage widgets.
- Running bp-setup or grill-me inside the chat bar.
- A manager role or per-user tool sets beyond the switches defined below.
- Bundling Node into a single executable. Portable Node in a private folder is the v1 answer.
- Serving the Rubric Second Brain map from the same server. It remains an optional sibling on port 5210.

## Isolation and cutover rules

1. `shop-os-chat`, `shop-os-installer`, `shop-os-license-server`, and `blueprint-skills` are read, never modified, until cutover.
2. New repo `blueprintit-ai/shop-os-dashboard`, new package `@blueprintitai/shop-os-dashboard`. Code is copied in from Shop OS Chat and agentic-os, not refactored in place.
3. Port 50000 (fallback 50001 to 50010). Chat's 7777 range is untouched. Both systems run on one machine against one vault at the same time during testing.
4. State outside the vault lives in `~/.shopos/dashboard/`. State inside the vault lives only in `<vault>/Dashboard/` and, for transcripts, `<vault>/Chats/` in the existing format. `CLAUDE.md`, `Context/`, and `.claude/settings.json` are never rewritten by the dashboard.
5. The license server and `~/.shopos/license.json` are reused unchanged. No new entitlement.
6. New install scripts live in the new repo. The install page, the published installer, and customer-facing `.bat` and `.command` downloads keep pointing at today's flow until cutover.
7. Cutover checklist: publish the package, repoint the install page scripts, publish the rewritten first-week guide and staff runbook, mark Shop OS Chat deprecated. Existing customers receive the dashboard on their next update. Rollback is repointing the install page.
8. Development targets the test vaults under `AI Clients/Testing/` and a fresh install on a clean machine. The Robonuggets folder is the reference copy of the upstream kits, not the codebase.

## Section 1: Architecture and modules

### Runtime

- ESM, Node 20 or newer, one process, one port.
- Launched as `shop-os-dashboard "<vault path>"`.
- Binds `0.0.0.0:50000` so LAN devices can reach it. Falls back through 50010 if taken.
- Registered to start at login: user-level Task Scheduler task on Windows, launchd user agent on Mac.
- A desktop shortcut named "Shop OS" opens the browser to the dashboard.
- The owner dashboard shows the current LAN address and a QR code for staff devices.

### Dependencies

- Runtime: `@anthropic-ai/claude-agent-sdk`, `marked`. Nothing native.
- Password hashing: Node built-in `crypto.scrypt`.
- Sessions: random tokens in an httpOnly cookie, server-side store persisted to JSON.
- Dev only: Playwright.

### Server modules (one file, one job)

| Module | Responsibility |
|---|---|
| `license` | Reads `~/.shopos/license.json`, validates against the existing license server on the same schedule Chat uses. Locks chat and notes when invalid. |
| `auth` | Login, logout, session issue and check, lockout, localhost-only first-run and recovery. |
| `users` | User store CRUD, role and permission switches, soft deactivate, audit of changes. |
| `chat` | Wraps the Agent SDK. Builds tool list, permission callback, and system prompt from the caller's role and folder scope. Streams SSE. Writes transcripts to `Chats/`. |
| `runs` | Skills deck. Owner only. Spawns Claude with an argument array, never `shell: true`. Writes run logs and result artifacts under `<vault>/Dashboard/`. |
| `notes` | File tree, note read, rendered HTML, full-text search, wikilink resolution, backlinks. Read-only. Enforces folder scope. |
| `artifacts` | Ring data from `<vault>/Dashboard/artifacts/` with sidecar JSON. Ported from agentic-os. Adds `visibility: owner | staff` sidecar field. Implements the missing artifact-remove route (move to `_trash`). |
| `snapshots` | Stats and routines JSON feeds from `<vault>/Dashboard/snapshots/`. Ported. |
| `assets` | Business Assets browser and upload. Ported. Folder configured by the owner in settings, not hardcoded. |
| `layout` | Per-user widget layout and theme, stored server-side. |
| `sessions-guard` | Caps concurrent Claude sessions (default 3). Queues the rest and exposes queue position. |
| `audit` | Appends one JSON line per event to `~/.shopos/dashboard/activity.jsonl`. |
| `updater` | Daily check of the npm registry. One-click update in the private prefix and restart. |
| `status` | Health: Claude Code present and signed in, license state, vault reachable, port, LAN address. Drives the status cards. |

### Data layout

```
<vault>/
  Dashboard/
    artifacts/            HTML artifacts + <name>.json sidecars; _trash/
    snapshots/            stats.json, routines.json, runs.json
    runs/                 one .log per headless run
  Chats/                  transcripts, unchanged format

~/.shopos/
  license.json            existing, unchanged
  dashboard/
    users.json            users, scrypt hashes, switches
    sessions.json         active sessions
    layouts/<userId>.json widget layout + theme
    settings.json         assets folder, session cap, port override
    activity.jsonl        audit log
    logs/                 rotating server logs
  runtime/                portable Node (installer)
  app/                    the installed package (installer)
```

Secrets never enter the vault, because the vault may be Dropbox-synced and is readable by Claude's tools.

### Front end

Served from `public/`. Three pages: login, owner dashboard, employee page. Detail in Section 4.

### Known tradeoff

Traffic on the LAN is plain HTTP. Self-signed certificates would produce browser warnings on every staff device. Passwords cross the shop Wi-Fi once per login. Acceptable for a private shop network and consistent with common on-premise small-business tools. Documented for the owner in the guide.

## Section 2: Authentication and permissions

### Roles

- `owner`: everything, including user management, skills deck, full-tool chat, all folders, all artifacts.
- `staff`: baseline of read-only chat and note viewer, plus per-user switches set by the owner.

No manager tier in v1.

### Staff switches (feature slugs stored per user)

| Slug | Meaning | Default |
|---|---|---|
| `folders` | List of allowed top-level vault folders, plus optionally one `Team/<org>/Profiles/<person>` folder | Projects, Resources, Processes, and the person's own Team profile folder when the owner links one |
| `assets.view` | Business Assets browser | off |
| `artifacts.shared` | See artifacts whose sidecar has `visibility: staff` | on |

Owner-only, not switches in v1: skills deck, chat with write tools, Users screen, audit widget, full folder access.

### Enforcement

Folder scope is applied twice from the same list:

1. `notes` refuses any path outside the scope, after resolving symlinks and `..`.
2. `chat` passes a tool-permission callback to the Agent SDK that denies Read, Glob, and Grep for any path outside the scope. Staff tool list is exactly Read, Glob, Grep, as in Shop OS Chat today. Denials are logged to the audit trail.

The system prompt tells the model about the scope for a better experience, but the callback is the boundary.

Owner chat uses the SDK with full tools and the permission mode that allows writes without prompts, with `cwd` set to the vault. This matches the owner's terminal experience.

### Login and sessions

- Username and password. Passwords hashed with scrypt (N=2^15, r=8, p=1, 32-byte salt).
- Five failed attempts lock the account for fifteen minutes. Lockouts are audited.
- Session token: 32 random bytes, httpOnly, `SameSite=Lax`, path `/`. Twelve hours by default. "Remember this device" extends to thirty days.
- Every authenticated request re-reads the user record. Deactivation takes effect on the next request.
- POST routes require a valid session and an `Origin` or `Referer` header matching the request host. Cross-origin POSTs are refused.

### First run and recovery (localhost only)

- The first-run screen that creates the first owner account responds only to requests from `127.0.0.1` or `::1`. From any other address it shows "Set up Shop OS on the shop computer first."
- `shop-os-dashboard --reset-owner` resets the owner password from a terminal on the shop computer.
- Being on the shop computer does not skip login otherwise.

### Users screen (owner only)

List, add with temporary password, edit name and switches, reset password, deactivate, reactivate. Soft deactivation keeps transcript authorship. The last active owner cannot be deactivated. A second owner can be added. Every change is audited.

### Audit log

One JSON line per login, failed login, lockout, chat session start and end, note view, artifact open, permission denial, and user change. Fields: timestamp, userId, username, role, event, detail. Surfaced as the team activity widget and retained for support.

## Section 3: The note viewer

### Surface

- Folder tree limited to the user's allowed folders. Hidden folders (`.claude`, `.obsidian`, `.git`, `.shopos`, `node_modules`) never appear.
- Markdown renders in the main pane. PDFs and images render inline. Other types download.
- Files over 2 MB show a size notice instead of rendering.

### Rendering

`marked` plus a preprocessing pass:

- Frontmatter becomes a properties strip.
- Wikilinks in all forms present in real vaults resolve and become in-app links: `[[Name]]`, `[[Name|alias]]`, `[[Name#Heading]]`, `[[path/Name]]`, `![[image.png]]`. Unresolved links render as muted text.
- Callouts (`> [!type]`) render as styled blocks.
- Tags render as chips. Task checkboxes and tables render.
- Highlights (`==text==`) render. Comments (`%%text%%`) are stripped.

### Link index and backlinks

- At startup the server indexes every note's basename, path, and outgoing links.
- A filesystem watcher with a 750 ms debounce keeps the index current through Dropbox sync bursts. A manual "rescan" exists in owner settings.
- Wikilinks resolve by basename with nearest-path tiebreak, matching Obsidian's default.
- Each note shows a "Mentioned in" panel from the index.

### Search

- Title matches first, then full text, with snippets.
- Server-side, streaming through files with Node built-ins.
- Respects the caller's folder scope.

### Chat integration

- Wikilinks and cited vault paths in chat answers open the note in the viewer. The `obsidian://` link rewriting from Chat is not carried over.
- From a note, the owner has an "Ask Claude about this" button that opens the chat bar with the note referenced.

### Owner dashboard widgets using this module

- Today's briefing: newest note in `Daily/`.
- Recent changes: last twenty notes modified, with who or what changed them when known.

## Section 4: Owner dashboard and employee page

### Owner dashboard

agentic-os's page, split into `owner.html`, `owner.css`, and JS modules (`ring.js`, `widgets.js`, `chat-bar.js`, `search.js`, `tour.js`, `theme.js`). Same look and behavior for ring, search, edit mode, widget library, theme toggle, and tour.

Changes from the kit:

- Widgets shipped: title, artifacts ring, chat bar, skills deck, routines, stats, business assets, today's briefing, recent changes, team activity, team roster with link to Users.
- Widgets removed: Google Calendar, email triage. Code not carried over.
- Skills deck defaults: bp-digest, morning briefing, bp-optimizer. Interactive skills stay in Claude Code.
- The orb opens the note viewer, or the Second Brain map if `localhost:5210` responds. All RoboNuggets Skool URLs removed. The CC BY credit card remains the final tour step.
- Layout and theme saved per user on the server.
- Locale and time zone follow the shop computer.
- Chat bar runs Claude with full tools in the vault, with tool-use markers and session resume.
- Widget edit-mode sliders and theme tokens keep the `REDESIGN.md` contract so a reskin stays a one-block change.

### Employee page

- Separate page, mobile-first.
- Header: shop name, person's name, logout.
- Tabs: Chat, Notes, and when switched on, Assets and Shared artifacts.
- Chat is Shop OS Chat's read-only conversation reskinned. Name comes from login. Transcripts to `Chats/` with username, existing format.

### Login page

Shop name from the vault's Context files, username, password, remember this device. Shows the locked state when the license is invalid.

### Owner on a small screen

Below tablet width the owner gets the employee layout plus full-tool chat and a Users link. The ring is desktop only.

## Section 5: The new install sequence

### Prerequisites

Two: Node and Claude Code. Replacements for what is removed:

| Removed | Was for | Replacement |
|---|---|---|
| Obsidian | Viewing notes | The note viewer |
| Git | Cloning two plugin marketplaces | Tarball fetch with Node's built-in fetch |
| Python 3 | Office-file conversion in bp-digest | Dropped. Claude converts natively. Verified in testing. |
| Homebrew, WinGet, MSI | Installing the above | Portable Node into `~/.shopos/runtime`, called by full path. System Node 20+ reused if present. |
| Administrator rights | Homebrew, WinGet, MSI | None needed. No UAC, no sudo. |

### Sequence (both platforms, about five minutes)

1. Customer downloads the personalized `.bat` or `.command` from the existing install page. Same page; new script behind it at cutover.
2. Portable Node downloads into `~/.shopos/runtime`.
3. Claude Code installs via Anthropic's native installer into the user's home.
4. The dashboard package installs into `~/.shopos/app` with the private Node's npm.
5. License validates. Vault folder picker and name prompt as today. `CLAUDE.md` stub, `Raw/`, `.claude/settings.json`, and plugin marketplaces are written by logic copied from today's installer, minus git.
6. Auto-start registers. Desktop shortcut created.
7. Dashboard starts. Browser opens to the first-run owner account screen.

### Still in the terminal for v1

- Signing in to Claude the first time.
- The bp-setup interview.

The first-run screen shows the exact commands. The `status` module detects Claude sign-in and `bp-setup-state: complete` and clears the setup cards.

### Updates

Daily registry check. "Update available" banner. One click updates in the private prefix and restarts. Replaces the saved `shop-os-update` command.

## Section 6: Error handling and testing

### Failure states (each a visible card, never a crash)

| Condition | Behavior |
|---|---|
| Claude Code missing or not signed in | Chat disabled; card shows the command to run |
| License invalid or expired | Login works; chat and notes lock; card explains renewal |
| Port 50000 taken | Try 50001 to 50010; update shortcut and displayed address; log |
| Vault folder missing | Status card; retry every 30 s |
| Session cap reached | "Waiting for a free slot" with queue position |
| Claude turn hangs or crashes | Per-turn timeout; friendly message; resume from last good turn |
| LAN address changes | Dashboard always shows current address and QR; guide recommends a static lease |
| Process dies | Auto-start task relaunches; logs rotate in `~/.shopos/dashboard/logs/` |

### Unit tests (Node built-in test runner)

- Auth: scrypt, lockout, session expiry, immediate revocation.
- Permissions: identical scope enforcement in `notes` and the SDK callback; traversal attempts refused.
- Renderer: frontmatter, every wikilink form, callouts, tags, embeds, highlights.
- Link index: build, incremental update, backlinks.
- Search: scoping, ranking, snippets.
- Sessions guard: cap and queue order.
- Runs: argument-array spawn, no shell.

### Integration tests (fixture vault)

- Fixture: sanitized copy of the Shop OS test vault.
- Route-by-role matrix: every endpoint for anonymous, staff, owner returns the expected status.
- Chat against a stubbed SDK: SSE event mapping; transcripts byte-compatible with Shop OS Chat's format.
- CSRF: cross-origin POST refused.
- First-run screen refused from a non-loopback address.

### Browser tests (Playwright, dev only)

- Login; employee page at phone viewport; wikilink in a chat answer opens the note; Users screen add, edit, deactivate; deactivated user's next click lands on login.

### Install tests (manual, real machines)

- Clean Windows 11, non-admin account.
- Clean macOS, non-admin account.
- Machine with an existing system Node.
- Machine with today's Shop OS installed: both systems run against one vault.
- Port collision.
- bp-digest with a PDF, a spreadsheet, and a Word doc, no Python present.

### Cutover gate

All tests above passing, plus one real shop running both systems side by side for a week with no regression in existing skills, before the install page flips.

## Licensing and attribution

Rubric Agentic OS and Rubric Second Brain are CC BY 4.0 by Jay E | RoboNuggets. The repo carries a `NOTICE.md` naming the original work, author, license, and changes made. The owner dashboard keeps a Credits card as the final tour step. No RoboNuggets marketing URLs ship. The `vendor/thinking-orbs.js` file's provenance is confirmed or the file is replaced before release.

## Open items to verify during implementation

1. Whether the Agent SDK accepts a slash command as the prompt for headless skill runs. If not, `runs` spawns the CLI with an argument array.
2. That bp-digest handles PDF, spreadsheet, and Word files with no Python installed.
3. Minimum Node version required by the current Agent SDK release, to pin the portable Node build.
4. Whether Playwright's browser download is acceptable as a dev dependency on the build machine, or whether browser tests run in CI only.

## Related

- [[Projects/shop-os-chat|Shop OS Chat]] (engine source, to be deprecated at cutover)
- [[Projects/shop-os-installer|Shop OS installer]] (install logic source, untouched until cutover)
- [[Projects/shop-os-license-server|License server]] (reused unchanged)
- [[Projects/capital-discount-furniture|CDF]] (permission model reference)
