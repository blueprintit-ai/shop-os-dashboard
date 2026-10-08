import { join } from "node:path";

export function claudePath(ctx) {
  const p = join(ctx.homeDir, ".local", "bin", ctx.platform === "win32" ? "claude.exe" : "claude");
  return ctx.exists(p) ? p : "claude";
}

export async function claudeVersion(ctx) {
  const r = await ctx.run(claudePath(ctx), ["--version"], { env: ctx.childEnv(), timeoutMs: 30000 });
  return r.ok ? String(r.stdout ?? "").trim() : null;
}

export async function listPlugins(ctx) {
  try {
    const r = await ctx.run(claudePath(ctx), ["plugin", "list", "--json"], { env: ctx.childEnv(), timeoutMs: 60000 });
    if (!r.ok) return [];
    const j = JSON.parse(r.stdout);
    return Array.isArray(j) ? j.map(({ id, enabled }) => ({ id, enabled })) : [];
  } catch { return []; }
}

export async function authOk(ctx) {
  const r = await ctx.run(claudePath(ctx), ["auth", "status"], { env: ctx.childEnv(), timeoutMs: 30000 });
  return !!r.ok;
}
