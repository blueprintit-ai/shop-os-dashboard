import { requireOwner } from "../auth.js";
import { sendJson } from "../lib/http.js";
import { applyUpdate } from "../updater.js";

export function updateRoutes({ auth, audit, appDir, npmBin, restart, applyUpdateImpl = applyUpdate }) {
  // applyUpdate is synchronous (spawnSync), so a second POST can only land
  // after the first returned — EXCEPT that the first response is sent before
  // the 500ms restart timer fires, so an impatient owner double-clicking
  // "Update now" would otherwise start a second npm install against the same
  // tree mid-restart. One flag per router instance is enough; it is never
  // cleared once the update succeeded, because the process is about to restart.
  let inFlight = false;
  return async (req, res, url) => {
    if (url.pathname !== "/api/update" || req.method !== "POST") return false;
    const user = requireOwner(req, res, auth); if (!user) return true;
    if (inFlight) return sendJson(res, 409, { error: "update-in-progress" }), true;
    inFlight = true;
    let result;
    try {
      result = applyUpdateImpl({ appDir, npmBin });
    } catch (e) {
      inFlight = false;
      return sendJson(res, 500, { error: e.message }), true;
    }
    if (!result.ok) {
      inFlight = false; // a failed install left the tree as it was; retrying is fine
      return sendJson(res, 500, { error: result.error }), true;
    }
    audit.log("update.applied", { userId: user.id, username: user.username });
    sendJson(res, 200, { ok: true });
    if (typeof restart === "function") setTimeout(restart, 500).unref?.();
    return true;
  };
}
