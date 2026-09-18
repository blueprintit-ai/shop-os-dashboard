# Installer Manual Test Runbook (Task 11)

Companion to `plans/2026-09-18-shop-os-dashboard-installer.md`'s Task 11 ("Manual install test matrix"). That task's 7 items need real physical hardware, a reboot, and macOS access that a CI/agent sandbox does not have — this document tracks what's been verified so far and gives exact, reproducible steps for the rest.

**Status: 2 of 7 done, 5 open.** Run the 5 open items before the cutover gate (per the design spec, `specs/2026-09-05-shop-os-dashboard-design.md`'s Section 6: "All tests above passing, plus one real shop running both systems side by side for a week with no regression in existing skills, before the install page flips").

## Done

### 3. System Node reuse — ✅ verified 2026-09-18

**Claim:** both the shell bootstrap (`run-setup.ps1`/`.sh`) and, later, `resolveNode` must reuse an existing system Node ≥20, not download a portable copy.

**How it was verified:** this branch isn't merged to `main` yet, so `installer/setup-windows.ps1`'s real download-and-run flow would fetch a stale `run-setup.ps1` (or none at all). Instead, `installer/run-setup.ps1`'s Node-acquisition logic (`Find-QualifyingNode` through the `$npmBin` resolution, lines 1-41) was run directly against this real Windows machine, short-circuited before the npm-install/GitHub-fallback steps (which would install the stale pre-Plan-3 published package).

**Result on this machine** (real system Node v24.16.0, well above the ≥20 floor):
```
TEST-RESULT nodeBin=node
TEST-RESULT npmBin=npm.cmd
TEST-RESULT system-node-version=v24.16.0
TEST-RESULT portable-runtime-dir-created=False
```
`Find-QualifyingNode` correctly detected the system Node, `$npmBin` correctly resolved to `npm.cmd` (this is the exact bug Task 9's pre-flight review caught and fixed — a bare `-replace` on the literal string `"node"` is a no-op, so without the fix this would have stayed `"node"` and broken every subsequent npm invocation), and no portable runtime directory was ever created.

**Re-run before cutover on:** a machine with a Node install NOT on the default PATH resolution order (e.g. only reachable via an nvm shim) — the `where node`/`where npm.cmd` calls in `installer/node-runtime.js`'s `resolveBinPath` (added in the final-review fix round) resolve `node` and `npm` via two independent lookups; this is a known, accepted, non-regressed risk (see the plan's ledger) worth confirming doesn't misfire on your actual target hardware profile.

### 5. Port collision fallback — ✅ verified 2026-09-18

**Claim:** start something else on 50000 first, confirm the dashboard falls back through 50001-50010, and the desktop shortcut/auto-start command still points at the actual bound port.

**How it was verified:** bound a dummy TCP listener on port 50000 on this real machine, then ran the actual `bin/shop-os-dashboard.js` from this branch directly (`node bin/shop-os-dashboard.js <temp-vault> --home <temp-home> --no-browser`, no `--port` flag, exercising the real `findFreePort()` fallback).

**Result:**
```
v Listening on port 50001
  This computer: http://localhost:50001
  Shop network:  http://100.106.103.8:50001
  Shop network:  http://10.5.0.2:50001
  Shop network:  http://192.168.1.215:50001
  Shop network:  http://172.18.208.1:50001
```
Correctly fell back to 50001, and every printed URL (local + all 4 LAN interfaces) reflects the real bound port, not the requested/default 50000.

**On the "shortcut/auto-start still points at the actual bound port" half of this item:** confirmed by reading the code (`installer/autostart-windows.js`'s `registerAutoStart`/`createDesktopShortcut`, `installer/autostart-macos.js`'s `registerAutoStart`/`createDesktopApp`) that **neither the scheduled task, the `.lnk` shortcut, the launchd plist, nor the `.app` launcher ever embeds a port number at all** — each only passes `nodeBin`, `dashboardBin`, `vaultPath`, and `--no-browser`. `bin/shop-os-dashboard.js` always determines the real port itself via `findFreePort()` at every launch, so there's no stale-port state for a shortcut to go wrong in the first place. (The final-review fix round removed the one place that *did* hardcode a port — a stray `open "http://localhost:50000"` line in the macOS `.app` launcher, Important finding #10 — so this item's original concern is now structurally addressed by design, not just by the fallback logic working.)

## Open — needs real hardware

### 1. Clean Windows 11, non-admin account

Needs: a fresh Windows 11 VM or machine, or a fresh non-admin local account on an existing one. Do NOT run this as an admin account — the entire point is confirming no UAC prompt ever appears.

1. On the clean/non-admin machine, open a plain (non-elevated) PowerShell or Command Prompt — do not right-click "Run as administrator."
2. Once this branch is merged and the install page points at it, run the real customer command (currently, `installer/setup-windows.ps1`'s content, fetched from `raw.githubusercontent.com/blueprintit-ai/shop-os-dashboard/main/installer/setup-windows.ps1` — confirm the install page's actual command matches this once cutover happens).
3. Watch for: any UAC prompt (there should be none — nothing in this flow calls `Start-Process -Verb RunAs`, elevates, or needs it), any Git/WinGet/Homebrew invocation (there should be none — grep the transcript output for those names if in doubt), and a successful landing on the first-run owner setup screen in a browser.
4. Confirm `%USERPROFILE%\.shopos\app\node_modules\@blueprintitai\shop-os-dashboard` exists and `%USERPROFILE%\.shopos\runtime.json` was written with real `node`/`npm` paths.
5. Confirm a desktop shortcut ("Shop OS.lnk") was created and works.
6. Log out and back in (or just wait if testing auto-start separately) — confirm the scheduled task `ShopOSDashboard` exists via `schtasks /query /tn ShopOSDashboard`.

### 2. Clean macOS, non-admin account

Needs: a fresh macOS machine or VM, or a fresh Standard (non-admin) user account on an existing Mac.

1. Log in as the non-admin Standard user.
2. Open Terminal (no `sudo`, ever) and run the real customer command (`installer/setup-macos.sh`'s content, fetched from the same raw GitHub path as above).
3. Watch for: any macOS permission/admin password prompt (there should be none), any Homebrew invocation (`brew` should never appear — check the transcript), a successful landing on the first-run owner setup screen.
4. Confirm `~/.shopos/app/node_modules/@blueprintitai/shop-os-dashboard` exists and `~/.shopos/runtime.json` was written.
5. Confirm a `Shop OS.app` was created on the Desktop and opens the dashboard correctly (not a stale/hardcoded port — see the port-collision note above, this should just work).
6. Confirm `launchctl list | grep ai.blueprintit.shop-os-dashboard` shows the registered LaunchAgent after logging out and back in.

### 4. Coexistence with an existing `shop-os-installer` (Shop OS Chat) install

Needs: a machine that already has the older `shop-os-installer` product installed and running (port 7777) against a real vault.

1. On that machine, run the new dashboard's install flow (items 1 or 2 above) pointed at the **same vault** the existing Shop OS Chat already uses.
2. Confirm Shop OS Chat (port 7777) is completely unaffected — still runs, still serves the same vault, no config it owns got touched. Watch specifically for `~/.claude/settings.json` and `~/.claude/plugins/known_marketplaces.json`, since both this installer and `shop-os-install.js` (the old one) can write to them — confirm the old installer's plugins/permissions are still present after the new one runs (the final-review fix round added a `.bak`-and-warn safeguard for a genuinely malformed `settings.json`, but a well-formed existing file should simply get the new dashboard's plugin IDs merged in, not replaced).
3. Confirm the new Shop OS Dashboard (port 50000, or its fallback per item 5) also starts cleanly against the same vault, with both products' auto-start entries present and non-conflicting (`ShopOSDashboard` scheduled task / LaunchAgent alongside whatever the older installer registered).
4. Use both products for a few real actions each (a chat turn in Shop OS Chat, a login + a skill run in the new dashboard) and confirm no cross-interference.

### 6. `bp-digest` with a PDF, a spreadsheet, and a Word doc, no Python installed

**Context found while investigating this item:** `bp-digest` is one of the three built-in Claude Code skills the dashboard's headless skill runner (`src/runs.js`) can invoke (alongside `morning-briefing` and `bp-optimizer`). Per the design spec (`specs/2026-09-05-shop-os-dashboard-design.md`, the "Removed / Replacement" table): Python 3 was previously required for office-file conversion inside `bp-digest`, and was **dropped entirely** — "Claude converts natively" — per that same spec, already "Verified in testing" once during Plan 1/2's own development. This item is really a **regression check** that the no-Python behavior still holds after this branch's changes, not a first-time verification.

This wasn't run as part of today's live checks because it needs real sample documents and makes a real, billed Claude Agent SDK call — a different category from the installer/bootstrap checks above, and worth doing deliberately rather than folded into an unattended pass.

1. On a machine confirmed to have **no Python installed** (`python --version` / `python3 --version` both fail), complete a fresh install of this branch.
2. Log in as the owner, open the Skills Deck widget, and run `bp-digest` against a real PDF, a real `.xlsx` spreadsheet, and a real `.docx` Word document (one at a time or together, per however `bp-digest`'s own skill definition accepts input — check the actual skill file in the `obsidian@blueprint-skills` marketplace this installer sets up for its exact invocation contract).
3. Confirm each file is digested successfully with no error referencing `python`, `pip`, or a missing interpreter.

### 7. Reboot test

Needs: a real machine you can freely reboot (do not run this on your primary dev machine mid-session — it will kill anything running, including any active terminal/IDE state).

1. Complete a fresh install (item 1 or 2).
2. Confirm the dashboard is NOT currently running (close any open terminal/process for it).
3. Reboot the machine.
4. Log in as the same user.
5. Without opening anything manually, confirm the dashboard auto-starts: check that it's listening (`netstat -ano | findstr :5000` on Windows in the 50000-50010 range, or `lsof -i :50000-50010` on macOS) within a reasonable time after login, and that a browser tab opens to it (unless the auto-start command passes `--no-browser`, which it does — confirm this is the intended UX: auto-start is silent-by-design, not user-facing on every login, only the manually-launched desktop shortcut opens a browser).
6. Also verify the **"Update now" restart actually works** post-fix (final-review Critical finding #3): trigger an update from the owner dashboard, confirm the dashboard goes down and **comes back up on its own within a few seconds** (via the new `makeRestart()` self-respawn), without needing the reboot/login this item is otherwise testing for.
