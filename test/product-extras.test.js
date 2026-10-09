// Product-only features the kit page has no UI for, restored around the (byte-identical modulo rules) kit page:
// toolbar extras (Users link, status dot, Update), a license gate, the Business Assets folder setting and the
// phone-access QR on /users.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { bootAsOwner, requestAs } from "./helpers/boot.js";
import { lanUrl } from "../public/js/lan-url.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- (a) toolbar extras ----
test("the kit page loads product-extras.js exactly once, last, and the script is served", async () => {
  const html = read("public/owner.html");
  assert.equal(html.split('<script src="/static/js/product-extras.js"></script>').length - 1, 1);
  assert.ok(html.trimEnd().endsWith('<script src="/static/js/product-extras.js"></script>\n</body>\n</html>'));
  const b = await bootAsOwner();
  try {
    const r = await requestAs(b.server, b.jar, "owner", "GET", "/static/js/product-extras.js");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /javascript/);
  } finally { b.cleanup(); }
});

const doms = [];
after(() => doms.forEach((d) => d.window.close())); // the script polls on an interval

function extrasDom({ role = "owner", status, updateOk = true } = {}) {
  const dom = new JSDOM(`<!doctype html><body><div class="tbar"><button id="editBtn"></button><button id="themeBtn"></button></div></body>`, { runScripts: "outside-only", url: "http://dash.test/owner" });
  doms.push(dom);
  const w = dom.window;
  const calls = [], toasts = [];
  w.toast = (m) => toasts.push(m);
  w.confirm = () => true;
  w.fetch = async (url, opts = {}) => {
    calls.push([opts.method || "GET", url]);
    const ok = (data, st = 200) => ({ ok: st < 400, status: st, json: async () => data });
    if (url === "/api/me") return ok({ user: { role, displayName: "G" } });
    if (url === "/api/status") return ok(status);
    if (url === "/api/update") return updateOk ? ok({ ok: true }) : ok({ error: "npm failed" }, 500);
    if (url === "/api/ping") return ok({ app: "x" });
    return ok({});
  };
  w.eval(read("public/js/product-extras.js"));
  return { dom, w, calls, toasts };
}
const goodStatus = { claude: { present: true, signedIn: "yes" }, license: { ok: true }, vault: { reachable: true }, update: { updateAvailable: false } };

test("toolbar extras: owner gets Users + status dot after the theme button; no Update control when current", async () => {
  const { w } = extrasDom({ status: goodStatus });
  await sleep(30);
  const ids = [...w.document.querySelectorAll(".tbar > *")].map((e) => e.id);
  assert.deepEqual(ids, ["editBtn", "themeBtn", "usersBtn", "statusBtn"]);
  assert.equal(w.document.getElementById("statusBtn").dataset.state, "ok");
  assert.equal(w.document.getElementById("updateBtn"), null);
});

test("toolbar extras: staff get nothing and make no status/update calls", async () => {
  const { w, calls } = extrasDom({ role: "staff", status: goodStatus });
  await sleep(30);
  assert.equal(w.document.querySelectorAll(".tbar > *").length, 2);
  assert.deepEqual(calls.map((c) => c[1]), ["/api/me"]);
});

test("toolbar extras: status dot reflects license / Claude / vault problems", async () => {
  const cases = [
    [{ ...goodStatus, license: { ok: false, error: "expired" } }, "bad"],
    [{ ...goodStatus, vault: { reachable: false } }, "bad"],
    [{ ...goodStatus, claude: { present: false, signedIn: "unknown" } }, "bad"],
    [{ ...goodStatus, claude: { present: true, signedIn: "no" } }, "bad"],
    [{ ...goodStatus, claude: { present: true, signedIn: "unknown" } }, "warn"],
  ];
  for (const [st, want] of cases) {
    const { w } = extrasDom({ status: st });
    await sleep(30);
    assert.equal(w.document.getElementById("statusBtn").dataset.state, want, JSON.stringify(st));
  }
});

test("toolbar extras: an available update shows Update; clicking it POSTs /api/update with the kit toast; a failure is reported", async () => {
  const { w, calls, toasts } = extrasDom({ status: { ...goodStatus, update: { updateAvailable: true, latest: "9.9.9" } } });
  await sleep(30);
  const btn = w.document.getElementById("updateBtn");
  assert.ok(btn, "Update control present");
  assert.equal(w.document.getElementById("statusBtn").dataset.state, "warn");
  btn.click(); await sleep(30);
  assert.ok(calls.some(([m, u]) => m === "POST" && u === "/api/update"));
  assert.ok(toasts.some((t) => /updat/i.test(t)));
  const bad = extrasDom({ status: { ...goodStatus, update: { updateAvailable: true } }, updateOk: false });
  await sleep(30);
  bad.w.document.getElementById("updateBtn").click(); await sleep(30);
  assert.ok(bad.toasts.some((t) => /npm failed|could not update/i.test(t)));
});

test("toolbar extras survive the kit rebuilding its toolbar", async () => {
  const { w } = extrasDom({ status: goodStatus });
  await sleep(30);
  w.document.querySelector(".tbar").remove();
  w.document.body.insertAdjacentHTML("beforeend", `<div class="tbar"><button id="editBtn"></button><button id="themeBtn"></button></div>`);
  await sleep(60);
  assert.deepEqual([...w.document.querySelectorAll(".tbar > *")].map((e) => e.id), ["editBtn", "themeBtn", "usersBtn", "statusBtn"]);
});

// ---- (b) license gate ----
test("a failed license check serves the license page instead of the kit pages (and the dashboard works again when it passes)", async () => {
  let ok = true; // boot (setup + staff user) needs a valid license; flip it after
  const b = await bootAsOwner({ licenseCheck: () => (ok ? { ok: true } : { ok: false, error: "License expired <b>2026-01-01</b>" }) });
  try {
    const probe = await requestAs(b.server, b.jar, "owner", "GET", "/owner"); assert.equal(probe.status, 200); await probe.arrayBuffer();
    ok = false;
    for (const path of ["/owner", "/widgets", "/assets", "/notes"]) {
      const r = await requestAs(b.server, b.jar, "owner", "GET", path);
      assert.equal(r.status, 402, path);
      const html = await r.text();
      assert.doesNotMatch(html, /id="profilePop"|id="grid"/, `${path} must not be the kit page`);
      assert.match(html, /License expired &lt;b&gt;2026-01-01&lt;\/b&gt;/, "reason shown, escaped");
      assert.match(html, /href="\/users"/);
    }
    // login, users and employee pages stay reachable
    for (const path of ["/login", "/users", "/employee"]) { const r = await requestAs(b.server, b.jar, "owner", "GET", path); assert.equal(r.status, 200, path); await r.arrayBuffer(); }
    ok = true;
    assert.equal((await requestAs(b.server, b.jar, "owner", "GET", "/owner")).status, 200);
  } finally { b.cleanup(); }
});

// ---- (c) Business Assets folder setting ----
test("settings: assetsDir must be an absolute path (or empty to reset); unknown keys are refused", async () => {
  const b = await bootAsOwner();
  try {
    const put = (body) => b.http("PUT", "/api/settings", { as: "owner", body });
    for (const bad of [{ assetsDir: "relative/dir" }, { assetsDir: "../x" }, { assetsDir: "/ok\u0000bad" }, { assetsDir: 5 }, { assetsDir: "x".repeat(600) }, { somethingElse: 1 }]) {
      const r = await put(bad); assert.equal(r.status, 400, JSON.stringify(bad)); await r.arrayBuffer();
    }
    const good = process.platform === "win32" ? "C:\\Business Assets" : "/Users/me/Business Assets";
    assert.equal((await (await put({ assetsDir: good })).json()).assetsDir, good);
    assert.equal((await (await b.http("GET", "/api/settings", { as: "owner" })).json()).assetsDir, good);
    assert.equal((await (await put({ assetsDir: "" })).json()).assetsDir, null, "empty resets to the default folder");
    assert.equal((await put({})).status, 200);
    assert.equal((await requestAs(b.server, b.jar, "staff", "PUT", "/api/settings", { assetsDir: good })).status, 403);
  } finally { b.cleanup(); }
});

test("/users carries the Business Assets folder and phone-access sections (owner page, vendored qrcode)", async () => {
  const html = read("public/users.html");
  assert.match(html, /src="\/static\/vendor\/qrcode\.min\.js"/);
  assert.match(html, /src="\/static\/js\/users-extras\.js"/);
  assert.match(html, /id="extras-root"/);
  const b = await bootAsOwner();
  try {
    assert.equal((await requestAs(b.server, b.jar, "owner", "GET", "/users")).status, 200);
    assert.equal((await requestAs(b.server, b.jar, "staff", "GET", "/users")).status, 302);
  } finally { b.cleanup(); }
});

test("assets.html says 'your Business Assets folder', not Dropbox", () => {
  assert.doesNotMatch(read("public/assets.html"), /Dropbox/);
  assert.match(read("public/assets.html"), /in your Business Assets folder\./);
});

// ---- (d) phone access ----
test("lanUrl: the first LAN address on the dashboard's port, or null when the machine has none", () => {
  assert.equal(lanUrl({ lan: ["192.168.1.20", "10.0.0.5"], port: 50000 }), "http://192.168.1.20:50000");
  assert.equal(lanUrl({ lan: [], port: 50000 }), null);
  assert.equal(lanUrl({ port: 50000 }), null);
  assert.equal(lanUrl({ lan: ["192.168.1.20"] }), null);
  assert.equal(lanUrl(null), null);
});

// ---- review round 2 ----
import { normalizeAssetsDir } from "../src/settings.js";
import { win32, posix } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

test("normalizeAssetsDir resolves what it stores: trailing slashes, forward slashes and .. segments (Windows and POSIX)", () => {
  const w = (d) => normalizeAssetsDir(d, win32, "win32");
  assert.equal(w("D:\\Business Assets\\"), "D:\\Business Assets");
  assert.equal(w("D:/Business Assets"), "D:\\Business Assets");
  assert.equal(w("D:/Business Assets/"), "D:\\Business Assets");
  assert.equal(w("D:\\x\\..\\y"), "D:\\y");
  assert.equal(w("\\\\server\\share\\Docs\\"), "\\\\server\\share\\Docs");
  for (const bad of ["\\foo", "/foo", "foo\\bar", "C:foo", "..\\x", "D:\\a\u0000b", ""]) assert.equal(w(bad), null, JSON.stringify(bad));
  const p = (d) => normalizeAssetsDir(d, posix, "linux");
  assert.equal(p("/Users/me/Business Assets/"), "/Users/me/Business Assets");
  assert.equal(p("/a/b/../c//d/"), "/a/c/d");
  assert.equal(p("/"), "/");
  for (const bad of ["rel/dir", "../x", "~/x"]) assert.equal(p(bad), null, bad);
});

test("an assets folder saved with a trailing slash or .. still works for list, open, favorite and /assets/file", async () => {
  const b = await bootAsOwner();
  try {
    const dir = join(b.home, "My Assets");
    mkdirSync(join(dir, "Docs"), { recursive: true });
    writeFileSync(join(dir, "Docs", "lease.txt"), "lease");
    for (const typed of [dir + "/", join(dir, "Docs", ".."), dir + "/./"]) {
      const saved = await (await b.http("PUT", "/api/settings", { as: "owner", body: { assetsDir: typed } })).json();
      assert.equal(saved.assetsDir, dir, `typed ${typed}`);
      const list = await (await b.http("GET", "/api/assets", { as: "owner" })).json();
      assert.equal(list.dir, dir);
      const f = list.files[0];
      assert.equal((await b.http("POST", "/api/assets/favorite", { as: "owner", body: { id: f.id, on: true } })).status, 200);
      assert.equal((await b.http("POST", "/api/assets/remind", { as: "owner", body: { id: f.id } })).status, 400, "found (no date yet), not 404");
      const file = await fetch(`${b.url}/assets/file/${f.id}`, { headers: { cookie: b.jar.owner } });
      assert.equal(await file.text(), "lease");
    }
    // a value saved by an earlier version (unnormalized, straight in settings.json) is covered too
    b.server.ctx.settingsStore.save({ assetsDir: dir + "/" });
    const list = await (await b.http("GET", "/api/assets", { as: "owner" })).json();
    assert.equal(list.files.length, 1);
    assert.equal((await b.http("POST", "/api/assets/favorite", { as: "owner", body: { id: list.files[0].id, on: true } })).status, 200);
  } finally { b.cleanup(); }
});

test("settings: sessionCap and portOverride are type-checked", async () => {
  const b = await bootAsOwner();
  try {
    const put = (body) => b.http("PUT", "/api/settings", { as: "owner", body });
    for (const bad of [{ sessionCap: "3" }, { sessionCap: 0 }, { sessionCap: 1.5 }, { sessionCap: 999 }, { sessionCap: null }, { portOverride: "50000" }, { portOverride: 80 }, { portOverride: 70000 }, { portOverride: 5000.5 }]) {
      const r = await put(bad); assert.equal(r.status, 400, JSON.stringify(bad)); await r.arrayBuffer();
    }
    assert.equal((await (await put({ sessionCap: 5, portOverride: 50005 })).json()).sessionCap, 5);
    assert.equal((await (await put({ portOverride: null })).json()).portOverride, null);
  } finally { b.cleanup(); }
});

test("license gate: owner-run pages (users, settings, status, update) keep working with a failed license; chat and kit data stay paused", async () => {
  let ok = true;
  const updates = [];
  const b = await bootAsOwner({ licenseCheck: () => (ok ? { ok: true } : { ok: false, error: "expired" }), applyUpdateImpl: (o) => { updates.push(o); return { ok: true }; } });
  try {
    ok = false;
    for (const path of ["/api/users", "/api/users/activity", "/api/users/folders", "/api/settings", "/api/status", "/api/me"]) {
      const r = await b.http("GET", path, { as: "owner" }); assert.notEqual(r.status, 402, path); assert.equal(r.status, 200, path); await r.arrayBuffer();
    }
    const up = await b.http("POST", "/api/update", { as: "owner", body: {} });
    assert.equal(up.status, 200); assert.equal(updates.length, 1);
    assert.equal((await requestAs(b.server, b.jar, "staff", "POST", "/api/update", {})).status, 403, "still owner-only");
    assert.equal((await requestAs(b.server, b.jar, "anon", "POST", "/api/update", {})).status, 401);
    assert.equal((await requestAs(b.server, b.jar, "owner", "POST", "/api/update", undefined)).status === 402, false);
    for (const path of ["/api/artifacts", "/api/stats", "/api/skills", "/api/assets"]) { const r = await b.http("GET", path, { as: "owner" }); assert.equal(r.status, 402, path); await r.arrayBuffer(); }
    const chat = await b.http("POST", "/api/chat", { as: "owner", body: { text: "hi" } }); assert.equal(chat.status, 402); await chat.arrayBuffer();
    const page = await (await requestAs(b.server, b.jar, "owner", "GET", "/owner")).text();
    assert.match(page, /Users, settings and updates still work/);
  } finally { b.cleanup(); }
});
