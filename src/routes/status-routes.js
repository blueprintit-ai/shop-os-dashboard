import { requireUser } from "../auth.js";
import { sendJson } from "../lib/http.js";
import { checkStatus } from "../status.js";
import { privateListStatus } from "../scope.js";
import { APP_ID, vaultFingerprint } from "../lib/instance.js";

export function statusRoutes({ auth, vaultPath, statusStore, licenseCheck, port, updateInfo, lanAddresses }) {
  const fingerprint = vaultFingerprint(vaultPath);
  return async (req, res, url) => {
    // Unauthenticated on purpose: a second launch uses it to detect that this
    // vault's dashboard is already running. Exposes nothing but these 3 fields.
    if (url.pathname === "/api/ping" && req.method === "GET") return sendJson(res, 200, { app: APP_ID, vault: fingerprint, port }), true;
    if (url.pathname !== "/api/status" || req.method !== "GET") return false;
    const user = requireUser(req, res, auth); if (!user) return true;
    const body = checkStatus({ vaultPath, statusStore, licenseCheck, port, updateInfo, lan: lanAddresses });
    // owners only: whether the private-files list (Dashboard/private-paths.json) is working
    if (user.role === "owner") {
      const s = privateListStatus(vaultPath);
      body.privateList = { state: s.state === "invalid-fail-closed" ? "failClosed" : s.state === "invalid-kept-previous" ? "keptLastGood" : "ok", ignoredEntries: s.ignoredEntries };
    }
    return sendJson(res, 200, body), true;
  };
}
