import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const doc = new JSDOM("<!doctype html><html><body></body></html>").window.document;
globalThis.document = doc;
const { brainSafeFragment } = await import("../public/js/brain-safe.js");
const PUB = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const render = (html) => { const box = doc.createElement("div"); box.appendChild(brainSafeFragment(html, doc)); return box; };
const out = (html) => render(html).innerHTML;

test("scripts, iframes, styles and event handlers are stripped from rendered note HTML", () => {
  const o = out('<p onclick="x()">hi</p><script>alert(1)</script><iframe src="//evil"></iframe><img src="a.png" onerror="alert(1)"><style>p{}</style><form action="/x"><button formaction="/y">b</button></form>');
  assert.doesNotMatch(o, /<script|<iframe|<style|<form|onclick|onerror|formaction/i);
  assert.match(o, /<p>hi<\/p>/);
  assert.match(o, /<img src="a\.png">/);
});

test("<a href=javascript:> and <img src=x onerror> are inert", () => {
  assert.doesNotMatch(out('<a href="javascript:alert(1)">x</a>'), /javascript:/i);
  assert.doesNotMatch(out('<a href="  JaVa\tScRiPt:alert(1)">x</a>'), /script:/i);
  assert.doesNotMatch(out('<img src=x onerror=alert(1)>'), /onerror/i);
  assert.doesNotMatch(out('<a href="vbscript:x">x</a>'), /vbscript/i);
  assert.doesNotMatch(out('<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>'), /data:/i);
});

test("image map bypass: <area href=javascript:> and usemap are gone", () => {
  const o = out('<img usemap="#m" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width=900 height=900><map name="m"><area href="javascript:alert(document.cookie)"></map>');
  assert.doesNotMatch(o, /<area|<map|usemap|javascript:/i);
});

test("mutation-XSS payload does not become a live element", () => {
  const box = render('<math><mtext><table><mglyph><svg><mtext><textarea><a title="</textarea><img src onerror=alert(1)>">');
  assert.equal(box.querySelectorAll("img, [onerror]").length, 0);
  assert.equal(box.querySelectorAll("math, svg, textarea").length, 0);
  assert.doesNotMatch(box.innerHTML, /onerror/i);
});

test("SVG with a script, and xlink:href javascript, are removed", () => {
  const box = render('<svg><script>alert(1)</script><a xlink:href="javascript:alert(1)"><text>x</text></a></svg><p>ok</p>');
  assert.equal(box.querySelectorAll("svg, script").length, 0);
  assert.doesNotMatch(box.innerHTML, /javascript:/i);
  assert.match(box.innerHTML, /<p>ok<\/p>/);
});

test("ordinary links, wikilink anchors and safe images survive", () => {
  const o = out('<a href="https://blueprintit.ai">ok</a> <a class="wikilink" data-target="Context/a.md">w</a> <img src="data:image/png;base64,AAAA"> <img src="/api/notes/raw?path=a.png">');
  assert.match(o, /href="https:\/\/blueprintit\.ai"/);
  assert.match(o, /data-target="Context\/a\.md"/);
  assert.match(o, /src="data:image\/png;base64,AAAA"/);
  assert.match(o, /src="\/api\/notes\/raw\?path=a\.png"/);
  assert.doesNotMatch(out('<img src="data:image/svg+xml;base64,AAAA">'), /data:/);
});

test("the viewer escapes every < in the note before markdown runs (like src/notes/render.js)", () => {
  const core = readFileSync(join(PUB, "brain", "_core.js"), "utf8");
  assert.match(core, /resolveWikilinks\(d\.content\.replace\(\/<\/g, '&lt;'\), path\)/);
  assert.doesNotMatch(core, /body\.innerHTML = '<div class="md-body">'/);
});

test("notes.js opens ?path= deep links", () => {
  const js = readFileSync(join(PUB, "js", "notes.js"), "utf8");
  assert.match(js, /URLSearchParams\(location\.search\)\.get\("path"\)/);
  assert.match(js, /if \(deepLink\) openNote\(deepLink\)/);
});
