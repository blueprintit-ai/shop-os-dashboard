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

test("owner dashboard shows a status widget with the LAN address", async ({ page }) => {
  const { url, username, password, cleanup } = await bootAsOwner();
  try {
    await page.goto(`${url}/login`);
    await page.fill("input[name=username]", username);
    await page.fill("input[name=password]", password);
    await page.click("button[type=submit]");
    await expect(page).toHaveURL(/\/owner$/);
    // w-status ships in defaultLayout() (Step 2 above), so it's already
    // present for a freshly-provisioned owner -- no "add widget" UI exists
    // to click first (see this task's header note).
    await expect(page.locator("#w-status .lan-address")).toBeVisible();
    await expect(page.locator("#w-status canvas.qr-code")).toBeVisible();
  } finally {
    cleanup();
  }
});

test("owner header chrome is not base.css's white card in dark mode (regression)", async ({ page }) => {
  const { url, username, password, cleanup } = await bootAsOwner();
  try {
    await page.goto(`${url}/login`);
    await page.fill("input[name=username]", username);
    await page.fill("input[name=password]", password);
    await page.click("button[type=submit]");
    await expect(page).toHaveURL(/\/owner$/);
    await expect(page.locator("#w-rt .wh")).toBeVisible();
    const bg = (sel) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await bg("#w-rt .wh")).toBe("rgba(0, 0, 0, 0)");
    expect(await bg("#owner-header")).toBe("rgba(0, 0, 0, 0)");
    expect(await bg("#owner-header #logout-btn")).not.toBe("rgb(255, 255, 255)");
    await expect(page.locator("#theme-btn svg:visible")).toHaveCount(1);
    await expect(page.locator("#theme-btn")).toHaveAttribute("title", "Switch to light theme");
  } finally {
    cleanup();
  }
});

test("reference look: title block shows the shop name, header icons + hex backdrop render, no external requests", async ({ page }) => {
  const { url, username, password, cleanup } = await bootAsOwner();
  const external = [];
  page.on("request", (r) => { if (!r.url().startsWith(url)) external.push(r.url()); });
  try {
    await page.goto(`${url}/login`);
    await page.fill("input[name=username]", username);
    await page.fill("input[name=password]", password);
    await page.click("button[type=submit]");
    await expect(page).toHaveURL(/\/owner$/);

    // Title widget: hex logo + the shop name (fixture vault: "# Acme Cabinets") + product name,
    // and the same name is in the tab title.
    await expect(page.locator("#w-title h1 svg.hexlogo")).toBeVisible();
    await expect(page.locator("#w-title #owner-shop-name")).toHaveText("Acme Cabinets");
    await expect(page.locator("#w-title h1 span")).toHaveText("- Blueprint OS");
    await expect(page).toHaveTitle(/Acme Cabinets/);

    // The icon row sits under the name and keeps every control; Users/Logout are icons, not text buttons.
    for (const id of ["editBtn", "searchBtn", "users-link", "infoBtn", "theme-btn", "logout-btn"]) await expect(page.locator(`#${id}`)).toBeVisible();
    expect((await page.locator("#logout-btn").innerText()).trim()).toBe("");
    const nameBox = await page.locator("#w-title h1").boundingBox();
    const barBox = await page.locator("#owner-header").boundingBox();
    expect(barBox.y).toBeGreaterThanOrEqual(nameBox.y + nameBox.height - 2);

    // Widget header icons are painted, and the hex backdrop canvas has content.
    const painted = await page.locator("#w-rt canvas.hic").evaluate((c) => c.getContext("2d").getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0));
    expect(painted).toBe(true);
    const hex = await page.locator("#hexCv").evaluate((c) => c.getContext("2d").getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0));
    expect(hex).toBe(true);

    // Outfit actually loads from our own server.
    await page.evaluate(() => document.fonts.load("400 14px Outfit"));
    expect(await page.evaluate(() => document.fonts.check("400 14px Outfit"))).toBe(true);
    expect(external).toEqual([]);

    // Fresh vault: friendly empty states instead of grey sentences.
    await expect(page.locator("#w-rt .empty .e1")).toHaveText("No routines yet");
    await expect(page.locator("#w-stats .empty .e1")).toHaveText("No numbers yet");
  } finally {
    cleanup();
  }
});
