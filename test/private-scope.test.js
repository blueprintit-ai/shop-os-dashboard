import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdirSync, writeFileSync, statSync, renameSync, utimesSync } from "node:fs";
import { isPathAllowed, isPrivatePath, allowedRoots, configurePrivateAudit, privateListStatus } from "../src/scope.js";
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

test("unusable list and no earlier good list: staff are denied EVERYTHING (fail closed), once-logged, status says so", () => {
  const events = [];
  configurePrivateAudit({ log: (e, f) => events.push({ e, ...f }) });
  try {
    for (const bad of ['{ "paths": ["Resources/ok.md"], }', "{ not json", "", "[]", "null", JSON.stringify({ paths: "Resources", patterns: {} }), '{"paths": [1,2,],}']) {
      const { vault, cleanup } = makeVault({ config: bad });
      try {
        events.length = 0;
        assert.equal(staffOK(vault, "Resources/ok.md"), false, `fail closed for ${JSON.stringify(bad)}`);
        assert.equal(staffOK(vault, "Projects/Acme.md"), false);
        assert.deepEqual(allowedRoots(vault, STAFF), []);
        assert.equal(isPathAllowed(vault, OWNER, join(vault, "Resources", "ok.md")), true, "the owner is never blocked");
        assert.equal(privateListStatus(vault).state, "invalid-fail-closed");
        assert.equal(privateListStatus(vault).staffBlocked, true);
        assert.equal(events.filter((x) => x.e === "private.config-invalid").length, 1, "logged once, not per call");
        assert.equal(events[0].failClosed, true);
        writeConfig(vault, { paths: [], patterns: [] });
        assert.equal(staffOK(vault, "Resources/ok.md"), true, "fixing the file restores access without a restart");
        assert.equal(privateListStatus(vault).state, "ok");
      } finally { cleanup(); }
    }
  } finally { configurePrivateAudit(null); }
});

test("a good list that is later saved half-written keeps protecting (last good list)", () => {
  const { vault, cleanup } = makeVault();
  const events = [];
  configurePrivateAudit({ log: (e, f) => events.push({ e, ...f }) });
  try {
    writeConfig(vault, OWNER_LIST);
    assert.equal(staffOK(vault, "Resources/salary-2025.md"), false);
    writeConfig(vault, "{ half written");
    assert.equal(staffOK(vault, "Resources/salary-2025.md"), false, "last good list stays in force");
    assert.equal(staffOK(vault, "Resources/ok.md"), true, "and staff are not locked out");
    assert.equal(privateListStatus(vault).state, "invalid-kept-previous");
    assert.equal(events.filter((x) => x.e === "private.config-invalid" && x.keptPreviousList).length, 1);
    writeConfig(vault, { paths: [], patterns: [] });
    assert.equal(staffOK(vault, "Resources/salary-2025.md"), true);
  } finally { configurePrivateAudit(null); cleanup(); }
});

test("every dropped list entry is audited once per file change and counted in the status", () => {
  const { vault, cleanup } = makeVault();
  const events = [];
  configurePrivateAudit({ log: (e, f) => events.push({ e, ...f }) });
  try {
    writeConfig(vault, { path: ["Resources"], paths: ["ok/../x", "C:\\Windows", "", 5, "Resources/Finance"], patterns: ["a/b", "***", "", 7, "salary*"], extra: 1 });
    assert.equal(staffOK(vault, "Resources/salary-2025.md"), false, "valid entries still work");
    staffOK(vault, "Resources/ok.md");
    const ig = events.filter((x) => x.e === "private.config-entry-ignored");
    assert.equal(ig.length, 10, JSON.stringify(ig.map((x) => x.entry)));
    assert.ok(ig.some((x) => x.entry === "path" && /unknown top-level key/.test(x.reason)));
    assert.ok(ig.some((x) => /\.\./.test(x.reason)) && ig.some((x) => /drive letter/.test(x.reason)) && ig.some((x) => /slash/.test(x.reason) && x.reason.includes('patterns match one file or folder name, use "paths" for folders')));
    assert.equal(privateListStatus(vault).ignoredEntries, 10);
    assert.equal(privateListStatus(vault).state, "ok");
    events.length = 0;
    staffOK(vault, "Resources/ok.md");
    assert.equal(events.length, 0, "not logged again until the file changes");
    const big = { paths: Array.from({ length: 600 }, (_, i) => `x${i}`), patterns: [] };
    writeConfig(vault, big);
    staffOK(vault, "Resources/ok.md");
    assert.equal(privateListStatus(vault).ignoredEntries, 1, "over-limit is counted");
  } finally { configurePrivateAudit(null); cleanup(); }
});

test("Unicode: a decomposed name on disk matches a composed list entry and pattern, and the other way round", () => {
  const nfd = "Cafe\u0301 Re\u0301sume\u0301";
  const nfc = nfd.normalize("NFC");
  assert.notEqual(nfd, nfc);
  const { vault, cleanup } = makeVault({ config: { paths: [`Resources/${nfc}`], patterns: [`*${"re\u0301sume\u0301".normalize("NFC")}*`, "caf\u00e9-*"] } });
  try {
    mkdirSync(join(vault, "Resources", nfd), { recursive: true });
    writeFileSync(join(vault, "Resources", nfd, "a.md"), "x");
    writeFileSync(join(vault, "Resources", "cafe\u0301-menu.md"), "x");
    writeFileSync(join(vault, "Resources", "Mon R\u00e9sum\u00e9.md"), "x");
    assert.equal(isPrivatePath(vault, join(vault, "Resources", nfd, "a.md")), true, "NFD folder vs NFC list path");
    assert.equal(isPrivatePath(vault, join(vault, "Resources", nfc, "a.md")), true);
    assert.equal(isPrivatePath(vault, join(vault, "Resources", "cafe\u0301-menu.md")), true, "NFD name vs NFC pattern");
    assert.equal(isPrivatePath(vault, join(vault, "Resources", "Mon R\u00e9sum\u00e9.md")), true);
    writeConfig(vault, { paths: [`Resources/${nfd}`], patterns: [`*re\u0301sume\u0301*`] });
    assert.equal(isPrivatePath(vault, join(vault, "Resources", nfc, "a.md")), true, "NFC folder vs NFD list path");
    assert.equal(isPrivatePath(vault, join(vault, "Resources", "Mon R\u00e9sum\u00e9.md")), true, "NFC name vs NFD pattern");
    assert.equal(isPrivatePath(vault, join(vault, "Resources", "ok.md")), false);
  } finally { cleanup(); }
});

test("front matter opened but never closed is private (fail closed); a closed one is read normally", () => {
  const { vault, cleanup } = makeVault();
  try {
    writeFileSync(join(vault, "Resources", "unclosed.md"), "---\ntitle: x\nno closing fence ever\n" + "z".repeat(100));
    writeFileSync(join(vault, "Resources", "unclosed-big.md"), "---\ntitle: x\n" + "a: b\n".repeat(20000) + "---\nbody\n");
    writeFileSync(join(vault, "Resources", "closed.md"), "---\ntitle: x\n---\nbody\n");
    writeFileSync(join(vault, "Resources", "hr-note.md"), "Intro\n\n---\n\nafter the rule\n");
    assert.equal(staffOK(vault, "Resources/unclosed.md"), false);
    assert.equal(staffOK(vault, "Resources/unclosed-big.md"), false, "closing fence beyond the 64 KB window");
    assert.equal(staffOK(vault, "Resources/closed.md"), true);
    assert.equal(staffOK(vault, "Resources/hr-note.md"), true, "a rule in the middle of a note is not front matter");
  } finally { cleanup(); }
});

test("same-size, same-mtime rewrites are still noticed (cache keys include ctime and inode)", () => {
  const { vault, cleanup } = makeVault();
  try {
    const f = join(vault, "Resources", "swap.md");
    writeFileSync(f, "---\nprivate: no\n---\nx");
    assert.equal(staffOK(vault, "Resources/swap.md"), true);
    const st = statSync(f);
    renameSync(f, f + ".old");
    writeFileSync(f, "---\nprivate: yes\n---\nx"); // same size as before
    utimesSync(f, st.atime, st.mtime); // same mtime too
    assert.equal(staffOK(vault, "Resources/swap.md"), false, "new inode / ctime");
  } finally { cleanup(); }
});

test("the front matter cache does not collapse at its cap: hot entries survive eviction", async () => {
  const { vault, cleanup } = makeVault();
  try {
    assert.equal(staffOK(vault, "Resources/fm-true.md"), false);
    for (let i = 0; i < 20; i++) writeFileSync(join(vault, "Resources", `bulk${i}.md`), "---\nprivate: yes\n---\n");
    for (let i = 0; i < 20; i++) assert.equal(staffOK(vault, `Resources/bulk${i}.md`), false);
    assert.equal(staffOK(vault, "Resources/fm-true.md"), false);
  } finally { cleanup(); }
});

test("the top-level Chats folder is private to staff by default, the owner still sees it", () => {
  const { vault, cleanup } = makeVault();
  try {
    mkdirSync(join(vault, "Chats"), { recursive: true });
    writeFileSync(join(vault, "Chats", "2026-01-01-pat.md"), "x");
    const g = { role: "staff", switches: { folders: ["Chats", "Resources"], teamFolder: null } };
    assert.equal(isPathAllowed(vault, g, join(vault, "Chats", "2026-01-01-pat.md")), false);
    assert.equal(isPathAllowed(vault, OWNER, join(vault, "Chats", "2026-01-01-pat.md")), true);
  } finally { cleanup(); }
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

test("the fast paths (tree walk, indexed notes) agree exactly with the full check on every file", async () => {
  const { buildTree } = await import("../src/notes/tree.js");
  const { LinkIndex } = await import("../src/notes/index.js");
  const { createScope } = await import("../src/scope.js");
  const { readdirSync } = await import("node:fs");
  const { vault, cleanup } = makeVault({ config: OWNER_LIST });
  try {
    link(join(vault, "Resources", "Private", "hr.md"), join(vault, "Resources", "innocent.md"));
    link(join(vault, "Resources", "ok.md"), join(vault, "Projects", "ok-link.md"));
    link(join(vault, "Private"), join(vault, "Projects", "linked-private"));
    const all = [];
    const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else all.push(p); } };
    walk(vault);
    const users = [STAFF, { ...STAFF, switches: { folders: ["Resources/Private", "Projects/Deep", "Team"], teamFolder: null } }, OWNER];
    for (const u of users) {
      const treeFiles = [];
      const collect = (nodes) => nodes.forEach((n) => (n.type === "dir" ? collect(n.children) : treeFiles.push(join(vault, n.path))));
      collect(buildTree(vault, u));
      const expected = all.filter((p) => isPathAllowed(vault, u, p) && !p.includes("/.obsidian/")).sort();
      // links in the tree are listed as files when the full check allows them
      assert.deepEqual(treeFiles.sort(), expected, `tree vs full check for ${u.role} ${u.switches.folders}`);
      const idx = new LinkIndex(vault); idx.build();
      const sc = createScope(vault, u);
      for (const n of idx.notes()) assert.equal(sc.allowedNote(n.path), isPathAllowed(vault, u, join(vault, n.path)), n.path);
    }
  } finally { cleanup(); }
});

test("Windows name aliases of a private-front-matter note are private everywhere (stream, trailing dot, trailing space)", async () => {
  const { createScope } = await import("../src/scope.js");
  const { LinkIndex } = await import("../src/notes/index.js");
  const { searchNotes } = await import("../src/notes/search.js");
  const { vault, cleanup } = makeVault({ config: OWNER_LIST });
  try {
    const aliases = ["fm-true.md::$DATA", "fm-true.md:stream", "fm-true.md.", "fm-true.md ", "fm-true.md...  ", "FM-TRUE.MD.", "fm-true.md. .", "fm-yes.md::$DATA", "salary-2025.md.", "bank-statement.txt "];
    for (const a of aliases) {
      const p = join(vault, "Resources", a);
      assert.equal(isPathAllowed(vault, STAFF, p), false, `isPathAllowed ${a}`);
      assert.equal(isPrivatePath(vault, p), true, `isPrivatePath ${a}`);
      assert.equal(createScope(vault, STAFF).allowedNote(`Resources/${a}`), false, `allowedNote ${a}`);
      assert.equal(createScope(vault, STAFF).allowed(p), false);
    }
    // aliases of public files stay as they were (nothing is private about them)
    assert.equal(isPrivatePath(vault, join(vault, "Resources", "ok.md.")), false);
  } finally { cleanup(); }
});

test("hidden folders cannot be reached through a name alias, for anyone", () => {
  const { vault, cleanup } = makeVault();
  try {
    for (const seg of [".obsidian.", ".obsidian ", ".obsidian::$INDEX_ALLOCATION", ".OBSIDIAN.", ".git. ", "node_modules.", ".claude..."]) {
      assert.equal(isPathAllowed(vault, OWNER, join(vault, "Resources", seg, "x.json")), false, `owner ${seg}`);
      assert.equal(isPathAllowed(vault, STAFF, join(vault, "Resources", seg, "x.json")), false, `staff ${seg}`);
      assert.equal(isPathAllowed(vault, OWNER, join(vault, seg, "x.json")), false, `owner root ${seg}`);
    }
  } finally { cleanup(); }
});

test("hasWindowsAlias is a pure helper: a colon after the drive letter, or a segment ending in dot or space", async () => {
  const { hasWindowsAlias } = await import("../src/scope.js");
  for (const p of ["a/fm.md::$DATA", "a/b:c", "a/b.", "a/b ", "a/b./c", "x\\y.\\z", "a/b..  ", "C:\\v\\a\\b.md:s"]) assert.equal(hasWindowsAlias(p, "win32"), true, p);
  for (const p of ["a/b.md", "a/..", "./a", "a/.hidden", "C:\\v\\a\\b.md", "C:/v/a", "a b/c d.md", "/"]) assert.equal(hasWindowsAlias(p, "win32"), false, p);
  assert.equal(hasWindowsAlias("a/b.", "linux"), false, "only Windows resolves these names to another file");
  assert.equal(hasWindowsAlias("a/b:c", "darwin"), false);
});

test("on Windows staff paths with alias spellings are refused outright; the owner is not affected", async () => {
  const { createScope } = await import("../src/scope.js");
  const { vault, cleanup } = makeVault();
  try {
    writeFileSync(join(vault, "Resources", "plain.md. x"), "x");
    const win = (u) => createScope(vault, u, { platform: "win32" });
    for (const a of ["ok.md.", "ok.md ", "ok.md::$DATA", "ok.md:s"]) {
      assert.equal(win(STAFF).allowed(join(vault, "Resources", a)), false, a);
      assert.equal(win(STAFF).allowedNote(`Resources/${a}`), false, a);
    }
    assert.equal(win(STAFF).allowed(join(vault, "Resources", "ok.md")), true);
    assert.equal(win(OWNER).allowed(join(vault, "Resources", "ok.md.")), true);
    assert.equal(createScope(vault, STAFF, { platform: "linux" }).allowed(join(vault, "Resources", "ok.md.")), true, "on other systems the canonical file is judged (and is fine)");
  } finally { cleanup(); }
});

test("8.3-style names (~) take the full realpath route and cannot hide a link into Private", () => {
  const { vault, cleanup } = makeVault();
  try {
    link(join(vault, "Resources", "Private"), join(vault, "Projects", "PRIVAT~1"));
    link(join(vault, "Resources", "fm-true.md"), join(vault, "Projects", "FM-TRU~1.MD"));
    assert.equal(staffOK(vault, "Projects/PRIVAT~1/hr.md"), false);
    assert.equal(staffOK(vault, "Projects/FM-TRU~1.MD"), false);
    assert.equal(isPrivatePath(vault, join(vault, "Projects", "PRIVAT~1")), true);
    mkdirSync(join(vault, "Projects", "REAL~1"));
    writeFileSync(join(vault, "Projects", "REAL~1", "a.md"), "x");
    assert.equal(staffOK(vault, "Projects/REAL~1/a.md"), true, "a genuine folder with ~ in its name is still usable");
  } finally { cleanup(); }
});

test("an index note whose parent folder was swapped for a link into Private is refused at once (no wait for a rebuild)", async () => {
  const { LinkIndex } = await import("../src/notes/index.js");
  const { searchNotes } = await import("../src/notes/search.js");
  const { renameSync, readdirSync } = await import("node:fs");
  const { vault, cleanup } = makeVault();
  try {
    mkdirSync(join(vault, "Resources", "Sub"), { recursive: true });
    writeFileSync(join(vault, "Resources", "Sub", "plan.md"), "# plan\nunique-plan-word\n");
    mkdirSync(join(vault, "Private", "Board"), { recursive: true });
    writeFileSync(join(vault, "Private", "Board", "plan.md"), "# plan\nunique-plan-word secret-board-token\n");
    const idx = new LinkIndex(vault); idx.build();
    assert.equal(searchNotes(vault, STAFF, idx, "unique-plan-word").length, 1);
    renameSync(join(vault, "Resources", "Sub"), join(vault, "Resources", "Sub.old"));
    link(join(vault, "Private", "Board"), join(vault, "Resources", "Sub"));
    assert.deepEqual(searchNotes(vault, STAFF, idx, "unique-plan-word"), [], "index is stale, the check is not");
    const { createScope } = await import("../src/scope.js");
    assert.equal(createScope(vault, STAFF).allowedNote("Resources/Sub/plan.md"), false);
    assert.equal(createScope(vault, OWNER).allowedNote("Resources/Sub/plan.md"), true);
  } finally { cleanup(); }
});
