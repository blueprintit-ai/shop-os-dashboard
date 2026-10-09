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

test("owner.css themes the top bar (#owner-header) and its buttons from owner tokens", () => {
  const bar = ruleBody(owner, "#owner-header");
  assert.match(bar, /background:\s*transparent/);
  assert.match(bar, /color:\s*var\(--cream\)/);
  assert.match(bar, /border-bottom:[^;]*color-mix\(in srgb, var\(--cream\)/);
  const btn = ruleBody(owner, "#owner-header button, #owner-header a");
  assert.match(btn, /color:\s*var\(--cream\)/);
  assert.match(btn, /border:[^;]*color-mix\(in srgb, var\(--cream\) 22%, transparent\)/);
});
