// Detect an already-running dashboard for the same vault, so the desktop
// shortcut does not start a second server (e.g. on 50001) next to the one
// autostart launched at login.
import { createHash } from "node:crypto";
import { resolve } from "node:path";

export const APP_ID = "shop-os-dashboard";

// First 16 hex chars of sha256(resolved absolute vault path). A fingerprint,
// not the path, so /api/ping leaks nothing about the machine.
export function vaultFingerprint(vaultPath) {
  let p = resolve(vaultPath);
  if (process.platform === "win32") p = p.toLowerCase();
  return createHash("sha256").update(p).digest("hex").slice(0, 16);
}

export async function findRunningInstance({ vaultPath, fetchImpl = fetch, start = 50000, end = 50010, timeoutMs = 300 }) {
  const want = vaultFingerprint(vaultPath);
  const ports = [];
  for (let p = start; p <= end; p++) ports.push(p);
  const hits = await Promise.all(ports.map(async (port) => {
    try {
      const res = await fetchImpl(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return null;
      const body = await res.json();
      return body?.app === APP_ID && body.vault === want ? port : null;
    } catch {
      return null; // refused, timed out, not JSON: not ours
    }
  }));
  const port = hits.find((p) => p !== null);
  return port === undefined ? null : { port };
}

// Only called when the caller decides probing is allowed; with an explicit
// --port we never probe (CI health step, tests, power users).
export async function decideStartup({ vaultPath, port, noBrowser, openPath = "", fetchImpl = fetch }) {
  if (port) return { action: "start" };
  const found = await findRunningInstance({ vaultPath, fetchImpl });
  if (!found) return { action: "start" };
  const base = `http://localhost:${found.port}`;
  // openPath (already validated by the CLI, e.g. "/employee") is where the browser goes; the message names the server.
  return { action: "attach", url: base + openPath, openBrowser: !noBrowser, message: `Blueprint OS is already running at ${base}` };
}
