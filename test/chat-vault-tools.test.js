import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { vaultSearch, vaultList, createVaultServer, VAULT_TOOL_NAMES } from "../src/chat/vault-tools.js";
import { makeVault, writeConfig, link, STAFF, OWNER_LIST } from "./helpers/private-vault.js";

const ALL_SECRETS = ["secret-margin-token", "secret-deep-token", "secret-hr-token", "secret-orig-token", "secret-fm-token", "secret-fm-yes-token", "secret-fm-quoted-token", "secret-root-private-token", "secret-raw-token", "secret-shadow-token", "secret-pattern-token", "secret-bank-token", "secret-payroll-folder-token", "secret-listed-path-token", "secret-context-token", "secret-team-token"];
const text = (r) => r.content.map((c) => c.text).join("\n");

test("search: finds allowed material, never private material, by body, name or folder trick", () => {
  const { vault, cleanup } = makeVault({ config: OWNER_LIST });
  try {
    for (const q of ALL_SECRETS) {
      const r = vaultSearch(vault, STAFF, { query: q });
      assert.ok(!text(r).includes(q), `search leaked ${q}: ${text(r)}`);
    }
    for (const q of ["Salary Review", "hr.md", "job-margins", "Quiet Note", "salary-2025", "bank-statement", "Salaries"]) {
      const out = text(vaultSearch(vault, STAFF, { query: q }));
      assert.ok(!/Private|hr\.md|job-margins|fm-true|salary-2025|bank-statement|Payroll Notes|Owner Draw/i.test(out.replace(/\bSalary Review\b[^\n]*Acme/g, "")) || out.includes("Projects/Acme.md") || out.includes("Resources/Handbook.md"), `path of a private file in: ${out}`);
    }
    const ok = vaultSearch(vault, STAFF, { query: "VISIBLE-OK-TOKEN" });
    assert.match(text(ok), /Resources\/ok\.md:\d+:.*visible-ok-token/i, "case-insensitive, path + line + snippet");
    assert.ok(!ok.isError);
  } finally { cleanup(); }
});

test("search: a result path never belongs to a private or out-of-scope file, over every query", () => {
  const { vault, cleanup } = makeVault({ config: OWNER_LIST });
  try {
    link(join(vault, "Resources", "Private", "hr.md"), join(vault, "Resources", "innocent.md"));
    link(join(vault, "Private"), join(vault, "Projects", "linked-private"));
    for (const q of ["a", "e", "token", "#", "secret", "Salary", "#"]) {
      const out = text(vaultSearch(vault, STAFF, { query: q, max: 500 }));
      for (const line of out.split("\n").filter((l) => /^[^ ].*:\d+:/.test(l))) {
        const p = line.split(":")[0];
        assert.ok(/^(Projects|Resources)\//.test(p), p);
        assert.ok(!/private|innocent|linked-private|fm-(true|yes|quoted)|salary|bank-|payroll|owner draw/i.test(p), p);
      }
      for (const s of ALL_SECRETS) assert.ok(!out.includes(s), s);
    }
  } finally { cleanup(); }
});

test("search: folder argument cannot escape or aim at private folders; the answer is the same as for a missing one", () => {
  const { vault, cleanup } = makeVault({ config: OWNER_LIST });
  try {
    const missing = vaultSearch(vault, STAFF, { query: "secret", folder: "Resources/nope" });
    assert.equal(missing.isError, true);
    for (const folder of ["Resources/Private", "resources/PRIVATE", "Resources\\Private", "Projects/Deep/er/Private", "Private", "Raw/Private", "Resources/../Private", "../", "/", "..", "Context", "Resources/Payroll Notes", "Resources/Finance/Owner Draw", "Team/Salaries", "/etc", "C:\\Windows"]) {
      const r = vaultSearch(vault, STAFF, { query: "secret", folder });
      assert.equal(r.isError, true, folder);
      assert.equal(text(r), text(missing), `${folder} must look like a missing folder`);
    }
    const sub = vaultSearch(vault, STAFF, { query: "visible-ok-token", folder: "Resources" });
    assert.match(text(sub), /Resources\/ok\.md/);
    const none = vaultSearch(vault, STAFF, { query: "visible-ok-token", folder: "Projects" });
    assert.ok(!text(none).includes("Resources/ok.md"));
  } finally { cleanup(); }
});

test("search: caps results and sizes, skips binary and huge files, tolerates bad input", () => {
  const { vault, cleanup } = makeVault();
  try {
    const d = join(vault, "Resources", "many"); mkdirSync(d, { recursive: true });
    for (let i = 0; i < 80; i++) writeFileSync(join(d, `n${i}.md`), `needle ${"x".repeat(5000)}\nneedle two\n`);
    writeFileSync(join(vault, "Resources", "bin.md"), Buffer.concat([Buffer.from("needle\0"), Buffer.alloc(50)]));
    writeFileSync(join(vault, "Resources", "huge.md"), "needle " + "y".repeat(3 * 1024 * 1024));
    const r = vaultSearch(vault, STAFF, { query: "needle", max: 1000 });
    const lines = text(r).split("\n").filter((l) => /:\d+:/.test(l));
    assert.ok(lines.length <= 50, `capped, got ${lines.length}`);
    assert.ok(text(r).length < 20000, "output size cap");
    assert.ok(lines.every((l) => l.length < 400), "snippets are short");
    assert.ok(!text(r).includes("bin.md") && !text(r).includes("huge.md"));
    for (const bad of [{}, { query: "" }, { query: "   " }, { query: 5 }, { query: "x".repeat(10000) }, { query: "ab", folder: 7 }, { query: "a\0b" }, null, undefined]) {
      const out = vaultSearch(vault, STAFF, bad);
      assert.ok(out && Array.isArray(out.content));
    }
  } finally { cleanup(); }
});

test("search does not follow a link out of the vault or into Private", () => {
  const { vault, root, cleanup } = makeVault();
  try {
    mkdirSync(join(root, "outside")); writeFileSync(join(root, "outside", "x.md"), "outside-needle");
    link(join(root, "outside"), join(vault, "Resources", "out"));
    link(join(vault, "Resources", "Private"), join(vault, "Resources", "loop"));
    link(join(vault, "Resources"), join(vault, "Resources", "self"));
    assert.ok(!text(vaultSearch(vault, STAFF, { query: "outside-needle" })).includes("outside-needle"));
    assert.ok(!text(vaultSearch(vault, STAFF, { query: "secret-hr-token" })).includes("secret-hr-token"));
    assert.equal(vaultSearch(vault, STAFF, { query: "visible-ok-token" }).isError ?? false, false);
  } finally { cleanup(); }
});

test("list: only allowed, non-private entries; names of private files and folders never appear", () => {
  const { vault, cleanup } = makeVault({ config: OWNER_LIST });
  try {
    const top = text(vaultList(vault, STAFF, {}));
    assert.match(top, /Projects/); assert.match(top, /Resources/);
    assert.ok(!/Private|Context|Team|Raw|Dashboard/.test(top), top);
    const res = text(vaultList(vault, STAFF, { folder: "Resources" }));
    assert.match(res, /ok\.md/); assert.match(res, /Handbook\.md/); assert.match(res, /fm-false\.md/);
    for (const n of ["Private", "fm-true", "fm-yes", "fm-quoted", "salary-2025", "bank-statement", "Payroll Notes", "Finance", "hr.md"]) {
      if (n === "Finance") continue; // a parent of a listed path stays visible
      assert.ok(!res.includes(n), `list leaks ${n}: ${res}`);
    }
    const fin = text(vaultList(vault, STAFF, { folder: "Resources/Finance" }));
    assert.ok(!fin.includes("Owner Draw"), fin);
    const proj = text(vaultList(vault, STAFF, { folder: "Projects" }));
    assert.ok(!proj.includes("Private") && proj.includes("Acme.md"), proj);
    const missing = vaultList(vault, STAFF, { folder: "Resources/nope" });
    for (const folder of ["Resources/Private", "RESOURCES/private", "Private", "Resources\\Private\\_processed", "Context", "..", "/", "Resources/../Context", "Resources/Payroll Notes", "Resources/Finance/Owner Draw"]) {
      const r = vaultList(vault, STAFF, { folder });
      assert.equal(r.isError, true, folder);
      assert.equal(text(r), text(missing), folder);
    }
  } finally { cleanup(); }
});

test("list: caps the number of entries, and bad input is an error not a crash", () => {
  const { vault, cleanup } = makeVault();
  try {
    const d = join(vault, "Resources", "big"); mkdirSync(d, { recursive: true });
    for (let i = 0; i < 700; i++) writeFileSync(join(d, `f${i}.md`), "x");
    const r = text(vaultList(vault, STAFF, { folder: "Resources/big" }));
    assert.ok(r.split("\n").length < 320);
    assert.match(r, /more/i);
    for (const bad of [{ folder: 5 }, { folder: "a\0b" }, null, undefined]) assert.ok(Array.isArray(vaultList(vault, STAFF, bad).content));
  } finally { cleanup(); }
});

test("a list or front-matter change takes effect on the very next call", () => {
  const { vault, cleanup } = makeVault({ config: { paths: [], patterns: [] } });
  try {
    assert.match(text(vaultSearch(vault, STAFF, { query: "visible-ok-token" })), /ok\.md/);
    writeConfig(vault, { paths: ["Resources/ok.md"], patterns: [] });
    assert.ok(!text(vaultSearch(vault, STAFF, { query: "visible-ok-token" })).includes("ok.md"));
    assert.ok(!/\bok\.md/.test(text(vaultList(vault, STAFF, { folder: "Resources" }))));
  } finally { cleanup(); }
});

test("the owner is not what these tools are for, but they never narrow below the owner's own rules", () => {
  const { vault, cleanup } = makeVault();
  try {
    const OWNER = { role: "owner", switches: { folders: [], teamFolder: null } };
    assert.match(text(vaultSearch(vault, OWNER, { query: "secret-hr-token" })), /Resources\/Private\/hr\.md/);
  } finally { cleanup(); }
});

test("server exposes exactly search and list under the vault name", async () => {
  const { vault, cleanup } = makeVault();
  try {
    assert.deepEqual([...VAULT_TOOL_NAMES], ["mcp__vault__search", "mcp__vault__list"]);
    const srv = createVaultServer({ vaultPath: vault, user: STAFF });
    assert.equal(srv.type, "sdk");
    assert.equal(srv.name, "vault");
    assert.ok(srv.instance);
  } finally { cleanup(); }
});

test("every denial and failure of search and list reads the same, whatever the reason", () => {
  const { vault, cleanup } = makeVault({ config: OWNER_LIST });
  try {
    const texts = new Set();
    const folders = ["Resources/nope", "Resources/ok.md", "Resources/Private", "Context", "Resources/fm-true.md", "Resources/Payroll Notes", "..", "/", "x\0y", 5];
    for (const folder of folders) {
      for (const fn of [vaultSearch, vaultList]) { const r = fn(vault, STAFF, { query: "x", folder }); assert.equal(r.isError, true, String(folder)); texts.add(text(r)); }
    }
    assert.equal(texts.size, 1, [...texts].join(" | "));
  } finally { cleanup(); }
});
