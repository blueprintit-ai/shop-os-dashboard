// test/steps-back.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext } from "../installer/core/context.js";
import { runSteps } from "../installer/core/runner.js";
import { obsidianStep, OBSIDIAN_FALLBACK_VERSION } from "../installer/steps/obsidian.js";
import { vaultStep } from "../installer/steps/vault.js";
import { dashboardStep, findNpmCli } from "../installer/steps/dashboard.js";

const redirectTo = (v) => ({ ok: false, status: 302, headers: new Headers({ location: `https://github.com/obsidianmd/obsidian-releases/releases/tag/v${v}` }) });
const quiet = { sleep: async () => {} };
const home = () => mkdtempSync(join(tmpdir(), "bp-home-"));
const lic = { key: "SHOP-AB12-CD34-EF56", customer: "Test Customer", product: "p", entitlements: [], valid_until: null };

test("obsidian: skipped when already installed (Windows per-user path)", async () => {
  const ctx = createContext({ platform: "win32", homeDir: "C:\\u", env: { LOCALAPPDATA: "C:\\u\\AppData\\Local" }, print: () => {}, exists: (p) => p.endsWith("Obsidian.exe") });
  assert.equal((await runSteps([obsidianStep()], ctx, quiet)).timeline[0].status, "skipped");
});

test("obsidian: Windows installs via Start-Process -Wait (no pipe hang), quotes escaped", async () => {
  const calls = [];
  let installed = false;
  const tmp = mkdtempSync(join(tmpdir(), "bp-tmp-"));
  const ctx = createContext({
    platform: "win32", homeDir: "C:\\Users\\O'Brien", env: { LOCALAPPDATA: "C:\\u\\AppData\\Local" }, print: () => {}, tmpDir: () => tmp,
    exists: (p) => installed && p.endsWith("Obsidian.exe"),
    run: async (cmd, args, opts) => { calls.push([cmd, args, opts]); installed = true; return { ok: true, stdout: "", outTail: "", cmdline: cmd }; },
    fetchImpl: async (url) => url.endsWith("/releases/latest")
      ? redirectTo("1.9.0")
      : { ok: true, arrayBuffer: async () => new ArrayBuffer(8) },
  });
  const r = await runSteps([obsidianStep()], ctx, quiet);
  assert.equal(r.ok, true, JSON.stringify(r.failed));
  assert.equal(calls[0][0], "powershell");
  assert.deepEqual(calls[0][1].slice(0, 2), ["-NoProfile", "-Command"]);
  const script = calls[0][1][2];
  assert.match(script, /Start-Process/);
  assert.match(script, /-Wait/);
  assert.match(script, /-PassThru/);
  assert.match(script, /\$env:BP_OBS_EXE/);
  assert.match(script, /ErrorActionPreference = 'Stop'/);
  assert.ok(calls[0][2].env.BP_OBS_EXE.endsWith("Obsidian-1.9.0.exe"));
  assert.match(script, /-ArgumentList '\/S'/);
  assert.match(script, /exit \$p\.ExitCode/);
  assert.equal(calls[0][2].timeoutMs, 300000);
});

test("obsidian: awkward installer paths go only through the environment", async () => {
  for (const name of ["O'Brien", "Jos\u2019e"]) {
    const calls = [];
    let installed = false;
    const tmp = join(mkdtempSync(join(tmpdir(), "bp-tmp-")), name);
    mkdirSync(tmp, { recursive: true });
    const ctx = createContext({
      platform: "win32", homeDir: "C:\\u", env: { LOCALAPPDATA: "C:\\u\\AppData\\Local" }, print: () => {}, tmpDir: () => tmp,
      exists: (p) => installed && p.endsWith("Obsidian.exe"),
      run: async (cmd, args, opts) => { calls.push([args[2], opts.env.BP_OBS_EXE]); installed = true; return { ok: true, stdout: "", outTail: "", cmdline: cmd }; },
      fetchImpl: async (url) => url.endsWith("/releases/latest")
        ? redirectTo("1.9.0")
        : { ok: true, arrayBuffer: async () => new ArrayBuffer(8) },
    });
    assert.equal((await runSteps([obsidianStep()], ctx, quiet)).ok, true);
    assert.ok(calls[0][1].includes(name));
    assert.ok(!calls[0][0].includes(name));
  }
});

test("obsidian: temp download dir is removed after success, failure and failed retries", async () => {
  const mk = (runOk, fetchBody) => {
    const tmp = mkdtempSync(join(tmpdir(), "bp-tmp-"));
    let installed = false;
    const ctx = createContext({
      platform: "win32", homeDir: "C:\\u", env: { LOCALAPPDATA: "C:\\u\\AppData\\Local" }, print: () => {}, tmpDir: () => tmp,
      exists: (p) => installed && p.endsWith("Obsidian.exe"),
      run: async (cmd) => { installed = runOk; return { ok: runOk, stdout: "", outTail: "x", cmdline: cmd, code: 1 }; },
      fetchImpl: async (url) => url.endsWith("/releases/latest")
        ? redirectTo("1.9.0")
        : fetchBody,
    });
    return { tmp, ctx };
  };
  const okBody = { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  let t = mk(true, okBody);
  await runSteps([obsidianStep()], t.ctx, quiet);
  assert.deepEqual(readdirSync(t.tmp), []);
  t = mk(false, okBody); // installer fails on all 3 attempts
  const r = await runSteps([obsidianStep()], t.ctx, { sleep: async () => {}, retryDelayMs: 0 });
  assert.equal(r.warnings.length, 1);
  assert.deepEqual(readdirSync(t.tmp), []);
});

test("obsidian: streaming download branch (web ReadableStream body) writes the file", async () => {
  const calls = [];
  const tmp = mkdtempSync(join(tmpdir(), "bp-tmp-"));
  let installed = false;
  let size = -1;
  const ctx = createContext({
    platform: "win32", homeDir: "C:\\u", env: { LOCALAPPDATA: "C:\\u\\AppData\\Local" }, print: () => {}, tmpDir: () => tmp,
    exists: (p) => installed && p.endsWith("Obsidian.exe"),
    run: async (cmd, args, opts) => { size = readFileSync(opts.env.BP_OBS_EXE).length; installed = true; return { ok: true, stdout: "", outTail: "", cmdline: cmd }; },
    fetchImpl: async (url) => url.endsWith("/releases/latest")
      ? redirectTo("1.9.0")
      : { ok: true, body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(5)); c.enqueue(new Uint8Array(7)); c.close(); } }) },
  });
  assert.equal((await runSteps([obsidianStep()], ctx, quiet)).ok, true);
  assert.equal(size, 12);
});

test("obsidian: Mac mounts the dmg, copies the app, always detaches", async () => {
  const calls = [];
  const h = home();
  const tmp = mkdtempSync(join(tmpdir(), "bp-tmp-"));
  let copied = false;
  const ctx = createContext({
    platform: "darwin", homeDir: h, print: () => {}, tmpDir: () => tmp,
    exists: (p) => copied && p === join(h, "Applications", "Obsidian.app"),
    run: async (cmd, args) => { calls.push(cmd); if (cmd === "ditto") { copied = true; return { ok: false, outTail: "boom", cmdline: "ditto" }; } return { ok: true, stdout: "", outTail: "", cmdline: cmd }; },
    fetchImpl: async (url) => url.endsWith("/releases/latest")
      ? redirectTo("1.9.0")
      : { ok: true, arrayBuffer: async () => new ArrayBuffer(8) },
  });
  const r = await runSteps([obsidianStep()], ctx, { sleep: async () => {}, retryDelayMs: 0 });
  assert.equal(r.ok, true);
  assert.ok(r.warnings.length === 1);
  assert.ok(calls.includes("hdiutil") && calls.at(-1) === "hdiutil", "detach runs last even on copy failure");
  assert.ok(!existsSync(join(h, "Applications", "Obsidian.app.partial")));
  assert.deepEqual(readdirSync(tmp), []);
});

test("obsidian lookup: follows the releases/latest redirect, never touches api.github.com, right asset per platform", async () => {
  for (const [platform, ext] of [["win32", "exe"], ["darwin", "dmg"]]) {
    const urls = [];
    const inits = [];
    const tmp = mkdtempSync(join(tmpdir(), "bp-tmp-"));
    const ctx = createContext({
      platform, homeDir: "/h", env: { LOCALAPPDATA: "C:\\u" }, print: () => {}, tmpDir: () => tmp, exists: () => false,
      run: async (cmd) => ({ ok: false, outTail: "stop", cmdline: cmd }),
      fetchImpl: async (url, init) => { urls.push(url); inits.push(init); return url.endsWith("/releases/latest") ? redirectTo("2.3.4") : { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; },
    });
    await runSteps([obsidianStep()], ctx, { sleep: async () => {}, retryDelayMs: 0 });
    assert.equal(urls[0], "https://github.com/obsidianmd/obsidian-releases/releases/latest");
    assert.equal(inits[0].redirect, "manual");
    assert.ok(inits[0].headers["User-Agent"]);
    assert.equal(urls[1], `https://github.com/obsidianmd/obsidian-releases/releases/download/v2.3.4/Obsidian-2.3.4.${ext}`);
    assert.ok(urls.every((u) => !u.includes("api.github.com")));
  }
});

test("obsidian lookup: network error, non-302 and unparsable Location fall back to the pinned version", async () => {
  const cases = {
    "network error": async () => { throw new Error("ECONNRESET"); },
    "HTTP 403": async () => ({ ok: false, status: 403, headers: new Headers() }),
    "200 without redirect": async () => ({ ok: true, status: 200, headers: new Headers() }),
    "unparsable Location": async () => ({ ok: false, status: 302, headers: new Headers({ location: "https://github.com/login?return_to=x" }) }),
    "hostile Location": async () => ({ ok: false, status: 302, headers: new Headers({ location: "https://github.com/x/tag/v1.2.3/../../evil" }) }),
  };
  for (const [name, lookup] of Object.entries(cases)) {
    const urls = [];
    const tmp = mkdtempSync(join(tmpdir(), "bp-tmp-"));
    const ctx = createContext({
      platform: "win32", homeDir: "C:\\u", env: { LOCALAPPDATA: "C:\\u" }, print: () => {}, tmpDir: () => tmp, exists: () => false,
      run: async (cmd) => ({ ok: false, outTail: "stop", cmdline: cmd }),
      fetchImpl: async (url, init) => { urls.push(url); return url.endsWith("/releases/latest") ? lookup() : { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; },
    });
    await runSteps([obsidianStep()], ctx, { sleep: async () => {}, retryDelayMs: 0 });
    const dl = urls.filter((u) => u.includes("/download/"));
    assert.ok(dl.length > 0 && dl.every((u) => u === `https://github.com/obsidianmd/obsidian-releases/releases/download/v${OBSIDIAN_FALLBACK_VERSION}/Obsidian-${OBSIDIAN_FALLBACK_VERSION}.exe`), name);
    assert.ok(urls.every((u) => !u.includes("api.github.com")), name);
  }
  assert.match(OBSIDIAN_FALLBACK_VERSION, /^\d+\.\d+\.\d+$/);
});

test("obsidian failure is a warning, not a stop", async () => {
  const ctx = createContext({ platform: "darwin", homeDir: "/h", print: () => {}, exists: () => false, fetchImpl: async () => ({ ok: false, status: 500 }) });
  const r = await runSteps([obsidianStep()], ctx, quiet);
  assert.equal(r.ok, true);
  assert.equal(r.warnings.length, 1);
});

test("vault: creates files, never overwrites an existing CLAUDE.md, records state", async () => {
  const h = home();
  const vault = join(h, "Dropbox", "Shop OS");
  mkdirSync(vault, { recursive: true });
  writeFileSync(join(vault, "CLAUDE.md"), "MY EXISTING FILE");
  const ctx = createContext({ platform: "darwin", homeDir: h, print: () => {}, vaultPath: vault, license: lic });
  const r = await runSteps([vaultStep()], ctx, quiet);
  assert.equal(r.ok, true, JSON.stringify(r.failed));
  assert.equal(readFileSync(join(vault, "CLAUDE.md"), "utf8"), "MY EXISTING FILE");
  assert.ok(existsSync(join(vault, "Raw", "README.md")));
  assert.ok(existsSync(join(vault, ".claude", "settings.json")));
  assert.ok(existsSync(join(h, ".shopos", "license.json")));
  assert.equal(JSON.parse(readFileSync(join(h, ".shopos", "install-state.json"), "utf8")).vaultPath, vault);
  // safe to re-run
  assert.equal((await runSteps([vaultStep()], ctx, quiet)).ok, true);
  assert.equal(readFileSync(join(vault, "CLAUDE.md"), "utf8"), "MY EXISTING FILE");
});

test("vault: invalid-JSON settings.json is backed up and surfaced in ctx.notes, step still ok", async () => {
  const h = home();
  const vault = join(h, "V");
  mkdirSync(join(vault, ".claude"), { recursive: true });
  writeFileSync(join(vault, ".claude", "settings.json"), "{not json");
  const printed = [];
  const ctx = createContext({ platform: "darwin", homeDir: h, print: (m) => printed.push(m), vaultPath: vault, license: lic });
  const r = await runSteps([vaultStep()], ctx, quiet);
  assert.equal(r.ok, true, JSON.stringify(r.failed));
  assert.ok(readdirSync(join(vault, ".claude")).some((f) => f.includes("bak")));
  assert.equal(ctx.notes.length, 1);
  assert.ok(printed.some((m) => m.includes(ctx.notes[0])));
});

test("vault: preserves an existing installedAt; null license is a clear StepError", async () => {
  const h = home();
  const vault = join(h, "V");
  const ctx = createContext({ platform: "darwin", homeDir: h, print: () => {}, vaultPath: vault, license: lic });
  await runSteps([vaultStep()], ctx, quiet);
  const p = join(h, ".shopos", "install-state.json");
  const first = JSON.parse(readFileSync(p, "utf8")).installedAt;
  await runSteps([vaultStep()], ctx, quiet);
  assert.equal(JSON.parse(readFileSync(p, "utf8")).installedAt, first);
  const bad = createContext({ platform: "darwin", homeDir: home(), print: () => {}, vaultPath: vault, license: null });
  const r = await runSteps([vaultStep()], bad, quiet);
  assert.equal(r.ok, false);
  assert.match(JSON.stringify(r.failed), /without a validated license/);
});

test("vault: a folder name with spaces and non-ASCII works (Review Focus 1)", async () => {
  const h = home();
  const vault = join(h, "Jos\u00e9 Garc\u00eda", "Blueprint OS");
  const ctx = createContext({ platform: "win32", homeDir: h, print: () => {}, vaultPath: vault, license: { ...lic, customer: "J" } });
  assert.equal((await runSteps([vaultStep()], ctx, quiet)).ok, true);
  assert.ok(existsSync(join(vault, "CLAUDE.md")));
});

test("findNpmCli handles both layouts", () => {
  const w = join("C:", "n", "node.exe");
  const winCli = join("C:", "n", "node_modules", "npm", "bin", "npm-cli.js");
  assert.equal(findNpmCli(w, (p) => p === winCli), winCli);
  const macCli = join("/r", "bin", "..", "lib", "node_modules", "npm", "bin", "npm-cli.js");
  assert.equal(findNpmCli(join("/r", "bin", "node"), (p) => p === macCli), macCli);
  assert.equal(findNpmCli("/x/node", () => false), null);
});

function dashCtx(platform) {
  const h = home();
  const nodeDir = join(h, "nodebin");
  mkdirSync(nodeDir, { recursive: true });
  const nodeBin = join(nodeDir, "node");
  const cli = join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js");
  mkdirSync(join(h, "pkg", "bin"), { recursive: true });
  writeFileSync(join(h, "pkg", "bin", "shop-os-dashboard.js"), "");
  const runs = [];
  const spawns = [];
  const ctx = createContext({
    platform, homeDir: h, nodeBin, print: () => {}, vaultPath: join(h, "Vault"), pkgDir: join(h, "pkg"),
    exists: (p) => p === cli || existsSync(p),
    run: async (cmd, args, opts) => { runs.push([cmd, args, opts]); return { ok: true, stdout: "", outTail: "", cmdline: cmd }; },
  });
  const deps = {
    resolveNode: async () => ({ node: nodeBin, npm: "npm", version: "v22.0.0", system: false }),
    spawnSyncImpl: (cmd, args) => { spawns.push([cmd, args]); return { status: 0 }; },
  };
  return { h, ctx, deps, runs, spawns, nodeBin, cli };
}

test("dashboard: Windows installs deps via node npm-cli.js and registers task + shortcut (faked system)", async () => {
  const d = dashCtx("win32");
  const r = await runSteps([dashboardStep(d.deps)], d.ctx, quiet);
  assert.equal(r.ok, true, JSON.stringify(r.failed));
  assert.equal(d.runs[0][0], d.nodeBin);
  assert.deepEqual(d.runs[0][1], [d.cli, "install", "--omit=dev", "--no-audit", "--no-fund"]);
  assert.ok(d.runs[0][2].env.PATH.startsWith(join(d.h, "nodebin")) || d.runs[0][2].env.Path?.startsWith(join(d.h, "nodebin")));
  assert.equal(d.runs[0][2].cwd, d.ctx.pkgDir);
  const schtasks = d.spawns.find((s) => s[0] === "schtasks");
  assert.ok(schtasks && schtasks[1].includes("/f") && schtasks[1].includes("ShopOSDashboard"));
  assert.ok(d.spawns.some((s) => s[0] === "cscript"));
  assert.equal(d.ctx.nodeBin, d.nodeBin);
  assert.equal(d.ctx.dashboardBin, join(d.ctx.pkgDir, "bin", "shop-os-dashboard.js"));
  const rt = JSON.parse(readFileSync(join(d.ctx.shoposHome, "runtime.json"), "utf8"));
  assert.equal(rt.node, d.nodeBin);
  assert.equal(rt.npm, join(d.h, "nodebin", "npm.cmd"));
  assert.equal(rt.system, true); // not under the shopos home
});

test("dashboard: no resolveNode call when the running node has npm-cli.js; falls back when it does not", async () => {
  const d = dashCtx("darwin");
  let called = 0;
  d.deps.resolveNode = async () => { called++; throw new Error("must not be called"); };
  assert.equal((await runSteps([dashboardStep(d.deps)], d.ctx, quiet)).ok, true);
  assert.equal(called, 0);
  assert.equal(JSON.parse(readFileSync(join(d.ctx.shoposHome, "runtime.json"), "utf8")).npm, join(d.h, "nodebin", "npm"));
  const e = dashCtx("darwin");
  const other = join(e.h, "other", "node");
  mkdirSync(join(e.h, "other", "node_modules", "npm", "bin"), { recursive: true });
  writeFileSync(join(e.h, "other", "node_modules", "npm", "bin", "npm-cli.js"), "");
  e.ctx.nodeBin = join(e.h, "nonpm", "node");
  let c2 = 0;
  e.deps.resolveNode = async () => { c2++; return { node: other, npm: "npm", version: "v1", system: false }; };
  assert.equal((await runSteps([dashboardStep(e.deps)], e.ctx, quiet)).ok, true);
  assert.equal(c2, 1);
});

test("dashboard: Windows Desktop is resolved from PowerShell (OneDrive redirect)", async () => {
  const d = dashCtx("win32");
  const od = join(d.h, "OneDrive", "Desktop");
  const baseRun = d.ctx.run;
  d.ctx.run = async (cmd, args, opts) => cmd === "powershell" ? { ok: true, stdout: od + "\r\n", outTail: "", cmdline: cmd } : baseRun(cmd, args, opts);
  assert.equal((await runSteps([dashboardStep(d.deps)], d.ctx, quiet)).ok, true);
  assert.ok(existsSync(od));
});

test("dashboard: the Desktop lookup forces UTF-8 output (non-ASCII profile names)", async () => {
  const d = dashCtx("win32");
  const baseRun = d.ctx.run; let psCmd = null;
  d.ctx.run = async (cmd, args, opts) => { if (cmd === "powershell") { psCmd = args.join(" "); return { ok: true, stdout: "", outTail: "", cmdline: cmd }; } return baseRun(cmd, args, opts); };
  await runSteps([dashboardStep(d.deps)], d.ctx, quiet);
  assert.match(psCmd, /^-NoProfile -Command \[Console\]::OutputEncoding\s*=\s*\[(System\.)?Text\.Encoding\]::UTF8;.*GetFolderPath\('Desktop'\)/);
});

test("dashboard: both autostart and shortcut failures are reported in one error", async () => {
  const d = dashCtx("win32");
  d.deps.spawnSyncImpl = () => ({ status: 1, stderr: "denied" });
  const r = await runSteps([dashboardStep(d.deps)], d.ctx, { sleep: async () => {}, retryDelayMs: 0 });
  const txt = JSON.stringify(r.warnings);
  assert.match(txt, /start at login/);
  assert.match(txt, /desktop shortcut/);
});

test("dashboard: Mac writes plist and desktop app only under the fake home, launchctl faked", async () => {
  const d = dashCtx("darwin");
  const r = await runSteps([dashboardStep(d.deps)], d.ctx, quiet);
  assert.equal(r.ok, true, JSON.stringify(r.failed));
  assert.ok(d.spawns.some((s) => s[0] === "launchctl"));
  assert.ok(existsSync(join(d.h, "Library", "LaunchAgents", "ai.blueprintit.shop-os-dashboard.plist")));
  assert.ok(existsSync(join(d.h, "Desktop", "Blueprint OS.app")));
});

test("dashboard: autostart failure is a warning with a readable message", async () => {
  const d = dashCtx("win32");
  d.deps.spawnSyncImpl = () => ({ status: 1, stderr: "denied" });
  const r = await runSteps([dashboardStep(d.deps)], d.ctx, { sleep: async () => {}, retryDelayMs: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.warnings.length, 1);
});
