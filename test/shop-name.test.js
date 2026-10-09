import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readShopName } from "../src/chat/system-prompt.js";

function vault(files) {
  const root = mkdtempSync(join(tmpdir(), "sod-name-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}
const claude = (name) => `---\nos-mode: business\nlicense-customer: ${name}\nlicense-product: shop-os\n---\n\n# Blueprint OS Vault\n`;

test("organization.md H1 wins over the license customer", () => {
  const v = vault({ "Context/organization.md": "# Acme Cabinets\n", "CLAUDE.md": claude("Someone Else") });
  assert.equal(readShopName(v), "Acme Cabinets");
  rmSync(v, { recursive: true, force: true });
});

test("fresh vault: falls back to CLAUDE.md license-customer", () => {
  const v = vault({ "CLAUDE.md": claude("Example Millwork LLC") });
  assert.equal(readShopName(v), "Example Millwork LLC");
  rmSync(v, { recursive: true, force: true });
});

test("template H1 like '# Organization' does not beat the license customer", () => {
  const v = vault({ "Context/organization.md": "---\ntype: context\n---\n# Organization\n", "CLAUDE.md": claude("Example Millwork LLC") });
  assert.equal(readShopName(v), "Example Millwork LLC");
  rmSync(v, { recursive: true, force: true });
});

test("no organization.md and no license-customer: generic fallback", () => {
  const v = vault({ "CLAUDE.md": "# Vault\nRouting doc.\n" });
  assert.equal(readShopName(v), "this shop");
  rmSync(v, { recursive: true, force: true });
});

test("/owner page title carries the shop name, HTML-escaped", async () => {
  const { bootAsOwner } = await import("./helpers/boot.js");
  const b = await bootAsOwner();
  try {
    writeFileSync(join(b.vault, "Context", "organization.md"), "# Smith & <Sons> Cabinets\n");
    const res = await b.http("GET", "/owner", { as: "owner" });
    const html = await res.text();
    assert.match(html, /<title>Blueprint OS — Smith &amp; &lt;Sons&gt; Cabinets<\/title>/);
  } finally { b.cleanup(); }
});
