import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, existsSync, mkdirSync, symlinkSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bootAsOwner, requestAs } from "./helpers/boot.js";
import { buildDemoVault, put } from "./helpers/brain-vault.js";
import { BrainStore, MIN_REFRESH_MS, STALE_MS } from "../src/brain/store.js";

const json = async (r) => r.json();
async function boot(opts) {
  const b = await bootAsOwner(opts);
  buildDemoVault(b.vault);
  return b;
}
const get = (b, role, path) => requestAs(b.server, b.jar, role, "GET", path);
const post = (b, role, path, body) => requestAs(b.server, b.jar, role, "POST", path, body);

test("role matrix: the map's whole-vault endpoints are owner-only, anon gets 401", async () => {
  const b = await boot();
  try {
    for (const path of ["/api/brain/graph", "/api/brain/meta", "/api/brain/search?q=a", "/api/brain/expand?path=Context"]) {
      assert.equal((await get(b, "anon", path)).status, 401, path + " anon");
      assert.equal((await get(b, "staff", path)).status, 403, path + " staff");
      assert.equal((await get(b, "owner", path)).status, 200, path + " owner");
    }
    for (const [path, body] of [["/api/brain/rescan", {}], ["/api/brain/tweak", { action: "unhide-all" }], ["/api/brain/bake", { theme: "dark" }]]) {
      assert.equal((await post(b, "anon", path, body)).status, 401, path + " anon");
      assert.equal((await post(b, "staff", path, body)).status, 403, path + " staff");
    }
  } finally { b.cleanup(); }
});

test("graph: shape the page expects, the demo vault's four rings, no agents", async () => {
  const b = await boot();
  try {
    const g = await json(await get(b, "owner", "/api/brain/graph?fresh=1"));
    assert.deepEqual(Object.keys(g).sort(), ["departments", "layers", "links", "mdLinks", "meta", "nodes"]);
    assert.deepEqual(g.layers.map((l) => l.key), ["A", "R", "M", "S"]);
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const id of ["CLAUDE.md", "lhub:A", "lhub:R", "lhub:S", "skill:my-skill", "app:crm", "Intelligence/competitors"]) assert.ok(ids.has(id), id);
    assert.ok([...ids].some((i) => i.startsWith("rt:0-morning-briefing")));
    assert.ok(g.nodes.every((n) => n.type !== "agent"));
    assert.equal(typeof g.meta.totalFiles, "number");
    assert.equal(g.meta.truncated, false);
    assert.ok(g.mdLinks.length > 0);
    const meta = await json(await get(b, "owner", "/api/brain/meta"));
    assert.equal(meta.totalFiles, g.meta.totalFiles);
  } finally { b.cleanup(); }
});

test("graph: apps come from /api/apps (the default Second Brain row is not a node), routines from the feed", async () => {
  const b = await boot();
  try {
    writeFileSync(join(b.vault, "Dashboard", "apps.json"), JSON.stringify([{ id: "sbRow", name: "Second Brain", url: "/brain", icon: "brain" }, { id: "crm", name: "Shop CRM", sub: "Customers", url: "https://example.com", icon: "gen" }]));
    const g = await json(await get(b, "owner", "/api/brain/graph?fresh=1"));
    assert.deepEqual(g.nodes.filter((n) => n.type === "app").map((n) => n.id), ["app:crm"]);
    assert.deepEqual(g.nodes.filter((n) => n.type === "routine").map((n) => n.label), ["Morning briefing", "Weekly digest"]);
  } finally { b.cleanup(); }
});

test("expand and search", async () => {
  const b = await boot();
  try {
    const e = await json(await get(b, "owner", "/api/brain/expand?path=Intelligence%2Fcompetitors"));
    assert.deepEqual(e.nodes.map((n) => n.id), ["Intelligence/competitors/Big Box.md"]);
    assert.equal((await get(b, "owner", "/api/brain/expand?path=Nope")).status, 404);
    assert.equal((await get(b, "owner", "/api/brain/expand?path=..%2F..")).status, 404);
    assert.equal((await get(b, "owner", "/api/brain/expand")).status, 404);
    const s = await json(await get(b, "owner", "/api/brain/search?q=big"));
    assert.ok(s.results.some((r) => r.path === "Intelligence/competitors/Big Box.md"));
    const none = await json(await get(b, "owner", "/api/brain/search?q=" + "z".repeat(500)));
    assert.deepEqual(none.results, []);
    assert.equal(none.q.length, 100);
  } finally { b.cleanup(); }
});

test("file: owner reads vault text; skills by name; traversal, hidden, secret, absolute, binary, oversize all refused", async () => {
  const b = await boot();
  try {
    const f = (p, role = "owner") => get(b, role, "/api/brain/file?path=" + encodeURIComponent(p));
    const ok = await f("Context/organization.md");
    assert.equal(ok.status, 200);
    assert.match((await json(ok)).content, /Acme Cabinets/);
    assert.equal((await f("Context/../CLAUDE.md")).status, 400);
    assert.equal((await f("../outside.md")).status, 400);
    assert.equal((await f("..\\outside.md")).status, 400);
    assert.equal((await f("/etc/passwd")).status, 400);
    assert.equal((await f("C:/Windows/win.ini")).status, 400);
    assert.equal((await f("Context/%2e%2e/CLAUDE.md")).status, 404);
    assert.equal((await f("")).status, 400);
    assert.equal((await f("Context/a\0b.md")).status, 400);
    assert.equal((await f(".obsidian/app.json")).status, 403);
    assert.equal((await f(".claude/settings.json")).status, 403);
    assert.equal((await f("Context/.hidden.md")).status, 403);
    assert.equal((await f("Context/.env")).status, 403);
    assert.equal((await f("Context/api-token.json")).status, 403);
    assert.equal((await f("Context")).status, 404, "a folder is not a file");
    assert.equal((await f("Context/missing.md")).status, 404);
    // binary and oversize
    writeFileSync(join(b.vault, "Projects", "pic.png"), Buffer.from([137, 80, 78, 71, 0, 1, 2]));
    const bin = await f("Projects/pic.png");
    assert.equal(bin.status, 400);
    assert.equal((await json(bin)).error, "binary");
    writeFileSync(join(b.vault, "Projects", "huge.md"), "x".repeat(600 * 1024));
    const big = await f("Projects/huge.md");
    assert.equal(big.status, 400);
    assert.match((await json(big)).error, /too large/);
    // skills: owner only, by name, no path games
    assert.match((await json(await f("skill:my-skill"))).content, /My skill/);
    assert.equal((await f("skill:nope")).status, 404);
    assert.equal((await f("skill:../../etc/passwd")).status, 404);
    assert.equal((await f("skill:my-skill", "staff")).status, 403);
    assert.equal((await f("Context/organization.md", "anon")).status, 401);
  } finally { b.cleanup(); }
});

test("file: a symlink that leaves the vault is refused", async (t) => {
  const b = await boot();
  const outside = mkdtempSync(join(tmpdir(), "brain-out-"));
  try {
    writeFileSync(join(outside, "secret.md"), "# outside the vault");
    try { symlinkSync(join(outside, "secret.md"), join(b.vault, "Context", "escape.md")); } catch { t.skip("symlinks unavailable here"); return; }
    const r = await get(b, "owner", "/api/brain/file?path=" + encodeURIComponent("Context/escape.md"));
    assert.ok([403, 404].includes(r.status), String(r.status));
    assert.doesNotMatch(await r.text(), /outside the vault/);
  } finally { b.cleanup(); rmSync(outside, { recursive: true, force: true }); }
});

test("file and open honor a staff member's folders (scope.js), never the page's owner-only rule", async () => {
  const b = await boot({ staffSwitches: { folders: ["Team/acme"] } });
  try {
    const f = (p) => get(b, "staff", "/api/brain/file?path=" + encodeURIComponent(p));
    assert.equal((await f("Team/acme/Profiles/marco/Marco.md")).status, 200);
    assert.equal((await f("Context/organization.md")).status, 403);
    assert.equal((await f("CLAUDE.md")).status, 403);
    const o = (p) => post(b, "staff", "/api/brain/open", { path: p });
    assert.equal((await o("Team/acme/Profiles/marco/Marco.md")).status, 200);
    assert.equal((await o("Context/organization.md")).status, 403);
  } finally { b.cleanup(); }
});

test("open: runs no process, returns the viewer URL for notes and raw images/PDFs, refuses the rest", async () => {
  const b = await boot();
  try {
    writeFileSync(join(b.vault, "Projects", "pic.png"), Buffer.from([137, 80, 78, 71]));
    const o = async (p) => post(b, "owner", "/api/brain/open", { path: p });
    const md = await o("Projects/Acme Kitchen.md");
    assert.equal(md.status, 200);
    assert.deepEqual(await json(md), { ok: true, url: "/notes?path=Projects%2FAcme%20Kitchen.md" });
    assert.equal((await json(await o("Projects/pic.png"))).url, "/api/notes/raw?path=Projects%2Fpic.png");
    assert.equal((await o("Context/api-token.json")).status, 403);
    assert.equal((await o("../x.md")).status, 400);
    assert.equal((await o("skill:my-skill")).status, 400);
    assert.equal((await o("Resources/missing.md")).status, 404);
    const r = await requestAs(b.server, b.jar, "owner", "POST", "/api/brain/open", undefined);
    assert.equal(r.status, 400);
    const src = readFileSync(new URL("../src/routes/brain-routes.js", import.meta.url), "utf8") + readFileSync(new URL("../src/brain/files.js", import.meta.url), "utf8");
    assert.doesNotMatch(src, /child_process|spawn|exec\(|execFile/);
  } finally { b.cleanup(); }
});

test("tweak: hide, edit, restore; only known ids; only the tweaks file; markup stripped", async () => {
  const b = await boot();
  try {
    const tw = (body) => post(b, "owner", "/api/brain/tweak", body);
    const file = join(b.vault, "Dashboard", "brain", "tweaks.json");
    assert.equal((await tw({ action: "hide", id: "Context/operator.md" })).status, 200);
    assert.equal((await tw({ action: "edit", id: "Context/organization.md", label: "<b>Org</b>", desc: "x<script>" })).status, 200);
    let g = await json(await get(b, "owner", "/api/brain/graph"));
    assert.ok(!g.nodes.some((n) => n.id === "Context/operator.md"));
    assert.equal(g.meta.hiddenCount, 1);
    const org = g.nodes.find((n) => n.id === "Context/organization.md");
    assert.doesNotMatch(org.label + org.desc, /[<>]/);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, "utf8"))).sort(), ["edits", "hidden"]);
    assert.equal((await tw({ action: "hide", id: "not-a-real-node" })).status, 400);
    assert.equal((await tw({ action: "hide" })).status, 400);
    assert.equal((await tw({ action: "delete-everything", id: "CLAUDE.md" })).status, 400);
    assert.equal((await tw({ action: "edit", id: "x".repeat(400), label: "a" })).status, 400);
    assert.equal((await tw({ action: "unhide-all" })).status, 200);
    g = await json(await get(b, "owner", "/api/brain/graph"));
    assert.ok(g.nodes.some((n) => n.id === "Context/operator.md"));
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).hidden, []);
    // junk in the stored file is ignored, not trusted
    writeFileSync(file, JSON.stringify({ hidden: [1, null, "Context/operator.md"], edits: { "Context/organization.md": { label: 5 }, "__proto__": { label: "x" } }, evil: true }));
    g = await json(await get(b, "owner", "/api/brain/graph"));
    assert.ok(!g.nodes.some((n) => n.id === "Context/operator.md"));
    assert.equal(g.nodes.find((n) => n.id === "Context/organization.md").label, "organization.md");
    assert.equal((await requestAs(b.server, b.jar, "owner", "POST", "/api/brain/tweak", undefined)).status, 400);
  } finally { b.cleanup(); }
});

test("bake: only whitelisted keys and plain values are stored, in Dashboard/brain/bake.json", async () => {
  const b = await boot();
  try {
    const r = await post(b, "owner", "/api/brain/bake", { skin: "final", theme: "dark", settings: { spin: 0.2, layout: "rings", depts: { context: true }, "bad key!": 1, __proto__: { x: 1 }, html: "<img onerror=x>" }, colors: { departments: { context: "#112233" }, accent: "#2e8fc9" }, evil: "no", overridesOnly: {} });
    assert.equal(r.status, 200);
    const d = await json(r);
    assert.equal(d.path, "Dashboard/brain/bake.json");
    const saved = JSON.parse(readFileSync(join(b.vault, d.path), "utf8"));
    assert.deepEqual(Object.keys(saved).sort(), ["colors", "overridesOnly", "settings", "skin", "theme"]);
    assert.deepEqual(saved.settings, { spin: 0.2, layout: "rings", depts: { context: true } });
    assert.equal((await post(b, "owner", "/api/brain/bake", [1, 2])).status, 400);
    const huge = await post(b, "owner", "/api/brain/bake", { settings: { a: "x".repeat(200000) } });
    assert.ok([400, 413].includes(huge.status));
    const big = {};
    for (let i = 0; i < 300; i++) big["k" + i] = { a: 1, b: 2, c: 3 };
    assert.equal((await post(b, "owner", "/api/brain/bake", { settings: big })).status, 200);
    assert.ok(JSON.stringify(JSON.parse(readFileSync(join(b.vault, d.path), "utf8"))).length < 64 * 1024);
  } finally { b.cleanup(); }
});

test("rescan: owner only and throttled", async () => {
  const b = await boot();
  try {
    await get(b, "owner", "/api/brain/graph"); // first scan
    const first = await post(b, "owner", "/api/brain/rescan", {});
    assert.equal(first.status, 429, "a rescan right after a scan is refused");
    assert.ok(first.headers.get("retry-after"));
  } finally { b.cleanup(); }
});

test("BrainStore: rescan throttle, stale and watcher invalidation, with a fake clock", () => {
  const v = mkdtempSync(join(tmpdir(), "brain-store-"));
  try {
    buildDemoVault(v);
    let t = 1_000_000;
    const s = new BrainStore(v, { now: () => t, skillsFor: () => [] });
    assert.deepEqual(s.ensure(), { refreshed: true, throttled: false });
    const scanned = s.model;
    assert.deepEqual(s.ensure(), { refreshed: false, throttled: false });
    assert.deepEqual(s.rescan(), { refreshed: false, throttled: true });
    t += MIN_REFRESH_MS + 1;
    assert.equal(s.rescan().refreshed, true);
    assert.notEqual(s.model, scanned);
    // watcher says something changed: the next request rescans, but not inside the minimum interval
    s.invalidate();
    assert.equal(s.ensure().refreshed, false);
    t += MIN_REFRESH_MS + 1;
    put(v, "Context/new-note.md", "# new");
    assert.equal(s.graph().nodes.some((n) => n.id === "Context/new-note.md"), true);
    // ?fresh=1 only rescans when the cached scan is older than STALE_MS
    const m = s.model;
    s.graph({ fresh: true });
    assert.equal(s.model, m);
    t += STALE_MS + 1;
    s.graph({ fresh: true });
    assert.notEqual(s.model, m);
    // the default Second Brain launcher row is not drawn as a node
    put(v, "Dashboard/apps.json", JSON.stringify([{ id: "sbRow", name: "Second Brain", url: "/notes", icon: "brain" }]));
    assert.equal(s.graph().nodes.some((n) => n.type === "app"), false);
  } finally { rmSync(v, { recursive: true, force: true }); }
});

test("the server wires the notes watcher to the brain cache", async () => {
  const b = await boot();
  try {
    assert.equal(typeof b.server.ctx.brain.invalidate, "function");
    b.server.ctx.brain.ensure();
    b.server.ctx.brain.dirty = false;
    b.server.ctx.index.watch; // eslint-disable-line no-unused-expressions
    assert.ok(b.server.ctx.brain.model);
  } finally { b.cleanup(); }
});

test("pages: /brain is owner-only, licence-gated, fills the shop name safely", async () => {
  const b = await boot();
  try {
    const page = async (role) => requestAs(b.server, b.jar, role, "GET", "/brain");
    const anon = await page("anon");
    assert.equal(anon.status, 302); assert.equal(anon.headers.get("location"), "/login");
    const staff = await page("staff");
    assert.equal(staff.status, 302); assert.equal(staff.headers.get("location"), "/notes");
    const owner = await page("owner");
    assert.equal(owner.status, 200);
    const html = await owner.text();
    assert.doesNotMatch(html, /__SHOP_NAME__|__BRAIN_TAGLINE_JS__/);
    assert.match(html, /<title>Blueprint OS — .* · AI Brain<\/title>/);
    assert.match(html, /tagline: "\\u003cem>Acme Cabinets\\u003c\/em>",/);
    assert.doesNotMatch(html, /fonts\.googleapis|cdn\.jsdelivr/);
    // a hostile shop name cannot break out of the title or the script string
    writeFileSync(join(b.vault, "Context", "organization.md"), "# Evil </script><script>alert(1)</script> \"q\" 'a'\n");
    const evil = await (await page("owner")).text();
    assert.doesNotMatch(evil, /<script>alert\(1\)/);
    const line = evil.split("\n").find((l) => l.trim().startsWith("tagline:"));
    assert.doesNotMatch(line, /<\/script/i);
    assert.equal(JSON.parse(line.trim().replace(/^tagline: /, "").replace(/,$/, "")).includes("</script"), false);
    // the static files the page needs are served
    for (const p of ["/static/brain/_core.js", "/static/brain/_core.css", "/static/brain/_flows2.js", "/static/brain/_icons.js", "/static/vendor/d3.min.js", "/static/css/brain-fonts.css", "/static/js/brain-safe.js", "/static/vendor/fonts/source-serif-4-latin-400-italic.woff2"]) {
      assert.equal((await requestAs(b.server, b.jar, "anon", "GET", p)).status, 200, p);
    }
  } finally { b.cleanup(); }
});

test("licence: a failed licence check pauses the map's API (402) and the page shows the licence page", async () => {
  const b = await boot({ licenseCheck: () => ({ ok: false, error: "expired" }) });
  try {
    assert.equal((await get(b, "owner", "/api/brain/graph")).status, 402);
    assert.equal((await get(b, "owner", "/api/brain/file?path=CLAUDE.md")).status, 402);
    assert.equal((await post(b, "owner", "/api/brain/tweak", { action: "unhide-all" })).status, 402);
    assert.equal((await requestAs(b.server, b.jar, "owner", "GET", "/brain")).status, 402);
  } finally { b.cleanup(); }
});

test("a vault with 5,000 notes: the graph stays small and quick", async () => {
  const b = await bootAsOwner();
  try {
    mkdirSync(join(b.vault, "Daily"), { recursive: true });
    for (let i = 0; i < 5000; i++) writeFileSync(join(b.vault, "Daily", `n-${i}.md`), `# n${i}\n[[n-${(i + 1) % 5000}]]\n`);
    const t0 = Date.now();
    const res = await get(b, "owner", "/api/brain/graph?fresh=1");
    const text = await res.text();
    const g = JSON.parse(text);
    assert.equal(res.status, 200);
    assert.ok(g.meta.totalFiles >= 5000);
    assert.ok(g.nodes.length < 1000, String(g.nodes.length));
    assert.ok(g.mdLinks.length <= 6000);
    assert.ok(text.length < 1_000_000, String(text.length));
    assert.ok(Date.now() - t0 < 5000);
  } finally { b.cleanup(); }
});
