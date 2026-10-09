// Real-browser coverage of the owner page, which is the RoboNuggets kit page served from public/owner.html
// (tools/sync-kit.mjs). Layout, tweaks and dashboard PROFILES live in localStorage exactly as the kit keeps them.
import { test, expect } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { bootAsOwner } from "../helpers/boot.js";

const LAYKEY = "os-dash-v10-blueprint";
const PROFKEY = "os-dash-profiles-v1";

async function openOwner(page, b, { tourSeen = true } = {}) {
  if (tourSeen) await page.addInitScript(() => { try { localStorage.setItem("os-tour-seen", "1"); } catch (_) {} });
  await page.goto(`${b.url}/login`);
  await page.fill("input[name=username]", b.username);
  await page.fill("input[name=password]", b.password);
  await page.click("button[type=submit]");
  await expect(page).toHaveURL(/\/owner$/);
  await expect(page.locator("#w-rt .wh")).toBeVisible();
}
const ls = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), key);

test("loads with no console errors and no request that leaves the dashboard (fonts, three.js and orbs are all local)", async ({ page }) => {
  const b = await bootAsOwner();
  const errors = [], external = [];
  try {
    page.on("console", (m) => {
      // the kit probes a Second Brain on localhost:5210; a refused connection is logged by the browser when none runs
      if (m.type() === "error" && !/localhost:5210|ERR_CONNECTION_REFUSED/.test(m.text() + (m.location()?.url || ""))) errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    // Requests made by the kit's Second Brain frame (http://localhost:5210, a separate app the owner may
    // run) are not the dashboard's own, so they are excluded.
    page.on("request", (r) => {
      const u = r.url();
      if (u.startsWith(b.url) || u.startsWith("data:") || u.startsWith("blob:") || /localhost:5210/.test(u)) return;
      if (/localhost:5210/.test(r.frame()?.url() || "")) return;
      external.push(u);
    });
    await openOwner(page, b);
    await page.waitForTimeout(3000);
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
    expect(await page.title()).toBe("Blueprint OS — Acme Cabinets");
    await expect(page.locator("#w-sk")).toBeVisible();
    // fonts: Outfit actually loaded from the bundled files
    expect(await page.evaluate(() => document.fonts.check("16px Outfit"))).toBe(true);
    const fontReqs = await page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /\.woff2/.test(n)));
    expect(fontReqs.length).toBeGreaterThan(0);
    for (const n of fontReqs) expect(n).toContain("/static/vendor/fonts/");
  } finally { b.cleanup(); }
});

test("the orb renders (three.js from /static/vendor, thinking-orbs painting the loading state)", async ({ page }) => {
  const b = await bootAsOwner();
  try {
    const three = [];
    page.on("request", (r) => { if (/three\.module\.min\.js/.test(r.url())) three.push(r.url()); });
    await openOwner(page, b);
    await page.waitForTimeout(4000);
    expect(three.some((u) => u.startsWith(`${b.url}/static/vendor/`))).toBe(true);
    const canvases = await page.locator("#orbBox canvas").evaluateAll((cs) => cs.map((c) => ({ w: c.width, h: c.height })));
    expect(canvases.length).toBeGreaterThan(0);
    expect(canvases.some((c) => c.w > 100 && c.h > 100)).toBe(true);
  } finally { b.cleanup(); }
});

test("dashboard profiles: save 'Laptop', switch away and back; the switch reloads and persists in localStorage", async ({ page }) => {
  const b = await bootAsOwner();
  try {
    await openOwner(page, b);
    await page.click("#profileBtn");
    await expect(page.locator("#profilePop")).toHaveClass(/show/);
    await expect(page.locator("#profileRows .prow")).toHaveCount(2); // the kit seeds Desktop + Laptop
    // save the current layout and look as a new profile
    await page.fill("#profileNewName", "Laptop3");
    await page.click("#profileNewBtn");
    let store = await ls(page, PROFKEY);
    expect(Object.keys(store.list)).toContain("Laptop3");
    expect(store.active).toBe("Laptop3");
    // switch to the seeded Laptop: page reloads
    await Promise.all([page.waitForEvent("load"), page.click('#profileRows .prow[data-name="Laptop"] .nm')]);
    await expect(page.locator("#w-rt .wh")).toBeVisible();
    store = await ls(page, PROFKEY);
    expect(store.active).toBe("Laptop");
    // survives another full reload
    await page.reload();
    store = await ls(page, PROFKEY);
    expect(store.active).toBe("Laptop");
    await page.click("#profileBtn");
    await expect(page.locator('#profileRows .prow.active')).toHaveAttribute("data-name", "Laptop");
    // the product's server-side layout route is not used by this page
    const layoutCalls = [];
    page.on("request", (r) => { if (r.url().includes("/api/layout")) layoutCalls.push(r.url()); });
    await page.reload();
    await page.waitForTimeout(1000);
    expect(layoutCalls).toEqual([]);
  } finally { b.cleanup(); }
});

test("edit mode: dragging a widget moves it and the new layout survives a reload", async ({ page }) => {
  const b = await bootAsOwner();
  try {
    await openOwner(page, b);
    const before = await ls(page, LAYKEY);
    await page.click("#editBtn");
    await expect(page.locator("body")).toHaveClass(/edit/);
    const header = page.locator("#w-rt .wh");
    const box = await header.boundingBox();
    await page.mouse.move(box.x + 40, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(box.x - 260, box.y + 12, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const after = await ls(page, LAYKEY);
    expect(after).not.toEqual(before);
    await page.reload();
    const moved = await page.locator("#w-rt .wh").boundingBox();
    expect(moved.x).toBeLessThan(box.x - 100);
  } finally { b.cleanup(); }
});

test("the chat bar sends a message to the product chat engine and shows the reply", async ({ page }) => {
  const b = await bootAsOwner(); // fake engine replies "ok"
  try {
    await openOwner(page, b);
    await page.fill("#chatIn", "hello from the kit page");
    await page.click("#chatSend");
    await expect(page.locator("#chatLog .cm.ai .body")).toContainText("ok");
    expect((await ls(page, "os-chat-v1")).sessionId).toBeTruthy();
  } finally { b.cleanup(); }
});

test("account popover shows the signed-in user, links Users for owners, and Logout signs out to /login", async ({ page }) => {
  const b = await bootAsOwner();
  try {
    await openOwner(page, b);
    await page.click("#chatAcct");
    await expect(page.locator("#acctpop")).toHaveClass(/show/);
    await expect(page.locator("#acctRows")).toContainText("Pat");
    await expect(page.locator("#acctRows")).toContainText("owner");
    await expect(page.locator('#acctRows a[href="/users"]')).toBeVisible();
    await expect(page.locator("#acctSwitch")).toHaveCount(0); // the kit's machine-wide Claude logout is not shipped
    await page.click("#acctLogout");
    await expect(page).toHaveURL(/\/login$/);
    const me = await page.request.get(`${b.url}/api/me`);
    expect(me.status()).toBe(401);
  } finally { b.cleanup(); }
});

test("tour still ends on the CC BY credit card for RoboNuggets", async ({ page }) => {
  const b = await bootAsOwner();
  try {
    await openOwner(page, b);
    await page.click("#infoBtn");
    await expect(page.locator("#tourCard")).toHaveClass(/show/);
    for (let i = 0; i < 40; i++) {
      if ((await page.locator("#tourCard").innerText()).includes("Rubric Agentic OS")) break;
      await page.click("#tourNext");
    }
    await expect(page.locator("#tourCard")).toContainText("Rubric Agentic OS");
    await expect(page.locator("#tourCard a[href='https://skool.com/robonuggets']")).toBeVisible();
  } finally { b.cleanup(); }
});

test("the kit's Business Assets and Widget Library pages render from local files only", async ({ page }) => {
  const b = await bootAsOwner();
  try {
    mkdirSync(join(b.home, "business-assets", "Licenses"), { recursive: true });
    writeFileSync(join(b.home, "business-assets", "Licenses", "contractor.pdf"), "%PDF-1.4 test");
    const external = [], errors = [];
    page.on("request", (r) => { const u = r.url(); if (!u.startsWith(b.url) && !u.startsWith("data:") && !u.startsWith("blob:") && !/localhost:5210/.test(u)) external.push(u); });
    page.on("pageerror", (e) => errors.push(e.message));
    await openOwner(page, b);
    await page.goto(`${b.url}/assets`);
    await expect(page.locator(".doc .nm", { hasText: "contractor.pdf" })).toBeVisible();
    await page.goto(`${b.url}/widgets`);
    await expect(page.locator("h1")).toContainText(/widget/i);
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
  } finally { b.cleanup(); }
});

test("SHOP APPS rows come from /api/apps: default is Second Brain only; owner-written rows render and open in a new tab", async ({ page, context }) => {
  const b = await bootAsOwner();
  try {
    await openOwner(page, b);
    await expect(page.locator("#appRows .row2")).toHaveCount(1);
    await expect(page.locator("#sbRow b")).toHaveText("Second Brain");
    await expect(page.locator("#w-apps")).not.toContainText("Reference Wall");
    await expect(page.locator("#w-apps [data-url*='127.0.0.1:5298']")).toHaveCount(0);
    const res = await page.evaluate(async () => (await fetch("/api/apps", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apps: [
      { id: "sbRow", name: "Second Brain", sub: "notes", url: "/notes", icon: "brain" },
      { id: "quotes", name: 'Quotes <i>&"', sub: "Estimates", url: "http://127.0.0.1:59999/q", icon: "docs" } ] }) })).status);
    expect(res).toBe(200);
    await page.reload();
    await expect(page.locator("#appRows .row2")).toHaveCount(2);
    await expect(page.locator("#quotes b")).toHaveText('Quotes <i>&"'); // escaped, not parsed
    await expect(page.locator("#quotes canvas.pix")).toHaveCount(1);
    await context.route("http://127.0.0.1:59999/**", (r) => r.fulfill({ contentType: "text/html", body: "<title>q</title>" }));
    const [popup] = await Promise.all([context.waitForEvent("page"), page.click("#quotes")]);
    expect(popup.url()).toBe("http://127.0.0.1:59999/q");
  } finally { b.cleanup(); }
});

test("toolbar extras (Users, status dot) render for an owner, after the theme icon, and not when the signed-in role is staff", async ({ page, browser }) => {
  const b = await bootAsOwner();
  try {
    await openOwner(page, b);
    await expect(page.locator("#statusBtn")).toBeVisible();
    await expect(page.locator("#usersBtn")).toBeVisible();
    const order = await page.locator(".tbar > button").evaluateAll((els) => els.map((e) => e.id));
    expect(order.slice(-3)).toEqual(["themeBtn", "usersBtn", "statusBtn"]);
    // they look like the kit's own toolbar buttons (same size, ghost background)
    const size = await page.evaluate(() => { const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return [b.width, b.height]; }; return [r("themeBtn"), r("usersBtn")]; });
    expect(size[0]).toEqual(size[1]);
    await Promise.all([page.waitForURL(/\/users$/), page.click("#usersBtn")]);
    // the kit rebuilds its toolbar when the theme flips (reload): extras come back
    await page.goto(`${b.url}/owner`);
    await expect(page.locator("#usersBtn")).toBeVisible();
    // staff: the same page with /api/me answering role staff gets no extras
    const ctx = await browser.newContext();
    const staff = await ctx.newPage();
    await staff.addInitScript(() => { try { localStorage.setItem("os-tour-seen", "1"); } catch (_) {} });
    await staff.route("**/api/me", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ user: { role: "staff", displayName: "M" }, shopName: "x" }) }));
    await staff.goto(`${b.url}/login`);
    await staff.fill("input[name=username]", b.username); await staff.fill("input[name=password]", b.password);
    await staff.click("button[type=submit]");
    await staff.waitForURL(/\/owner$/);
    await expect(staff.locator("#w-rt .wh")).toBeVisible();
    await staff.waitForTimeout(800);
    await expect(staff.locator("#usersBtn")).toHaveCount(0);
    await expect(staff.locator("#statusBtn")).toHaveCount(0);
    await ctx.close();
  } finally { b.cleanup(); }
});

test("/users shows the Business Assets folder setting and the phone-access section; the setting saves", async ({ page }) => {
  const b = await bootAsOwner();
  try {
    await openOwner(page, b);
    await page.goto(`${b.url}/users`);
    await expect(page.locator("#assets-setting h2")).toHaveText("Business Assets folder");
    const dir = join(b.home, "elsewhere");
    await page.fill("#assets-dir", dir);
    await page.click("#assets-form button");
    await expect.poll(async () => (await (await page.request.get(`${b.url}/api/settings`)).json()).assetsDir).toBe(dir);
    await expect(page.locator("#phone-access")).toBeVisible();
    // the booted test server has no port and CI boxes may have no LAN address, so answer /api/status ourselves
    await page.route("**/api/status", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ lan: ["192.168.1.20", "172.28.80.1"], port: 50000, update: {} }) }));
    await page.reload();
    await expect(page.locator("#phone-addr")).toContainText("http://192.168.1.20:50000");
    await expect(page.locator("#phone-addr")).toContainText("Other addresses: http://172.28.80.1:50000");
    await expect(page.locator("#phone-qr svg")).toBeVisible();
    await page.unroute("**/api/status");
    await page.route("**/api/status", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ lan: [], port: 50000, update: {} }) }));
    await page.reload();
    await expect(page.locator("#phone-addr")).toContainText("No Wi-Fi address");
  } finally { b.cleanup(); }
});

test("an artifact opens inline under the CSP sandbox: its script runs but cannot reach the dashboard's origin", async ({ page }) => {
  const b = await bootAsOwner();
  try {
    writeFileSync(join(b.vault, "Dashboard", "artifacts", "live.html"), `<title>live</title><p id="p">static</p><script>
      document.getElementById('p').textContent = 'script ran';
      try { document.getElementById('p').dataset.cookie = String(document.cookie.length); localStorage.setItem('x','1'); document.getElementById('p').dataset.ls = 'ok'; } catch (e) { document.getElementById('p').dataset.ls = 'blocked'; }
    </script>`);
    await openOwner(page, b);
    await page.goto(`${b.url}/artifacts/live.html`);
    await expect(page.locator("#p")).toHaveText("script ran");
    await expect(page.locator("#p")).toHaveAttribute("data-ls", "blocked");
    // and the sample report from the fixture vault still displays
    await page.goto(`${b.url}/artifacts/sample-report.html`);
    await expect(page.locator("body")).not.toBeEmpty();
  } finally { b.cleanup(); }
});
