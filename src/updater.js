import { spawnSync as defaultSpawnSync } from "node:child_process";

function parts(v) { return v.replace(/^v/, "").split(".").map(Number); }
function isNewer(latest, current) {
  const a = parts(latest), b = parts(current);
  for (let i = 0; i < 3; i++) { if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0); }
  return false;
}

export async function checkForUpdate({ currentVersion, fetchImpl = fetch }) {
  try {
    const resp = await fetchImpl("https://registry.npmjs.org/@blueprintitai/shop-os-dashboard/latest");
    if (!resp.ok) return { updateAvailable: false, latest: currentVersion };
    const body = await resp.json();
    const latest = body.version ?? currentVersion;
    return { updateAvailable: isNewer(latest, currentVersion), latest };
  } catch {
    return { updateAvailable: false, latest: currentVersion };
  }
}

export function applyUpdate({ appDir, npmBin, spawnSyncImpl = defaultSpawnSync }) {
  const result = spawnSyncImpl(npmBin, ["install", "@blueprintitai/shop-os-dashboard@latest"], { cwd: appDir, encoding: "utf8" });
  if (result.status !== 0) return { ok: false, error: result.stderr || `npm install exited ${result.status}` };
  return { ok: true };
}
