import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sanitizeArtifactSvg as run, listArtifacts } from "../src/artifacts.js";

// The kit page assigns an artifact sidecar's `svg` to an <svg>'s innerHTML, and sidecars are
// agent-writable, so src/artifacts.js validates it before /api/artifacts serves it.
// Reject-not-strip: anything outside the allowlisted grammar becomes "".

test("legitimate glyphs pass through unchanged", () => {
  assert.equal(run('<path d="M26 8L14 27h8l-2 13 12-19h-8l2-13z"/>'), '<path d="M26 8L14 27h8l-2 13 12-19h-8l2-13z"/>');
  const multi = '<rect x="8" y="12" width="32" height="22" rx="3"/><path d="M24 34v6M16 40h16"/><circle cx="24" cy="24" r="15"/>';
  assert.equal(run(multi), multi);
  assert.equal(run('<g transform="translate(2 2)"><path d="M1 1"/></g>'), '<g transform="translate(2 2)"><path d="M1 1"/></g>');
});

test("the slash-instead-of-whitespace onerror bypass is rejected", () => {
  assert.equal(run("<image/onerror=alert(1)>"), "");
  assert.equal(run('<path/onload="x" d="M1 1"/>'), "");
});

test("script, foreignObject, style, comments and stray text are rejected outright", () => {
  assert.equal(run('<path d="M1 1"/><script>alert(1)</script>'), "");
  assert.equal(run('<foreignObject><body xmlns="http://www.w3.org/1999/xhtml">x</body></foreignObject>'), "");
  assert.equal(run("<style>*{}</style>"), "");
  assert.equal(run('<!-- x --><path d="M1 1"/>'), "");
  assert.equal(run('<path d="M1 1"/> hello'), "");
});

test("href / on* / style attributes are rejected (never stripped and kept)", () => {
  assert.equal(run('<rect x="0" y="0" width="10" height="10" href="javascript:alert(1)"/>'), "");
  assert.equal(run('<rect x="0" y="0" width="10" height="10" onclick="alert(1)"/>'), "");
  assert.equal(run('<rect style="fill:red" x="0"/>'), "");
});

test("attribute values cannot smuggle quotes, angle brackets or entities", () => {
  assert.equal(run('<path d="M1 1&#34; onload=&#34;x"/>'), "");
  assert.equal(run('<path d="a<b"/>'), "");
  assert.equal(run("<path d='M1 1'/>"), "");
});

test("unbalanced or malformed markup is rejected", () => {
  assert.equal(run("<path d=unterminated"), "");
  assert.equal(run('<g><path d="M1 1"/>'), "");
  assert.equal(run('<g></path>'), "");
});

test("empty / non-string / oversized input becomes an empty string", () => {
  assert.equal(run(""), "");
  assert.equal(run(undefined), "");
  assert.equal(run(42), "");
  assert.equal(run('<path d="' + "M1 1 ".repeat(2000) + '"/>'), "");
});

test("listArtifacts serves only the sanitized svg", () => {
  const vault = mkdtempSync(join(tmpdir(), "svg-"));
  try {
    const dir = join(vault, "Dashboard", "artifacts");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a.html"), "<title>A</title>");
    writeFileSync(join(dir, "a.json"), JSON.stringify({ svg: '<path d="M1 1"/><script>alert(1)</script>' }));
    writeFileSync(join(dir, "b.html"), "<title>B</title>");
    writeFileSync(join(dir, "b.json"), JSON.stringify({ svg: '<circle cx="24" cy="24" r="15"/>' }));
    const { artifacts } = listArtifacts(vault, { role: "owner" });
    assert.equal(artifacts.find((x) => x.file === "a.html").svg, "");
    assert.equal(artifacts.find((x) => x.file === "b.html").svg, '<circle cx="24" cy="24" r="15"/>');
  } finally { rmSync(vault, { recursive: true, force: true }); }
});

test("listArtifacts never serves a title the kit page could parse as HTML (stored XSS)", () => {
  const vault = mkdtempSync(join(tmpdir(), "title-"));
  try {
    const dir = join(vault, "Dashboard", "artifacts");
    mkdirSync(dir, { recursive: true });
    const cases = {
      "a-sidecar": { sidecar: { title: '<img src=x onerror=alert(1)>' } },
      "b-amp": { sidecar: { title: "Fish &amp; <b>chips" } },
      "c-ctrl": { sidecar: { title: "bell\u0007tab" } },
      "d-num": { sidecar: { title: 42 } },
      "e-html": { html: "<title><svg onload=alert(1)></title>" },
      "f&g": {},
      "ok-one": { sidecar: { title: "Quarterly report 2026" } },
    };
    for (const [stem, c] of Object.entries(cases)) {
      writeFileSync(join(dir, stem + ".html"), c.html || "<p>x</p>");
      if (c.sidecar) writeFileSync(join(dir, stem + ".json"), JSON.stringify(c.sidecar));
    }
    const by = Object.fromEntries(listArtifacts(vault, { role: "owner" }).artifacts.map((a) => [a.file, a.title]));
    for (const t of Object.values(by)) assert.doesNotMatch(t, /[<>&\u0000-\u001f\u007f]/, t);
    assert.equal(by["a-sidecar.html"], "a-sidecar");
    assert.equal(by["b-amp.html"], "b-amp");
    assert.equal(by["c-ctrl.html"], "c-ctrl");
    assert.equal(by["d-num.html"], "d-num");
    assert.equal(by["e-html.html"], "e-html");
    assert.equal(by["f&g.html"], "fg");
    assert.equal(by["ok-one.html"], "Quarterly report 2026");
  } finally { rmSync(vault, { recursive: true, force: true }); }
});
