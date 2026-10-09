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

// ---------------------------------------------------------------------------
// Orb layout + interaction (the saved layout's `orb: { c, r, s, z }` block).
// The orb is placed on the same 32-column grid as the widgets: centre at
// (c * CELL, r * CELL) with CELL = viewport width / 32, module scale s sizing
// the ring (RINGpx = 316 * (CELL / 60) * s) and zoom z scaling the three.js group.
// ---------------------------------------------------------------------------
async function loginOwner(page, { url, username, password }, viewport = { width: 1600, height: 900 }) {
  await page.setViewportSize(viewport);
  await page.goto(`${url}/login`);
  await page.fill("input[name=username]", username);
  await page.fill("input[name=password]", password);
  await page.click("button[type=submit]");
  await expect(page).toHaveURL(/\/owner$/);
  await page.waitForFunction(() => typeof window.__orbState === "function");
}
const orbState = (page) => page.evaluate(() => window.__orbState());
const boxOf = (page) => page.locator("#orbBox").evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
async function putOrb(page, url, orb) {
  const ctx = page.context().request;
  const layout = await (await ctx.get(`${url}/api/layout`)).json();
  const res = await ctx.put(`${url}/api/layout`, { data: { ...layout, orb }, headers: { origin: url } });
  expect(res.ok()).toBe(true);
}
const waitLayoutPut = (page) => page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/api/layout"));

test("orb honors the saved layout: centred on c/r on the 32-col grid, size follows s, zoom/defaults exposed", async ({ page }) => {
  const boot = await bootAsOwner();
  try {
    await loginOwner(page, boot);
    // default layout: { c: 16, r: 9, s: 1.7, z: 2.6 } at 1600x900 -> CELL 50
    let st = await orbState(page);
    expect(st).toMatchObject({ c: 16, r: 9, s: 1.7, z: 2.6, cell: 50, cx: 800, cy: 450 });
    let b = await boxOf(page);
    expect(b.x + b.w / 2).toBeCloseTo(800, 0);
    expect(b.y + b.h / 2).toBeCloseTo(450, 0);
    expect(b.w).toBe(Math.round(316 * (50 / 60) * 1.7 * 2.1));

    await putOrb(page, boot.url, { c: 10, r: 6.5, s: 1, z: 2 });
    await page.reload();
    await page.waitForFunction(() => typeof window.__orbState === "function");
    st = await orbState(page);
    expect(st).toMatchObject({ c: 10, r: 6.5, s: 1, z: 2, cx: 500, cy: 325 });
    b = await boxOf(page);
    expect(b.x + b.w / 2).toBeCloseTo(500, 0);
    expect(b.y + b.h / 2).toBeCloseTo(325, 0);
    expect(b.w).toBe(Math.round(316 * (50 / 60) * 1 * 2.1)); // smaller s -> smaller orb box
    // the ring canvas is drawn around the same centre: the saved z is honored as-is
    expect(st.z).toBe(2);
  } finally { boot.cleanup(); }
});

test("orb re-places itself when the window is resized, and a 2:1 window shrinks the ring to fit (saved s untouched)", async ({ page }) => {
  const boot = await bootAsOwner();
  try {
    await loginOwner(page, boot);
    await page.setViewportSize({ width: 2000, height: 1000 });
    const st = await orbState(page);
    expect(st).toMatchObject({ cell: 62.5, cx: 1000, cy: 562.5, s: 1.7, clamped: true });
    expect(st.sEff).toBeLessThan(1.7);
    await expect.poll(async () => { const b = await boxOf(page); return Math.round(b.x + b.w / 2); }).toBe(1000); // placed by the resize handler
    const b = await boxOf(page);
    expect(b.w).toBe(st.ob);
    expect(st.cy + st.ring).toBeLessThan(1000 * 1.2); // ring no longer runs a full radius past the bottom
  } finally { boot.cleanup(); }
});

test("use mode: dragging across the orb spins it (__orbRotY changes); widgets and the search bar never read as orb drags", async ({ page }) => {
  const boot = await bootAsOwner();
  try {
    await loginOwner(page, boot);
    const hasGl = await page.waitForFunction(() => typeof window.__orbRotY === "function", null, { timeout: 8000 }).then(() => true, () => false);
    test.skip(!hasGl, "WebGL unavailable in this browser: the spin read-back (__orbRotY) only exists once the three.js orb is built");
    await page.click("#tourX").catch(() => {});
    const rot = () => page.evaluate(() => window.__orbRotY());

    // drag starting on a widget that overlaps the orb footprint: not an orb drag
    const wb = await page.locator("#w-stats .wh").boundingBox();
    const r0 = await rot();
    await page.mouse.move(wb.x + wb.width - 8, wb.y + 10);
    await page.mouse.down();
    await page.mouse.move(wb.x + wb.width + 160, wb.y + 10, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    expect(Math.abs((await rot()) - r0)).toBeLessThan(0.2); // idle drift only

    // search bar open on top of the orb centre: pressing in it does not spin
    await page.click("#searchBtn");
    const r1 = await rot();
    const input = await page.locator("#searchIn").boundingBox();
    await page.mouse.move(input.x + 20, input.y + 5);
    await page.mouse.down();
    await page.mouse.move(input.x + 140, input.y + 5, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    expect(Math.abs((await rot()) - r1)).toBeLessThan(0.2);

    // a real drag across the core spins it, with momentum
    const r2 = await rot();
    await page.mouse.move(760, 450);
    await page.mouse.down();
    await page.mouse.move(900, 450, { steps: 14 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect(Math.abs((await rot()) - r2)).toBeGreaterThan(0.3);
  } finally { boot.cleanup(); }
});

test("edit mode: dragging the orb moves it (half-cell snap) and the saved layout carries the new c/r", async ({ page }) => {
  const boot = await bootAsOwner();
  try {
    await loginOwner(page, boot);
    await page.click("#tourX").catch(() => {});
    await page.click("#editBtn");
    const put = waitLayoutPut(page);
    await page.mouse.move(800, 450);
    await page.mouse.down();
    await page.mouse.move(913, 487, { steps: 12 }); // +113px, +37px => +2.26 cells, +0.74 cell
    await page.mouse.up();
    const body = (await put).postDataJSON();
    expect(body.orb.c).toBe(18.5); // 16 + 2.26 = 18.26 -> snapped to the nearest half cell
    expect(body.orb.r).toBe(9.5);  // 9 + .74 = 9.74 -> 9.5
    expect(body.orb.s).toBe(1.7);
    expect(body.orb.z).toBe(2.6);
    expect(body.widgets.length).toBeGreaterThan(5); // same save as the widgets: one layout object
    const st = await orbState(page);
    expect(st).toMatchObject({ c: 18.5, r: 9.5 });
    const b = await boxOf(page);
    expect(b.x + b.w / 2).toBeCloseTo(18.5 * 50, 0);
    expect(b.y + b.h / 2).toBeCloseTo(9.5 * 50, 0);
    await page.reload();
    await page.waitForFunction(() => typeof window.__orbState === "function");
    expect(await orbState(page)).toMatchObject({ c: 18.5, r: 9.5 });
  } finally { boot.cleanup(); }
});

test("edit mode: the #orbGrip handle resizes the orb, s stays within [.5, 1.7] and is saved", async ({ page }) => {
  const boot = await bootAsOwner();
  try {
    await loginOwner(page, boot);
    await page.click("#tourX").catch(() => {});
    await expect(page.locator("#orbGrip")).toBeHidden(); // handle only exists visually in edit mode
    await page.click("#editBtn");
    await expect(page.locator("#orbGrip")).toBeVisible();
    const center = { x: 800, y: 450 };
    const gripPos = async () => { const g = await page.locator("#orbGrip").boundingBox(); return { x: g.x + g.width / 2, y: g.y + g.height / 2 }; };

    // drag the grip half way to the centre -> s ~ 0.85
    let g = await gripPos();
    let put = waitLayoutPut(page);
    await page.mouse.move(g.x, g.y);
    await page.mouse.down();
    await page.mouse.move(center.x + (g.x - center.x) / 2, center.y + (g.y - center.y) / 2, { steps: 10 });
    await page.mouse.up();
    let body = (await put).postDataJSON();
    expect(body.orb.s).toBeGreaterThan(0.8);
    expect(body.orb.s).toBeLessThan(0.9);
    expect(body.orb.c).toBe(16);
    expect(body.orb.r).toBe(9);
    const small = await boxOf(page);
    expect(small.w).toBeLessThan(940 * 0.6);

    // far past the grip's start, and to the centre: both clamp
    g = await gripPos();
    put = waitLayoutPut(page);
    await page.mouse.move(g.x, g.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 3000, center.y + 3000, { steps: 6 });
    await page.mouse.up();
    expect((await put).postDataJSON().orb.s).toBe(1.7);

    g = await gripPos();
    put = waitLayoutPut(page);
    await page.mouse.move(g.x, g.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 1, center.y + 1, { steps: 6 });
    await page.mouse.up();
    expect((await put).postDataJSON().orb.s).toBe(0.5);
    expect((await orbState(page)).s).toBe(0.5);
  } finally { boot.cleanup(); }
});

test("use mode: a clean click on the orb core opens the note viewer (no Second Brain) or the Second Brain (up); a click off the core does neither", async ({ page }) => {
  const boot = await bootAsOwner();
  try {
    // Simulate "no Second Brain on :5210" regardless of what runs on the dev machine.
    await page.route("http://localhost:5210/**", (route) => route.abort());
    await loginOwner(page, boot);
    await page.click("#tourX").catch(() => {});
    await page.mouse.click(800, 450 + 250); // inside the ring footprint but outside the core (< 30% of the ring radius)
    await page.waitForTimeout(500);
    await expect(page.locator("#notes-root")).toBeHidden();
    await page.mouse.click(800, 450);
    await expect(page.locator("#notes-root")).toBeVisible();

    // Second Brain reachable: the same click opens it in a new tab instead.
    await page.unroute("http://localhost:5210/**");
    await page.route("http://localhost:5210/**", (route) => route.fulfill({ status: 200, body: "ok", contentType: "text/html" }));
    await page.click("#chatBar"); // CLOSE -> back to the ring
    await expect(page.locator("#ring-root")).toBeVisible();
    const popup = page.waitForEvent("popup");
    await page.mouse.click(800, 450);
    expect((await popup).url()).toContain("localhost:5210");
  } finally { boot.cleanup(); }
});
