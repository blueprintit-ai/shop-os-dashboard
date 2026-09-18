import { requireUser } from "../auth.js";
import { sendJson } from "../lib/http.js";
import { readStats, readRoutines } from "../snapshots.js";

export function snapshotsRoutes({ vaultPath, auth }) {
  return async (req, res, url) => {
    const p = url.pathname;
    if (p === "/api/snapshots/stats") {
      const user = requireUser(req, res, auth); if (!user) return true;
      return sendJson(res, 200, readStats(vaultPath)), true;
    }
    if (p === "/api/snapshots/routines") {
      const user = requireUser(req, res, auth); if (!user) return true;
      return sendJson(res, 200, readRoutines(vaultPath)), true;
    }
    return false;
  };
}
