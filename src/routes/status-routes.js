import { requireUser } from "../auth.js";
import { sendJson } from "../lib/http.js";
import { checkStatus } from "../status.js";

export function statusRoutes({ auth, vaultPath, statusStore, licenseCheck, port }) {
  return async (req, res, url) => {
    if (url.pathname !== "/api/status" || req.method !== "GET") return false;
    const user = requireUser(req, res, auth); if (!user) return true;
    return sendJson(res, 200, checkStatus({ vaultPath, statusStore, licenseCheck, port })), true;
  };
}
