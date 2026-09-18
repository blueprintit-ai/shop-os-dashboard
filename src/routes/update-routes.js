import { requireOwner } from "../auth.js";
import { sendJson } from "../lib/http.js";
import { applyUpdate } from "../updater.js";

export function updateRoutes({ auth, audit, appDir, npmBin, restart }) {
  return async (req, res, url) => {
    if (url.pathname !== "/api/update" || req.method !== "POST") return false;
    const user = requireOwner(req, res, auth); if (!user) return true;
    const result = applyUpdate({ appDir, npmBin });
    if (!result.ok) return sendJson(res, 500, { error: result.error }), true;
    audit.log("update.applied", { userId: user.id, username: user.username });
    sendJson(res, 200, { ok: true });
    if (typeof restart === "function") setTimeout(restart, 500).unref?.();
    return true;
  };
}
