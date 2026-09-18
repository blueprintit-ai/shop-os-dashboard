import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PUB = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const read = (f) => readFileSync(join(PUB, f), "utf8");

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
