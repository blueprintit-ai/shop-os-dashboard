import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { privateListMessages, mountPrivateBanner } from "../public/js/private-banner.js";

const fresh = () => { const dom = new JSDOM(`<!doctype html><section id="b" hidden></section>`); return dom.window.document.getElementById("b"); };

test("no banner when the list works and nothing was ignored", () => {
  const root = fresh();
  assert.deepEqual(mountPrivateBanner(root, { state: "ok", ignoredEntries: 0 }), []);
  assert.equal(root.hidden, true);
  assert.equal(root.innerHTML, "");
  assert.deepEqual(privateListMessages(undefined), []);
  assert.deepEqual(privateListMessages(null), []);
});

test("an unusable list with no earlier version says staff cannot open any files, in plain words", () => {
  const root = fresh();
  mountPrivateBanner(root, { state: "failClosed", ignoredEntries: 0 });
  assert.equal(root.hidden, false);
  assert.equal(root.querySelector("[role=alert]").textContent, "Your private-files list could not be read, so staff cannot open any files until it is fixed. Edit Dashboard/private-paths.json.");
});

test("a half-saved list after a good one says the previous version is in use", () => {
  const root = fresh();
  mountPrivateBanner(root, { state: "keptLastGood", ignoredEntries: 0 });
  assert.match(root.textContent, /previous version is still in use.*Dashboard\/private-paths\.json/);
});

test("ignored entries are counted, with the patterns-versus-paths hint", () => {
  const root = fresh();
  mountPrivateBanner(root, { state: "ok", ignoredEntries: 3 });
  assert.match(root.textContent, /^3 entries in your private-files list were ignored: patterns match one file or folder name, use "paths" for folders/);
  assert.match(privateListMessages({ state: "ok", ignoredEntries: 1 })[0], /^1 entry in your private-files list was ignored/);
  mountPrivateBanner(root, { state: "failClosed", ignoredEntries: 2 });
  assert.equal(root.querySelectorAll("[role=alert]").length, 2);
});

test("the /users page script mounts the banner from /api/status", () => {
  const src = readFileSync(new URL("../public/js/users-extras.js", import.meta.url), "utf8");
  assert.match(src, /id="private-banner"/);
  assert.match(src, /mountPrivateBanner\(document\.getElementById\("private-banner"\), status\?\.privateList\)/);
});
