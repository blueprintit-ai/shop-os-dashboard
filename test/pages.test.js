import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, cpSync, rmSync } from "node:fs";
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
    body: JSON.stringify({ displayName: "Glenn", username: "glenn", password: "longenough1" }),
  });
  const cookie = setup.headers.get("set-cookie").split(";")[0];
  return {
    base, cookie,
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

test("GET /owner serves owner.html, not employee.html", async () => {
  const { base, cookie, cleanup } = await bootAsOwner();
  try {
    const res = await fetch(`${base}/owner`, { headers: { cookie } });
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.match(body, /id="ring-root"/); // owner.html marker, absent from employee.html
    assert.doesNotMatch(body, /data-tab="chat"/); // employee.html's tab markup
  } finally {
    cleanup();
  }
});
