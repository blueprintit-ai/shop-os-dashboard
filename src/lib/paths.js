import { homedir } from "node:os";
import { join } from "node:path";

export function dashboardHome() {
  return process.env.SHOPOS_DASHBOARD_HOME || join(homedir(), ".shopos", "dashboard");
}

export function vaultDashboardDir(vaultPath) {
  return join(vaultPath, "Dashboard");
}
