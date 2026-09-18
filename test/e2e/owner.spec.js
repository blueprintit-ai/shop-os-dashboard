// Real browser coverage for the /owner dashboard, replacing the Task 9
// placeholder (`test.skip(...)`). Selectors below were checked against the
// actual shipped markup/JS, not copied blind from this task's own brief
// sketch -- several of the brief's illustrative selectors do not match what
// earlier tasks actually built, the same class of correction called out in
// public/js/owner/tour.js's and widgets.js's own header comments:
//   - Login form fields have no id -- public/login.html only gives them
//     `name="username"` / `name="password"`, so we select on [name=...].
//   - The tour's close button is #tourX, not #tourClose
//     (public/js/owner/tour.js's own header comment documents this exact
//     brief-vs-reality gap).
//   - There are 7 tour steps (index 0..6); clicking #tourNext 6 times from
//     the opening step (0) lands on step 6 (Credits) without triggering the
//     close-on-last-next behavior (tour.js: `i < TOUR_STEPS.length - 1 ? show(i+1) : close()`).
//   - Widgets are rendered as `<section class="w" id="w-rt">`, not
//     `.widget[data-id=...]` (public/js/owner/widgets.js's own header
//     comment documents this too) -- the draggable handle is its `.wh` child.
//   - Dragging only takes effect once #editBtn has toggled `body.edit` on
//     (widgets.js checks `document.body.classList.contains("edit")` before
//     starting a drag).
import { test, expect } from "@playwright/test";
import { bootAsOwner } from "../helpers/boot.js";

test("owner logs in, sees the ring, runs the tour to its CC BY credit, and a dragged widget's position survives reload", async ({ page }) => {
  const { url, username, password, cleanup } = await bootAsOwner();
  try {
    await page.goto(`${url}/login`);
    await page.fill("input[name=username]", username);
    await page.fill("input[name=password]", password);
    await page.click("button[type=submit]");
    await expect(page).toHaveURL(/\/owner$/);
    await expect(page.locator("#ring-root")).toBeVisible();

    // Tour: open it, click through to the last (Credits) step, and confirm
    // the required CC BY / RoboNuggets attribution is actually rendered and
    // linked -- not just present somewhere in the source.
    await page.click("#infoBtn");
    await expect(page.locator("#tourCard")).toHaveClass(/show/);
    for (let i = 0; i < 6; i++) await page.click("#tourNext");
    await expect(page.locator("#tourCard")).toContainText("Rubric Agentic OS");
    await expect(page.locator("#tourCard a[href='https://skool.com/robonuggets']")).toBeVisible();
    await page.click("#tourX");
    await expect(page.locator("#tourCard")).not.toHaveClass(/show/);

    // Edit mode: drag the Routines widget (#w-rt) by its header and confirm
    // the new position survives a full reload (server-persisted layout, not
    // just in-memory DOM state).
    await page.click("#editBtn");
    const header = page.locator("#w-rt .wh");
    const before = await header.boundingBox();
    await page.mouse.move(before.x + 10, before.y + 10);
    await page.mouse.down();
    await page.mouse.move(before.x + 250, before.y + 10, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(600); // widgets.js debounces the PUT /api/layout save by 400ms
    await page.reload();
    const after = await page.locator("#w-rt .wh").boundingBox();
    expect(after.x).toBeGreaterThan(before.x + 100);
  } finally {
    cleanup();
  }
});

test("theme toggle persists per user across a full reload (server-rendered, no flash)", async ({ page }) => {
  const { url, username, password, cleanup } = await bootAsOwner();
  try {
    await page.goto(`${url}/login`);
    await page.fill("input[name=username]", username);
    await page.fill("input[name=password]", password);
    await page.click("button[type=submit]");
    await expect(page).toHaveURL(/\/owner$/);
    await expect(page.locator("html")).not.toHaveClass(/light/);

    await page.click("#theme-btn"); // theme.js: saves layout.theme, then does a full location.reload()
    await page.waitForURL(/\/owner$/);
    await expect(page.locator("html")).toHaveClass(/light/);

    await page.reload();
    await expect(page.locator("html")).toHaveClass(/light/); // still true after the reload, straight from __THEME_CLASS__
  } finally {
    cleanup();
  }
});
