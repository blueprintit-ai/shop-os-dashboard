import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runSkill, readRunHistory, SKILLS } from "../src/runs.js";
import { createServer } from "../src/server.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "vault");

async function* fakeRunTurn({ prompt }) {
  yield { type: "session", claudeSessionId: "sess-1" };
  yield { type: "text", delta: `## Result\nRan ${prompt}\n\n- one\n- two\n` };
  yield { type: "done", text: `## Result\nRan ${prompt}\n\n- one\n- two\n`, stats: { duration_ms: 1200 } };
}

test("SKILLS carries the three spec defaults", () => {
  const ids = SKILLS.map((s) => s.id);
  assert.deepEqual(ids, ["bp-digest", "morning-briefing", "bp-optimizer"]);
});

test("runSkill writes a run log, an HTML report artifact with a visibility field, its sidecar, and a run-history row", async () => {
  const vault = mkdtempSync(join(tmpdir(), "sod-runs-"));
  const job = await runSkill({
    vaultPath: vault, skillId: "bp-digest", input: "", model: "SONNET", effort: "MEDIUM",
    runTurn: fakeRunTurn, audit: { log() {} },
  });
  assert.equal(job.status, "done");
  const artifactsDir = join(vault, "Dashboard", "artifacts");
  const html = readFileSync(join(artifactsDir, job.reportFile), "utf8");
  assert.match(html, /Ran \/bp-digest/);
  const sidecar = JSON.parse(readFileSync(join(artifactsDir, job.reportFile.replace(/\.html$/, ".json")), "utf8"));
  assert.equal(sidecar.kind, "run");
  assert.equal(sidecar.visibility, "owner");
  const history = readRunHistory(vault);
  assert.equal(history[0].id, "bp-digest");
  assert.equal(history[0].exit, 0);
  rmSync(vault, { recursive: true, force: true });
});

test("runSkill records a failed run without throwing", async () => {
  async function* failingRunTurn() {
    yield { type: "error", message: "boom" };
  }
  const vault = mkdtempSync(join(tmpdir(), "sod-runs-"));
  const job = await runSkill({
    vaultPath: vault, skillId: "bp-optimizer", input: "", model: "HAIKU", effort: "LOW",
    runTurn: failingRunTurn, audit: { log() {} },
  });
  assert.equal(job.status, "failed");
  assert.equal(readRunHistory(vault)[0].exit, 1);
  rmSync(vault, { recursive: true, force: true });
});

async function bootAsOwner() {
  const root = mkdtempSync(join(tmpdir(), "sod-runs-routes-"));
  const vault = join(root, "vault"); cpSync(FIX, vault, { recursive: true });
  const server = createServer({ vaultPath: vault, homeDir: join(root, "home"), runTurn: fakeRunTurn, licenseCheck: () => ({ ok: true }) });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const b = `http://127.0.0.1:${server.address().port}`;

  const setup = await fetch(`${b}/api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: b },
    body: JSON.stringify({ displayName: "Glenn", username: "glenn", password: "longenough1" }),
  });
  const jar = { owner: setup.headers.get("set-cookie").split(";")[0] };

  const staffRes = await fetch(`${b}/api/users`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: b, cookie: jar.owner },
    body: JSON.stringify({ displayName: "Staff User", username: "staff", password: "longenough2", role: "staff" }),
  });
  await staffRes.json();

  const staffLogin = await fetch(`${b}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: b },
    body: JSON.stringify({ username: "staff", password: "longenough2" }),
  });
  jar.staff = staffLogin.headers.get("set-cookie").split(";")[0];

  return {
    server, jar, root,
    cleanup: () => { server.close(); server.ctx.index.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

function base(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

test("GET /api/runs and POST /api/runs are owner-only", async () => {
  const { server, jar, cleanup } = await bootAsOwner();
  const b = base(server);
  try {
    assert.equal((await fetch(`${b}/api/runs`, { headers: { cookie: jar.staff } })).status, 403);
    const list = await fetch(`${b}/api/runs`, { headers: { cookie: jar.owner } });
    assert.equal(list.status, 200);
    assert.ok(Array.isArray((await list.json()).skills));

    const post = await fetch(`${b}/api/runs`, {
      method: "POST", headers: { cookie: jar.owner, "content-type": "application/json", origin: b },
      body: JSON.stringify({ id: "unknown-skill" }),
    });
    assert.equal(post.status, 400);
  } finally {
    cleanup();
  }
});

test("POST /api/runs runs a known skill end-to-end through the fake runTurn", async () => {
  const { server, jar, cleanup } = await bootAsOwner();
  const b = base(server);
  try {
    const post = await fetch(`${b}/api/runs`, {
      method: "POST", headers: { cookie: jar.owner, "content-type": "application/json", origin: b },
      body: JSON.stringify({ id: "bp-digest" }),
    });
    assert.equal(post.status, 200);
    const job = await post.json();
    assert.equal(job.status, "done");
    assert.equal(job.id, "bp-digest");

    const list = await fetch(`${b}/api/runs`, { headers: { cookie: jar.owner } });
    const { runs } = await list.json();
    assert.equal(runs[0].id, "bp-digest");
  } finally {
    cleanup();
  }
});
