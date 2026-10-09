import { test } from "node:test";
import assert from "node:assert/strict";
import { bootAsOwner, requestAs } from "./helpers/boot.js";
import { staffUrl, buildStaffShortcut } from "../src/lib/staff-shortcut.js";

const boot = (o = {}) => bootAsOwner({ lanImpl: () => ["192.168.1.20", "10.0.0.5"], port: 50003, ...o });
const get = (b, role, q) => requestAs(b.server, b.jar, role, "GET", `/api/users/staff-shortcut${q}`);

test("builders: exact bytes for .url, .webloc and the text file", () => {
  const u = "http://192.168.1.20:50003/employee";
  assert.equal(staffUrl("192.168.1.20", 50003), u);
  const url = buildStaffShortcut("url", u);
  assert.equal(url.fileName, "Blueprint OS Staff Chat.url");
  assert.equal(url.body, "[InternetShortcut]\r\nURL=http://192.168.1.20:50003/employee\r\nIconIndex=0\r\n");
  const wl = buildStaffShortcut("webloc", u);
  assert.equal(wl.fileName, "Blueprint OS Staff Chat.webloc");
  assert.equal(wl.body, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n\t<key>URL</key>\n\t<string>http://192.168.1.20:50003/employee</string>\n</dict>\n</plist>\n`);
  const bm = buildStaffShortcut("bookmark", u);
  assert.equal(bm.fileName, "Blueprint OS Staff Chat.txt");
  assert.equal(bm.body, "http://192.168.1.20:50003/employee\n");
  assert.equal(buildStaffShortcut("pdf", u), null);
});

test("builders: the webloc escapes XML-significant characters in the URL", () => {
  const wl = buildStaffShortcut("webloc", "http://h:1/employee?a=1&b=<2>\"'");
  assert.ok(wl.body.includes("<string>http://h:1/employee?a=1&amp;b=&lt;2&gt;&quot;&apos;</string>"));
});

test("GET /api/users/staff-shortcut?format=url returns the exact .url file as an attachment", async () => {
  const b = await boot();
  try {
    const r = await get(b, "owner", "?format=url");
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-disposition"), 'attachment; filename="Blueprint OS Staff Chat.url"');
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(await r.text(), "[InternetShortcut]\r\nURL=http://192.168.1.20:50003/employee\r\nIconIndex=0\r\n");
  } finally { b.cleanup(); }
});

test("GET /api/users/staff-shortcut: webloc and bookmark formats", async () => {
  const b = await boot();
  try {
    const w = await get(b, "owner", "?format=webloc");
    assert.equal(w.status, 200);
    assert.equal(w.headers.get("content-disposition"), 'attachment; filename="Blueprint OS Staff Chat.webloc"');
    assert.equal(w.headers.get("x-content-type-options"), "nosniff");
    const text = await w.text();
    assert.ok(text.includes("<string>http://192.168.1.20:50003/employee</string>"));
    assert.ok(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    const t = await get(b, "owner", "?format=bookmark");
    assert.equal(t.status, 200);
    assert.equal(t.headers.get("content-disposition"), 'attachment; filename="Blueprint OS Staff Chat.txt"');
    assert.match(t.headers.get("content-type"), /^text\/plain/);
    assert.equal(await t.text(), "http://192.168.1.20:50003/employee\n");
  } finally { b.cleanup(); }
});

test("the file holds the URL only: no tokens, no cookie, no owner data", async () => {
  const b = await boot();
  try {
    for (const f of ["url", "webloc", "bookmark"]) {
      const text = await (await get(b, "owner", `?format=${f}`)).text();
      for (const secret of [b.jar.owner.split("=")[1], b.vault, b.home, "pat", "Pat"]) assert.ok(!text.includes(secret), `${f} leaks ${secret}`);
      assert.deepEqual([...text.matchAll(/https?:\/\/[^\s<"]+/g)].map((m) => m[0]).filter((u) => !u.includes("apple.com")), ["http://192.168.1.20:50003/employee"]);
    }
  } finally { b.cleanup(); }
});

test("owner-only: anonymous gets 401, staff gets 403, for every format", async () => {
  const b = await boot();
  try {
    for (const f of ["url", "webloc", "bookmark"]) {
      assert.equal((await get(b, "anon", `?format=${f}`)).status, 401, f);
      assert.equal((await get(b, "staff", `?format=${f}`)).status, 403, f);
    }
  } finally { b.cleanup(); }
});

test("bad or missing format is 400; no network address is 409; falls back to the request's port when the server has none", async () => {
  const b = await boot();
  try {
    assert.equal((await get(b, "owner", "")).status, 400);
    assert.equal((await get(b, "owner", "?format=exe")).status, 400);
  } finally { b.cleanup(); }
  const none = await boot({ lanImpl: () => [] });
  try {
    const r = await get(none, "owner", "?format=url");
    assert.equal(r.status, 409);
    assert.match((await r.json()).error, /network/i);
  } finally { none.cleanup(); }
  const noPort = await boot({ port: null });
  try {
    const r = await get(noPort, "owner", "?format=bookmark");
    assert.equal(await r.text(), `http://192.168.1.20:${noPort.server.address().port}/employee\n`);
  } finally { noPort.cleanup(); }
});

test("license gate: like the other /api/users routes, it keeps working with a failed license", async () => {
  const b = await boot({ licenseCheck: () => ({ ok: false, error: "expired" }) });
  try {
    assert.equal((await b.http("GET", "/api/users", { as: "owner" })).status, 200);
    assert.equal((await get(b, "owner", "?format=url")).status, 200);
    assert.equal((await get(b, "staff", "?format=url")).status, 403);
    assert.equal((await get(b, "anon", "?format=url")).status, 401);
  } finally { b.cleanup(); }
});

test("/api/status and the shortcut use the same address list, so the page and the file agree", async () => {
  const b = await boot();
  try {
    const status = await (await requestAs(b.server, b.jar, "owner", "GET", "/api/status")).json();
    assert.deepEqual(status.lan, ["192.168.1.20", "10.0.0.5"]);
    assert.equal(status.port, 50003);
  } finally { b.cleanup(); }
});
