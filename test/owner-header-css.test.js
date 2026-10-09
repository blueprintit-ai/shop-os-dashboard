import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Regression: base.css gives every bare <header> a white card background and
// bordered buttons. /owner's top bar (#owner-header) and every widget heading
// (header.wh) are <header>s, so on the dark theme they rendered as white
// boxes with cream-on-white text. owner.css must override that chrome.
const PUB = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const owner = readFileSync(join(PUB, "css", "owner.css"), "utf8");
const base = readFileSync(join(PUB, "css", "base.css"), "utf8");

// Declaration body of the rule whose selector list is exactly `selector`.
function ruleBody(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\#]/g, "\\$&");
  const m = css.match(new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, "m"));
  assert.ok(m, `owner.css must have a rule for ${selector}`);
  return m[1];
}

test("base.css still styles bare header as light chrome (other pages rely on it)", () => {
  assert.match(ruleBody(base, "header"), /background:\s*var\(--card\)/);
});

test("owner.css makes widget headings (.wh) transparent with no bottom border", () => {
  const body = ruleBody(owner, ".wh");
  assert.match(body, /background:\s*transparent/);
  assert.match(body, /border-bottom:\s*0/);
  assert.match(body, /color:\s*var\(--cream\)/);
});

test("owner.css restyles the top bar (#owner-header) as the kit's quiet icon row", () => {
  const bar = ruleBody(owner, "#owner-header");
  assert.match(bar, /background:\s*transparent/);
  assert.match(bar, /color:\s*var\(--cream\)/);
  assert.match(bar, /border:\s*0/);
  assert.match(bar, /position:\s*fixed/);
  const btn = ruleBody(owner, "#owner-header button, #owner-header a");
  assert.match(btn, /color:\s*var\(--cream\)/);
  assert.match(btn, /border:\s*0/);
  const svg = ruleBody(owner, "#owner-header svg");
  assert.match(svg, /stroke:\s*var\(--mute\)/);
});

test("top bar keeps every functional control, as icons with accessible names", () => {
  const html = readFileSync(join(PUB, "owner.html"), "utf8");
  for (const id of ["editBtn", "searchBtn", "users-link", "infoBtn", "theme-btn", "logout-btn"]) {
    assert.match(html, new RegExp(`id="${id}"[^>]*aria-label="[^"]+"`), `${id} needs an aria-label`);
  }
  assert.match(html, /<a id="users-link" href="\/users"/);
});

test("theme toggle button holds inline SVG icons, and CSS shows one per theme", () => {
  const html = readFileSync(join(PUB, "owner.html"), "utf8");
  const btn = html.match(/<button id="theme-btn"[^>]*>([\s\S]*?)<\/button>/);
  assert.ok(btn, "#theme-btn exists");
  assert.match(btn[1], /<svg[^>]*class="ti-sun"/);
  assert.match(btn[1], /<svg[^>]*class="ti-moon"/);
  assert.match(owner, /html\.light #theme-btn \.ti-sun\s*\{[^}]*display:\s*none/);
  assert.match(owner, /html\.light #theme-btn \.ti-moon\s*\{[^}]*display:\s*block/);
});
