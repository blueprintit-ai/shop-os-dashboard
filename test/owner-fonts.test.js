import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PUB = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const css = readFileSync(join(PUB, "css", "kit-fonts.css"), "utf8");

test("every @font-face in kit-fonts.css points at a bundled local file", () => {
  const urls = [...css.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(urls.length >= 7, "Outfit 300-700 + Doto 700/900");
  for (const u of urls) {
    assert.match(u, /^\/static\/vendor\/fonts\/[\w-]+\.woff2$/);
    assert.ok(existsSync(join(PUB, u.replace("/static/", ""))), u);
  }
});

test("kit-fonts.css declares exactly the weights the kit page asks for", () => {
  const faces = [...css.matchAll(/font-family: '(\w+)'[^}]*font-weight: (\d+)/g)].map((m) => `${m[1]} ${m[2]}`).sort();
  assert.deepEqual(faces, ["Doto 700", "Doto 900", "Outfit 300", "Outfit 400", "Outfit 500", "Outfit 600", "Outfit 700"]);
});
