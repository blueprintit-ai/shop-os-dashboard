import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { bootAsOwner } from "./helpers/boot.js";
import { safeFileHeaders } from "../src/lib/safe-file-response.js";

const ACTIVE = "<script>alert(1)</script>";
const raw = (b, rel, as = "owner") => b.http("GET", `/api/notes/raw?path=${encodeURIComponent(rel)}`, { as });

test("safeFileHeaders: inline vs attachment, nosniff, COOP, sandbox except pdf", () => {
  const a = safeFileHeaders({ filename: "x.html", mime: "text/html", inline: false });
  assert.match(a["content-disposition"], /^attachment;/);
  assert.equal(a["x-content-type-options"], "nosniff");
  assert.equal(a["cross-origin-opener-policy"], "same-origin");
  assert.equal(a["content-security-policy"], "sandbox");
  const p = safeFileHeaders({ filename: "x.pdf", mime: "application/pdf", inline: true });
  assert.match(p["content-disposition"], /^inline;/);
  assert.equal(p["content-security-policy"], undefined);
});

test("/api/notes/raw: per-type policy with nosniff + CSP sandbox (pdf excepted)", async () => {
  const b = await bootAsOwner({ staffSwitches: { folders: ["Projects", "Resources"] } });
  try {
    mkdirSync(join(b.vault, "Projects"), { recursive: true });
    const files = ["a.html", "a.htm", "a.xml", "a.xhtml", "a.json", "a.js", "a.exe", "noext", "a.svg", "a.png", "a.jpg", "a.jpeg", "a.gif", "a.webp", "a.md", "a.txt", "a.csv", "a.pdf"];
    for (const f of files) writeFileSync(join(b.vault, "Projects", f), ACTIVE);
    const download = new Set(["a.html", "a.htm", "a.xml", "a.xhtml", "a.json", "a.js", "a.exe", "noext"]);
    const types = { "a.svg": "image/svg+xml", "a.png": "image/png", "a.jpg": "image/jpeg", "a.jpeg": "image/jpeg", "a.gif": "image/gif", "a.webp": "image/webp", "a.pdf": "application/pdf", "a.md": "text/plain", "a.txt": "text/plain", "a.csv": "text/plain" };
    for (const f of files) {
      const res = await raw(b, `Projects/${f}`);
      assert.equal(res.status, 200, f);
      await res.arrayBuffer();
      const disp = res.headers.get("content-disposition");
      const ct = res.headers.get("content-type");
      if (download.has(f)) { assert.match(disp, /^attachment;/, f); assert.match(ct, /^application\/octet-stream/, f); }
      else { assert.match(disp, /^inline;/, `${f}: ${disp}`); assert.ok(ct.startsWith(types[f]), `${f}: ${ct}`); }
      assert.equal(res.headers.get("x-content-type-options"), "nosniff", f);
      assert.equal(res.headers.get("cross-origin-opener-policy"), "same-origin", f);
      if (f === "a.pdf") assert.equal(res.headers.get("content-security-policy"), null);
      else assert.equal(res.headers.get("content-security-policy"), "sandbox", f);
    }
    // an SVG carrying a script is served as an image under a sandbox, so the script cannot run
    const svg = await raw(b, "Projects/a.svg");
    assert.equal(svg.headers.get("content-type"), "image/svg+xml");
    assert.equal(svg.headers.get("content-security-policy"), "sandbox");
    assert.equal(await svg.text(), ACTIVE);
    // md body is intact and text/plain
    assert.equal(await (await raw(b, "Projects/a.md")).text(), ACTIVE);
  } finally { b.cleanup(); }
});

test("/api/notes/raw: traversal, hidden dirs, folder scope and auth are unchanged", async () => {
  const b = await bootAsOwner({ staffSwitches: { folders: ["Projects", "Resources"] } });
  try {
    mkdirSync(join(b.vault, ".obsidian"), { recursive: true });
    writeFileSync(join(b.vault, ".obsidian", "x.html"), ACTIVE);
    assert.equal((await raw(b, "../../etc/passwd")).status, 403);
    assert.equal((await raw(b, ".obsidian/x.html")).status, 403);
    assert.equal((await raw(b, "Context/operator.md", "staff")).status, 404);
    assert.ok([403, 404].includes((await raw(b, "Projects/missing.png")).status)); // unchanged: never 200
    assert.equal((await b.http("GET", "/api/notes/raw")).status, 401);
    assert.equal((await b.http("GET", "/api/notes/raw", { as: "owner" })).status, 400);
    const ok = await raw(b, "Projects/layout.png", "staff");
    assert.equal(ok.status, 200); assert.match(ok.headers.get("content-disposition"), /^inline;/);
    await ok.arrayBuffer();
  } finally { b.cleanup(); }
});
