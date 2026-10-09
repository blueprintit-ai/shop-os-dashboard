// The kit page (public/owner.html, synced from the RoboNuggets kit) calls the kit server's
// /api/* surface. src/routes/kit-compat-routes.js implements it on top of the product's own
// data and engines; these tests pin the response SHAPES the page reads (taken from the kit's
// server.js and dashboard.html) and the auth rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootAsOwner, requestAs } from "./helpers/boot.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 3000) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("waitFor timed out"); await sleep(20); }
}
const json = async (res) => res.json();

// A runTurn whose completion the test controls.
function gatedRunTurn() {
  const calls = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  async function* runTurn({ prompt, options }) {
    calls.push({ prompt, options });
    yield { type: "session", claudeSessionId: "cc-" + calls.length };
    yield { type: "text", delta: "working " };
    await gate;
    yield { type: "tool_use", name: "Read", input: { file_path: "/x/notes.md" } };
    yield { type: "text", delta: "done" };
    yield { type: "done", text: "working done", stats: { duration_ms: 1234 } };
  }
  return { runTurn, calls, release };
}

test("every kit endpoint needs a session; owner-only ones refuse staff", async () => {
  const b = await bootAsOwner();
  try {
    const rows = [
      // [method, path, body, anon, staff, owner]
      ["GET", "/api/calendar", undefined, 401, 200, 200],
      ["GET", "/api/email", undefined, 401, 200, 200],
      ["GET", "/api/stats", undefined, 401, 200, 200],
      ["GET", "/api/routines", undefined, 401, 200, 200],
      ["GET", "/api/skills", undefined, 401, 403, 200],
      ["POST", "/api/run", { id: "nope" }, 401, 403, 400],
      ["GET", "/api/run-status?job=zzz", undefined, 401, 403, 404],
      ["GET", "/api/jobs/active", undefined, 401, 403, 200],
      ["POST", "/api/artifact-remove", { file: "missing.html" }, 401, 403, 404],
      ["POST", "/api/assets/scan", { id: "zzz" }, 401, 403, 404],
      ["POST", "/api/assets/remind", { id: "zzz" }, 401, 403, 404],
      ["POST", "/api/open", { target: "/tmp" }, 401, 400, 400],
    ];
    for (const [m, p, body, anon, staff, owner] of rows) {
      for (const [role, want] of [["anon", anon], ["staff", staff], ["owner", owner]]) {
        const res = await requestAs(b.server, b.jar, role, m, p, body);
        assert.equal(res.status, want, `${role} ${m} ${p}`);
        await res.arrayBuffer();
      }
    }
  } finally { b.cleanup(); }
});

test("calendar and email answer the kit's not-wired shape; the page keeps its built-in demo values", async () => {
  const b = await bootAsOwner();
  try {
    const cal = await json(await b.http("GET", "/api/calendar", { as: "owner" }));
    assert.equal(cal.needsSetup, true);
    assert.deepEqual(cal.events, []);
    const mail = await json(await b.http("GET", "/api/email", { as: "owner" }));
    assert.equal(mail.needsSetup, true);
  } finally { b.cleanup(); }
});

test("stats and routines serve the vault's Dashboard/snapshots feeds, or needsSetup when absent", async () => {
  const b = await bootAsOwner();
  try {
    assert.deepEqual(await json(await b.http("GET", "/api/stats", { as: "owner" })), { needsSetup: true });
    const r0 = await json(await b.http("GET", "/api/routines", { as: "owner" }));
    assert.equal(r0.needsSetup, true);
    assert.deepEqual(r0.routines, []);
    const snap = join(b.vault, "Dashboard", "snapshots");
    mkdirSync(snap, { recursive: true });
    writeFileSync(join(snap, "stats.json"), JSON.stringify({ title: "Shop", metrics: [{ big: "4", cap: "OPEN JOBS" }] }));
    writeFileSync(join(snap, "routines.json"), JSON.stringify({ sources: [{ key: "a", label: "A" }], routines: [], counts: {} }));
    assert.equal((await json(await b.http("GET", "/api/stats", { as: "owner" }))).metrics[0].big, "4");
    assert.equal((await json(await b.http("GET", "/api/routines", { as: "owner" }))).sources[0].key, "a");
  } finally { b.cleanup(); }
});

test("skills uses the kit's shape: model/effort are indexes into models/efforts", async () => {
  const b = await bootAsOwner();
  try {
    const d = await json(await b.http("GET", "/api/skills", { as: "owner" }));
    assert.deepEqual(d.models, ["HAIKU", "SONNET", "OPUS", "FABLE"]);
    assert.deepEqual(d.efforts, ["LOW", "MEDIUM", "HIGH", "XHIGH", "MAX"]);
    assert.ok(Array.isArray(d.runs));
    const digest = d.skills.find((s) => s.id === "bp-digest");
    assert.equal(digest.model, 1);       // SONNET
    assert.equal(digest.effort, 1);      // MEDIUM
    assert.equal(digest.needsInput, false);
    assert.equal(typeof digest.icon, "string");
  } finally { b.cleanup(); }
});

test("run starts a job at once; run-status and jobs/active follow it to a report on the ring", async () => {
  const g = gatedRunTurn();
  const b = await bootAsOwner({ runTurn: g.runTurn });
  try {
    const start = await b.http("POST", "/api/run", { as: "owner", body: { id: "bp-digest", model: "SONNET", effort: "MEDIUM", input: "" } });
    assert.equal(start.status, 200);
    const { job } = await start.json();
    assert.match(job, /^bp-digest-[0-9a-f-]{36}$/);
    await waitFor(() => g.calls.length === 1);
    const st1 = await json(await b.http("GET", `/api/run-status?job=${encodeURIComponent(job)}`, { as: "owner" }));
    assert.equal(st1.status, "running");
    assert.equal(typeof st1.elapsed, "number");
    await waitFor(async () => (await json(await b.http("GET", `/api/run-status?job=${job}`, { as: "owner" }))).tail.includes("working"));
    const active = await json(await b.http("GET", "/api/jobs/active", { as: "owner" }));
    assert.equal(active.jobs.length, 1);
    assert.equal(active.jobs[0].jobId, job);
    assert.equal(active.jobs[0].id, "bp-digest");
    g.release();
    const done = await waitFor(async () => { const s = await json(await b.http("GET", `/api/run-status?job=${job}`, { as: "owner" })); return s.status !== "running" ? s : null; });
    assert.equal(done.status, "done");
    assert.equal(done.code, 0);
    assert.match(done.report, /^bp-digest-\d{8}-\d{4}\.html$/);
    assert.ok(existsSync(join(b.vault, "Dashboard", "artifacts", done.report)));
    assert.equal((await json(await b.http("GET", "/api/jobs/active", { as: "owner" }))).jobs.length, 0);
    const skills = await json(await b.http("GET", "/api/skills", { as: "owner" }));
    assert.equal(skills.runs[0].id, "bp-digest");
  } finally { g.release(); b.cleanup(); }
});

test("run rejects an unknown skill with the kit's error text; free-text input is passed to the engine, never a shell", async () => {
  const g = gatedRunTurn(); g.release();
  const b = await bootAsOwner({ runTurn: g.runTurn });
  try {
    const bad = await b.http("POST", "/api/run", { as: "owner", body: { id: "rm -rf" } });
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: "unknown skill" });
    const evil = 'Acme"; $(touch /tmp/pwned) `x`';
    const { job } = await (await b.http("POST", "/api/run", { as: "owner", body: { id: "bp-digest", input: evil } })).json();
    await waitFor(() => g.calls.length === 1);
    assert.equal(g.calls[0].prompt, `/bp-digest ${evil}`);
    await waitFor(async () => (await json(await b.http("GET", `/api/run-status?job=${job}`, { as: "owner" }))).status === "done");
  } finally { b.cleanup(); }
});

test("artifacts: the ring's balls in the kit shape; artifact-remove moves a file to _trash", async () => {
  const b = await bootAsOwner();
  try {
    const d = await json(await b.http("GET", "/api/artifacts", { as: "owner" }));
    assert.equal(d.count, d.artifacts.length);
    const a = d.artifacts.find((x) => x.file === "sample-report.html");
    assert.ok(a);
    for (const k of ["title", "icon", "kind", "note", "svg", "category", "created", "modified", "url"]) assert.ok(k in a, k);
    const rm = await b.http("POST", "/api/artifact-remove", { as: "owner", body: { file: "sample-report.html" } });
    assert.equal(rm.status, 200);
    assert.deepEqual(await rm.json(), { ok: true });
    const dir = join(b.vault, "Dashboard", "artifacts");
    assert.ok(existsSync(join(dir, "_trash", "sample-report.html")));
    assert.ok(!existsSync(join(dir, "sample-report.html")));
    const bad = await b.http("POST", "/api/artifact-remove", { as: "owner", body: { file: "../../etc/passwd" } });
    assert.equal(bad.status, 400);
    assert.ok((await bad.json()).error);
  } finally { b.cleanup(); }
});

test("assets: kit fields on the listing; scan stores the expiry the engine reads", async () => {
  const seen = [];
  async function* runTurn({ prompt, options }) {
    seen.push({ prompt, options });
    yield { type: "text", delta: 'Sure. {"expires":"2027-01-31"}' };
    yield { type: "done", text: 'Sure. {"expires":"2027-01-31"}', stats: {} };
  }
  const b = await bootAsOwner({ runTurn });
  try {
    const root = join(b.home, "business-assets");
    mkdirSync(join(root, "Licenses"), { recursive: true });
    writeFileSync(join(root, "Licenses", "contractor.pdf"), "%PDF-1.4 test");
    writeFileSync(join(root, "Licenses", "plan.dwg"), "x");
    writeFileSync(join(root, "loose.txt"), "hello");
    const d = await json(await b.http("GET", "/api/assets", { as: "owner" }));
    assert.equal(d.reminderDays, 30);
    const pdf = d.files.find((f) => f.name === "contractor.pdf");
    assert.equal(pdf.scannable, true);
    assert.equal(pdf.expires, null);
    assert.equal(d.files.find((f) => f.name === "plan.dwg").scannable, false);
    assert.ok(d.categories.some((c) => c.name === "Uncategorized" && c.count === 1));

    const scan = await json(await b.http("POST", "/api/assets/scan", { as: "owner", body: { id: pdf.id } }));
    assert.deepEqual(scan, { id: pdf.id, expires: "2027-01-31", scanStatus: "found" });
    assert.equal(seen.length, 1);
    assert.ok(seen[0].prompt.includes(join(root, "Licenses", "contractor.pdf")));
    assert.deepEqual(seen[0].options.tools, ["Read"]);
    // the SDK auto-approves Read without calling canUseTool (src/chat/options.js), so a PreToolUse hook enforces the scope
    const hook = seen[0].options.hooks.PreToolUse[0].hooks[0];
    const pre = (tool_name, tool_input) => hook({ hook_event_name: "PreToolUse", tool_name, tool_input });
    assert.deepEqual(await pre("Read", { file_path: join(root, "Licenses", "contractor.pdf") }), {});
    for (const [tool, input] of [["Read", { file_path: join(root, "loose.txt") }], ["Read", { file_path: "/etc/passwd" }], ["Read", { file_path: join(root, "Licenses", "..", "loose.txt") }], ["Read", {}], ["Bash", { command: "ls" }], ["Glob", { pattern: "*" }]]) {
      const r = await pre(tool, input);
      assert.equal(r.hookSpecificOutput?.permissionDecision, "deny", `${tool} ${JSON.stringify(input)}`);
    }
    // relative paths resolve against the assets root, not the process cwd
    assert.deepEqual(await pre("Read", { file_path: join("Licenses", "contractor.pdf") }), {});
    assert.equal((await pre("Read", { file_path: "contractor.pdf" })).hookSpecificOutput?.permissionDecision, "deny");
    assert.equal(await seen[0].options.canUseTool("Read", { file_path: "/etc/passwd" }).then((r) => r.behavior), "deny");
    const after = await json(await b.http("GET", "/api/assets", { as: "owner" }));
    assert.equal(after.files.find((f) => f.id === pdf.id).expires, "2027-01-31");

    const dwg = d.files.find((f) => f.name === "plan.dwg");
    assert.deepEqual(await json(await b.http("POST", "/api/assets/scan", { as: "owner", body: { id: dwg.id } })), { id: dwg.id, scanStatus: "unsupported" });
    assert.equal(seen.length, 1, "unsupported types never reach the engine");

    // remind: needs a date, and Google Calendar is not wired
    const noDate = await b.http("POST", "/api/assets/remind", { as: "owner", body: { id: dwg.id } });
    assert.equal(noDate.status, 400);
    const rem = await b.http("POST", "/api/assets/remind", { as: "owner", body: { id: pdf.id } });
    assert.equal(rem.status, 501);
    assert.match((await rem.json()).error, /calendar/i);
  } finally { b.cleanup(); }
});

test("endpoints the synced page no longer calls are gone (no chat bar; logout uses /api/me + /api/logout; documents open via /assets/file)", async () => {
  const b = await bootAsOwner();
  try {
    for (const [m, p] of [["GET", "/api/account"], ["POST", "/api/account/login"], ["POST", "/api/account/logout"], ["POST", "/api/assets/open"], ["POST", "/api/chat"], ["POST", "/api/chat/stop"], ["POST", "/api/chat/render"]]) {
      const r = await b.http(m, p, { as: "owner", body: m === "POST" ? {} : undefined });
      assert.equal(r.status, 404, `${m} ${p}`);
      await r.arrayBuffer();
    }
    assert.equal((await b.http("GET", "/api/me", { as: "owner" })).status, 200, "still signed in");
  } finally { b.cleanup(); }
});

test("/widgets (the kit's widget library) is owner-only", async () => {
  const b = await bootAsOwner();
  try {
    const own = await requestAs(b.server, b.jar, "owner", "GET", "/widgets");
    assert.equal(own.status, 200);
    assert.match(await own.text(), /Widget Library/);
    const staff = await requestAs(b.server, b.jar, "staff", "GET", "/widgets");
    assert.equal(staff.status, 302);
    const anon = await requestAs(b.server, b.jar, "anon", "GET", "/widgets");
    assert.equal(anon.status, 302);
  } finally { b.cleanup(); }
});

// ---- /api/apps (SHOP APPS widget rows) ----
test("apps: default is the single Second Brain row; everyone signed in can read", async () => {
  const b = await bootAsOwner();
  try {
    for (const as of ["owner", "staff"]) {
      const d = await json(await b.http("GET", "/api/apps", { as }));
      assert.deepEqual(d.apps, [{ id: "sbRow", name: "Second Brain", sub: "Your whole workspace as a living map", url: "/brain", icon: "brain" }]);
    }
    assert.equal((await requestAs(b.server, b.jar, "anon", "GET", "/api/apps")).status, 401);
  } finally { b.cleanup(); }
});

test("apps: owner replaces the list; it persists to Dashboard/apps.json and reads back", async () => {
  const b = await bootAsOwner();
  try {
    const apps = [
      { id: "sbRow", name: "Second Brain", sub: "notes", url: "/brain", icon: "brain" },
      { id: "quotes", name: "Quotes", sub: "Estimates & invoices", url: "http://127.0.0.1:5055/", icon: "docs" },
      { id: "crm", name: "CRM", sub: "", url: "https://crm.example.com/app", icon: "links" },
    ];
    const put = await b.http("POST", "/api/apps", { as: "owner", body: { apps } });
    assert.equal(put.status, 200);
    assert.deepEqual((await put.json()).apps, apps);
    assert.deepEqual(JSON.parse(readFileSync(join(b.vault, "Dashboard", "apps.json"), "utf8")), apps);
    assert.deepEqual((await json(await b.http("GET", "/api/apps", { as: "staff" }))).apps, apps);
    // a bare array is accepted too, and an empty list is a valid "no apps"
    assert.equal((await b.http("POST", "/api/apps", { as: "owner", body: [] })).status, 200);
    assert.deepEqual((await json(await b.http("GET", "/api/apps", { as: "owner" }))).apps, []);
  } finally { b.cleanup(); }
});

test("apps: write is owner-only and validates every field", async () => {
  const b = await bootAsOwner();
  try {
    const ok = { id: "a1", name: "A", sub: "s", url: "https://a.example.com", icon: "docs" };
    assert.equal((await requestAs(b.server, b.jar, "anon", "POST", "/api/apps", { apps: [ok] })).status, 401);
    assert.equal((await requestAs(b.server, b.jar, "staff", "POST", "/api/apps", { apps: [ok] })).status, 403);
    const bad = [
      { ...ok, url: "javascript:alert(1)" }, { ...ok, url: "//evil.example.com" }, { ...ok, url: "file:///etc/passwd" },
      { ...ok, url: "data:text/html,x" }, { ...ok, icon: "nope" }, { ...ok, icon: undefined },
      { ...ok, id: "has space" }, { ...ok, id: "" }, { ...ok, name: "" }, { ...ok, name: "x".repeat(81) },
      { ...ok, sub: "x".repeat(121) }, { ...ok, name: 5 },
    ];
    for (const row of bad) {
      const r = await b.http("POST", "/api/apps", { as: "owner", body: { apps: [row] } });
      assert.equal(r.status, 400, JSON.stringify(row));
      assert.ok((await r.json()).error);
    }
    assert.equal((await b.http("POST", "/api/apps", { as: "owner", body: { apps: [ok, { ...ok }] } })).status, 400, "duplicate ids");
    assert.equal((await b.http("POST", "/api/apps", { as: "owner", body: { apps: Array.from({ length: 25 }, (_, i) => ({ ...ok, id: "a" + i })) } })).status, 400, "too many");
    assert.equal((await b.http("POST", "/api/apps", { as: "owner", body: { apps: "x" } })).status, 400);
    assert.ok(!existsSync(join(b.vault, "Dashboard", "apps.json")), "nothing written by rejected requests");
  } finally { b.cleanup(); }
});

test("apps: a hand-edited or corrupt apps.json never breaks the widget (bad rows are dropped, corrupt file = default)", async () => {
  const b = await bootAsOwner();
  try {
    mkdirSync(join(b.vault, "Dashboard"), { recursive: true });
    writeFileSync(join(b.vault, "Dashboard", "apps.json"), JSON.stringify([{ id: "x", name: "X", sub: "", url: "javascript:1", icon: "docs" }, { id: "y", name: "Y", sub: "", url: "http://localhost:9/", icon: "docs" }]));
    assert.deepEqual((await json(await b.http("GET", "/api/apps", { as: "owner" }))).apps.map((a) => a.id), ["y"]);
    writeFileSync(join(b.vault, "Dashboard", "apps.json"), "{not json");
    assert.equal((await json(await b.http("GET", "/api/apps", { as: "owner" }))).apps[0].id, "sbRow");
  } finally { b.cleanup(); }
});

test("apps: the icon allowlist is exactly the sprite names the kit page defines", async () => {
  const { APP_ICONS } = await import("../src/apps.js");
  const html = readFileSync(join(import.meta.dirname, "..", "public", "owner.html"), "utf8");
  const a = html.indexOf("const ICS = {"), z = html.indexOf("\n};", a);
  const keys = new Set([...html.slice(a, z).matchAll(/(?:^|\n)\s*(\w+)\s*:\s*\[/g)].map((m) => m[1]));
  for (const k of APP_ICONS) assert.ok(keys.has(k), `${k} is a kit sprite`);
  assert.equal(APP_ICONS.length, 11);
});

test("/notes: the product's notes viewer as a plain page, any signed-in role", async () => {
  const b = await bootAsOwner();
  try {
    for (const role of ["owner", "staff"]) {
      const r = await requestAs(b.server, b.jar, role, "GET", "/notes");
      assert.equal(r.status, 200, role);
      const html = await r.text();
      assert.match(html, /id="notes-root"/);
      assert.match(html, /\/static\/js\/notes\.js/);
    }
    assert.equal((await requestAs(b.server, b.jar, "anon", "GET", "/notes")).status, 302);
  } finally { b.cleanup(); }
});

// ---- the kit renders feed fields as HTML: the compat handlers escape them ----
const XSS = '<script>alert(1)</script><img src=x onerror=alert(1)>"\'&';
test("stats: every string is HTML-escaped (only <br> in cap survives); /api/snapshots/stats is left alone", async () => {
  const b = await bootAsOwner();
  try {
    const snap = join(b.vault, "Dashboard", "snapshots");
    mkdirSync(snap, { recursive: true });
    const feed = { title: XSS, asOf: XSS, mock: true, metrics: [{ big: XSS, cap: "gross<br>profit " + XSS, extra: { deep: [XSS] } }, { big: 7, cap: "a<br><br>b<br/>c<BR>" }] };
    writeFileSync(join(snap, "stats.json"), JSON.stringify(feed));
    const d = await json(await b.http("GET", "/api/stats", { as: "owner" }));
    const text = JSON.stringify(d);
    assert.doesNotMatch(text, /<script|<img|onerror=alert\(1\)>|<\/script/);
    assert.equal(d.title, "&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;");
    assert.match(d.metrics[0].cap, /^gross<br>profit &lt;script&gt;/);
    assert.equal(d.metrics[0].extra.deep[0], d.title);
    assert.equal(d.metrics[1].big, 7);
    assert.equal(d.metrics[1].cap, "a<br><br>b&lt;br/&gt;c&lt;BR&gt;", "only the exact <br> is restored");
    assert.equal(d.mock, true);
    const raw = await json(await b.http("GET", "/api/snapshots/stats", { as: "owner" }));
    assert.equal(raw.title, XSS, "the plain snapshot route is unchanged");
  } finally { b.cleanup(); }
});

test("routines: strings escaped, src/key restricted to [a-z0-9_-], t to HH:MM, invalid rows dropped", async () => {
  const b = await bootAsOwner();
  try {
    const snap = join(b.vault, "Dashboard", "snapshots");
    mkdirSync(snap, { recursive: true });
    writeFileSync(join(snap, "routines.json"), JSON.stringify({
      generated: XSS, counts: { desktop: 3 },
      sources: [{ key: "desktop", label: XSS }, { key: '"><script>', label: "bad" }, { key: "server", label: "Server" }],
      routines: [
        { t: "07:00", d: "daily", src: "desktop", n: XSS, desc: XSS },
        { t: "7:00", d: "daily", src: "desktop", n: "bad time" },
        { t: "07:00<i>", d: "daily", src: "desktop", n: "bad time 2" },
        { t: "08:00", d: "daily", src: '"><img src=x onerror=alert(1)>', n: "bad src" },
        { t: "09:00", d: "daily", n: "no src" },
        "not an object",
        { t: "18:30", d: "mon", src: "server", n: "backup", est: true },
      ],
    }));
    const d = await json(await b.http("GET", "/api/routines", { as: "owner" }));
    assert.doesNotMatch(JSON.stringify(d), /<script|<img|<i>|onerror=alert\(1\)>/);
    assert.deepEqual(d.routines.map((r) => r.t + r.src), ["07:00desktop", "18:30server"]);
    assert.equal(d.routines[0].n, "&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;");
    assert.equal(d.routines[1].est, true);
    assert.deepEqual(d.sources.map((s) => s.key), ["desktop", "server"]);
    assert.equal(d.counts.desktop, 3);
    assert.doesNotMatch(d.generated, /</);
    const raw = await json(await b.http("GET", "/api/snapshots/routines", { as: "owner" }));
    assert.equal(raw.routines.length, 7, "the plain snapshot route is unchanged");
  } finally { b.cleanup(); }
});

test("/artifacts/<file>: reports still display inline but under a CSP sandbox that gives scripts no access to the dashboard origin", async () => {
  const b = await bootAsOwner();
  try {
    const res = await fetch(`${b.url}/artifacts/sample-report.html`, { headers: { cookie: b.jar.owner } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/html/);
    assert.equal(res.headers.get("content-disposition"), null, "stays inline");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    const csp = res.headers.get("content-security-policy");
    assert.match(csp, /^sandbox /);
    assert.match(csp, /allow-scripts/);
    assert.doesNotMatch(csp, /allow-same-origin/, "an artifact must not run as the dashboard's origin");
  } finally { b.cleanup(); }
});

test("a malformed or oversized JSON body is a 400, never silently treated as {}", async () => {
  const b = await bootAsOwner();
  try {
    const raw = (path, payload) => fetch(b.url + path, { method: "POST", headers: { cookie: b.jar.owner, origin: b.url, "content-type": "application/json" }, body: payload });
    for (const path of ["/api/run", "/api/artifact-remove", "/api/apps", "/api/assets/scan"]) {
      const bad = await raw(path, "{not json");
      assert.equal(bad.status, 400, path);
      assert.deepEqual(await bad.json(), { error: "bad request body" });
    }
    const big = await raw("/api/run", JSON.stringify({ id: "x".repeat(1_100_000) }));
    assert.equal(big.status, 400);
    await big.arrayBuffer();
  } finally { b.cleanup(); }
});

test("run validates model and effort against the kit's lists", async () => {
  const g = gatedRunTurn(); g.release();
  const b = await bootAsOwner({ runTurn: g.runTurn });
  try {
    for (const bad of [{ model: "GPT9" }, { effort: "ULTRA" }, { model: 3 }, { model: "sonnet; rm -rf" }]) {
      const r = await b.http("POST", "/api/run", { as: "owner", body: { id: "bp-digest", ...bad } });
      assert.equal(r.status, 400, JSON.stringify(bad));
      assert.match((await r.json()).error, /model|effort/);
    }
    assert.equal(g.calls.length, 0);
    const ok = await b.http("POST", "/api/run", { as: "owner", body: { id: "bp-digest", model: "haiku", effort: "low" } });
    assert.equal(ok.status, 200, "case-insensitive");
  } finally { b.cleanup(); }
});

test("JobStore: unique ids, at most 50 kept, finished jobs older than an hour pruned, running jobs never pruned", async () => {
  const { JobStore } = await import("../src/kit-compat/jobs.js");
  async function* quick() { yield { type: "done", text: "ok", stats: {} }; }
  const vault = mkdtempSync(join(tmpdir(), "jobs-"));
  try {
    const store = new JobStore();
    const ids = new Set();
    for (let i = 0; i < 60; i++) ids.add(store.start({ vaultPath: vault, skillId: "bp-digest", runTurn: quick, audit: { log() {} } }).jobId);
    assert.equal(ids.size, 60, "ids are unique even within one millisecond");
    for (const id of ids) assert.match(id, /^bp-digest-[0-9a-f-]{36}$/);
    await waitFor(() => [...store.jobs.values()].every((j) => j.status !== "running"), 10000);
    store.prune();
    assert.ok(store.jobs.size <= 50, `kept ${store.jobs.size}`);
    const old = [...store.jobs.values()][0]; old.ended = Date.now() - 2 * 3600_000;
    const running = { jobId: "r", status: "running", started: Date.now() - 5 * 3600_000, ended: null };
    store.jobs.set("r", running);
    store.prune();
    assert.ok(!store.jobs.has(old.jobId));
    assert.ok(store.jobs.has("r"));
  } finally { rmSync(vault, { recursive: true, force: true }); }
});

test("feeds: __proto__/constructor/prototype keys and a routine without a string d are dropped", async () => {
  const b = await bootAsOwner();
  try {
    const snap = join(b.vault, "Dashboard", "snapshots"); mkdirSync(snap, { recursive: true });
    writeFileSync(join(snap, "routines.json"), `{"sources":[{"key":"__proto__"},{"key":"constructor"},{"key":"prototype"},{"key":"ok"}],"routines":[
      {"t":"07:00","d":"daily","src":"__proto__","n":"a"},{"t":"07:00","d":"daily","src":"constructor","n":"b"},{"t":"07:00","d":5,"src":"ok","n":"c"},{"t":"07:00","src":"ok","n":"d"},{"t":"07:00","d":"daily","src":"ok","n":"e"}]}`);
    const d = await json(await b.http("GET", "/api/routines", { as: "owner" }));
    assert.deepEqual(d.sources.map((s) => s.key), ["ok"]);
    assert.deepEqual(d.routines.map((r) => r.n), ["e"]);
  } finally { b.cleanup(); }
});

test("scan: engine failures go to the audit trail, not nowhere", async () => {
  async function* runTurn() { throw new Error("engine exploded"); }
  const b = await bootAsOwner({ runTurn });
  try {
    const root = join(b.home, "business-assets"); mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "a.pdf"), "%PDF");
    const { files } = await json(await b.http("GET", "/api/assets", { as: "owner" }));
    const r = await json(await b.http("POST", "/api/assets/scan", { as: "owner", body: { id: files[0].id } }));
    assert.equal(r.scanStatus, "error");
    assert.match(readFileSync(join(b.home, "activity.jsonl"), "utf8"), /assets\.scan\.error.*engine exploded/);
  } finally { b.cleanup(); }
});
