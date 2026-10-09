import { homedir, tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { runCommand } from "./exec.js";
import { collectSnapshot } from "./snapshot.js";

export const DEFAULT_LICENSE_SERVER = "https://shop-os-license-server.glenn-15d.workers.dev";

// installer/core/context.js -> package root is two directories up.
const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function createContext(overrides = {}) {
  const platform = overrides.platform ?? process.platform;
  const homeDir = overrides.homeDir ?? homedir();
  const shoposHome = overrides.shoposHome ?? join(homeDir, ".shopos");
  const ctx = {
    platform, arch: process.arch, env: process.env, homeDir, shoposHome,
    fetchImpl: fetch, run: runCommand, exists: existsSync,
    licenseServer: DEFAULT_LICENSE_SERVER, licenseKey: null, license: null, vaultPath: null,
    flags: { noLaunch: false }, extraPath: [], runId: null, supportCode: null, reporter: null,
    pkgDir: PKG_ROOT,
    print: (m) => console.log(m),
    readText: (p) => readFileSync(p, "utf8"),
    // Timers are injectable so tests run on fake time; they never keep the process alive on their own.
    setInterval: (fn, ms) => { const h = setInterval(fn, ms); h?.unref?.(); return h; },
    clearInterval: (h) => clearInterval(h),
    prompt: async (q, def = "") => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try { const a = (await rl.question(def ? `${q} [${def}] ` : `${q} `)).trim(); return a || def; } finally { rl.close(); }
    },
    ...overrides,
  };
  // Defaults only when the caller did not inject their own.
  ctx.childEnv ??= () => {
    const env = { ...ctx.env };
    const key = Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
    env[key] = [...ctx.extraPath, env[key] ?? ""].filter(Boolean).join(ctx.platform === "win32" ? ";" : ":");
    return env;
  };
  // The starter exports the node it found (a stable path such as /opt/homebrew/bin/node); process.execPath
  // may be a version-specific, symlink-resolved Cellar path that goes stale on the next `brew upgrade`.
  const starterNode = ctx.env?.SHOPOS_NODE_BIN;
  if (!ctx.nodeBin && starterNode && ctx.exists(starterNode)) ctx.nodeBin = starterNode;
  ctx.tmpDir ??= () => { const d = join(tmpdir(), "blueprint-os-install"); mkdirSync(d, { recursive: true }); return d; };
  if (!ctx.snapshot) {
    let snap = null;
    ctx.snapshot = async () => (snap ??= await collectSnapshot({ platform, arch: ctx.arch, env: ctx.env, homeDir, run: ctx.run, exists: ctx.exists, fetchImpl: ctx.fetchImpl }));
  }
  return ctx;
}
