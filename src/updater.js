import { spawnSync as defaultSpawnSync, spawn as defaultSpawn } from "node:child_process";

// A hung `npm install` on a single-threaded http server would otherwise block
// every other request forever (see update-routes.js's in-flight guard for the
// other half of that fix).
export const UPDATE_TIMEOUT_MS = 120000;

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

export function applyUpdate({ appDir, npmBin, spawnSyncImpl = defaultSpawnSync, timeoutMs = UPDATE_TIMEOUT_MS }) {
  // On Windows the resolved npm is `npm.cmd`, a batch file: spawnSync cannot
  // execute it without a shell (ENOENT / EINVAL otherwise). With shell:true the
  // command is handed to cmd.exe as a string, so the path — which routinely
  // contains spaces (C:\Users\First Last\...) — has to be quoted.
  const useShell = /\.cmd$/i.test(npmBin ?? "");
  const command = useShell ? `"${npmBin}"` : npmBin;
  const result = spawnSyncImpl(command, ["install", "@blueprintitai/shop-os-dashboard@latest"], {
    cwd: appDir, encoding: "utf8", timeout: timeoutMs, ...(useShell ? { shell: true } : {}),
  });
  if (result.error) return { ok: false, error: result.error.message };
  if (result.status !== 0) return { ok: false, error: result.stderr || `npm install exited ${result.status}` };
  return { ok: true };
}

// Restarting by exiting and trusting the OS auto-start mechanism does not work:
// the launchd agent is RunAtLoad/KeepAlive:false and the Windows scheduled task
// is /sc ONLOGON — both fire at login only, never after a clean exit. So the
// process relaunches itself, detached, before exiting. Injectable for tests:
// actually spawning a second dashboard in CI is not something to assert on.
export function makeRestart({
  spawnImpl = defaultSpawn,
  exitImpl = () => process.exit(0),
  execPath = process.execPath,
  argv = process.argv.slice(1),
} = {}) {
  return () => {
    try {
      const child = spawnImpl(execPath, argv, { detached: true, stdio: "ignore" });
      child?.unref?.();
    } catch (e) {
      console.error("[updater] could not relaunch after update:", e.message);
    }
    exitImpl();
  };
}
