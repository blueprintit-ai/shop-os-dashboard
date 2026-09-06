import { requireUser } from "../auth.js";
import { sendJson, readJsonBody } from "../lib/http.js";

export function layoutRoutes({ auth, layoutStore }) {
  return async (req, res, url) => {
    const p = url.pathname;
    if (p !== "/api/layout") return false;
    const user = requireUser(req, res, auth);
    if (!user) return true;
    if (req.method === "GET") {
      return sendJson(res, 200, layoutStore.get(user.id)), true;
    }
    if (req.method === "PUT") {
      const body = await readJsonBody(req);
      return sendJson(res, 200, layoutStore.save(user.id, body)), true;
    }
    return false;
  };
}
