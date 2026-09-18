# ADR: Playwright's browser download on the build machine (design spec Open Item #4)

Decision: keep `npx playwright test` / `npm run test:e2e` as a separate,
non-blocking script from `npm test` regardless of the outcome below —
`"test"` only globs `test/*.test.js` (node:test), so a machine that can't
reach the Chromium CDN still gets a fully green `npm test`. `test:e2e` is
the explicit opt-in for whoever has (or can get) network access to run the
real browser suite, whether that's this build machine, a developer's own
laptop, or CI.

Verified on: 2026-09-06, Task 14, this implementation sandbox (Windows 11,
`C:\Users\glchu\Dropbox\Blueprint-OS\Projects\shop-os-dashboard\.worktrees\owner-dashboard-implementation`).

Result: **the download succeeded and the browser suite ran and passed.**

```
$ npx playwright install chromium
Downloading Chrome for Testing 153.0.8010.12 (playwright chromium v1243) ... 195.6 MiB
Chrome for Testing 153.0.8010.12 (playwright chromium v1243) downloaded to
  C:\Users\glchu\AppData\Local\ms-playwright\chromium-1243
Downloading Chrome Headless Shell 153.0.8010.12 ... 114.6 MiB
Chrome Headless Shell 153.0.8010.12 downloaded to
  C:\Users\glchu\AppData\Local\ms-playwright\chromium_headless_shell-1243

$ npx playwright test
Running 2 tests using 2 workers
  ok 1 test\e2e\owner.spec.js:64:1 › theme toggle persists per user across a full reload ... (1.7s)
  ok 2 test\e2e\owner.spec.js:24:1 › owner logs in, sees the ring, runs the tour ... (2.8s)
  2 passed (4.4s)
```

So on *this* build machine, at least, Open Item #4 resolves in the
straightforward direction: yes, the Chromium download is acceptable as a
dev dependency here — it's a one-time ~310 MiB fetch from
`cdn.playwright.dev`, cached under `%LOCALAPPDATA%\ms-playwright`, and the
resulting suite runs in a few seconds.

This is **not** a blanket guarantee for every future build machine — a
locked-down corporate network, an offline installer host, or a CI runner
with an egress allowlist could still block the same download for reasons
that have nothing to do with this project's code. If that happens
elsewhere, the fallback is exactly what this ADR already commits to
structurally: `test:e2e` stays out of `npm test`, so treat the browser
suite as CI-only (or "run it from a machine with network access") on
whichever environment can't complete the download, without that blocking
the rest of the test suite or the release.
