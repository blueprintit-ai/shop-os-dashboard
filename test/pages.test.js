import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../src/server.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUB = join(HERE, "..", "public");
const FIX = join(HERE, "fixtures", "vault");
const read = (f) => readFileSync(join(PUB, f), "utf8");

async function* fakeRunTurn() { yield { type: "done", text: "", stats: {} }; }

async function bootAsOwner() {
  const root = mkdtempSync(join(tmpdir(), "sod-pages-"));
  const vault = join(root, "vault"); cpSync(FIX, vault, { recursive: true });
  const server = createServer({ vaultPath: vault, homeDir: join(root, "home"), runTurn: fakeRunTurn, licenseCheck: () => ({ ok: true }) });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const setup = await fetch(`${base}/api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ displayName: "Pat", username: "pat", password: "longenough1" }),
  });
  const cookie = setup.headers.get("set-cookie").split(";")[0];
  return {
    base, cookie, vault,
    cleanup: () => { server.close(); server.ctx.index.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

test("employee page has chat and notes mounts, role attribute, and loads scripts", () => {
  const html = read("employee.html");
  assert.match(html, /data-role="__ROLE__"/);
  assert.match(html, /id="chat-root"/);
  assert.match(html, /id="notes-root"/);
  assert.match(html, /src="\/static\/vendor\/marked\.min\.js"/);
  assert.match(html, /src="\/static\/js\/chat\.js"/);
  assert.match(html, /src="\/static\/js\/notes\.js"/);
  assert.match(html, /<meta name="viewport"/);
});

test("login and setup pages post to the right endpoints", () => {
  assert.match(read("login.html"), /\/api\/login/);
  assert.match(read("login.html"), /name="remember"/);
  assert.match(read("setup.html"), /\/api\/setup/);
});

test("users page mounts the users script", () => {
  const html = read("users.html");
  assert.match(html, /id="users-root"/);
  assert.match(html, /src="\/static\/js\/users\.js"/);
});

test("no page rewrites wikilinks to obsidian://", () => {
  for (const f of ["js/chat.js", "js/notes.js"]) assert.doesNotMatch(read(f), /obsidian:\/\//);
});

test("GET /owner serves the kit page with the shop name filled in and nothing left to substitute", async () => {
  const { base, cookie, cleanup } = await bootAsOwner();
  try {
    const res = await fetch(`${base}/owner`, { headers: { cookie } });
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.match(body, /id="profilePop"/); // kit marker, absent from employee.html
    assert.doesNotMatch(body, /data-tab="chat"/); // employee.html's tab markup
    assert.match(body, /<title>Blueprint OS \u2014 Acme Cabinets<\/title>/);
    assert.doesNotMatch(body, /__SHOP_NAME(_JS)?__|__ROLE__|__THEME_CLASS__/);
  } finally {
    cleanup();
  }
});

test("the shop name is escaped for HTML and for the title widget's JS template literal", async () => {
  const { base, cookie, cleanup, vault } = await bootAsOwner();
  try {
    writeFileSync(join(vault, "Context", "organization.md"), "# Bob's <b>`${alert(1)}`\\ Cabinets\n");
    const body = await (await fetch(`${base}/owner`, { headers: { cookie } })).text();
    assert.match(body, /<title>Blueprint OS \u2014 Bob&#39;s|<title>Blueprint OS \u2014 Bob's &lt;b&gt;/);
    assert.ok(body.includes("Bob's &lt;b&gt;\\`\\${alert(1)}\\`\\\\ Cabinets <span>- Blueprint OS</span>"), "title widget heading");
  } finally {
    cleanup();
  }
});
