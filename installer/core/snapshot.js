import { statfsSync, existsSync } from "node:fs";
import { homedir, type as osType, release as osRelease } from "node:os";
import { runCommand } from "./exec.js";
import { detectClaudeDesktop } from "./desktop.js";

const HOSTS = { github: "https://github.com", npm: "https://registry.npmjs.org", claude_ai: "https://claude.ai" };

async function reachable(fetchImpl, url, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try { await fetchImpl(url, { method: "HEAD", signal: ctl.signal }); return true; } catch { return false; } finally { clearTimeout(t); }
}

// Never throws: every probe is guarded.
export async function collectSnapshot({
  platform = process.platform, arch = process.arch, env = process.env, homeDir = homedir(), run = runCommand,
  exists = existsSync, fetchImpl = fetch, statfs = statfsSync, nodeVersion = process.version, timeoutMs = 5000,
} = {}) {
  const safe = async (fn, fallback) => { try { return await fn(); } catch { return fallback; } };
  const elevated = platform === "win32"
    ? !!(await safe(() => run("net", ["session"], { timeoutMs: 8000 }), { ok: false }))?.ok
    : !!(await safe(() => process.getuid?.() === 0, false));
  const disk = await safe(() => { const s = statfs(homeDir); return Math.floor((s.bavail * s.bsize) / (1024 * 1024)); }, -1);
  const [github, npm, claude_ai] = await Promise.all(Object.values(HOSTS).map((u) => reachable(fetchImpl, u, timeoutMs)));
  const git = !!(await safe(() => run("git", ["--version"], { timeoutMs: 8000 }), { ok: false }))?.ok;
  const proxy = ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"].some((k) => !!env?.[k]);
  const desktop = await safe(() => detectClaudeDesktop({ platform, env, homeDir, exists }).installed, false);
  const os = await safe(() => `${osType()} ${osRelease()}`, "unknown");
  return { os, arch, elevated, node: nodeVersion, free_disk_mb: disk, proxy, reach: { github, npm, claude_ai }, git, desktop };
}
