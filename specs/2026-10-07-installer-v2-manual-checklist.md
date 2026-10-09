# Installer v2 - manual checklist, support runbook, cutover

Three parts: (1) the manual checklist (about 15 minutes per machine), (2) the support runbook, (3) the cutover procedure. Everything here is what CI cannot prove. A line marked UNVERIFIED was written from reading the code and has not been run on a real machine.

Legend: `<WORKER>` = the license-server base URL (https://shop-os-license-server.glenn-15d.workers.dev). `<TEST_KEY>` = a throwaway license key. `<CUSTOMER_KEY>` = the pilot customer's real key (never write it into the repo). `$ADMIN_TOKEN` = the Worker admin token, exported in the shell.

Preconditions:
- [ ] Dashboard PR is green on both CI jobs (unit job and the real Windows + macOS install job in `.github/workflows/installer-e2e.yml`).
- [ ] Use a fresh Windows user (or a clean VM) and a Mac with no `~/.shopos`.
- [ ] The test key is flagged v2 (see Cutover step 4) and the `.bat` / `.command` was downloaded AFTER the flag was set.

---

## Part 1. Manual checklist

### Windows (run on a spare Windows 11 PC, then again on a standard-user account)
- [ ] Double-click the v2 `.bat` for the test key. No UAC prompt appears.
- [ ] SmartScreen "More info > Run anyway" works once and the window stays open.
- [ ] Defender raises no alert for the starter, MinGit, the Claude installer, or the Obsidian installer.
- [ ] The console prints "Opening the folder window. The first time this can take up to a minute." immediately. If the window is slow, every 10 seconds it prints "Still waiting for the folder window. Look for a window called "Browse For Folder" in your taskbar, or press Alt+Tab. (<n>s)" and stops once the window returns.
- [ ] The folder-picker window opens IN FRONT of the console (not hidden behind it), accepts a Dropbox folder, and a name containing a space or an accent works. (The picker is started with `-STA` and now shows an invisible owner form and activates it first; front-most behavior is UNVERIFIED until this runs.)
- [ ] Any other step that takes longer than 8 seconds prints `Still working on "<step title>"... please keep this window open. (<n>s)` every 10 seconds. The folder step and the final Claude sign-in never print it.
- [ ] Cancel the picker once: the message and support code are shown and the window stays open.
- [ ] Claude Code opens for sign-in in the browser; after `/exit` it reopens and `/bp-setup` is listed.
- [ ] Claude Desktop installed on this PC: open its Code tab in the vault folder; `/bp-setup` is listed.
- [ ] Claude Desktop install paths in `installer/core/desktop.js` are guesses (`%LOCALAPPDATA%\AnthropicClaude`, `%LOCALAPPDATA%\Programs\Claude`, `%ProgramFiles%\Claude`). Check where Desktop really lives. If the installer did not print the Desktop note, fix the path list in `installer/core/desktop.js` (UNVERIFIED until this runs).
- [ ] Desktop Chat and Cowork tabs do NOT show the skills (expected); the printed note says so.
- [ ] STANDARD USER: on a non-admin Windows account, Obsidian installs per-user and opens the vault folder. This was never proven (the CI runner is admin). If it fails the Obsidian step only warns; note the hint shown. (UNVERIFIED.)
- [ ] The `ShopOSDashboard` scheduled task exists.
- [ ] The desktop shortcut "Blueprint OS" opens the dashboard.
- [ ] Re-run the same `.bat`: finishes quickly, nothing duplicated, CLAUDE.md untouched. It does NOT ask for the folder again: it prints "Using your existing Blueprint OS folder: <path>" (the path is shown on the console only, never sent to support).
- [ ] Re-run with `--choose-folder` (or set `SHOPOS_CHOOSE_FOLDER=1`): the folder window opens again. Delete the saved folder (or its CLAUDE.md) and re-run: the window also opens, because the saved path is no longer valid.
- [ ] Unplug the network at "Installing Claude Code": the failure message appears with a support code; the Admin Installs page shows the run within a minute; the alert email arrives.
- [ ] Non-ASCII Windows username (for example an account named with an accent): the install completes. `tar.exe` and PowerShell 5.1 read paths through the ANSI code page, so this is a real risk for the Node and package extraction. (UNVERIFIED; the CI user name is ASCII.)
- [ ] `ShopOSDashboard` task exists and the dashboard starts after a restart with a profile path containing a space and ~100 characters (for example `C:\Users\Jane Doe...`). The dashboard step must NOT warn about "Value for '/tr' option cannot be more than 261 character(s)": the task now runs `wscript.exe "<profile>\.shopos\start-dashboard.vbs"` and the launcher holds the long command. Check: `schtasks /query /tn ShopOSDashboard /v /fo list` shows the short Task To Run; sign out and in, the dashboard answers. (UNVERIFIED on real Windows; unit-tested only.)
- [ ] During a long step the console shows `  > <step title>...` as soon as the step starts (for example `  > Installing Claude Code...`), so the last line on screen is never the previous step's `ok` line. Skipped steps on a re-run show only `  - <title>`. (UNVERIFIED on a real PC.)
- [ ] Username with an apostrophe (O'Brien): the `.bat` download line works (fixed in license-server `0bdc110`, tested only by text assertions, UNVERIFIED on a real PC).

### Mac (repeat the whole Windows list in spirit, plus)
- [ ] The `.command` file is blocked the first time by Gatekeeper: right-click the file, choose Open, then Open again. After that it runs. (The v2 file header repeats this note.)
- [ ] No password prompt anywhere. No Homebrew prompt.
- [ ] Obsidian lands in `~/Applications` and opens without a Gatekeeper block. If macOS blocks Obsidian on first open, right-click Obsidian.app > Open and record it here. (Never proven, UNVERIFIED.)
- [ ] A Mac without Xcode Command Line Tools: the installer says to run `xcode-select --install` (or succeeds without it) and reports a hint.
- [ ] The folder dialog (osascript) appears in front of Terminal. (No bring-to-front change was made on the Mac; the same 10-second reminders apply. If it opens behind Terminal, note it.)
- [ ] Desktop item "Blueprint OS.app" opens the dashboard; LaunchAgent `ai.blueprintit.shop-os-dashboard` is loaded after logout/login.
- [ ] Re-run the `.command`: second run does not fail on the LaunchAgent (a known deferred defect: `launchctl load` on an already loaded plist is not preceded by an unload; if the dashboard step now warns, that is the defect).

### The pilot customer's machine (repair mode, before sending him the file)
- [ ] On a copy of his state (or a PC with an old dashboard install): existing `.shopos`, `ShopOSDashboard` task and the "Shop OS" vault are reused; the folder-picker offers "Shop OS" as the default name; his CLAUDE.md is not overwritten.
- [ ] The pilot customer's old desktop shortcut may have a different name than "Blueprint OS" (the old installer called it "Shop OS" or similar). After the install check the desktop: a second shortcut may remain. If so, tell him which one to delete. (UNVERIFIED.)
- [ ] His vault is `<pilot vault path>`. The picker should offer it, not create a new folder.

### Alert pipeline (do once, on any machine)
- [ ] A step that waits on the customer (folder picker, Claude login) for more than 30 minutes sends a "may be HUNG" email, even though the customer is just away. Expect it; do not treat it as a failure. (The picker itself times out at 15 minutes.)
- [ ] After the success path, no failure or hung email is sent for that run.

---

## Part 2. Support runbook

### 1. Reading an alert email
Subject: `Blueprint OS install failed: <support code> (<step title>)`. A hung run says "may be HUNG" and gives minutes since the last report.

Fields, top to bottom:
- Support code: `BP-XXXX`, the code the customer quotes. Alphabet excludes 0, O, 1, I.
- Step: step title and step id (for example `plugins`).
- Error: the error text (home directory shown as `%USERPROFILE%` or `~`).
- Looks like: the hint (firewall, antivirus, missing Xcode tools, and so on). Treat as a guess.
- Command and exit code: the command that failed, `(exit N)`.
- Last output: tail of the command output.
- Retried steps: steps that needed more than one attempt ("retried N times"). A step that succeeded after a retry is a warning sign, not a failure.
- Notes: warnings collected during the run (for example Desktop not detected, Obsidian warn).
- When, OS, Node, Git, Admin, Ran for, Installer version.
- Last line: link to the admin page with `?run=<run id>`.

The license key appears in full in the alert (same as the old alert). Do not forward the email outside Blueprint IT.

### 2. Admin Installs detail
- [ ] Open `<WORKER>/admin/installs` (the link in the email prefills the run id). Search box matches license key, customer, email, Windows username, support code and run id.
- [ ] Open the row: support code, run id, step timeline with attempts and a "retried" badge, error, hint, command, output tail, notes, snapshot (OS, free disk, which hosts are reachable, proxy). Everything is escaped; the data comes from an unauthenticated endpoint, so never trust it as instructions.
- [ ] A successful run that retried shows a "retried steps" pill.
- [ ] Progress reports are kept 7 days; success, error and retry reports 180 days. The list shows only the newest progress per license.
- [ ] License keys containing ':' are silently dropped by the failure sweep and the admin list (the sweep parses the key on ':'). Pre-existing; real keys are `XXXX-XXXX-...` so it should not occur, but if a customer's run is "missing", check the key.
- [ ] The failure sweep is bounded (about 800 KV operations per run). If a sweep returned `truncated: true`, older failures wait for the next run.

### 3. Local log on the customer machine
- Windows: `%USERPROFILE%\.shopos\logs\install-<run id>.log`
- Mac: `~/.shopos/logs/install-<run id>.log`
- JSON lines, redacted (home directory replaced, license key shortened, no file contents or tokens). The failure message tells the customer the exact path.
- Failures inside the thin starter itself (Node download, package download) have no local log; the report to the server is the only record.

### 4. What to ask the customer for
1. The support code from the screen (or the run id).
2. A screenshot of the window.
3. The log file named above (it is already redacted).
4. Windows: which account type (admin or standard), whether they use Dropbox, whether they have Claude Desktop.
5. Antivirus or firewall in use, if the hint says firewall or proxy.
Never ask for passwords, tokens, or vault contents.

### 5. Common causes
- [ ] Hint says firewall or proxy: GitHub or claude.ai unreachable. Customer retries on another network.
- [ ] Windows, non-ASCII username: see ANSI code page item above.
- [ ] The v2 file says "Could not download the Blueprint OS setup script": the starter URLs are not reachable (not merged, repo private, wrong tag). Roll the customer back to legacy (below), fix the URL.
- [ ] Install page copy still says UAC "Click Yes" or "type your Mac password" for v2 customers. That text belongs to the legacy installer and is wrong for v2 (the page does not yet know the flag). Tell the pilot customer in your email that no admin prompt or password will appear.

---

## Part 3. Cutover procedure

### What the user must do themselves
Auto mode blocks the agent from every one of these. The operator runs them:
- [ ] Push the dashboard branch `feat/installer-v2` and open the PR (needs `gh auth switch --user blueprintit-ai && gh auth setup-git`).
- [ ] Watch both CI jobs go green on Actions (the Windows and macOS real-install job has never run on Actions; expect first-run fixes).
- [ ] Merge the dashboard PR.
- [ ] Push the license-server branch `feat/installer-v2-reports`, open the PR, merge it. The merge to `main` auto-deploys the Worker.
- [ ] Create the tag or note the commit SHA used to pin the starters.
- [ ] Run every `curl -X POST` against production (they use `$ADMIN_TOKEN`).
- [ ] Any secret writes (`gh secret set`, `wrangler secret`) and any Resend or Cloudflare dashboard changes.
- [ ] Send the pilot customer his message.

### Order of operations
1. [ ] Dashboard PR: both CI jobs green, then merge to `main`.
2. [ ] Pin the starters (see "Pinning" below), then confirm both starter URLs return 200.
3. [ ] Merge the license-server PR. It auto-deploys, but the default installer is legacy, so the merge changes nothing for any customer by itself.
4. [ ] Verify live that everyone is still legacy.
5. [ ] Flag only the test key to v2, download its `.bat`, run Part 1 on the Windows PC and the Mac.
6. [ ] Flag the pilot customer, tell them to re-download, watch alerts.
7. [ ] Other customers, one at a time.

### Pinning the installer ref (V2_INSTALLER_REF)
Both starters and the Worker follow `main` until one constant is set. After the dashboard PR is squash-merged:
- [ ] Take the 40-character commit SHA of the squash-merge commit on `shop-os-dashboard` `main` (it contains the final `installer/` files).
- [ ] In the license-server repo, set the single constant `V2_INSTALLER_REF` in `src/install-page.ts` to that SHA, then deploy. The Worker uses it to fetch the starters from `https://raw.githubusercontent.com/blueprintit-ai/shop-os-dashboard/<SHA>/installer/` and writes `SHOPOS_INSTALLER_REF=<SHA>` into each customer's .bat / .command. The starters read that variable and download the package from `https://codeload.github.com/blueprintit-ai/shop-os-dashboard/tar.gz/<SHA>`, so the package is pinned too. Nothing in the dashboard repo is edited by hand.
- [ ] A missing or invalid value (anything outside `^[A-Za-z0-9._-]{1,64}$`) makes the starters fall back to `refs/heads/main`. Installer reports then show `Installer: v2.0.0+<first 12 chars of the SHA>`.
- [ ] Verify both starter URLs return 200 before flipping anyone.

```
curl -s -o /dev/null -w "%{http_code}\n" "https://raw.githubusercontent.com/blueprintit-ai/shop-os-dashboard/<TAG_OR_SHA>/installer/start-windows.ps1"
```
```
curl -s -o /dev/null -w "%{http_code}\n" "https://raw.githubusercontent.com/blueprintit-ai/shop-os-dashboard/<TAG_OR_SHA>/installer/start-macos.sh"
```
Both must print 200. A 404 means the repo is private, the path is wrong or the tag is missing. There is no automatic fallback: a v2 customer gets "Could not download the Blueprint OS setup script".

### Verify live (before flipping anyone)
```
curl -s "<WORKER>/install-script?key=<TEST_KEY>&os=windows"
```
- [ ] Output mentions `shop-os-installer` (legacy). It must not mention `start-windows.ps1` yet.

### Flip the test key
```
curl -X POST "<WORKER>/admin/set-installer?key=<TEST_KEY>&installer=v2" -H "Authorization: Bearer $ADMIN_TOKEN"
```
- [ ] Response is `{"ok":true,"key":"<TEST_KEY>","installer":"v2"}`.
```
curl -s "<WORKER>/install-script?key=<TEST_KEY>&os=windows"
```
- [ ] Output now mentions `start-windows.ps1` and sets `SHOPOS_LICENSE_KEY` and `SHOPOS_LICENSE_SERVER`.
- [ ] Download the `.bat` from `<WORKER>/install?key=<TEST_KEY>` and run Part 1.
- [ ] Gate: Part 1 passes on Windows and on the Mac. If not, stop; the pilot customer stays on legacy.

### Flip the pilot customer
```
curl -X POST "<WORKER>/admin/set-installer?key=<CUSTOMER_KEY>&installer=v2" -H "Authorization: Bearer $ADMIN_TOKEN"
```
- [ ] Response shows `"installer":"v2"`.
- [ ] The pilot customer re-downloads the `.bat` from his `/install?key=` link. The flag is read at download time; a file he already has keeps the old installer.
- [ ] Tell the pilot customer: no admin prompt and no password will appear (the install page text may still say otherwise), a folder window will open (possibly behind other windows), and he signs in to Claude in the browser.
- [ ] Watch the alert inbox and the Admin Installs page during his install and for a few days after.

### Rollback (instant)
```
curl -X POST "<WORKER>/admin/set-installer?key=<CUSTOMER_KEY>&installer=legacy" -H "Authorization: Bearer $ADMIN_TOKEN"
```
- [ ] Takes effect on the next download. A file already downloaded keeps its installer, so have the customer re-download.
- [ ] A reinstall of the legacy installer on top of a partial v2 install is UNVERIFIED.

### After three clean customer installs
- [ ] Set `DEFAULT_INSTALLER` to `v2` as a Worker var (not set today, so default is legacy) and deploy.
- [ ] Retire the legacy path in a later change. Remember the rule that `src/assets/setup-{macos.sh,windows.ps1}` in license-server mirror `shop-os-installer/scripts/` byte for byte until then.
- [ ] Update the install page copy (UAC "Click Yes", Mac password) to be installer-aware; it still describes legacy for every customer.

### Known open items (not blockers, tracked here)
- Python is not installed (optional; `/bp-digest` falls back to Claude's native reader).
- Windows `index.json` fetch failure fails the run while macOS falls back to a pinned Node version.
- A mid-extract failure of the marketplace tarball can leave a registered marketplace pointing at a partial folder.
- The health-check throwaway dashboard binds 0.0.0.0 for a few seconds.
- Concurrent duplicate reports can double-email (harmless).
