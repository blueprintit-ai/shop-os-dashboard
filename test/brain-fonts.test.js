import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PUB = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const css = readFileSync(join(PUB, "css", "brain-fonts.css"), "utf8");

test("every @font-face in brain-fonts.css points at a bundled local file", () => {
  const urls = [...css.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]);
  assert.equal(urls.length, 7);
  for (const u of urls) {
    assert.match(u, /^\/static\/vendor\/fonts\/[\w-]+\.woff2$/);
    assert.ok(existsSync(join(PUB, u.replace("/static/", ""))), u);
  }
});

test("brain-fonts.css declares Outfit 300-700 and Source Serif 4 italic 400/600", () => {
  const faces = [...css.matchAll(/font-family: '([\w ]+)'; font-style: (\w+); font-weight: (\d+)/g)].map((m) => `${m[1]} ${m[2]} ${m[3]}`).sort();
  assert.deepEqual(faces, ["Outfit normal 300", "Outfit normal 400", "Outfit normal 500", "Outfit normal 600", "Outfit normal 700", "Source Serif 4 italic 400", "Source Serif 4 italic 600"]);
});

test("the vendored d3 build and its license ship together", () => {
  assert.match(readFileSync(join(PUB, "vendor", "d3.min.js"), "utf8").slice(0, 120), /d3js\.org v7\./);
  assert.match(readFileSync(join(PUB, "vendor", "LICENSE-d3.txt"), "utf8"), /Mike Bostock/);
  assert.match(readFileSync(join(PUB, "vendor", "fonts", "OFL-SourceSerif4.txt"), "utf8"), /SIL OPEN FONT LICENSE/i);
});
