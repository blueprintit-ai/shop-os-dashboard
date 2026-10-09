// installer/steps/dashboard.js
import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { StepError, failFromResult } from "../core/errors.js";
import { resolveNode as realResolveNode } from "../node-runtime.js";
import { JsonStore } from "../../src/lib/store.js";
import * as win from "../autostart-windows.js";
import * as mac from "../autostart-macos.js";

// Windows zip: <dir>/node_modules/npm/bin/npm-cli.js. Mac tarball/Homebrew: <dir>/../lib/node_modules/npm/bin/npm-cli.js.
export function findNpmCli(nodeBin, exists) {
  const dir = dirname(nodeBin);
  return [join(dir, "node_modules", "npm", "bin", "npm-cli.js"), join(dir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")].find((p) => exists(p)) ?? null;
}

async function desktopDirFor(ctx) {
  let dir = join(ctx.homeDir, "Desktop");
  if (ctx.platform === "win32") {
    // The Desktop may be redirected (OneDrive); ask Windows where it really is.
    try {
      const r = await ctx.run("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Environment]::GetFolderPath('Desktop')"], { timeoutMs: 20000 });
      const out = r.ok ? String(r.stdout ?? "").trim() : "";
      if (out) dir = out;
    } catch { /* fall back */ }
  }
  try { mkdirSync(dir, { recursive: true }); } catch { /* the shortcut call reports it */ }
  return dir;
}

// deps (tests only): { resolveNode, spawnSyncImpl } so nothing touches the real system.
export function dashboardStep(deps = {}) {
  const resolveNode = deps.resolveNode ?? realResolveNode;
  const spawnSyncImpl = deps.spawnSyncImpl;
  const spawnOpt = spawnSyncImpl ? { spawnSyncImpl } : {};
  return {
    id: "dashboard", title: "Setting up the Blueprint OS Dashboard", severity: "warn", retries: 1,
    async action(ctx) {
      const isWin = ctx.platform === "win32";
      // The installer already runs on a suitable Node; use it unless it has no npm next to it.
      const running = ctx.nodeBin ?? process.execPath;
      let node;
      let npmCli = findNpmCli(running, ctx.exists);
      if (npmCli) {
        node = {
          node: running, npm: join(dirname(running), isWin ? "npm.cmd" : "npm"),
          version: running === process.execPath ? process.version : "unknown",
          system: !running.startsWith(ctx.shoposHome),
        };
      } else {
        node = await resolveNode({ homeDir: ctx.shoposHome, fetchImpl: ctx.fetchImpl, ...spawnOpt });
        npmCli = findNpmCli(node.node, ctx.exists);
        if (!npmCli) throw new StepError(`npm was not found next to Node at ${node.node}.`);
      }
      // `node npm-cli.js` instead of npm.cmd: Node refuses to spawn .cmd files without a shell.
      const env = ctx.childEnv();
      const pathKey = Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
      env[pathKey] = [dirname(node.node), env[pathKey] ?? ""].filter(Boolean).join(isWin ? ";" : ":");
      const r = await ctx.run(node.node, [npmCli, "install", "--omit=dev", "--no-audit", "--no-fund"], { cwd: ctx.pkgDir, env, timeoutMs: 10 * 60 * 1000 });
      if (!r.ok) failFromResult("Could not install the dashboard's dependencies.", r);
      new JsonStore(join(ctx.shoposHome, "runtime.json"), {}).save({ node: node.node, npm: node.npm, version: node.version, system: node.system });
      const dashboardBin = join(ctx.pkgDir, "bin", "shop-os-dashboard.js");
      const problems = [];
      const auto = isWin
        ? win.registerAutoStart({ nodeBin: node.node, dashboardBin, vaultPath: ctx.vaultPath, launcherDir: ctx.shoposHome, ...spawnOpt })
        : mac.registerAutoStart({ nodeBin: node.node, dashboardBin, vaultPath: ctx.vaultPath, homeOverride: ctx.homeDir, ...spawnOpt });
      if (!auto.ok) problems.push(`Could not register the dashboard to start at login: ${auto.error}`);
      const desktopDir = await desktopDirFor(ctx);
      const sc = isWin
        ? win.createDesktopShortcut({ nodeBin: node.node, dashboardBin, vaultPath: ctx.vaultPath, desktopDir, ...spawnOpt })
        : mac.createDesktopApp({ nodeBin: node.node, dashboardBin, vaultPath: ctx.vaultPath, desktopDir });
      if (!sc.ok) problems.push(`Could not create the desktop shortcut: ${sc.error}`);
      ctx.dashboardBin = dashboardBin;
      ctx.nodeBin = node.node;
      if (problems.length) throw new StepError(problems.join(" "));
    },
    verify: async (ctx) => (ctx.exists(join(ctx.pkgDir, "bin", "shop-os-dashboard.js")) ? true : "The dashboard files are missing."),
  };
}
