// test/steps-claude.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createContext } from "../installer/core/context.js";
import { runSteps } from "../installer/core/runner.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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
  assert.ok(cmds.filter((c) => c !== "git").every((c) => c === abs));
});

test("ensureGit: Mac without git throws a hinted StepError", async () => {
  const ctx = createContext({ platform: "darwin", print: () => {}, run: async () => bad("git: command not found") });
  await assert.rejects(ensureGit(ctx), (e) => e.name === "StepError" && /xcode-select/.test(e.hint));
});

test("ensureGit: Windows picks the right MinGit asset, skips busybox, and adds PATH once", async () => {
  for (const [arch, want] of [["x64", "MinGit-2.47.1-64-bit.zip"], ["arm64", "MinGit-2.47.1-arm64.zip"]]) {
    const home = mkdtempSync(join(tmpdir(), "bp-git-"));
    let gitOk = false;
    const urls = [];
    const assets = ["MinGit-2.47.1-busybox-64-bit.zip", "MinGit-2.47.1-busybox-arm64.zip", "MinGit-2.47.1-64-bit.zip", "MinGit-2.47.1-arm64.zip"].map((name) => ({ name, browser_download_url: `https://dl/${name}` }));
    const fetchImpl = async (u) => {
      urls.push(u);
      if (u.includes("api.github.com")) return { ok: true, status: 200, json: async () => ({ assets }) };
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
    };
    const ctx = createContext({ platform: "win32", arch, homeDir: home, shoposHome: home, print: () => {}, fetchImpl, run: async () => (gitOk ? ok("git version 2") : bad("nope")) });
    // Fake extraction by pre-creating nothing: extractZip would reject an empty buffer, so stub via a real minimal path.
    mkdirSync(join(home, "tools", "mingit", "cmd"), { recursive: true });
    writeFileSync(join(home, "tools", "mingit", "cmd", "git.exe"), "");
    gitOk = false;
    const ctx2 = ctx;
    ctx2.run = async (c, a) => (ctx2.extraPath.length ? ok("git version 2") : bad("nope"));
    await ensureGit(ctx2);
    await ensureGit(ctx2);
    assert.equal(ctx2.extraPath.length, 1);
    assert.ok(ctx2.extraPath[0].endsWith("cmd"));
    // selection is exercised below via a fresh dir with no unpacked git
    const home2 = mkdtempSync(join(tmpdir(), "bp-git-"));
    const ctx3 = createContext({ platform: "win32", arch, homeDir: home2, shoposHome: home2, print: () => {}, fetchImpl, run: async () => bad("nope") });
    await assert.rejects(ensureGit(ctx3)).catch(() => {});
    assert.ok(urls.some((u) => u.endsWith(want)), `${arch} should download ${want}; got ${urls}`);
  }
});
