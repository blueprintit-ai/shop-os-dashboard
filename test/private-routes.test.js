import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bootPrivate, writeConfig, link, OWNER_LIST } from "./helpers/private-vault.js";

const SECRETS = ["secret-margin-token", "secret-deep-token", "secret-hr-token", "secret-orig-token", "secret-fm-token", "secret-fm-yes-token", "secret-fm-quoted-token", "secret-root-private-token", "secret-raw-token", "secret-shadow-token"];
const LISTED_SECRETS = ["secret-pattern-token", "secret-bank-token", "secret-payroll-folder-token", "secret-listed-path-token", "secret-context-token", "secret-team-token"];
// Names that must never appear anywhere in a staff response.
const PRIVATE_NAMES = ["job-margins", "hr.md", "Salary Review", "Salaries", "fm-true", "fm-yes", "fm-quoted", "Quiet Note", "inbox.txt", "orig.txt", "_processed", "Handbook Private"];

const get = async (ctx, as, path) => { const r = await ctx.req(as, "GET", path); const text = await r.text(); return { status: r.status, text }; };
const enc = encodeURIComponent;

test("tree: staff never see private files or folders, nor their names; owner sees everything", async () => {
  const ctx = await bootPrivate({ config: OWNER_LIST });
  try {
    const staff = await get(ctx, "staff", "/api/notes/tree");
    assert.equal(staff.status, 200);
    for (const n of [...PRIVATE_NAMES, "Private", "salary-2025", "bank-statement", "Payroll Notes", "Owner Draw"]) assert.ok(!staff.text.toLowerCase().includes(n.toLowerCase()), `staff tree leaks ${n}`);
    assert.ok(staff.text.includes("Acme.md") && staff.text.includes("ok.md") && staff.text.includes("fm-false.md"));
    const owner = await get(ctx, "owner", "/api/notes/tree");
    for (const n of ["Private", "hr.md", "fm-true.md", "salary-2025.md", "Payroll Notes"]) assert.ok(owner.text.includes(n), `owner tree lacks ${n}`);
  } finally { ctx.cleanup(); }
});

test("search: staff get no hit for any private body, title or listed material; owner finds them", async () => {
  const ctx = await bootPrivate({ config: OWNER_LIST });
  try {
    for (const q of [...SECRETS, ...LISTED_SECRETS, "Salary Review", "Quiet Note", "Handbook Private"]) {
      const r = await get(ctx, "staff", `/api/notes/search?q=${enc(q)}`);
      assert.equal(r.status, 200);
      const hits = JSON.parse(r.text);
      assert.deepEqual(hits.filter((h) => /private|fm-|salary-2025|bank-|payroll|Owner Draw|Salaries/i.test(h.path)), [], `staff search for ${q} returned ${r.text}`);
      for (const s of [...SECRETS, ...LISTED_SECRETS]) assert.ok(!r.text.includes(s), `snippet leaked ${s}`);
    }
    for (const q of ["secret-hr-token", "secret-fm-token", "secret-root-private-token"]) {
      assert.equal(JSON.parse((await get(ctx, "owner", `/api/notes/search?q=${q}`)).text).length >= 1, true, q);
    }
    assert.ok(JSON.parse((await get(ctx, "staff", "/api/notes/search?q=visible-ok-token")).text).length === 1);
  } finally { ctx.cleanup(); }
});

test("recent: staff never see private notes", async () => {
  const ctx = await bootPrivate({ config: OWNER_LIST });
  try {
    const staff = await get(ctx, "staff", "/api/notes/recent?limit=100");
    for (const n of [...PRIVATE_NAMES, "salary-2025"]) assert.ok(!staff.text.includes(n), n);
    assert.ok(staff.text.includes("Acme.md"));
    assert.ok((await get(ctx, "owner", "/api/notes/recent?limit=100")).text.includes("hr.md"));
  } finally { ctx.cleanup(); }
});

test("view and raw: every way to name a private file is a 404 for staff, identical to a missing file", async () => {
  const ctx = await bootPrivate({ config: OWNER_LIST });
  try {
    link(join(ctx.vault, "Resources", "Private", "hr.md"), join(ctx.vault, "Resources", "innocent.md"));
    link(join(ctx.vault, "Resources", "Private"), join(ctx.vault, "Projects", "docs"));
    const attempts = [
      "Resources/Private/hr.md", "Resources/PRIVATE/hr.md", "resources/private/HR.md", "Resources/Private /hr.md", "Resources/Private./hr.md",
      "Resources\\Private\\hr.md", "Resources/Private\\hr.md", "Resources/../Private/Salaries.md", "Projects/../Resources/Private/hr.md",
      "Private/Salaries.md", "Raw/Private/inbox.txt", "Projects/Private/job-margins.md", "Projects/Deep/er/Private/x/y.md",
      "Resources/fm-true.md", "Resources/fm-yes.md", "Resources/fm-quoted.md", "Resources/innocent.md", "Projects/docs/hr.md",
      "Resources/salary-2025.md", "Resources/bank-statement.txt", "Resources/Payroll Notes/q1.md", "Resources/Finance/Owner Draw/draw.md", "Context/payroll.md", "Resources/Private/not-there.md",
      "Dashboard/private-paths.json",
    ];
    for (const route of ["view", "raw"]) for (const p of attempts) {
      const r = await get(ctx, "staff", `/api/notes/${route}?path=${enc(p)}`);
      assert.ok([403, 404].includes(r.status), `${route} ${p} -> ${r.status}`);
      for (const s of [...SECRETS, ...LISTED_SECRETS]) assert.ok(!r.text.includes(s), `${route} ${p} leaked ${s}`);
    }
    // inside granted folders the answer is the same 404 as for a name that never existed (no existence oracle)
    for (const p of ["Resources/Private/hr.md", "Resources/fm-true.md", "Resources/salary-2025.md", "Resources/Private/not-there.md"]) {
      assert.equal((await get(ctx, "staff", `/api/notes/view?path=${enc(p)}`)).status, 404, p);
    }
    assert.equal((await get(ctx, "staff", `/api/notes/view?path=${enc("Resources/nope.md")}`)).status, 404);
    // the owner can open them
    for (const p of ["Resources/Private/hr.md", "Resources/fm-true.md", "Private/Salaries.md"]) assert.equal((await get(ctx, "owner", `/api/notes/view?path=${enc(p)}`)).status, 200, p);
    assert.equal((await get(ctx, "staff", `/api/notes/view?path=${enc("Resources/ok.md")}`)).status, 200);
    assert.equal((await get(ctx, "staff", `/api/notes/raw?path=${enc("Resources/ok.md")}`)).status, 200);
  } finally { ctx.cleanup(); }
});

test("wikilinks to private notes render exactly like links that do not resolve: no link, no hint", async () => {
  const ctx = await bootPrivate();
  try {
    const r = await get(ctx, "staff", `/api/notes/view?path=${enc("Projects/Acme.md")}`);
    const body = JSON.parse(r.text);
    assert.match(body.html, /<span class="wikilink missing">Salary Review<\/span>/, "same markup as a link to a note that does not exist");
    assert.ok(!body.html.includes("private note") && !body.html.includes("wikilink private"));
    assert.ok(!body.html.includes("hr.md") && !body.html.includes("Private"));
    // the visible [[Handbook]] resolves to the visible note even though a private note of the same name sorts first
    assert.ok(body.html.includes(enc("Resources/Handbook.md")), body.html);
    assert.ok(!body.html.includes(enc("Private/Handbook.md")));
    // owner still gets a real link to the private note
    const o = JSON.parse((await get(ctx, "owner", `/api/notes/view?path=${enc("Projects/Acme.md")}`)).text);
    assert.ok(o.html.includes(enc("Resources/Private/hr.md")));
  } finally { ctx.cleanup(); }
});

test("backlinks from private notes are dropped for staff and kept for the owner", async () => {
  const ctx = await bootPrivate();
  try {
    const s = JSON.parse((await get(ctx, "staff", `/api/notes/view?path=${enc("Projects/Acme.md")}`)).text);
    assert.deepEqual(s.backlinks.map((b) => b.path).sort(), ["Resources/Handbook.md"]);
    assert.ok(!JSON.stringify(s.backlinks).includes("Salary Review"));
    const o = JSON.parse((await get(ctx, "owner", `/api/notes/view?path=${enc("Projects/Acme.md")}`)).text);
    assert.ok(o.backlinks.some((b) => b.path === "Resources/Private/hr.md"));
  } finally { ctx.cleanup(); }
});

test("a deny-list edit hides a note from tree, search and view on the next request, with no restart", async () => {
  const ctx = await bootPrivate({ config: { paths: [], patterns: [] } });
  try {
    assert.equal((await get(ctx, "staff", `/api/notes/view?path=${enc("Resources/ok.md")}`)).status, 200);
    writeConfig(ctx.vault, { paths: ["Resources/ok.md"], patterns: [] });
    assert.equal((await get(ctx, "staff", `/api/notes/view?path=${enc("Resources/ok.md")}`)).status, 404);
    assert.ok(!(await get(ctx, "staff", "/api/notes/tree")).text.includes('"name":"ok.md"'));
    assert.equal(JSON.parse((await get(ctx, "staff", "/api/notes/search?q=visible-ok-token")).text).length, 0);
    writeConfig(ctx.vault, "{ corrupt");
    assert.equal((await get(ctx, "staff", `/api/notes/view?path=${enc("Resources/ok.md")}`)).status, 404, "a half-saved list keeps the previous one");
    writeConfig(ctx.vault, { paths: [], patterns: [] });
    assert.equal((await get(ctx, "staff", `/api/notes/view?path=${enc("Resources/ok.md")}`)).status, 200);
  } finally { ctx.cleanup(); }
});

test("brain file/open (reachable by staff) follow the same rules; the brain graph stays owner-only", async () => {
  const ctx = await bootPrivate({ config: OWNER_LIST });
  try {
    for (const p of ["Resources/Private/hr.md", "resources/PRIVATE/hr.md", "Private/Salaries.md", "Resources/fm-true.md", "Resources/salary-2025.md", "Resources/Payroll Notes/q1.md"]) {
      const f = await get(ctx, "staff", `/api/brain/file?path=${enc(p)}`);
      assert.equal(f.status, 404, p);
      for (const s of [...SECRETS, ...LISTED_SECRETS]) assert.ok(!f.text.includes(s));
      const o = await ctx.req("staff", "POST", "/api/brain/open", { path: p });
      assert.equal(o.status, 404, p);
    }
    assert.equal((await get(ctx, "staff", `/api/brain/file?path=${enc("Resources/ok.md")}`)).status, 200);
    assert.equal((await get(ctx, "owner", `/api/brain/file?path=${enc("Resources/Private/hr.md")}`)).status, 200);
    for (const p of ["/api/brain/graph", "/api/brain/meta", "/api/brain/search?q=salary", "/api/brain/expand?path=Resources"]) assert.equal((await get(ctx, "staff", p)).status, 403, p);
  } finally { ctx.cleanup(); }
});

test("artifacts: staff never see or open a listed or private-marked artifact", async () => {
  const ctx = await bootPrivate({
    config: { paths: ["Dashboard/artifacts/payroll-report.html"], patterns: ["*salary*"] },
    prepare: (vault) => {
      const d = join(vault, "Dashboard", "artifacts");
      mkdirSync(d, { recursive: true });
      for (const [f, side] of [["ok-report.html", { visibility: "staff" }], ["payroll-report.html", { visibility: "staff" }], ["salary-summary.html", { visibility: "staff" }], ["flagged.html", { visibility: "staff", private: true }], ["flagged2.html", { visibility: "staff", private: "Yes" }]]) {
        writeFileSync(join(d, f), `<title>${f}</title><p>secret-art-${f}</p>`);
        writeFileSync(join(d, f.replace(".html", ".json")), JSON.stringify(side));
      }
    },
  });
  try {
    const list = JSON.parse((await get(ctx, "staff", "/api/artifacts")).text);
    assert.deepEqual(list.artifacts.map((a) => a.file), ["ok-report.html"]);
    for (const f of ["payroll-report.html", "salary-summary.html", "flagged.html", "flagged2.html"]) assert.equal((await get(ctx, "staff", `/artifacts/${f}`)).status, 403, f);
    assert.equal((await get(ctx, "staff", "/artifacts/ok-report.html")).status, 200);
    assert.equal(JSON.parse((await get(ctx, "owner", "/api/artifacts")).text).artifacts.length, 5);
    assert.equal((await get(ctx, "owner", "/artifacts/payroll-report.html")).status, 200);
  } finally { ctx.cleanup(); }
});

test("business assets: a Private category or listed pattern is invisible to staff", async () => {
  const ctx = await bootPrivate({
    config: { paths: [], patterns: ["*payroll*"] },
    staffSwitches: { assetsView: true },
    prepare: (vault, home) => {
      for (const [cat, f] of [["Insurance", "policy.txt"], ["Private", "ssn.txt"], ["Insurance", "payroll-2025.txt"]]) {
        mkdirSync(join(home, "business-assets", cat), { recursive: true });
        writeFileSync(join(home, "business-assets", cat, f), "x");
      }
    },
  });
  try {
    const s = JSON.parse((await get(ctx, "staff", "/api/assets")).text);
    assert.deepEqual(s.files.map((f) => f.name), ["policy.txt"]);
    assert.deepEqual(s.categories.map((c) => c.name), ["Insurance"]);
    assert.equal(s.categories[0].count, 1);
    const o = JSON.parse((await get(ctx, "owner", "/api/assets")).text);
    assert.equal(o.files.length, 3);
    const id = (name) => o.files.find((f) => f.name === name).id;
    assert.equal((await get(ctx, "staff", `/assets/file/${id("ssn.txt")}`)).status, 404);
    assert.equal((await get(ctx, "staff", `/assets/file/${id("payroll-2025.txt")}`)).status, 404);
    assert.equal((await get(ctx, "staff", `/assets/file/${id("policy.txt")}`)).status, 200);
    assert.equal((await ctx.req("staff", "POST", "/api/assets/favorite", { id: id("ssn.txt"), on: true })).status, 404);
    assert.equal((await get(ctx, "owner", `/assets/file/${id("ssn.txt")}`)).status, 200);
  } finally { ctx.cleanup(); }
});

test("owner user-management folder list does not offer Private folders", async () => {
  const ctx = await bootPrivate();
  try {
    const f = JSON.parse((await get(ctx, "owner", "/api/users/folders")).text);
    assert.ok(f.folders.includes("Resources") && !f.folders.some((n) => n.toLowerCase() === "private"));
  } finally { ctx.cleanup(); }
});

test("one uniform answer: private, listed, private-folder, out-of-folder and missing files are indistinguishable for staff", async () => {
  const ctx = await bootPrivate({ config: OWNER_LIST });
  try {
    const cases = ["Resources/fm-true.md", "Resources/salary-2025.md", "Resources/Private/hr.md", "Private/Salaries.md", "Context/operator.md", "Daily/2026-09-04.md", "Resources/nope.md", "Resources", "Resources/Private", "../../etc/hosts"];
    for (const route of ["view", "raw"]) {
      const seen = new Set();
      for (const p of cases) { const r = await get(ctx, "staff", `/api/notes/${route}?path=${enc(p)}`); seen.add(`${r.status} ${r.text}`); }
      assert.equal(seen.size, 1, `${route}: ${[...seen].join(" | ")}`);
      assert.equal([...seen][0], '404 {"error":"Not available"}');
    }
    // brain file/open: same single answer
    const seen = new Set();
    for (const p of cases.filter((x) => !x.includes(".."))) { const r = await get(ctx, "staff", `/api/brain/file?path=${enc(p)}`); seen.add(`${r.status} ${r.text}`); const o = await ctx.req("staff", "POST", "/api/brain/open", { path: p }); seen.add(`${o.status} ${await o.text()}`); }
    assert.deepEqual([...seen], ['404 {"error":"Not available"}']);
  } finally { ctx.cleanup(); }
});

test("stats and routines feeds are owner-only (they can carry text derived from private notes)", async () => {
  const ctx = await bootPrivate();
  try {
    for (const p of ["/api/stats", "/api/routines", "/api/snapshots/stats", "/api/snapshots/routines"]) {
      assert.equal((await get(ctx, "staff", p)).status, 403, p);
      assert.equal((await get(ctx, "owner", p)).status, 200, p);
    }
  } finally { ctx.cleanup(); }
});
