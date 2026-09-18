import { homedir } from "node:os";
import { join } from "node:path";

export function dashboardHome() {
  return process.env.SHOPOS_DASHBOARD_HOME || join(homedir(), ".shopos", "dashboard");
}

// The INSTALL location, distinct from dashboardHome() above (which is the
// app-DATA home: users.json, activity.jsonl, layouts, status.json). Every
// installer path — installer/run-setup.ps1's $appDir, installer/run-setup.sh's
// $APP_DIR, and bin/shop-os-dashboard-setup.js's dashboardBin — agrees on
// "~/.shopos/app" with no "dashboard" segment, so the updater has to use the
// same path or it npm-installs into a directory that does not exist.
export function shoposAppDir() {
  return process.env.SHOPOS_APP_DIR || join(homedir(), ".shopos", "app");
}

// The runtime record written by setup (bin/shop-os-dashboard-setup.js) holding
// the absolute node/npm paths resolveNode() picked, so the running dashboard
// can find npm later without depending on PATH.
export function shoposRuntimeFile() {
  return process.env.SHOPOS_RUNTIME_FILE || join(homedir(), ".shopos", "runtime.json");
}

export function vaultDashboardDir(vaultPath) {
  return join(vaultPath, "Dashboard");
}
