import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderNote } from "../src/notes/render.js";
import { sanitizeUrls } from "../public/js/sanitize-urls.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
const doc = dom.window.document;
const resolveLink = () => ({ href: "", exists: false });

// public/js/notes.js's openNote() interpolates note.html (server-rendered by
// src/notes/render.js) into the viewer via .innerHTML. render.js shares the
// same underlying marked link/image rendering that chat.js's renderMarkdown()
// needed sanitizeUrls() to guard -- but render.js itself has no such guard
// (it only escapes raw `<` in the source, same as chat.js's round-1 fix, and
// never got a round-2/round-3-equivalent for marked's own generated links).
// This test proves both halves of the fix: the gap is real in render.js's
// own output today, and notes.js's sanitizeUrls() call at the point of DOM
// insertion closes it.
test("a malicious markdown link in a note's rendered HTML is neutralized before DOM insertion", () => {
  const { html } = renderNote("See [click here](javascript:alert(1)) for details.", { resolveLink });

  // Confirms the gap is real in render.js today (it does not sanitize this
  // itself) -- this assertion documents why sanitizeUrls() must run at the
  // point of DOM insertion in notes.js, not that render.js's own output is
  // already safe.
  assert.match(html, /href="javascript:alert\(1\)"/);

  const safe = sanitizeUrls(html, doc);
  assert.doesNotMatch(safe, /href="javascript:/);
  assert.match(safe, /href="#"/);
});

test("a legitimate wikilink and a normal https link in note HTML survive sanitizeUrls untouched", () => {
  const resolveExisting = (target) => ({ href: `/api/notes/view?path=${encodeURIComponent(target)}.md`, exists: true });
  const { html } = renderNote("See [[Pricing Sheet]] and [our site](https://blueprintit.ai).", { resolveLink: resolveExisting });
  const safe = sanitizeUrls(html, doc);
  assert.equal(safe, html);
  assert.match(safe, /href="\/api\/notes\/view\?path=Pricing%20Sheet\.md"/);
  assert.match(safe, /href="https:\/\/blueprintit\.ai"/);
});
