// installer/steps/dashboard.js
import { join, dirname } from "node:path";
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

// deps (tests only): { resolveNode, spawnSyncImpl } so nothing touches the real system.
export function dashboardStep(deps = {}) {
  const resolveNode = deps.resolveNode ?? realResolveNode;
  const spawnSyncImpl = deps.spawnSyncImpl;
  const spawnOpt = spawnSyncImpl ? { spawnSyncImpl } : {};
  return {
    id: "dashboard", title: "Setting up the Blueprint OS Dashboard", severity: "warn", retries: 1,
    async action(ctx) {
      const node = await resolveNode({ homeDir: ctx.shoposHome, fetchImpl: ctx.fetchImpl, ...spawnOpt });
      const npmCli = findNpmCli(node.node, ctx.exists);
      if (!npmCli) throw new StepError(`npm was not found next to Node at ${node.node}.`);
      // `node npm-cli.js` instead of npm.cmd: Node refuses to spawn .cmd files without a shell.
      const r = await ctx.run(node.node, [npmCli, "install", "--omit=dev"], { cwd: ctx.pkgDir, env: ctx.childEnv(), timeoutMs: 10 * 60 * 1000 });
      if (!r.ok) failFromResult("Could not install the dashboard's dependencies.", r);
      new JsonStore(join(ctx.shoposHome, "runtime.json"), {}).save({ node: node.node, npm: node.npm, version: node.version, system: node.system });
      const dashboardBin = join(ctx.pkgDir, "bin", "shop-os-dashboard.js");
      const isWin = ctx.platform === "win32";
      const auto = isWin
        ? win.registerAutoStart({ nodeBin: node.node, dashboardBin, vaultPath: ctx.vaultPath, ...spawnOpt })
        : mac.registerAutoStart({ nodeBin: node.node, dashboardBin, vaultPath: ctx.vaultPath, homeOverride: ctx.homeDir, ...spawnOpt });
      if (!auto.ok) throw new StepError(`Could not register the dashboard to start at login: ${auto.error}`);
      const desktopDir = join(ctx.homeDir, "Desktop");
      const sc = isWin
        ? win.createDesktopShortcut({ nodeBin: node.node, dashboardBin, vaultPath: ctx.vaultPath, desktopDir, ...spawnOpt })
        : mac.createDesktopApp({ nodeBin: node.node, dashboardBin, vaultPath: ctx.vaultPath, desktopDir });
      if (!sc.ok) throw new StepError(`Could not create the desktop shortcut: ${sc.error}`);
      ctx.dashboardBin = dashboardBin;
      ctx.nodeBin = node.node;
    },
    verify: async (ctx) => (ctx.exists(join(ctx.pkgDir, "bin", "shop-os-dashboard.js")) ? true : "The dashboard files are missing."),
  };
}
