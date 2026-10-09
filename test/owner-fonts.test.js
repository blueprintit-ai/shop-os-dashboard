import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PUB = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const css = readFileSync(join(PUB, "css", "owner.css"), "utf8");

test("every @font-face in owner.css points at a bundled local file", () => {
  const urls = [...css.matchAll(/@font-face[^}]*url\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(urls.length >= 7, "Outfit 300-700 and Doto 700/900");
  for (const u of urls) {
    assert.ok(u.startsWith("/static/vendor/fonts/"), u);
    assert.ok(existsSync(join(PUB, u.replace("/static/", ""))), `${u} must exist`);
  }
  for (const fam of ["Outfit", "Doto"]) assert.match(css, new RegExp(`font-family: '${fam}'`));
});

test("OFL licence texts ship next to the fonts and NOTICE.md mentions them", () => {
  for (const f of ["OFL-Outfit.txt", "OFL-Doto.txt"]) assert.match(readFileSync(join(PUB, "vendor", "fonts", f), "utf8"), /SIL Open Font License/);
  const notice = readFileSync(join(PUB, "..", "NOTICE.md"), "utf8");
  assert.match(notice, /Outfit/); assert.match(notice, /Doto/); assert.match(notice, /Open Font License/);
});

test("no external font or CDN URL anywhere in the owner page, its css or js", () => {
  const files = [join(PUB, "owner.html"), join(PUB, "css", "owner.css")];
  const jsDir = join(PUB, "js", "owner");
  for (const f of readdirSync(jsDir)) files.push(join(jsDir, f));
  for (const f of files) {
    assert.ok(statSync(f).isFile());
    const txt = readFileSync(f, "utf8");
    assert.doesNotMatch(txt, /fonts\.googleapis|fonts\.gstatic|@import\s+url\(["']?https?:/i, f);
  }
});
