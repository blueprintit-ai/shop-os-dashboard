import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { sanitizeUrls } from "../public/js/sanitize-urls.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
const doc = dom.window.document;

test("neutralizes a plain javascript: href", () => {
  const html = sanitizeUrls('<a href="javascript:alert(1)">click</a>', doc);
  assert.match(html, /href="#"/);
  assert.doesNotMatch(html, /href="javascript:/);
});

test("neutralizes a vbscript: href", () => {
  const html = sanitizeUrls('<a href="vbscript:alert(1)">x</a>', doc);
  assert.match(html, /href="#"/);
});

test("neutralizes data:text/html", () => {
  const html = sanitizeUrls('<a href="data:text/html,<script>alert(1)</script>">x</a>', doc);
  assert.doesNotMatch(html, /data:text\/html/);
});

test("neutralizes an entity-encoded javascript scheme (&#58; numeric)", () => {
  const html = sanitizeUrls('<a href="javascript&#58;alert(1)">x</a>', doc);
  assert.doesNotMatch(html, /href="javascript:/);
});

test("neutralizes javascript hidden behind the named entity &colon; — round 3's specific find", () => {
  const html = sanitizeUrls('<a href="javascript&colon;alert(1)">x</a>', doc);
  assert.doesNotMatch(html, /href="javascript:/);
});

test("neutralizes the scheme-splitting trick hidden behind the named entity &Tab; — round 3's specific find", () => {
  const html = sanitizeUrls('<a href="java&Tab;script:alert(1)">x</a>', doc);
  assert.doesNotMatch(html, /href="javascript:/i);
});

test("neutralizes a literal-TAB scheme-splitting attempt", () => {
  const html = sanitizeUrls('<a href="java\tscript:alert(1)">x</a>', doc);
  assert.doesNotMatch(html, /href="javascript:/i);
});

test("does NOT touch a normal https link", () => {
  const html = sanitizeUrls('<a href="https://example.com/path">x</a>', doc);
  assert.match(html, /href="https:\/\/example\.com\/path"/);
});

test("does NOT false-positive on 'javascript' appearing in a path", () => {
  const html = sanitizeUrls('<a href="https://example.com/learn-javascript">x</a>', doc);
  assert.match(html, /href="https:\/\/example\.com\/learn-javascript"/);
});

test("does NOT touch a relative link", () => {
  const html = sanitizeUrls('<a href="/api/notes/view?path=Foo.md">x</a>', doc);
  assert.match(html, /href="\/api\/notes\/view\?path=Foo\.md"/);
});

test("does NOT touch a legitimate data:image src on an img tag", () => {
  const html = sanitizeUrls('<img src="data:image/png;base64,iVBORw0KGgo=">', doc);
  assert.match(html, /src="data:image\/png;base64,iVBORw0KGgo="/);
});
