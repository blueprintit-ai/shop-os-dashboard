import { readJsonBody, sendJson, isLoopback } from "../lib/http.js";
import { requireUser } from "../auth.js";
import { readShopName } from "../chat/system-prompt.js";

export function authRoutes(ctx) {
  const { users, auth, audit, vaultPath, licenseCheck } = ctx;
  return async (req, res, url) => {
    const p = url.pathname;
    if (req.method === "POST" && p === "/api/setup") {
      if (!isLoopback(req)) return sendJson(res, 403, { error: "Set up Shop OS on the shop computer first" }), true;
      if (users.count() > 0) return sendJson(res, 409, { error: "Already set up" }), true;
      const b = await readJsonBody(req);
      try {
        await users.create({ username: b.username, displayName: b.displayName, password: b.password, role: "owner" });
      } catch (e) { return sendJson(res, 400, { error: e.message, code: e.code }), true; }
      const r = await auth.login({ username: b.username, password: b.password, remember: true, ip: req.socket.remoteAddress });
      audit.log("setup.owner-created", { username: b.username });
      return sendJson(res, 200, { ok: true }, { "set-cookie": auth.issueCookie(r.token, r.maxAgeSec) }), true;
    }
    if (req.method === "POST" && p === "/api/login") {
      const b = await readJsonBody(req);
      const r = await auth.login({ username: b.username, password: b.password, remember: !!b.remember, ip: req.socket.remoteAddress });
      if (!r.ok) return sendJson(res, 401, { ok: false, reason: r.reason }), true;
      return sendJson(res, 200, { ok: true, user: { id: r.user.id, displayName: r.user.displayName, role: r.user.role } }, { "set-cookie": auth.issueCookie(r.token, r.maxAgeSec) }), true;
    }
    if (req.method === "POST" && p === "/api/logout") {
      auth.logout(auth.tokenFor(req));
      res.writeHead(204, { "set-cookie": auth.clearCookie() }); res.end(); return true;
    }
    if (req.method === "GET" && p === "/api/me") {
      const user = requireUser(req, res, auth); if (!user) return true;
      return sendJson(res, 200, { user, shopName: readShopName(vaultPath), license: { ok: licenseCheck().ok } }), true;
    }
    return false;
  };
}
