import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { isPathAllowed, isPrivatePath, allowedRoots, configurePrivateAudit } from "../src/scope.js";
import { makeVault, writeConfig, link, STAFF, OWNER, OWNER_LIST } from "./helpers/private-vault.js";

const staffOK = (v, rel) => isPathAllowed(v, STAFF, join(v, rel));

test("rule (a): a Private segment at any depth is denied for staff, any case, trailing dot or space", () => {
  const { vault, cleanup } = makeVault();
  try {
    for (const rel of ["Projects/Private/job-margins.md", "Projects/Deep/er/Private/x/y.md", "Resources/Private/hr.md", "Resources/Private/_processed/orig.txt"]) {
      assert.equal(staffOK(vault, rel), false, rel);
      assert.equal(isPrivatePath(vault, join(vault, rel)), true, rel);
    }
    for (const v of ["PRIVATE", "private", "Private.", "Private ", "private..", "pRiVaTe . "]) {
      assert.equal(isPrivatePath(vault, join(vault, "Resources", v, "hr.md")), true, JSON.stringify(v));
    }
    assert.equal(isPrivatePath(vault, join(vault, "Resources", "Private::$INDEX_ALLOCATION", "hr.md")), true, "NTFS stream suffix");
    assert.equal(staffOK(vault, "Resources/ok.md"), true);
    assert.equal(isPrivatePath(vault, join(vault, "Resources", "Privateer", "x.md")), false, "only an exact segment");
    assert.equal(isPrivatePath(vault, join(vault, "Resources", "My Private Notes.md")), false);
  } finally { cleanup(); }
});

test("owner is never limited by private rules", () => {
  const { vault, cleanup } = makeVault({ config: OWNER_LIST });
  try {
    for (const rel of ["Private/Salaries.md", "Resources/Private/hr.md", "Resources/fm-true.md", "Context/payroll.md", "Raw/Private/inbox.txt"]) {
      assert.equal(isPathAllowed(vault, OWNER, join(vault, rel)), true, rel);
    }
  } finally { cleanup(); }
});

test("traversal, backslash and mixed-separator tricks cannot reach Private", () => {
  const { vault, cleanup } = makeVault();
  try {
    assert.equal(isPathAllowed(vault, STAFF, join(vault, "Resources", "ok.md", "..", "Private", "hr.md")), false);
    assert.equal(isPathAllowed(vault, STAFF, join(vault, "Resources", "..", "Private", "Salaries.md")), false);
    assert.equal(isPathAllowed(vault, STAFF, join(vault, "Resources/Private\\hr.md")), false);
    assert.equal(isPrivatePath(vault, join(vault, "Resources\\..\\Private\\hr.md")), true);
    assert.equal(isPrivatePath(vault, join(vault, "Resources\\PRIVATE.\\hr.md")), true);
    assert.equal(isPathAllowed(vault, STAFF, join(vault, "Resources", "Private")), false, "the folder itself");
    assert.equal(isPathAllowed(vault, STAFF, join(vault, "Resources", "Private", "does-not-exist.md")), false, "a name that does not exist yet");
  } finally { cleanup(); }
});

test("symlinks into Private are denied by their real path (file, folder, chain, and from inside Private)", () => {
  const { vault, cleanup } = makeVault();
  try {
    link(join(vault, "Resources", "Private", "hr.md"), join(vault, "Resources", "innocent.md"));
    link(join(vault, "Resources", "Private"), join(vault, "Projects", "docs"));
    link(join(vault, "Projects", "docs"), join(vault, "Resources", "chain"));
    link(join(vault, "Private"), join(vault, "Resources", "root-private"));
    assert.equal(staffOK(vault, "Resources/innocent.md"), false);
    assert.equal(staffOK(vault, "Projects/docs/hr.md"), false);
    assert.equal(staffOK(vault, "Projects/docs"), false);
    assert.equal(staffOK(vault, "Resources/chain/hr.md"), false);
    assert.equal(staffOK(vault, "Resources/root-private/Salaries.md"), false);
    assert.equal(staffOK(vault, "Resources/root-private/not-there.md"), false, "nonexistent child behind a link into Private");
    // a link in a public folder to a public file still works
    link(join(vault, "Resources", "ok.md"), join(vault, "Projects", "ok-link.md"));
    assert.equal(staffOK(vault, "Projects/ok-link.md"), true);
  } finally { cleanup(); }
});

test("a symlink escaping the vault is denied", async () => {
  const { vault, root, cleanup } = makeVault();
  try {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(root, "outside"));
    writeFileSync(join(root, "outside", "x.md"), "x");
    link(join(root, "outside"), join(vault, "Resources", "out"));
    assert.equal(staffOK(vault, "Resources/out/x.md"), false);
  } finally { cleanup(); }
});

test("rule (b): front matter private true in several spellings; false and body text are not private", () => {
  const { vault, cleanup } = makeVault();
  try {
    assert.equal(staffOK(vault, "Resources/fm-true.md"), false);
    assert.equal(staffOK(vault, "Resources/fm-yes.md"), false, "CRLF, capital key, spaced colon, quoted Yes");
    assert.equal(staffOK(vault, "Resources/fm-quoted.md"), false, "quoted key and value");
    assert.equal(staffOK(vault, "Resources/fm-false.md"), true);
    assert.equal(staffOK(vault, "Resources/not-fm.md"), true, "private: true in the body is just text");
    assert.equal(staffOK(vault, "Resources/ok.md"), true);
  } finally { cleanup(); }
});

test("front matter edits take effect without restart", async () => {
  const { vault, cleanup } = makeVault();
  const { writeFileSync, utimesSync } = await import("node:fs");
  try {
    const f = join(vault, "Resources", "ok.md");
    assert.equal(staffOK(vault, "Resources/ok.md"), true);
    writeFileSync(f, "---\nprivate: yes\n---\n# Ok\n");
    const t = new Date(Date.now() + 5000); utimesSync(f, t, t);
    assert.equal(staffOK(vault, "Resources/ok.md"), false);
  } finally { cleanup(); }
});

test("rule (c): owner list paths and patterns; missing file is empty", () => {
  const { vault, cleanup } = makeVault();
  try {
    assert.equal(staffOK(vault, "Resources/salary-2025.md"), true, "no list yet");
    writeConfig(vault, OWNER_LIST);
    assert.equal(staffOK(vault, "Resources/salary-2025.md"), false, "salary*");
    assert.equal(staffOK(vault, "Resources/Payroll Notes/q1.md"), false, "*payroll* on a folder segment");
    assert.equal(staffOK(vault, "Resources/bank-statement.txt"), false, "bank-*");
    assert.equal(staffOK(vault, "Resources/Finance/Owner Draw/draw.md"), false, "listed path prefix");
    assert.equal(staffOK(vault, "Resources/finance/owner draw/draw.md"), false, "listed path is case-insensitive");
    assert.equal(staffOK(vault, "Resources/Finance"), true, "the parent of a listed path stays visible");
    assert.equal(staffOK(vault, "Resources/ok.md"), true);
    const TEAM = { role: "staff", switches: { folders: ["Team", "Context"], teamFolder: null } };
    assert.equal(isPathAllowed(vault, TEAM, join(vault, "Team", "Salaries", "s.md")), false);
    assert.equal(isPathAllowed(vault, TEAM, join(vault, "Context", "payroll.md")), false);
    assert.equal(isPathAllowed(vault, TEAM, join(vault, "Context", "organization.md")), true, "not listed, just nonexistent: path rules are not a blanket");
  } finally { cleanup(); }
});

test("patterns: only * is a wildcard, per segment, anchored, case-insensitive; extension-less stem also matches", () => {
  const { vault, cleanup } = makeVault({ config: { paths: [], patterns: ["bank-statement", "a.c", "sal[ary]*", "*"] } });
  try {
    // `*` alone and regex metacharacters are not wildcards
    assert.equal(staffOK(vault, "Resources/ok.md"), true, "a lone * is dropped, it would hide everything");
    assert.equal(staffOK(vault, "Resources/bank-statement.txt"), false, "stem of the final segment matches");
    assert.equal(isPrivatePath(vault, join(vault, "Resources", "abc")), false, "a.c is literal");
    assert.equal(isPrivatePath(vault, join(vault, "Resources", "a.c")), true);
    assert.equal(isPrivatePath(vault, join(vault, "Resources", "salary-2025.md")), false, "[ary] is literal");
    assert.equal(isPrivatePath(vault, join(vault, "Resources", "SAL[ARY]x")), true);
  } finally { cleanup(); }
});

test("hostile list entries: empty, dot, dotdot, absolute, non-strings, oversized", () => {
  const big = Array.from({ length: 5000 }, (_, i) => `x${i}`);
  const { vault, cleanup } = makeVault({ config: { paths: ["", "/", ".", "..", "../Projects", "Projects/../Resources", 5, null, { a: 1 }, "a".repeat(5000), ...big], patterns: [7, "", "a/b", "x".repeat(5000), "***"] } });
  try {
    assert.equal(staffOK(vault, "Resources/ok.md"), true, "nothing hostile hides the whole vault");
    assert.equal(staffOK(vault, "Projects/Acme.md"), true);
  } finally { cleanup(); }
});

test("corrupt or wrongly shaped list: treated as empty, audited once per change; last good list is kept", () => {
  const { vault, cleanup } = makeVault();
  const events = [];
  configurePrivateAudit({ log: (e, f) => events.push({ e, ...f }) });
  try {
    writeConfig(vault, "{ not json");
    assert.equal(staffOK(vault, "Resources/salary-2025.md"), true);
    assert.equal(staffOK(vault, "Resources/salary-2025.md"), true);
    assert.equal(events.filter((x) => x.e === "private.config-invalid").length, 1, "logged once, not per call");
    writeConfig(vault, JSON.stringify({ paths: "Resources", patterns: {} }));
    assert.equal(staffOK(vault, "Resources/salary-2025.md"), true, "wrong shape = empty");
    writeConfig(vault, "[]");
    writeConfig(vault, "null");
    assert.equal(staffOK(vault, "Resources/ok.md"), true);
    // a good list, then a corrupt save: protection must not silently vanish
    writeConfig(vault, OWNER_LIST);
    assert.equal(staffOK(vault, "Resources/salary-2025.md"), false);
    writeConfig(vault, "{ half written");
    assert.equal(staffOK(vault, "Resources/salary-2025.md"), false, "last good list stays in force");
    // deleting the file is a deliberate empty
    writeConfig(vault, { paths: [], patterns: [] });
    assert.equal(staffOK(vault, "Resources/salary-2025.md"), true);
  } finally { configurePrivateAudit(null); cleanup(); }
});

test("a deny-list change takes effect on the next call, both directions", () => {
  const { vault, cleanup } = makeVault({ config: { paths: [], patterns: [] } });
  try {
    assert.equal(staffOK(vault, "Resources/ok.md"), true);
    writeConfig(vault, { paths: ["Resources/ok.md"], patterns: [] });
    assert.equal(staffOK(vault, "Resources/ok.md"), false);
    writeConfig(vault, { paths: [], patterns: [] });
    assert.equal(staffOK(vault, "Resources/ok.md"), true);
  } finally { cleanup(); }
});

test("the owner list file itself is never readable by staff", () => {
  const { vault, cleanup } = makeVault({ config: OWNER_LIST });
  try {
    const TEAM = { role: "staff", switches: { folders: ["Dashboard"], teamFolder: null } };
    assert.equal(isPathAllowed(vault, TEAM, join(vault, "Dashboard", "private-paths.json")), false);
    assert.equal(isPathAllowed(vault, TEAM, join(vault, "Dashboard", "artifacts", "placeholder.txt")), true);
  } finally { cleanup(); }
});

test("a staff folder grant that is itself private yields no root", () => {
  const { vault, cleanup } = makeVault();
  try {
    const u = { role: "staff", switches: { folders: ["Private", "Resources/Private", "Resources"], teamFolder: null } };
    assert.deepEqual(allowedRoots(vault, u).map((r) => r.split("/").pop()), ["Resources"]);
    assert.equal(isPathAllowed(vault, u, join(vault, "Private", "Salaries.md")), false);
  } finally { cleanup(); }
});

test("an unknown role is treated as staff", () => {
  const { vault, cleanup } = makeVault();
  try {
    const u = { role: "weird", switches: { folders: ["Resources"], teamFolder: null } };
    assert.equal(isPathAllowed(vault, u, join(vault, "Resources", "Private", "hr.md")), false);
    assert.equal(isPathAllowed(vault, { switches: { folders: ["Resources"] } }, join(vault, "Resources", "Private", "hr.md")), false);
  } finally { cleanup(); }
});
