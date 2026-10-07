// test/steps-back.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext } from "../installer/core/context.js";
import { runSteps } from "../installer/core/runner.js";
import { obsidianStep } from "../installer/steps/obsidian.js";
import { vaultStep } from "../installer/steps/vault.js";
import { dashboardStep, findNpmCli } from "../installer/steps/dashboard.js";

const quiet = { sleep: async () => {} };
const home = () => mkdtempSync(join(tmpdir(), "bp-home-"));
const lic = { key: "SHOP-AB12-CD34-EF56", customer: "Scott", product: "p", entitlements: [], valid_until: null };

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
    fetchImpl: async (url) => url.includes("api.github.com")
      ? { ok: true, json: async () => ({ assets: [{ name: "Obsidian-1.9.0.exe", browser_download_url: "https://x/Obsidian-1.9.0.exe" }] }) }
      : { ok: true, arrayBuffer: async () => new ArrayBuffer(8) },
  });
  const r = await runSteps([obsidianStep()], ctx, quiet);
  assert.equal(r.ok, true, JSON.stringify(r.failed));
  assert.equal(calls[0][0], "powershell");
  assert.deepEqual(calls[0][1].slice(0, 2), ["-NoProfile", "-Command"]);
  const script = calls[0][1][2];
  assert.match(script, /Start-Process/);
  assert.match(script, /-Wait/);
  assert.match(script, /-ArgumentList '\/S'/);
  assert.match(script, /exit \$p\.ExitCode/);
  assert.equal(calls[0][2].timeoutMs, 300000);
});

test("obsidian: single quotes in the installer path are doubled", async () => {
  const calls = [];
  let installed = false;
  const tmp = join(mkdtempSync(join(tmpdir(), "bp-tmp-")), "O'Brien");
  mkdirSync(tmp, { recursive: true });
  const ctx = createContext({
    platform: "win32", homeDir: "C:\\u", env: { LOCALAPPDATA: "C:\\u\\AppData\\Local" }, print: () => {}, tmpDir: () => tmp,
    exists: (p) => installed && p.endsWith("Obsidian.exe"),
    run: async (cmd, args) => { calls.push(args[2]); installed = true; return { ok: true, stdout: "", outTail: "", cmdline: cmd }; },
    fetchImpl: async (url) => url.includes("api.github.com")
      ? { ok: true, json: async () => ({ assets: [{ name: "Obsidian-1.9.0.exe", browser_download_url: "u" }] }) }
      : { ok: true, arrayBuffer: async () => new ArrayBuffer(8) },
  });
  assert.equal((await runSteps([obsidianStep()], ctx, quiet)).ok, true);
  assert.match(calls[0], /O''Brien/);
  assert.doesNotMatch(calls[0], /[^']O'Brien/);
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
    fetchImpl: async (url) => url.includes("api.github.com")
      ? { ok: true, json: async () => ({ assets: [{ name: "Obsidian-1.9.0.dmg", browser_download_url: "u" }] }) }
      : { ok: true, arrayBuffer: async () => new ArrayBuffer(8) },
  });
  const r = await runSteps([obsidianStep()], ctx, { sleep: async () => {}, retryDelayMs: 0 });
  assert.equal(r.ok, true);
  assert.ok(r.warnings.length === 1);
  assert.ok(calls.includes("hdiutil") && calls.at(-1) === "hdiutil", "detach runs last even on copy failure");
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
  const nodeBin = join(nodeDir, "node");
  const cli = join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js");
  mkdirSync(join(h, "pkg", "bin"), { recursive: true });
  writeFileSync(join(h, "pkg", "bin", "shop-os-dashboard.js"), "");
  const runs = [];
  const spawns = [];
  const ctx = createContext({
    platform, homeDir: h, print: () => {}, vaultPath: join(h, "Vault"), pkgDir: join(h, "pkg"),
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
  assert.deepEqual(d.runs[0][1], [d.cli, "install", "--omit=dev"]);
  assert.equal(d.runs[0][2].cwd, d.ctx.pkgDir);
  const schtasks = d.spawns.find((s) => s[0] === "schtasks");
  assert.ok(schtasks && schtasks[1].includes("/f") && schtasks[1].includes("ShopOSDashboard"));
  assert.ok(d.spawns.some((s) => s[0] === "cscript"));
  assert.equal(d.ctx.nodeBin, d.nodeBin);
  assert.equal(d.ctx.dashboardBin, join(d.ctx.pkgDir, "bin", "shop-os-dashboard.js"));
  assert.ok(existsSync(join(d.ctx.shoposHome, "runtime.json")));
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
