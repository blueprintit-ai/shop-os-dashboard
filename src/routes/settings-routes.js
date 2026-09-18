import { requireOwner } from "../auth.js";
import { sendJson, readJsonBody } from "../lib/http.js";

export function settingsRoutes({ auth, settingsStore, audit }) {
  return async (req, res, url) => {
    if (url.pathname !== "/api/settings") return false;
    const user = requireOwner(req, res, auth); if (!user) return true;
    if (req.method === "GET") return sendJson(res, 200, settingsStore.get()), true;
    if (req.method === "PUT") {
      const patch = await readJsonBody(req);
      const saved = settingsStore.save(patch);
      audit.log("settings.change", { userId: user.id, username: user.username, role: user.role, patch });
      return sendJson(res, 200, saved), true;
    }
    return false;
  };
}
