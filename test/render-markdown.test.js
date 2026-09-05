import { test } from "node:test";
import assert from "node:assert/strict";
import { marked } from "marked";
import { renderMarkdown } from "../public/js/render-markdown.js";

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
const parse = (s) => marked.parse(s);

test("plain markdown renders normally", () => {
  const html = renderMarkdown("**bold** and _italic_", parse, esc);
  assert.match(html, /<strong>bold<\/strong>/);
});

test("a wikilink still renders as a real clickable anchor", () => {
  const html = renderMarkdown("See [[Pricing Sheet|the pricing]] for details.", parse, esc);
  assert.match(html, /<a class="wikilink" href="#" data-target="Pricing Sheet">the pricing<\/a>/);
});

test("raw script tag in the source text never becomes a live tag", () => {
  const html = renderMarkdown("<script>alert(document.cookie)</script>", parse, esc);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("an img onerror payload echoed from note content is rendered inert", () => {
  const html = renderMarkdown('Here is what the note said: <img src=x onerror="alert(1)">', parse, esc);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test("an anchor with a javascript: href is rendered inert", () => {
  const html = renderMarkdown('<a href="javascript:alert(1)">click</a>', parse, esc);
  assert.doesNotMatch(html, /href="javascript:/);
});

test("a div with an onclick handler is rendered inert", () => {
  const html = renderMarkdown('<div onclick="alert(1)">hi</div>', parse, esc);
  // The literal text "onclick=" is expected to survive as escaped, inert
  // text content (marked additionally escapes the quote characters once the
  // leading "<" has been neutralized into "&lt;", which is exactly why the
  // handler can never re-attach to a live element) -- what must never appear
  // is an actual unescaped opening tag carrying the handler.
  assert.doesNotMatch(html, /<div[^&]*onclick=/);
  assert.match(html, /&lt;div onclick=/);
});

test("a markdown link with a javascript: scheme (no raw HTML tag involved) is rendered inert", () => {
  const html = renderMarkdown("[click me](javascript:alert(1))", parse, esc);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.match(html, /href="#"/);
});

test("a markdown image with a javascript: scheme is rendered inert", () => {
  const html = renderMarkdown("![img](javascript:alert(1))", parse, esc);
  assert.doesNotMatch(html, /src="javascript:/i);
});

test("a normal https markdown link still works", () => {
  const html = renderMarkdown("[Shop OS](https://blueprintit.ai)", parse, esc);
  assert.match(html, /href="https:\/\/blueprintit\.ai"/);
});
