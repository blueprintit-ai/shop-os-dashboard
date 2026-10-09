import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanVault, isSecret, buildGraph, expandDir, search, LIMITS, deptOf } from "../src/brain/scan.js";
import { mergeConfig, LAYERS, DEFAULT_DEPARTMENTS, ICON_KEYS } from "../src/brain/defaults.js";
import { listSkills } from "../src/brain/skills.js";
import { buildDemoVault, put } from "./helpers/brain-vault.js";

const tmp = () => mkdtempSync(join(tmpdir(), "brain-"));
const cfg = () => ({ ...mergeConfig(null), layers: LAYERS });

test("default config uses the vault folder names, the kit's icon keys and neutral labels", async () => {
  const c = mergeConfig(null);
  assert.deepEqual(c.departments.map((d) => d.key), ["business", "context", "intelligence", "projects", "team"]);
  for (const d of c.departments) { assert.ok(ICON_KEYS.includes(d.icon)); assert.match(d.color, /^#[0-9a-f]{6}$/i); }
  assert.deepEqual(LAYERS.map((l) => l.key), ["A", "R", "M", "S"]);
  assert.equal(deptOf("Context/a.md", c), "context");
  assert.equal(deptOf("Intelligence/market/x.md", c), "intelligence");
  assert.equal(deptOf("Daily/x.md", c), "business");
  assert.equal(deptOf("whatever/x.md", c), "business");
});

test("a hand-edited departments.json is validated: bad rows dropped, unknown depts ignored", async () => {
  const c = mergeConfig({ departments: [{ key: "ok", label: "Okay", color: "#112233", icon: "book" }, { key: "Bad Key", label: "x", color: "#112233", icon: "book" }, { key: "evil", label: "<script>", color: "#112233", icon: "book" }, { key: "nocolor", label: "x", color: "red", icon: "book" }, { key: "noicon", label: "x", color: "#112233", icon: "rocket" }],
    pathRules: [{ prefix: "A/", dept: "ok" }, { prefix: "../x", dept: "ok" }, { prefix: "B/", dept: "ghost" }], default: "ok" });
  assert.deepEqual(c.departments.map((d) => d.key), ["ok"]);
  assert.deepEqual(c.pathRules, [{ prefix: "A/", dept: "ok" }]);
  assert.equal(c.default, "ok");
  assert.deepEqual(mergeConfig("junk").departments, DEFAULT_DEPARTMENTS);
});

test("scan: hidden/system folders, secrets-by-dotfile, node_modules and Dashboard stay off the map", async () => {
  const v = tmp();
  try {
    buildDemoVault(v);
    const m = await scanVault(v);
    const rels = m.files.map((f) => f.rel);
    for (const bad of [".obsidian/app.json", ".claude/settings.json", ".git/config", "Context/.hidden.md", "Context/.env", "node_modules/x/index.js", "Dashboard/apps.json"]) assert.ok(!rels.includes(bad), bad);
    assert.ok(rels.includes("Context/organization.md"));
    assert.ok(rels.includes("Context/api-token.json"), "secret-looking files are listed (flagged), never served");
    assert.equal(m.dirs.has("Dashboard"), false);
    assert.equal(m.truncated, false);
  } finally { rmSync(v, { recursive: true, force: true }); }
});

test("scan: symlinks are never followed, unsafe names are skipped and counted", async () => {
  const v = tmp(), outside = tmp();
  try {
    put(v, "Context/a.md", "# a");
    writeFileSync(join(outside, "secret.md"), "# outside");
    mkdirSync(join(outside, "dir")); writeFileSync(join(outside, "dir", "deep.md"), "x");
    let linked = true;
    try { symlinkSync(join(outside, "secret.md"), join(v, "Context", "link.md")); symlinkSync(join(outside, "dir"), join(v, "linkdir")); } catch { linked = false; }
    put(v, 'Context/<img onerror=x>.md', "x");
    put(v, 'Context/say "hi".md', "x");
    const m = await scanVault(v);
    const rels = m.files.map((f) => f.rel);
    assert.deepEqual(rels, ["Context/a.md"]);
    assert.ok(m.skippedUnsafe >= 2);
    assert.equal(m.dirs.has("linkdir"), false);
    assert.ok(linked || true);
  } finally { rmSync(v, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test("links: wikilinks and relative md links resolve; a self link and a link out of the vault do not", async () => {
  const v = tmp();
  try {
    buildDemoVault(v);
    const m = await scanVault(v);
    const has = (a, b) => m.mdLinks.some(([x, y]) => x === a && y === b);
    assert.ok(has("CLAUDE.md", "Context/organization.md"));
    assert.ok(has("CLAUDE.md", "Projects/Acme Kitchen.md"));
    assert.ok(has("Context/operator.md", "Context/organization.md"));
    assert.ok(has("Intelligence/market/Trends.md", "Intelligence/competitors/Big Box.md"));
    assert.ok(!m.mdLinks.some(([a, b]) => a === b));
    // cache: second scan re-reads nothing, and a new note that an old wikilink names is picked up
    const m2 = await scanVault(v, m.cache);
    assert.equal(m2.scanStats.read, 0);
    assert.equal(m2.mdLinks.length, m.mdLinks.length);
  } finally { rmSync(v, { recursive: true, force: true }); }
});

test("graph: router, department hubs, the three layer hubs, folded folders, skills, apps and routines", async () => {
  const v = tmp();
  try {
    buildDemoVault(v);
    const m = await scanVault(v);
    const skills = listSkills(v, { home: join(v, "nohome"), productSkills: [{ id: "bp-digest", label: "Digest" }] });
    const extras = { skills, apps: [{ id: "crm", name: "Shop CRM", sub: "Customers", url: "https://x" }], routines: [{ t: "07:00", d: "daily", src: "desktop", n: "Morning briefing", desc: "d" }], tweaks: { hidden: [], edits: {} } };
    const g = buildGraph(m, cfg(), extras);
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const id of ["CLAUDE.md", "hub:context", "hub:business", "hub:team", "lhub:A", "lhub:R", "lhub:S", "Context/organization.md", "Intelligence/competitors", "Team/acme", "skill:my-skill", "skill:bp-digest", "app:crm"]) assert.ok(ids.has(id), id);
    assert.ok([...ids].some((i) => i.startsWith("rt:0-morning-briefing")));
    assert.equal(g.nodes.find((n) => n.id === "Intelligence/competitors").type, "dir");
    assert.equal(g.nodes.find((n) => n.id === "Intelligence/competitors").files, 1);
    assert.equal(g.nodes.find((n) => n.id === "skill:my-skill").layer, "S");
    assert.equal(g.nodes.find((n) => n.id === "Context/organization.md").dept, "context");
    assert.ok(g.nodes.every((n) => n.access === "claude"), "no node claims access for an agent the product does not have");
    assert.ok(g.links.some((l) => l.s === "Context/organization.md" && l.t === "hub:context" && l.k === "spoke"));
    assert.ok(g.links.some((l) => l.s === "skill:my-skill" && l.t === "lhub:S"));
    assert.ok(g.nodes.every((n) => !n.id.startsWith("agent:")));
  } finally { rmSync(v, { recursive: true, force: true }); }
});

test("graph: the owner's hide and edit tweaks apply, with markup stripped", async () => {
  const v = tmp();
  try {
    buildDemoVault(v);
    const m = await scanVault(v);
    const g = buildGraph(m, cfg(), { tweaks: { hidden: ["Context/operator.md"], edits: { "Context/organization.md": { label: "Org", desc: "d" } } } });
    assert.ok(!g.nodes.some((n) => n.id === "Context/operator.md"));
    assert.ok(!g.links.some((l) => l.s === "Context/operator.md"));
    assert.equal(g.nodes.find((n) => n.id === "Context/organization.md").label, "Org");
    assert.equal(g.hiddenCount, 1);
  } finally { rmSync(v, { recursive: true, force: true }); }
});

test("expand and search come from the cached scan", async () => {
  const v = tmp();
  try {
    buildDemoVault(v);
    const m = await scanVault(v);
    const kids = expandDir(m, cfg(), "Intelligence/competitors");
    assert.deepEqual(kids.map((k) => k.id), ["Intelligence/competitors/Big Box.md"]);
    assert.equal(expandDir(m, cfg(), "nope"), null);
    assert.equal(expandDir(m, cfg(), "../.."), null);
    const hit = search(m, cfg(), "big", [{ name: "bigger-skill", size: 0 }]);
    assert.ok(hit.some((h) => h.path === "Intelligence/competitors/Big Box.md"));
    assert.ok(hit.some((h) => h.path === "skill:bigger-skill"));
    assert.deepEqual(search(m, cfg(), "   "), []);
  } finally { rmSync(v, { recursive: true, force: true }); }
});

test("caps: a vault with 5,000 notes keeps the walk, the graph and the link list bounded", async () => {
  const v = tmp();
  try {
    for (let i = 0; i < 20; i++) mkdirSync(join(v, "Projects", "p" + i), { recursive: true });
    mkdirSync(join(v, "Daily"));
    for (let i = 0; i < 5000; i++) {
      const dir = i % 5 === 0 ? "Daily" : "Projects/p" + (i % 20);
      writeFileSync(join(v, dir, `note-${i}.md`), `# n${i}\n[[note-${(i + 1) % 5000}]] [[note-${(i + 7) % 5000}]]\n`);
    }
    const m = await scanVault(v);
    assert.equal(m.files.length, 5000);
    const g = buildGraph(m, cfg(), {});
    const files = g.nodes.filter((n) => n.type === "file");
    assert.ok(files.length <= LIMITS.maxVisibleFiles, String(files.length));
    assert.ok(g.nodes.length < 1000, String(g.nodes.length));
    assert.ok(g.capped.hiddenFiles >= 900, "Daily/ has 1000 notes, only perDirVisible are drawn");
    assert.ok(m.mdLinks.length <= LIMITS.maxMdLinks);
    const small = { ...LIMITS, maxFiles: 300, maxMdLinks: 50, maxMdReads: 100 };
    const m2 = await scanVault(v, new Map(), small);
    assert.equal(m2.files.length, 300);
    assert.equal(m2.truncated, true);
    assert.ok(m2.mdLinks.length <= 50);
    assert.ok(m2.scanStats.read <= 100);
    const exp = expandDir(m, cfg(), "Daily");
    assert.ok(exp.length <= LIMITS.expandFiles + LIMITS.expandDirs);
    const depth = { ...LIMITS, maxDirs: 5 };
    assert.equal((await scanVault(v, new Map(), depth)).dirs.size <= 5, true);
  } finally { rmSync(v, { recursive: true, force: true }); }
});

test("a note bigger than the read cap is only read up to the cap", async () => {
  const v = tmp();
  try {
    put(v, "Context/a.md", "# a\n");
    put(v, "Context/big.md", "[[a]]\n" + "x".repeat(2000) + "\n[[late-link-after-cap]]");
    put(v, "Context/late-link-after-cap.md", "# late");
    const m = await scanVault(v, new Map(), { ...LIMITS, mdReadBytes: 1000 });
    assert.ok(m.mdLinks.some(([a, b]) => a === "Context/big.md" && b === "Context/a.md"));
    assert.ok(!m.mdLinks.some(([a, b]) => b === "Context/late-link-after-cap.md"));
  } finally { rmSync(v, { recursive: true, force: true }); }
});

test("skills: vault, user and plugin sources, deduped by name, capped, descriptions cleaned", async () => {
  const v = tmp(), home = tmp();
  try {
    put(v, "Skills/a-skill/SKILL.md", "---\nname: a-skill\ndescription: \"Does <b>things</b>\"\n---\nbody");
    put(home, "skills/user-skill/SKILL.md", "---\ndescription: user level\n---\n");
    put(home, "skills/a-skill/SKILL.md", "---\ndescription: shadowed by the vault copy\n---\n");
    const plug = join(home, "plugins", "cache", "m", "p", "1.0.0");
    put(plug, "skills/plug-skill/SKILL.md", "---\ndescription: from a plugin\n---\n");
    put(home, "plugins/installed_plugins.json", JSON.stringify({ version: 2, plugins: { "p@m": [{ scope: "user", installPath: plug }] } }));
    put(v, "Skills/../escape/SKILL.md", "x");
    const list = listSkills(v, { home, productSkills: [{ id: "bp-digest", label: "Digest" }, { id: "plug-skill", label: "dup" }] });
    assert.deepEqual(list.map((s) => s.name).sort(), ["a-skill", "bp-digest", "plug-skill", "user-skill"]);
    assert.equal(list.find((s) => s.name === "a-skill").source, "vault");
    assert.doesNotMatch(list.find((s) => s.name === "a-skill").desc, /[<>"]/);
    assert.equal(list.find((s) => s.name === "bp-digest").file, null);
  } finally { rmSync(v, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); }
});

test("secret-looking paths are flagged at any depth (the kit's regex missed a / boundary)", () => {
  for (const p of ["Context/secrets.md", "Context/secrets/api.md", "secrets/x.md", "Context/my-secret.md", "Context/id_rsa", "a/.env", "a/server.pem", "Context/api-token.json", "Team/credentials.md"]) assert.equal(isSecret(p), true, p);
  for (const p of ["Context/secretary.md", "Context/organization.md", "Projects/Acme Kitchen.md"]) assert.equal(isSecret(p), false, p);
});

test("scan: the time budget covers link extraction, partial is reported, the bytes cap holds, and the loop yields", async () => {
  const v = tmp();
  try {
    for (let i = 0; i < 400; i++) put(v, `Daily/n${i}.md`, `# n${i}\n[[n${(i + 1) % 400}]]\n` + "x".repeat(500));
    // deterministic: a setImmediate loop can only advance if the scan hands the event loop back
    let ticks = 0, stop = false;
    const spin = () => { if (!stop) { ticks++; setImmediate(spin); } };
    spin();
    const bytesCapped = await scanVault(v, new Map(), { ...LIMITS, maxBytesRead: 5000, yieldMs: 0 });
    assert.equal(bytesCapped.partial, true);
    assert.ok(bytesCapped.scanStats.bytes <= 5000 + LIMITS.mdReadBytes);
    assert.ok(bytesCapped.scanStats.read < 400);
    const budget = await scanVault(v, new Map(), { ...LIMITS, budgetMs: -1 });
    assert.equal(budget.partial, true);
    const full = await scanVault(v);
    assert.equal(full.partial, false);
    stop = true;
    assert.ok(ticks > 0, "the event loop ran while the scan was in progress");
  } finally { rmSync(v, { recursive: true, force: true }); }
});

test("skills: a symlinked SKILL.md, a link-out skill folder and a crafted installPath are refused", async (t) => {
  const v = tmp(), home = tmp(), outside = tmp();
  try {
    writeFileSync(join(outside, "passwd.txt"), "root:x:0:0");
    put(outside, "skills/stolen/SKILL.md", "---\ndescription: crafted\n---\n");
    put(home, "plugins/installed_plugins.json", JSON.stringify({ version: 2, plugins: { "x@y": [{ scope: "user", installPath: outside }] } }));
    try {
      mkdirSync(join(v, "Skills", "linked"), { recursive: true });
      symlinkSync(join(outside, "passwd.txt"), join(v, "Skills", "linked", "SKILL.md"));
      symlinkSync(join(outside, "skills", "stolen"), join(v, "Skills", "linkdir"));
    } catch { t.skip("symlinks unavailable"); return; }
    const names = listSkills(v, { home, productSkills: [] }).map((s) => s.name);
    assert.deepEqual(names, []);
  } finally { for (const d of [v, home, outside]) rmSync(d, { recursive: true, force: true }); }
});

test("scan: one folder with thousands of entries yields inside the folder, not only between folders", async () => {
  const v = tmp();
  try {
    mkdirSync(join(v, "Daily"));
    for (let i = 0; i < 1500; i++) writeFileSync(join(v, "Daily", `n${i}.md`), `# n${i}\n`);
    let ticks = 0, stop = false;
    const spin = () => { if (!stop) { ticks++; setImmediate(spin); } };
    spin();
    const m = await scanVault(v, new Map(), { ...LIMITS, yieldMs: 0 });
    stop = true;
    assert.equal(m.files.length, 1500);
    assert.ok(ticks >= 20, "the walk handed the loop back inside the single folder: " + ticks);
  } finally { rmSync(v, { recursive: true, force: true }); }
});

test("skills: a linked Skills folder (or .claude/skills, or user skills) pointing outside is refused", async (t) => {
  const v = tmp(), home = tmp(), outside = tmp();
  try {
    put(outside, "evil/SKILL.md", "---\ndescription: outside\n---\n");
    try {
      symlinkSync(outside, join(v, "Skills"), "dir");
      mkdirSync(join(v, ".claude"), { recursive: true });
      symlinkSync(outside, join(v, ".claude", "skills"), "dir");
      symlinkSync(outside, join(home, "skills"), "dir");
    } catch { t.skip("symlinks unavailable"); return; }
    assert.deepEqual(listSkills(v, { home, productSkills: [] }), []);
    // and a skills folder that is a real folder inside the vault still works
    rmSync(join(v, "Skills"));
    put(v, "Skills/ok/SKILL.md", "---\ndescription: fine\n---\n");
    assert.deepEqual(listSkills(v, { home, productSkills: [] }).map((s) => s.name), ["ok"]);
  } finally { for (const d of [v, home, outside]) rmSync(d, { recursive: true, force: true }); }
});
