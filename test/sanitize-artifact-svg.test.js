import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { sanitizeArtifactSvg } from "../public/js/owner/sanitize-svg.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
const DOMParserImpl = dom.window.DOMParser;
const docImpl = dom.window.document;
const run = (svg) => sanitizeArtifactSvg(svg, DOMParserImpl, docImpl);

// ring.js's sanitizeArtifactSvg() previously pattern-matched the raw SVG
// string with regexes. That approach had a real bypass: /\son\w+\s*=/i
// requires literal whitespace right before the attribute name, but
// `<image/onerror=alert(1)>` (a `/` immediately after the tag name, no
// whitespace) is the well-known <svg/onload=...>-style filter-evasion
// syntax (PortSwigger's XSS cheat sheet / OWASP) and still yields a working
// onerror handler once a browser tokenizes it. These tests prove the
// rewritten, DOM-parse-and-allowlist version actually neutralizes it -- and
// that legitimate glyphs still survive.

test("a legitimate glyph (bare path, no fill/stroke) passes through with its geometry intact", () => {
  // Re-serialized through the real HTML document (see sanitize-svg.js's own
  // comment), so a self-closing "/>" becomes an explicit "></path>" -- the
  // same, standards-conformant thing every browser's own innerHTML getter
  // does for foreign (SVG) elements. Parses to an identical DOM either way.
  const out = run('<path d="M26 8L14 27h8l-2 13 12-19h-8l2-13z"/>');
  assert.equal(out, '<path d="M26 8L14 27h8l-2 13 12-19h-8l2-13z"></path>');
});

test("a multi-path glyph using the built-in ART_GLYPH shape vocabulary survives", () => {
  const out = run('<rect x="8" y="12" width="32" height="22" rx="3"/><path d="M24 34v6M16 40h16"/>');
  assert.equal(out, '<rect x="8" y="12" width="32" height="22" rx="3"></rect><path d="M24 34v6M16 40h16"></path>');
});

test("the slash-instead-of-whitespace onerror bypass is neutralized", () => {
  const out = run("<image/onerror=alert(1)>");
  assert.doesNotMatch(out, /onerror/i);
  assert.doesNotMatch(out, /<image/i);
});

test("a plain <script> payload is rejected outright", () => {
  const out = run('<path d="M1 1"/><script>alert(1)</script>');
  assert.equal(out, "");
});

test("<foreignObject> is rejected outright", () => {
  const out = run('<foreignObject><body xmlns="http://www.w3.org/1999/xhtml">x</body></foreignObject>');
  assert.equal(out, "");
});

test("an href=javascript: attribute is stripped from an otherwise-allowed element", () => {
  const out = run('<rect x="0" y="0" width="10" height="10" href="javascript:alert(1)"/>');
  assert.doesNotMatch(out, /javascript:/i);
  assert.doesNotMatch(out, /href/i);
  assert.match(out, /<rect/);
});

test("a plain on* handler attribute (the original regex's own target case) is still stripped", () => {
  const out = run('<rect x="0" y="0" width="10" height="10" onclick="alert(1)"/>');
  assert.doesNotMatch(out, /onclick/i);
});

test("malformed/unparsable markup falls back to an empty string", () => {
  assert.equal(run("<path d=unterminated"), "");
});

test("falsy input is returned as-is (no sidecar svg field at all)", () => {
  assert.equal(run(""), "");
  assert.equal(run(undefined), undefined);
});
