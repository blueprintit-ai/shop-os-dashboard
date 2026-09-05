import { test } from "node:test";
import assert from "node:assert/strict";
import { splitFrontmatter, extractWikilinks, renderNote, slugHeading } from "../src/notes/render.js";

const NOTE = `---
type: project
tags: [kitchen, acme]
---
# Acme Kitchen

Customer: [[Acme Cabinets|Acme]]. See [[Pricing Sheet#Countertops]] and ![[layout.png]].

> [!note] Deposit received
> 50% on 2026-08-01.

- [x] Measure
- [ ] Order doors

Status is ==on track== #kitchen %%private%%
`;

const resolveLink = (target) => {
  const known = { "Acme Cabinets": "/notes/view?path=Context%2Forganization.md", "Pricing Sheet": "/notes/view?path=Resources%2FPricing%20Sheet.md", "layout.png": "/notes/raw?path=Projects%2Flayout.png" };
  return known[target] ? { href: known[target], exists: true } : { href: "", exists: false };
};

test("splitFrontmatter separates keys and body", () => {
  const { frontmatter, body } = splitFrontmatter(NOTE);
  assert.equal(frontmatter.type, "project");
  assert.equal(frontmatter.tags, "[kitchen, acme]");
  assert.ok(body.startsWith("# Acme Kitchen"));
  assert.deepEqual(splitFrontmatter("# No fm").frontmatter, null);
});

test("extractWikilinks handles alias, heading, embed", () => {
  const links = extractWikilinks(NOTE);
  assert.deepEqual(links, [
    { target: "Acme Cabinets", alias: "Acme", heading: null, embed: false },
    { target: "Pricing Sheet", alias: null, heading: "Countertops", embed: false },
    { target: "layout.png", alias: null, heading: null, embed: true },
  ]);
});

test("renderNote produces clickable wikilinks, heading anchors, image embeds", () => {
  const { html } = renderNote(NOTE, { resolveLink });
  assert.match(html, /<a class="wikilink" href="\/notes\/view\?path=Context%2Forganization\.md">Acme<\/a>/);
  assert.match(html, /<a class="wikilink" href="\/notes\/view\?path=Resources%2FPricing%20Sheet\.md#countertops">Pricing Sheet › Countertops<\/a>/);
  assert.match(html, /<img class="embed" src="\/notes\/raw\?path=Projects%2Flayout\.png" alt="layout.png">/);
});

test("renderNote renders callouts, tags, highlights, checkboxes; strips comments and frontmatter", () => {
  const { html } = renderNote(NOTE, { resolveLink });
  assert.match(html, /<div class="callout callout-note"><div class="callout-title">Deposit received<\/div>/);
  assert.match(html, /<a class="tag" href="\/notes\/search\?q=%23kitchen">#kitchen<\/a>/);
  assert.match(html, /<mark>on track<\/mark>/);
  assert.match(html, /<input[^>]*type="checkbox"[^>]*checked/);
  assert.doesNotMatch(html, /private/);
  assert.doesNotMatch(html, /type: project/);
});

test("unresolved wikilink renders as missing span", () => {
  const { html } = renderNote("See [[Nowhere]]", { resolveLink });
  assert.match(html, /<span class="wikilink missing">Nowhere<\/span>/);
});

test("slugHeading", () => {
  assert.equal(slugHeading("Countertops"), "countertops");
  assert.equal(slugHeading("Q3 Plan: Budget & Timing"), "q3-plan-budget-timing");
});

test("renderNote escapes raw HTML in the note", () => {
  const { html } = renderNote("<script>alert(1)</script> hi", { resolveLink });
  assert.doesNotMatch(html, /<script>/);
});
