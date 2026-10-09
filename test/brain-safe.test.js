import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const doc = new JSDOM("<!doctype html><html><body></body></html>").window.document;
globalThis.document = doc;
const { brainSafeHtml } = await import("../public/js/brain-safe.js");
const PUB = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

test("scripts, iframes, styles and event handlers are stripped from rendered note HTML", () => {
  const out = brainSafeHtml('<p onclick="x()">hi</p><script>alert(1)</script><iframe src="//evil"></iframe><img src="a.png" onerror="alert(1)"><style>p{}</style><form action="/x"><button formaction="/y">b</button></form>', doc);
  assert.doesNotMatch(out, /<script|<iframe|<style|<form|onclick|onerror|formaction/i);
  assert.match(out, /<p>hi<\/p>/);
  assert.match(out, /<img src="a\.png">/);
});

test("javascript: links are neutralized and ordinary links survive", () => {
  const out = brainSafeHtml('<a href="javascript:alert(1)">x</a> <a href="https://blueprintit.ai">ok</a> <a class="wikilink" data-target="Context/a.md">w</a>', doc);
  assert.doesNotMatch(out, /javascript:/i);
  assert.match(out, /href="https:\/\/blueprintit\.ai"/);
  assert.match(out, /data-target="Context\/a\.md"/);
});

test("notes.js opens ?path= deep links", () => {
  const js = readFileSync(join(PUB, "js", "notes.js"), "utf8");
  assert.match(js, /searchParams|URLSearchParams\(location\.search\)\.get\("path"\)/);
  assert.match(js, /if \(deepLink\) openNote\(deepLink\)/);
});
