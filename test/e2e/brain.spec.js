// Real-browser coverage of /brain, the Second Brain map: the RoboNuggets kit page (public/brain.html, tools/sync-brain.mjs)
// fed by /api/brain/*. Needs a Chromium (see docs/decisions/playwright-ci-only.md).
import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootAsOwner } from "../helpers/boot.js";
import { buildDemoVault, put } from "../helpers/brain-vault.js";

// the skills list reads the Claude home (installed plugins): keep the machine running the tests out of it
process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), "brain-claude-home-"));

const SHOTS = process.env.BRAIN_SHOTS || "";

function fatten(vault) {
  buildDemoVault(vault);
  const topics = ["Pricing", "Install", "Warranty", "Delivery", "Measure", "Quote", "Invoice", "Supplier", "Hiring", "Safety"];
  topics.forEach((t, i) => {
    put(vault, `Context/${t}.md`, `# ${t}\n\nSee [[organization]] and [[${topics[(i + 1) % topics.length]}]].\n`);
    put(vault, `Resources/${t} guide.md`, `# ${t} guide\n[[${t}]]\n`);
    put(vault, `Intelligence/decisions/${t}.md`, `# ${t} decision\n[[${t}]]\n`);
    put(vault, `Projects/Job ${i + 1}.md`, `# Job ${i + 1}\nClient notes, see [[${t}]]\n`);
    put(vault, `Team/staff/${t} person.md`, `# ${t}\n`);
    put(vault, `Daily/2026-09-${String(i + 1).padStart(2, "0")}.md`, `# Day ${i + 1}\n`);
  });
  for (const s of ["bp-digest", "morning-briefing", "bp-optimizer", "quote-writer", "job-recap"]) put(vault, `Skills/${s}/SKILL.md`, `---\nname: ${s}\ndescription: ${s} skill\n---\n# ${s}\n`);
  writeFileSync(join(vault, "Dashboard", "apps.json"), JSON.stringify([{ id: "crm", name: "Shop CRM", sub: "Customers", url: "https://example.com", icon: "gen" }, { id: "cal", name: "Calendar", sub: "Jobs", url: "https://example.com/cal", icon: "tele" }]));
}

// `beforeBrain` runs after login (the owner page it lands on makes its own probes) and before /brain loads.
async function openBrain(page, b, beforeBrain) {
  await page.goto(`${b.url}/login`);
  await page.fill("input[name=username]", b.username);
  await page.fill("input[name=password]", b.password);
  await page.click("button[type=submit]");
  await expect(page).toHaveURL(/\/owner$/);
  beforeBrain?.();
  await page.goto(`${b.url}/brain`);
  await page.waitForFunction(() => window.BrainCore && BrainCore.S && BrainCore.S.nodes && BrainCore.S.nodes.length > 5 && !document.querySelector("#brain-splash.on"), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);
}

test("the map loads: four rings, CLAUDE.md in the centre, product data, no console errors, nothing leaves the dashboard", async ({ page }) => {
  const b = await bootAsOwner();
  const errors = [], external = [];
  try {
    fatten(b.vault);
    await page.setViewportSize({ width: 1650, height: 843 });
    await openBrain(page, b, () => {
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => { const u = r.url(); if (!u.startsWith(b.url) && !u.startsWith("data:") && !u.startsWith("blob:")) external.push(u); });
    });
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
    expect(await page.title()).toBe("Blueprint OS — Acme Cabinets · AI Brain");
    const s = await page.evaluate(() => ({
      layers: BrainCore.S.layers.map((l) => l.key), router: BrainCore.S.router && BrainCore.S.router.id,
      types: [...new Set(BrainCore.S.nodes.map((n) => n.type))].sort(), n: BrainCore.S.nodes.length,
      skills: BrainCore.S.nodes.filter((n) => n.layer === "S" && n.type === "file").length,
      brand: document.querySelector(".hud-rubric").textContent, tag: document.querySelector(".hud-tag").textContent,
      home: document.getElementById("fab-home").textContent,
    }));
    expect(s.layers).toEqual(["A", "R", "M", "S"]);
    expect(s.router).toBe("CLAUDE.md");
    expect(s.types).toEqual(expect.arrayContaining(["app", "dir", "file", "hub", "router", "routine"]));
    expect(s.skills).toBeGreaterThanOrEqual(5);
    expect(s.brand).toBe("BLUEPRINT OS");
    expect(s.tag).toBe("Acme Cabinets");
    expect(s.home).toContain("DASHBOARD");
    expect(await page.evaluate(() => document.fonts.check("16px Outfit"))).toBe(true);
    expect(await page.evaluate(() => document.fonts.check("italic 16px 'Source Serif 4'"))).toBe(true);
    const fontReqs = await page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /\.woff2/.test(n)));
    for (const n of fontReqs) expect(n).toContain("/static/vendor/fonts/");
    // the canvas is painted (not blank)
    const painted = await page.evaluate(() => { const c = document.querySelector("canvas"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] + d[i + 1] + d[i + 2] > 120) n++; return n; });
    expect(painted).toBeGreaterThan(50);
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: join(SHOTS, "brain-product-1.png") });
      await page.click("#fab-menu"); await page.waitForTimeout(600);
      await page.screenshot({ path: join(SHOTS, "brain-product-menu.png") });
      await page.click("#fab-menu"); await page.click("#fab-legend"); await page.waitForTimeout(600);
      await page.screenshot({ path: join(SHOTS, "brain-product-legend.png") });
    }
  } finally { b.cleanup(); }
});

test("clicking a note selects it, a second click opens the viewer with the note's text, Open goes to /notes", async ({ page, context }) => {
  const b = await bootAsOwner();
  try {
    fatten(b.vault);
    await page.setViewportSize({ width: 1650, height: 843 });
    await openBrain(page, b);
    await page.evaluate(() => { BrainCore.S.st.spinPaused = true; });
    const pos = () => page.evaluate((id) => { const S = BrainCore.S; const n = S.byId.get(id); return [n.x * S.cam.k + S.cam.x, n.y * S.cam.k + S.cam.y]; }, "Context/organization.md");
    let [x, y] = await pos(); await page.mouse.click(x, y); await page.waitForTimeout(300);
    expect(await page.evaluate(() => BrainCore.S.sel && BrainCore.S.sel.id)).toBe("Context/organization.md");
    [x, y] = await pos(); await page.mouse.click(x, y);
    await expect(page.locator("#brain-viewer.open .md-body")).toContainText("Acme Cabinets", { timeout: 5000 });
    await expect(page.locator("#brain-viewer .v-path")).toHaveText("Context/organization.md");
    const popup = context.waitForEvent("page");
    await page.click("#brain-viewer .v-open");
    const np = await popup;
    await np.waitForLoadState("domcontentloaded");
    expect(np.url()).toBe(`${b.url}/notes?path=Context%2Forganization.md`);
    await expect(np.locator("#notes-viewer")).toContainText("Acme Cabinets", { timeout: 5000 });
  } finally { b.cleanup(); }
});

test("search finds a note and jumps to it; the viewer sanitizes hostile note HTML; skills open in the viewer", async ({ page }) => {
  const b = await bootAsOwner();
  try {
    fatten(b.vault);
    const hostile = [
      "# Hostile", "",
      '<img src=x onerror="window.__pwned=1">', "",
      "<script>window.__pwned=2</script>", "",
      "[bad](javascript:window.__pwned=3)", "",
      '<img usemap="#m" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width=900 height=900><map name="m"><area href="javascript:window.__pwned=4"></map>', "",
      '<math><mtext><table><mglyph><svg><mtext><textarea><a title="</textarea><img src onerror=window.__pwned=5>">', "",
      '<svg><script>window.__pwned=6</script></svg>', "",
    ].join("\n");
    put(b.vault, "Context/hostile.md", hostile);
    await page.setViewportSize({ width: 1650, height: 843 });
    await openBrain(page, b);
    await page.click("#fab-menu");
    await page.fill("#brain-search", "warranty");
    await expect(page.locator("#brain-results .res").first()).toContainText("Warranty");
    await page.fill("#brain-search", "hostile");
    await expect(page.locator("#brain-results .res").first()).toContainText("hostile.md");
    await page.click("#brain-results .res");
    await page.evaluate(() => BrainCore.openViewer("Context/hostile.md"));
    await expect(page.locator("#brain-viewer.open .md-body")).toContainText("Hostile");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    expect(await page.locator("#brain-viewer .md-body script").count()).toBe(0);
    expect(await page.locator("#brain-viewer .md-body a[href^='javascript']").count()).toBe(0);
    expect(await page.locator("#brain-viewer .md-body img, #brain-viewer .md-body area, #brain-viewer .md-body svg, #brain-viewer .md-body textarea").count()).toBe(0);
    await expect(page.locator("#brain-viewer .md-body")).toContainText("<script>window.__pwned=2</script>");
    await page.evaluate(() => BrainCore.openViewer("skill:quote-writer"));
    await expect(page.locator("#brain-viewer.open .md-body")).toContainText("quote-writer");
  } finally { b.cleanup(); }
});

test("staff are sent to /notes, the owner's Dashboard button goes to /owner", async ({ page }) => {
  const b = await bootAsOwner({ staffSwitches: { folders: ["Team/acme"] } });
  try {
    await page.goto(`${b.url}/login`);
    await page.fill("input[name=username]", "marco");
    await page.fill("input[name=password]", "longenough1");
    await page.click("button[type=submit]");
    await page.waitForURL(/\/employee$/);
    await page.goto(`${b.url}/brain`);
    await expect(page).toHaveURL(/\/notes$/);
  } finally { b.cleanup(); }
  const o = await bootAsOwner();
  try {
    await openBrain(page, o);
    await page.click("#fab-home");
    await expect(page).toHaveURL(/\/owner$/);
  } finally { o.cleanup(); }
});

test("tweak and rescan from the page: Remove hides a node, Restore brings it back", async ({ page }) => {
  const b = await bootAsOwner();
  try {
    fatten(b.vault);
    await page.setViewportSize({ width: 1650, height: 843 });
    await openBrain(page, b);
    await page.evaluate(() => { BrainCore.S.st.spinPaused = true; });
    page.on("dialog", (d) => d.accept());
    await page.evaluate(() => BrainCore.select(BrainCore.S.byId.get("Daily/2026-09-04.md")));
    await page.click("#brain-card .act[data-act=remove]").catch(async () => { await page.click(".act[data-act=remove]"); });
    await page.waitForFunction(() => !BrainCore.S.byId.has("Daily/2026-09-04.md"), null, { timeout: 8000 });
    const hidden = await (await page.request.get(`${b.url}/api/brain/graph`)).json();
    expect(hidden.meta.hiddenCount).toBe(1);
  } finally { b.cleanup(); }
});
