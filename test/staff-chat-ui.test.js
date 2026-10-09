import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { staffAddresses, staffSectionHtml, mountStaffSection } from "../public/js/staff-chat.js";
import { bootAsOwner, requestAs } from "./helpers/boot.js";

const status = { lan: ["192.168.1.20", "10.0.0.5", "172.28.80.1"], port: 50001 };
const fresh = () => { const dom = new JSDOM(`<!doctype html><section id="r"></section>`); return { dom, root: dom.window.document.getElementById("r") }; };

test("staffAddresses: best LAN address first on the server's port; others kept; null without an address or port", () => {
  assert.deepEqual(staffAddresses(status), { url: "http://192.168.1.20:50001/employee", others: ["http://10.0.0.5:50001/employee", "http://172.28.80.1:50001/employee"] });
  assert.equal(staffAddresses({ lan: [], port: 1 }).url, null);
  assert.equal(staffAddresses({ lan: ["10.0.0.1"] }).url, null);
  assert.equal(staffAddresses(null).url, null);
});

test("the section shows the big address, copy, QR, two download links, advice, sign-in note and the other addresses", () => {
  const { dom, root } = fresh();
  const drawn = [];
  const qrcode = () => ({ addData: (d) => drawn.push(d), make() {}, createSvgTag: () => '<svg viewBox="0 0 1 1"></svg>' });
  mountStaffSection(root, status, { qrcode, clipboard: { writeText: async () => {} } });
  const d = dom.window.document;
  assert.equal(d.querySelector("h2").textContent, "Staff chat on their own computers");
  assert.equal(d.getElementById("staff-url").textContent, "http://192.168.1.20:50001/employee");
  assert.equal(d.getElementById("staff-url").getAttribute("href"), "http://192.168.1.20:50001/employee");
  assert.deepEqual(drawn, ["http://192.168.1.20:50001/employee"]);
  assert.ok(d.querySelector("#staff-qr svg"));
  assert.equal(d.getElementById("staff-dl-win").getAttribute("href"), "/api/users/staff-shortcut?format=url");
  assert.equal(d.getElementById("staff-dl-mac").getAttribute("href"), "/api/users/staff-shortcut?format=webloc");
  assert.equal(d.getElementById("staff-dl-txt").getAttribute("href"), "/api/users/staff-shortcut?format=bookmark");
  assert.equal(d.getElementById("staff-advice").textContent, "Send this to your team. The address works while the shop computer is on and on the same Wi-Fi. If staff cannot connect after a router restart, ask your IT person to reserve the shop computer's address (a DHCP reservation) so it never changes.");
  assert.match(d.getElementById("staff-signin-note").textContent, /username and password you create for them on this page.*only the folders you tick/);
  const others = [...d.querySelectorAll("#staff-others a")].map((a) => a.textContent);
  assert.deepEqual(others, ["http://10.0.0.5:50001/employee", "http://172.28.80.1:50001/employee"]);
});

test("copy writes the address to the clipboard and says so; a clipboard failure is reported, not thrown", async () => {
  const { dom, root } = fresh();
  const wrote = [], toasts = [];
  mountStaffSection(root, status, { qrcode: undefined, clipboard: { writeText: async (t) => { wrote.push(t); } }, toast: (m) => toasts.push(m) });
  assert.equal(dom.window.document.getElementById("staff-qr").hidden, true, "no qrcode library: the box is hidden, the address still shows");
  dom.window.document.getElementById("staff-copy").click();
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(wrote, ["http://192.168.1.20:50001/employee"]);
  assert.deepEqual(toasts, ["Address copied."]);
  const f = fresh();
  mountStaffSection(f.root, status, { clipboard: { writeText: async () => { throw new Error("denied"); } }, toast: (m) => toasts.push(m) });
  f.dom.window.document.getElementById("staff-copy").click();
  await new Promise((r) => setTimeout(r, 10));
  assert.match(toasts.at(-1), /Could not copy/);
});

test("with no network address the section explains instead of showing a dead link, and still carries the advice", () => {
  const { dom, root } = fresh();
  mountStaffSection(root, { lan: [], port: 50000 }, {});
  const d = dom.window.document;
  assert.match(d.getElementById("staff-none").textContent, /No shop network address/);
  assert.equal(d.getElementById("staff-url"), null);
  assert.equal(d.getElementById("staff-dl-win"), null);
  assert.ok(d.getElementById("staff-advice"));
});

test("the section is wired into /users and its script is served; the download link works end to end", async () => {
  assert.match(readFileSync(new URL("../public/js/users-extras.js", import.meta.url), "utf8"), /mountStaffSection/);
  const b = await bootAsOwner({ lanImpl: () => ["192.168.1.20"], port: 50001 });
  try {
    const js = await requestAs(b.server, b.jar, "owner", "GET", "/static/js/staff-chat.js");
    assert.equal(js.status, 200);
    const { dom, root } = fresh();
    mountStaffSection(root, { lan: ["192.168.1.20"], port: 50001 }, {});
    const href = dom.window.document.getElementById("staff-dl-win").getAttribute("href");
    const r = await requestAs(b.server, b.jar, "owner", "GET", href);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-disposition"), /^attachment; filename="Blueprint OS Staff Chat\.url"$/);
    assert.match(await r.text(), /^\[InternetShortcut\]\r\nURL=http:\/\/192\.168\.1\.20:50001\/employee\r\n/);
  } finally { b.cleanup(); }
});
