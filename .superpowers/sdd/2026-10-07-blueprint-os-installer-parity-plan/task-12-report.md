# Task 12 report: thin starters

Commits: f450342 feat(installer): thin Windows and macOS starters; 9160329 fix(installer): macOS starter home-dir redaction leaked a backslash

Files: installer/start-windows.ps1 (70 lines), installer/start-macos.sh (63 lines, executable bit set in fix round 1), test/starters.test.js (8 tests: brief's 5 plus 3 extra: exact message/alphabet/step/source, arm64+tar.exe+no throw+exit 1, no set -e + exec handover).

TDD: RED `node --test test/starters.test.js` failed (files missing). GREEN: 8/8 pass. Full suite `node --test test/*.test.js`: 372 tests, 371 pass, 0 fail, 1 skipped. `bash -n` clean, shellcheck clean. Starters were NOT executed; only the json_str helper and the index.json version pipeline were exercised in subshells on sample input.

Changes versus the brief:
- macOS: the brief's Node-version grep expected `"npm":"..","lts"` adjacent, but real index.json has v8/uv/zlib/openssl/modules between them, so it never matched (always fell back to v22.20.0). Replaced with `tr '}' '\n' | grep '"lts":"' | head -1 | grep -o version`, plus regex validation with fallback.
- macOS: JSON built by hand was unsafe (backslashes, newlines, license key). Added json_str (drops control chars, escapes \ and ", hides $HOME as ~, 400 char cap) used for key, message, os. Initial version leaked a backslash before ~; fixed in 9160329.
- macOS: curl/tar failure messages include the exit code; mkdir failures call fail (stage "setup" / package-download); `-m 60` on the index.json fetch.
- Windows: error_message has USERPROFILE replaced with %USERPROFILE% and capped at 400 chars (privacy rule). `$LASTEXITCODE = -1` before tar.exe so a missing tar.exe cannot pass via a stale 0. Download and extract split into separate stages with tar's exit code checked outside any try. Removed the try/catch around `node --version` (native, judged by exit code only). Arm64 also detected via PROCESSOR_ARCHITEW6432 (32-bit PS on arm64). `-UseBasicParsing` also on the install-log POST; `-ErrorAction Stop` on Expand-Archive so the catch fires. Support code alphabet indexed by its own length.

Concerns: none blocking. Unverified on real Windows (CI later task): assigning `$LASTEXITCODE` is legal in PS 5.1 but only CI proves it. If the index.json format is ever pretty-printed across lines, the macOS parse falls back to the pinned v22.20.0 (safe).

## Fix round 1

Correction: the original report claimed start-macos.sh was executable; it was committed 100644. Now chmod +x and `git update-index --chmod=+x` (mode 100755), and a test asserts the bit.

TDD: tests written first. RED: the new static tests for both starters failed (2 of 13); the behavioral test and json_str cases passed against the old code except where the new rules apply (the added "x" + 500 quotes case exercises the truncate-before-escape order). GREEN after the rewrite: 13/13 in test/starters.test.js.

Fixes:
1. ps1 uses `$global:LASTEXITCODE = -1` before native calls (works under `& script.ps1`); Test-Node helper reads `$LASTEXITCODE`.
2. Both pin Node major: first LTS entry with version v22 or v24 (fallback v22.20.0), download SHASUMS256.txt, verify SHA256 (Get-FileHash / shasum -a 256); mismatch or missing entry fails with stage node-download.
3. Both run `--version` on any found node and require >= 20, else re-download. Extraction goes to a temp folder under ~/.shopos (same volume), then rename into runtime/; the old dir is removed first, so a half extraction is never reused.
4. ps1 redaction: case-insensitive (-ireplace, regex-escaped), TEMP -> %TEMP% applied before USERPROFILE, empty values skipped, inside the existing try so the report is never skipped.
5. sh json_str: now strips to printable ASCII, truncates to 400 chars BEFORE escaping.
6. ps1 extracts the Node zip with tar.exe judged by $LASTEXITCODE; Expand-Archive removed.
7. ps1 Test-Path -LiteralPath everywhere (New-Item unchanged, no -LiteralPath).
8. ps1 sets SecurityProtocol -bor 3072 (ASCII).
9. start-macos.sh is executable (see correction).

New tests: behavioral bash run (temp HOME, empty SHOPOS_PACKAGE_DIR, local http server): exit 1, exact message on stdout, body parses as JSON, step starter:package-extract, support code matches the alphabet, body has no temp HOME path. json_str regression (backslashes, quotes, home path, 401 backslashes, truncation) via the function extracted from the script. Static checks for the items above.

Sizes: ps1 85 lines (<90), sh 63 lines (<80); limits unchanged.
Checks: `bash -n` clean; shellcheck warnings clean (two SC2015 info notes on intentional `A && B || fail`); ps1 verified pure ASCII; full suite results are in the final reply.
Deviation: the temp dir for the Node download lives under ~/.shopos (not %TEMP%) so the final move is a same-volume rename. The ps1 cannot be run here; PS 5.1 behavior of `$global:LASTEXITCODE` assignment and tar.exe on zip is unverified until Windows CI.
Full suite: 377 tests, 376 pass, 0 fail, 1 skipped.

## Fix round 2

- Behavioral test now uses SHOPOS_LICENSE_KEY = `${home}/k\"q` and asserts JSON.parse(body).license_key === `~/k\"q` plus no home path in the raw body. The test accepts an optional STARTER_SH env var (script path override) so it can be pointed at a scratch copy. PATH for the spawned bash starts with dirname(process.execPath), so Node can never be downloaded.
- Mutation verified: in a scratchpad copy (/private/tmp/claude-501/scratch-mut.sh, never the repo file) I removed the json_str wrapper around the license key in fail(); with STARTER_SH pointing at it the behavioral test FAILED (12 pass, 1 fail). The real script passes 13/13.
- ps1: Remove-Item -LiteralPath $dest ... -ErrorAction Stop; tar.exe is called as "$env:SystemRoot\System32\tar.exe" in both extractions; the Node temp folder is removed before Fail on checksum, tar and catch (move) failures. ps1 stays pure ASCII, 85 lines.
- sh: the Node temp folder is removed before fail on download, checksum list, checksum, extract and move failures (exit codes captured via rc=$? first). 63 lines.
- Checks: bash -n clean, shellcheck -S warning clean. Full suite: 377 tests, 376 pass, 0 fail, 1 skipped.
