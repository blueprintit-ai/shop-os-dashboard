import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeUrls } from "../public/js/sanitize-urls.js";

test("neutralizes a javascript: href", () => {
  const html = sanitizeUrls('<a href="javascript:alert(1)">click</a>');
  assert.equal(html, '<a href="#">click</a>');
});

test("neutralizes a javascript: href with embedded whitespace/tab obfuscation", () => {
  // Builds "java<TAB>script:alert(1)" -- a classic filter-bypass trick that
  // relies on browsers ignoring TAB/newline/CR anywhere in a URL when
  // sniffing its scheme.
  const html = sanitizeUrls('<a href="java\tscript:alert(1)">x</a>');
  assert.doesNotMatch(html, /script:alert/i);
});

test("neutralizes a vbscript: href", () => {
  const html = sanitizeUrls('<a href="vbscript:alert(1)">x</a>');
  assert.equal(html, '<a href="#">x</a>');
});

test("neutralizes an entity-encoded javascript scheme", () => {
  const html = sanitizeUrls('<a href="javascript&#58;alert(1)">x</a>');
  assert.doesNotMatch(html, /alert\(1\)/);
});

test("neutralizes data:text/html", () => {
  const html = sanitizeUrls('<a href="data:text/html,<script>alert(1)</script>">x</a>');
  assert.doesNotMatch(html, /data:text\/html/);
});

test("does NOT touch a normal https link", () => {
  const html = sanitizeUrls('<a href="https://example.com/path">x</a>');
  assert.equal(html, '<a href="https://example.com/path">x</a>');
});

test("does NOT touch a relative link", () => {
  const html = sanitizeUrls('<a href="/api/notes/view?path=Foo.md">x</a>');
  assert.equal(html, '<a href="/api/notes/view?path=Foo.md">x</a>');
});

test("does NOT touch a legitimate data:image src on an img tag", () => {
  const html = sanitizeUrls('<img src="data:image/png;base64,iVBORw0KGgo=">');
  assert.equal(html, '<img src="data:image/png;base64,iVBORw0KGgo=">');
});
