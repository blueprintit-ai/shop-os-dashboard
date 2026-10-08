import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createContext } from "../installer/core/context.js";
import { detectClaudeDesktop } from "../installer/core/desktop.js";
import { collectSnapshot } from "../installer/core/snapshot.js";
import { claudePath, listPlugins, authOk } from "../installer/core/claude.js";

test("childEnv prepends extraPath and reuses the existing Path key on Windows", () => {
  const ctx = createContext({ platform: "win32", env: { Path: "C:\\Windows" }, extraPath: ["C:\\mingit\\cmd"] });
  const env = ctx.childEnv();
  assert.equal(env.Path, "C:\\mingit\\cmd;C:\\Windows");
  assert.equal(env.PATH, undefined);
});

test("childEnv uses PATH and ':' on mac", () => {
  const ctx = createContext({ platform: "darwin", env: { PATH: "/usr/bin" }, extraPath: ["/x"] });
  assert.equal(ctx.childEnv().PATH, "/x:/usr/bin");
});

test("overridden childEnv, tmpDir and snapshot are respected", async () => {
  const childEnv = () => ({ MARK: "1" });
  const tmpDir = () => "/custom/tmp";
  const snap = { os: "fake" };
  const snapshot = async () => snap;
  const ctx = createContext({ childEnv, tmpDir, snapshot });
  assert.equal(ctx.childEnv, childEnv);
  assert.equal(ctx.tmpDir(), "/custom/tmp");
  assert.equal(await ctx.snapshot(), snap);
});

test("default pkgDir is the package root; explicit pkgDir wins", () => {
  const ctx = createContext({});
  assert.ok(existsSync(join(ctx.pkgDir, "package.json")));
  assert.ok(existsSync(join(ctx.pkgDir, "bin")));
  assert.equal(createContext({ pkgDir: "/elsewhere" }).pkgDir, "/elsewhere");
});

test("default snapshot memoizes collectSnapshot", async () => {
  let calls = 0;
  const ctx = createContext({
    platform: "darwin", homeDir: "/h", exists: () => false, env: {},
    run: async () => { calls++; return { ok: false, stdout: "" }; },
    fetchImpl: async () => { calls++; return { ok: true }; },
  });
  const a = await ctx.snapshot();
  const before = calls;
  const b = await ctx.snapshot();
  assert.equal(a, b);
  assert.equal(calls, before);
});

test("claudePath prefers the absolute install location (Review Focus 5)", () => {
  const ctx = createContext({ platform: "win32", homeDir: "C:\\Users\\a", exists: (p) => p.endsWith("claude.exe") });
  assert.match(claudePath(ctx), /\.local[\\/]bin[\\/]claude\.exe$/);
  const none = createContext({ platform: "darwin", homeDir: "/h", exists: () => false });
  assert.equal(claudePath(none), "claude");
});

test("listPlugins parses claude plugin list --json", async () => {
  const run = async () => ({ ok: true, stdout: JSON.stringify([{ id: "a@b", enabled: true }, { id: "c@d", enabled: false }]) });
  const ctx = createContext({ run, exists: () => false });
  assert.deepEqual(await listPlugins(ctx), [{ id: "a@b", enabled: true }, { id: "c@d", enabled: false }]);
});

test("listPlugins returns [] on failure or bad JSON", async () => {
  assert.deepEqual(await listPlugins(createContext({ run: async () => ({ ok: false, stdout: "" }) })), []);
  assert.deepEqual(await listPlugins(createContext({ run: async () => ({ ok: true, stdout: "not json" }) })), []);
});

test("authOk follows the exit code", async () => {
  assert.equal(await authOk(createContext({ run: async () => ({ ok: true }) })), true);
  assert.equal(await authOk(createContext({ run: async () => ({ ok: false }) })), false);
});

test("Desktop detection checks the platform's candidate paths", () => {
  const mac = detectClaudeDesktop({ platform: "darwin", env: {}, homeDir: "/Users/a", exists: (p) => p === "/Applications/Claude.app" });
  assert.deepEqual(mac, { installed: true, path: "/Applications/Claude.app" });
  const none = detectClaudeDesktop({ platform: "win32", env: { LOCALAPPDATA: "C:\\L" }, homeDir: "C:\\u", exists: () => false });
  assert.equal(none.installed, false);
});

test("snapshot assembles from injected probes and never throws", async () => {
  const run = async (cmd) => ({ ok: cmd === "git" || cmd === "net", stdout: "git version 2" });
  const snap = await collectSnapshot({
    platform: "win32", arch: "x64", env: { HTTPS_PROXY: "http://p:1" }, homeDir: "C:\\u", run, exists: () => false,
    fetchImpl: async (url) => { if (url.includes("npmjs")) throw new Error("down"); return { ok: true }; },
    statfs: () => ({ bavail: 1000, bsize: 1024 * 1024 }), nodeVersion: "v22.1.0",
  });
  assert.equal(snap.free_disk_mb, 1000);
  assert.equal(snap.proxy, true);
  assert.deepEqual(snap.reach, { github: true, npm: false, claude_ai: true });
  assert.equal(snap.git, true);
  assert.equal(snap.elevated, true);
  assert.equal(snap.desktop, false);
});

test("snapshot never throws when every probe throws, and uses HEAD with a signal", async () => {
  const seen = [];
  const boom = () => { throw new Error("boom"); };
  const snap = await collectSnapshot({
    platform: "win32", env: {}, homeDir: "C:\\u", run: boom, exists: boom,
    fetchImpl: async (url, opts) => { seen.push(opts); throw new Error("down"); },
    statfs: boom,
  });
  assert.equal(snap.free_disk_mb, -1);
  assert.equal(snap.git, false);
  assert.equal(snap.elevated, false);
  assert.equal(snap.desktop, false);
  assert.deepEqual(snap.reach, { github: false, npm: false, claude_ai: false });
  assert.equal(seen.length, 3);
  for (const o of seen) { assert.equal(o.method, "HEAD"); assert.ok(o.signal); }
});

test("SHOPOS_NODE_BIN from the starter becomes ctx.nodeBin when the file exists; otherwise it is ignored", () => {
  const ok = createContext({ platform: "darwin", env: { SHOPOS_NODE_BIN: "/opt/homebrew/bin/node" }, exists: (p) => p === "/opt/homebrew/bin/node" });
  assert.equal(ok.nodeBin, "/opt/homebrew/bin/node");
  const missing = createContext({ platform: "darwin", env: { SHOPOS_NODE_BIN: "/gone/node" }, exists: () => false });
  assert.equal(missing.nodeBin, undefined);
  const unset = createContext({ platform: "darwin", env: {}, exists: () => true });
  assert.equal(unset.nodeBin, undefined);
  const explicit = createContext({ platform: "darwin", nodeBin: "/mine/node", env: { SHOPOS_NODE_BIN: "/opt/homebrew/bin/node" }, exists: () => true });
  assert.equal(explicit.nodeBin, "/mine/node");
});
