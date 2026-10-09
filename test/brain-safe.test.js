import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { marked } from "marked";

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

// ---- reviewer payload corpus (round 2): the viewer pipeline = escape <, resolve wikilinks, marked, brainSafeFragment ----
function grab(core, name) {
  const i = core.indexOf("function " + name); let d = 0;
  for (let k = core.indexOf("{", i); ; k++) { if (core[k] === "{") d++; else if (core[k] === "}") { d--; if (!d) return core.slice(i, k + 1); } }
}
const coreSrc = readFileSync(join(PUB, "brain", "_core.js"), "utf8");
const S = { mdLinks: [["N/src.md", 'Folder/a"><img src=x onerror=alert(1)>.md'], ["N/src.md", "Folder/foo.md"], ["N/src.md", "Folder/java&#115;cript.md"]] };
const resolveWikilinks = new Function("S", grab(coreSrc, "escapeAttr") + grab(coreSrc, "escapeHtml") + grab(coreSrc, "resolveWikilinks") + "; return resolveWikilinks;")(S);
const pipeline = (md) => { const box = doc.createElement("div"); box.appendChild(brainSafeFragment(marked.parse(resolveWikilinks(md.replace(/</g, "&lt;"), "N/src.md")), doc)); return box; };

const ALLOWED = new Set(["p", "a", "img", "code", "pre", "em", "strong", "del", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "table", "thead", "tbody", "tr", "th", "td", "hr", "br", "span", "input"]);
const squashed = (v) => v.replace(/[\u0000-\u0020\u007f-\u009f\u00ad\u200b-\u200f\u2028\u2029\ufeff]/g, "").toLowerCase();
function problems(box, { elements = true } = {}) {
  const out = [];
  for (const el of box.querySelectorAll("*")) {
    if (elements && !ALLOWED.has(el.localName)) out.push("element " + el.localName);
    for (const a of el.attributes) {
      const v = squashed(a.value);
      if (/^on/i.test(a.name) || ["style", "srcset", "formaction", "srcdoc", "usemap"].includes(a.name)) out.push("attr " + a.name);
      if (["href", "src", "xlink:href", "action", "data", "background", "cite", "poster"].includes(a.name) && (/^(javascript|vbscript|livescript):/.test(v) || (v.startsWith("data:") && !/^data:image\/(png|gif|jpe?g|webp);/.test(v)))) out.push(a.name + "=" + a.value);
      if (a.name === "src" && /^(https?:)?\/\//.test(v)) out.push("external src " + a.value);
    }
  }
  return out;
}

const MD = {
  js: "[x](javascript:alert(1))", jsCase: "[x](JaVaScRiPt:alert(1))", jsEnt: "[x](&#106;avascript:alert(1))", jsEnt2: "[x](javascript&colon;alert(1))",
  jsTab: "[x](java\tscript:alert(1))", jsNl: "[x](java%0ascript:alert(1))", jsHexEnt: "[x](&#x6A;avascript:alert(1))", jsEntNoSemi: "[x](&#106avascript:alert(1))",
  jsLeadSpace: "[x](%20javascript:alert(1))", jsRef: "[x][r]\n\n[r]: javascript:alert(1)", jsRefEnt: "[x][r]\n\n[r]: &#x6a;avascript:alert(1)",
  vb: "[x](vbscript:msgbox)", data: "[x](data:text/html,hi)", dataImg: "![x](data:image/svg+xml,<svg onload=alert(1)>)", dataImgEnt: "![x](data&colon;text/html,x)",
  protoRel: "[x](//evil.com)", backslash: "[x](\\\\evil.com)", imgExt: "![x](https://evil.com/beacon.png)", imgProtoRel: "![x](//evil.com/b.png)", imgTitle: '![x](a.png "t" onerror=alert(1))',
  title: '[x](http://a "a\\" onmouseover=alert(1) b")', titleWiki: "[x](http://a '[[foo]]')", altWiki: "![[[foo]]](a.png)",
  wikiAlias: '[[foo|x" onmouseover="alert(1)]]', wikiAliasMd: "[[foo|[y](javascript:alert(1))]]", wikiAliasAmp: "[[foo|&lt;img src=x onerror=alert(1)&gt;]]",
  wikiTargetQuote: '[[a"><img src=x onerror=alert(1)>]]', wikiInLinkDest: "[x]([[foo]])", wikiInCode: "`[[foo]]`", wikiFence: "```\n[[foo]]\n```",
  wikiJsEnt: "[[java&#115;cript]]", fenceLang: '```x" onclick=alert(1)\ncode\n```', autolinkLit: "www.evil.com javascript:alert(1)",
  gtTrick: "&lt;img src=x onerror=alert(1)&gt;", entLt: "&#60;img src=x onerror=alert(1)&#62;", entLt2: "&#x3c;script&#x3e;alert(1)&#x3c;/script&#x3e;",
  headingId: '# x" onclick="a', wikiNested: "[[foo|[[foo]]]]", nestedLinkWiki: "[[[foo]]](javascript:alert(1))", imgInLink: "[![a](x.png)](javascript:alert(1))",
  linkHrefSpaces: "[x](<javascript:alert(1)>)", unicodeLs: "[x](java\u2028script:alert(1))", nulScheme: "[x](java\u0000script:alert(1))", zws: "[x](\u200bjavascript:alert(1))",
  livescript: "[x](livescript:x)", wikiTargetJs: "[[java&#115;cript]] [[foo]]",
};
const RAW = ['<img srcset="javascript:alert(1) 1x, x.png 2x">', '<a href="&#14;javascript:alert(1)">x</a>', '<a href="java&#x0D;script:alert(1)">x</a>', '<a HREF="JAVASCRIPT:alert(1)">x</a>', '<a href="javascript&#58;alert(1)">x</a>', "<details open ontoggle=alert(1)>", '<a href=" javascript:alert(1)">x</a>', '<img src="data:image/png;base64,x" onload=alert(1)>', '<a href="data:image/png;base64,AAAA">x</a>', '<img src="DATA:image/svg+xml,<svg onload=alert(1)>">', '<portal src="javascript:alert(1)"></portal>', '<x-y is="foo" onclick=1>', '<img/src="x"/onerror=alert(1)>', '<table background="javascript:alert(1)">', '<blockquote cite="javascript:x">', '<a href="jav&Tab;ascript:alert(1)">', '<img src="https://evil.com/p.gif">', '<img src="//evil.com/p.gif">'];

for (const [name, md] of Object.entries(MD)) {
  test(`viewer pipeline, markdown payload ${name}: no script runs, no javascript: URL, no on* attribute, no external image`, () => {
    assert.deepEqual(problems(pipeline(md)), []);
  });
}
for (const raw of RAW) {
  test(`backstop sanitizer, raw HTML ${JSON.stringify(raw).slice(0, 60)}: inert`, () => {
    const box = doc.createElement("div"); box.appendChild(brainSafeFragment(raw, doc));
    assert.deepEqual(problems(box, { elements: false }), []);
  });
}
