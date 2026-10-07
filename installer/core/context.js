import { homedir, tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";
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
  ctx.tmpDir ??= () => { const d = join(tmpdir(), "blueprint-os-install"); mkdirSync(d, { recursive: true }); return d; };
  if (!ctx.snapshot) {
    let snap = null;
    ctx.snapshot = async () => (snap ??= await collectSnapshot({ platform, arch: ctx.arch, env: ctx.env, homeDir, run: ctx.run, exists: ctx.exists, fetchImpl: ctx.fetchImpl }));
  }
  return ctx;
}
