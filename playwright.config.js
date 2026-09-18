import { defineConfig } from "@playwright/test";

// Each test in test/e2e boots its own server (createServer(), random loopback
// port) via test/helpers/boot.js's bootAsOwner(), so there is no shared
// baseURL or webServer entry here -- every test navigates to the URL that
// helper hands back. Kept out of `npm test` (package.json's "test" script
// only globs test/*.test.js) so a machine without a downloadable Chromium
// can still run the full node:test suite; see docs/decisions/playwright-ci-only.md.
export default defineConfig({
  testDir: "test/e2e",
  timeout: 30000,
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
  },
});
