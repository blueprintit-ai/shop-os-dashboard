// test/steps-claude.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createContext } from "../installer/core/context.js";
import { runSteps } from "../installer/core/runner.js";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureGit } from "../installer/steps/git.js";
import { claudeCodeStep } from "../installer/steps/claude-code.js";
import { pluginsStep, PLUGIN_IDS } from "../installer/steps/plugins.js";

const quiet = { sleep: async () => {} };
const ok = (stdout = "") => ({ ok: true, code: 0, stdout, outTail: "", cmdline: "x" });
const bad = (outTail) => ({ ok: false, code: 1, stdout: "", outTail, cmdline: "x" });

test("claude-code: skipped when claude already runs", async () => {
  const calls = [];
  const ctx = createContext({ platform: "darwin", print: () => {}, run: async (c, a) => { calls.push([c, a]); return ok("2.1.292 (Claude Code)"); } });
  const r = await runSteps([claudeCodeStep()], ctx, quiet);
  assert.equal(r.timeline[0].status, "skipped");
  assert.deepEqual(calls[0][1], ["--version"]);
});

test("claude-code: downloads the official installer to a file and runs it (Windows: -File, never iex)", async () => {
  const calls = [];
  let installed = false;
  const run = async (cmd, args) => {
    calls.push([cmd, args]);
    if (args[0] === "--version") return installed ? ok("2.1.292") : bad("not found");
    installed = true;
    return ok("done");
  };
  const ctx = createContext({ platform: "win32", homeDir: "C:\\u", print: () => {}, run, exists: () => installed, fetchImpl: async () => ({ ok: true, status: 200, text: async () => "Write-Host hi" }) });
  const r = await runSteps([claudeCodeStep()], ctx, quiet);
  assert.equal(r.ok, true);
  const install = calls.find(([c]) => c === "powershell");
  assert.ok(install[1].includes("-File"));
  assert.ok(!install[1].join(" ").match(/iex|Invoke-Expression/i));
});

test("claude-code: fails with the installer's output tail when claude still does not run", async () => {
  const ctx = createContext({ platform: "darwin", print: () => {}, run: async (c, a) => (a?.[0] === "--version" ? bad("") : bad("curl: (6) Could not resolve host")), fetchImpl: async () => ({ ok: true, status: 200, text: async () => "#!/bin/bash" }) });
  const r = await runSteps([claudeCodeStep()], ctx, quiet);
  assert.equal(r.ok, false);
  assert.match(r.failed.outTail, /Could not resolve host/);
});

function pluginCtx({ already = [], failOn = null } = {}) {
  const calls = [];
  let enabled = [...already];
  const run0 = async (cmd, args) => {
    calls.push(args.join(" "));
    if (args[0] === "--version") return ok("git version 2");
    if (args.join(" ") === "plugin list --json") return ok(JSON.stringify(enabled.map((id) => ({ id, enabled: true }))));
    if (failOn && args.join(" ").includes(failOn)) return bad("× Failed");
    if (args[1] === "install") enabled.push(args[2]);
    return ok();
  };
  const run = async (cmd, args) => ({ ...(await run0(cmd, args)), cmdline: args.join(" ") });
  const ctx = createContext({ platform: "darwin", print: () => {}, run, exists: () => false, shoposHome: "/tmp/bp-test-shopos",
    fetchImpl: async () => { throw new Error("tarball fetch is stubbed"); } });
  return { ctx, calls };
}

test("plugins: skipped when both are already enabled", async () => {
  const { ctx } = pluginCtx({ already: PLUGIN_IDS });
  const r = await runSteps([pluginsStep({ fetchTarball: async () => ({ ok: true }) })], ctx, quiet);
  assert.equal(r.timeline[0].status, "skipped");
});

test("plugins: adds both marketplaces, installs both at user scope, verifies via list", async () => {
  const { ctx, calls } = pluginCtx();
  const r = await runSteps([pluginsStep({ fetchTarball: async () => ({ ok: true }) })], ctx, quiet);
  assert.equal(r.ok, true, JSON.stringify(r.failed));
  assert.ok(calls.some((c) => c.startsWith("plugin marketplace add") && c.includes("blueprint-skills")));
  assert.ok(calls.includes("plugin marketplace add anthropics/claude-plugins-official"));
  assert.ok(calls.includes("plugin install obsidian@blueprint-skills --scope user"));
  assert.ok(calls.includes("plugin install superpowers@claude-plugins-official --scope user"));
});

test("plugins: 'already added/installed' is tolerated on a re-run (Review Focus 3)", async () => {
  const { ctx } = pluginCtx({ failOn: "marketplace add" });
  const run = ctx.run;
  ctx.run = async (c, a) => { const r = await run(c, a); return !r.ok && a[1] === "marketplace" ? { ...r, outTail: "Marketplace 'x' already exists" } : r; };
  const r = await runSteps([pluginsStep({ fetchTarball: async () => ({ ok: true }) })], ctx, quiet);
  assert.equal(r.ok, true, JSON.stringify(r.failed));
});

test("plugins: a real failure surfaces the command and output", async () => {
  const { ctx } = pluginCtx({ failOn: "plugin install superpowers" });
  const r = await runSteps([pluginsStep({ fetchTarball: async () => ({ ok: true }) })], ctx, quiet);
  assert.equal(r.ok, false);
  assert.match(r.failed.command, /plugin install superpowers/);
});

test("plugins: a failed tarball download is a stop with the URL's error", async () => {
  const { ctx } = pluginCtx();
  const r = await runSteps([pluginsStep({ fetchTarball: async () => ({ ok: false, error: "HTTP 503 fetching x" }) })], ctx, quiet);
  assert.match(r.failed.error, /503/);
});

test("claude-code/plugins: after install, claude is called by absolute path even though it is not on PATH", async () => {
  const abs = "/home/u/.local/bin/claude";
  const cmds = [];
  let installed = false;
  const run = async (cmd, args) => {
    cmds.push(cmd);
    if (cmd === "/bin/bash") { installed = true; return ok(); }
    if (args[0] === "--version") return cmd === abs && installed ? ok("2.1.292") : bad("not found");
    return ok();
  };
  const ctx = createContext({ platform: "darwin", homeDir: "/home/u", print: () => {}, run, exists: (p) => installed && p === abs, fetchImpl: async () => ({ ok: true, status: 200, text: async () => "#!/bin/bash" }) });
  const r = await runSteps([claudeCodeStep()], ctx, quiet);
  assert.equal(r.ok, true, JSON.stringify(r.failed));
  assert.equal(cmds[cmds.length - 1], abs);
});

test("plugins: plugin commands run via the absolute claude path", async () => {
  const abs = "/home/u/.local/bin/claude";
  const cmds = [];
  const enabled = [];
  const run = async (cmd, args) => {
    cmds.push(cmd);
    if (args[0] === "--version") return ok("git version 2");
    if (args.join(" ") === "plugin list --json") return ok(JSON.stringify(enabled.map((id) => ({ id, enabled: true }))));
    if (args[1] === "install") enabled.push(args[2]);
    return ok();
  };
  const ctx = createContext({ platform: "darwin", homeDir: "/home/u", print: () => {}, run, exists: (p) => p === abs, shoposHome: "/tmp/bp-test-shopos" });
  const r = await runSteps([pluginsStep({ fetchTarball: async () => ({ ok: true }) })], ctx, quiet);
  assert.equal(r.ok, true, JSON.stringify(r.failed));
  assert.ok(cmds.filter((c) => c !== "git" && c !== "xcode-select").every((c) => c === abs));
});

test("ensureGit: Mac with the tools but no working git throws a hinted StepError", async () => {
  const ctx = createContext({ platform: "darwin", print: () => {}, run: async (c) => (c === "xcode-select" ? ok("/Library/Developer/CommandLineTools") : bad("git: command not found")) });
  await assert.rejects(ensureGit(ctx), (e) => e.name === "StepError" && /xcode-select/.test(e.hint));
});

test("ensureGit: Mac without Command Line Tools never runs git, triggers the installer once and explains what to do", async () => {
  const calls = [];
  const ctx = createContext({ platform: "darwin", print: () => {}, run: async (c, a) => { calls.push([c, ...a].join(" ")); return c === "xcode-select" && a[0] === "-p" ? bad("xcode-select: error: unable to get active developer directory") : ok(); } });
  await assert.rejects(ensureGit(ctx), (e) => e.name === "StepError" && /Command Line Tools/.test(e.message) && /click Install/i.test(e.message) && /run this setup again/i.test(e.message) && /xcode-select --install/.test(e.hint));
  assert.ok(!calls.some((c) => c.startsWith("git")), calls.join("|"));
  assert.equal(calls.filter((c) => c === "xcode-select --install").length, 1);
});

test("ensureGit: Windows never consults xcode-select", async () => {
  const calls = [];
  const ctx = createContext({ platform: "win32", print: () => {}, run: async (c) => { calls.push(c); return ok("git version 2"); } });
  await ensureGit(ctx);
  assert.deepEqual(calls, ["git"]);
});


// ---- ensureGit (Windows) ----
function zipOf(entries) {
  const local = []; const central = []; let offset = 0;
  for (const [name, content] of entries) {
    const nb = Buffer.from(name); const data = Buffer.from(content);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(offset, 42);
    local.push(lh, nb, data); central.push(ch, nb); offset += 30 + nb.length + data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, eocd]);
}
const sha = (b) => createHash("sha256").update(b).digest("hex");
const GOOD = zipOf([["cmd/git.exe", "MZ"]]);
const ARM = zipOf([["cmd/git.exe", "MZ-arm"]]);
const MG = { version: "t", assets: { x64: { url: "https://dl/x64.zip", sha256: sha(GOOD) }, arm64: { url: "https://dl/arm64.zip", sha256: sha(ARM) } } };

function winGit({ arch = "x64", bytes = { "https://dl/x64.zip": GOOD, "https://dl/arm64.zip": ARM }, fetchImpl } = {}) {
  const home = mkdtempSync(join(tmpdir(), "bp-git-"));
  const urls = [];
  const gitCalls = [];
  const run = async (c, a, o) => {
    const pathKey = Object.keys(o?.env ?? {}).find((k) => k.toLowerCase() === "path");
    const withMingit = !!pathKey && o.env[pathKey].includes("mingit");
    gitCalls.push(withMingit);
    return withMingit ? ok("git version 2") : bad("git: not found");
  };
  const f = fetchImpl ?? (async (u) => { urls.push(u); return bytes[u] ? { ok: true, status: 200, arrayBuffer: async () => bytes[u] } : { ok: false, status: 404 }; });
  const ctx = createContext({ platform: "win32", arch, homeDir: home, shoposHome: home, print: () => {}, run, fetchImpl: f, env: { PATH: "C:\\Windows" } });
  return { ctx, home, urls, gitCalls, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

test("ensureGit: verifies the hash, extracts a real zip, renames partial -> mingit, adds PATH once", async () => {
  const t = winGit();
  try {
    await ensureGit(t.ctx, { mingit: MG });
    await ensureGit(t.ctx, { mingit: MG });
    assert.ok(existsSync(join(t.home, "tools", "mingit", "cmd", "git.exe")));
    assert.ok(!existsSync(join(t.home, "tools", "mingit.partial")));
    assert.equal(t.ctx.extraPath.length, 1);
    assert.deepEqual(t.urls, ["https://dl/x64.zip"]); // second run used the cache
  } finally { t.cleanup(); }
});

test("ensureGit: arm64 picks the arm64 entry", async () => {
  const t = winGit({ arch: "arm64" });
  try {
    await ensureGit(t.ctx, { mingit: MG });
    assert.deepEqual(t.urls, ["https://dl/arm64.zip"]);
  } finally { t.cleanup(); }
});

test("ensureGit: a hash mismatch is a StepError and nothing is extracted", async () => {
  const t = winGit({ bytes: { "https://dl/x64.zip": zipOf([["cmd/git.exe", "EVIL"]]) } });
  try {
    await assert.rejects(ensureGit(t.ctx, { mingit: MG }), (e) => e.name === "StepError" && /integrity check/.test(e.message));
    assert.ok(!existsSync(join(t.home, "tools", "mingit")));
    assert.ok(!existsSync(join(t.home, "tools", "mingit.partial")));
    assert.equal(t.ctx.extraPath.length, 0);
  } finally { t.cleanup(); }
});

test("ensureGit: HTTP and network errors name the URL", async () => {
  const t = winGit({ bytes: {} });
  const t2 = winGit({ fetchImpl: async () => { throw new Error("ECONNRESET"); } });
  try {
    await assert.rejects(ensureGit(t.ctx, { mingit: MG }), (e) => e.name === "StepError" && /404/.test(e.message) && e.message.includes("https://dl/x64.zip"));
    await assert.rejects(ensureGit(t2.ctx, { mingit: MG }), (e) => e.name === "StepError" && e.message.includes("https://dl/x64.zip") && /ECONNRESET/.test(e.message));
  } finally { t.cleanup(); t2.cleanup(); }
});

test("ensureGit: a cached mingit whose git does not run is re-extracted", async () => {
  const t = winGit();
  try {
    const dir = join(t.home, "tools", "mingit");
    mkdirSync(join(dir, "cmd"), { recursive: true });
    writeFileSync(join(dir, "cmd", "git.exe"), "broken");
    writeFileSync(join(dir, "stale.txt"), "x");
    // First git check with the cached copy "fails": simulate by making run fail until the stale file is gone.
    const orig = t.ctx.run;
    t.ctx.run = async (c, a, o) => (existsSync(join(dir, "stale.txt")) ? bad("broken") : orig(c, a, o));
    await ensureGit(t.ctx, { mingit: MG });
    assert.deepEqual(t.urls, ["https://dl/x64.zip"]);
    assert.ok(!existsSync(join(dir, "stale.txt")));
    assert.ok(existsSync(join(dir, "cmd", "git.exe")));
  } finally { t.cleanup(); }
});

test("ensureGit: an interrupted mingit.partial is cleaned and never looks complete", async () => {
  const t = winGit();
  try {
    const partial = join(t.home, "tools", "mingit.partial");
    mkdirSync(join(partial, "cmd"), { recursive: true });
    writeFileSync(join(partial, "cmd", "git.exe"), "half");
    writeFileSync(join(partial, "leftover.txt"), "x");
    await ensureGit(t.ctx, { mingit: MG });
    assert.ok(!existsSync(partial));
    assert.ok(!existsSync(join(t.home, "tools", "mingit", "leftover.txt")));
  } finally { t.cleanup(); }
});

// ---- plugins: per-action tolerance ----
function tolerance({ marketplaceOut, installOut, timedOut = false }) {
  const ctxp = pluginCtx();
  const base = ctxp.ctx.run;
  ctxp.ctx.run = async (c, a, o) => {
    const isMp = a[1] === "marketplace";
    const isInst = a[1] === "install" && a[2].startsWith("obsidian");
    if (isMp && marketplaceOut) return { ok: false, code: 1, stdout: "", outTail: marketplaceOut, cmdline: a.join(" "), timedOut };
    if (isInst && installOut) { await base(c, a, o); return { ok: false, code: 1, stdout: "", outTail: installOut, cmdline: a.join(" "), timedOut }; }
    return base(c, a, o);
  };
  return ctxp.ctx;
}
const runPlugins = (ctx) => runSteps([pluginsStep({ fetchTarball: async () => ({ ok: true }) })], ctx, quiet);

test("plugins: marketplace add tolerates 'already exists'; install tolerates 'already installed'", async () => {
  assert.equal((await runPlugins(tolerance({ marketplaceOut: "Marketplace already exists" }))).ok, true);
  assert.equal((await runPlugins(tolerance({ installOut: "Plugin already installed" }))).ok, true);
});

test("plugins: 'already installed' on a marketplace add is NOT tolerated", async () => {
  const r = await runPlugins(tolerance({ marketplaceOut: "already installed" }));
  assert.equal(r.ok, false);
  assert.match(r.failed.command, /plugin marketplace add/);
});

test("plugins: a timed-out run is never tolerated", async () => {
  const r = await runPlugins(tolerance({ marketplaceOut: "already exists", timedOut: true }));
  assert.equal(r.ok, false);
  assert.match(r.failed.error, /timed out/);
});

test("plugins: a non-'already' marketplace add failure stops with the command and output", async () => {
  const r = await runPlugins(tolerance({ marketplaceOut: "fatal: could not resolve host" }));
  assert.equal(r.ok, false);
  assert.match(r.failed.command, /plugin marketplace add/);
  assert.match(r.failed.outTail, /could not resolve host/);
});

test("claude-code: the downloaded installer file is unique and removed afterwards", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "bp-cc-"));
  const seen = [];
  try {
    const ctx = createContext({ platform: "darwin", print: () => {}, tmpDir: () => tmp,
      run: async (c, a) => { if (c === "/bin/bash") { seen.push(a[0]); return ok(); } return bad("nope"); },
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => "#!/bin/bash" }) });
    await runSteps([claudeCodeStep()], ctx, quiet);
    assert.equal(seen.length > 0, true);
    assert.match(seen[0], /claude-install-[0-9a-f-]{36}\.sh$/);
    assert.deepEqual(readdirSync(tmp), []);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("claude-code: a network error names the URL", async () => {
  const ctx = createContext({ platform: "darwin", print: () => {}, run: async () => bad("nope"), fetchImpl: async () => { throw new Error("ENOTFOUND"); } });
  const r = await runSteps([claudeCodeStep()], ctx, quiet);
  assert.equal(r.ok, false);
  assert.match(r.failed.error, /https:\/\/claude\.ai\/install\.sh/);
});
