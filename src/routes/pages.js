import { join } from "node:path";
import { readFileSync } from "node:fs";
import { send, serveStatic, isLoopback } from "../lib/http.js";
import { readShopName } from "../chat/system-prompt.js";

function redirect(res, to) { res.writeHead(302, { location: to }); res.end(); }

export function pageRoutes(ctx) {
  const { users, auth, publicDir, vaultPath } = ctx;
  const page = (name) => readFileSync(join(publicDir, name), "utf8");
  return async (req, res, url) => {
    if (req.method !== "GET") return false;
    const p = url.pathname;
    if (p.startsWith("/static/")) {
      const rel = p.slice("/static/".length);
      if (rel.includes("..")) return send(res, 400, { "content-type": "text/plain" }, "Bad path"), true;
      serveStatic(res, join(publicDir, rel)); return true;
    }
    const user = auth.userForRequest(req);
    const noOwner = users.count() === 0;
    if (p === "/") {
      if (noOwner) return (isLoopback(req) ? redirect(res, "/setup") : send(res, 200, { "content-type": "text/html; charset=utf-8" }, page("not-ready.html"))), true;
      if (!user) return redirect(res, "/login"), true;
      return redirect(res, user.role === "owner" ? "/owner" : "/employee"), true;
    }
    if (p === "/setup") {
      if (!noOwner || !isLoopback(req)) return redirect(res, "/"), true;
      return send(res, 200, { "content-type": "text/html; charset=utf-8" }, page("setup.html")), true;
    }
    if (p === "/login") return send(res, 200, { "content-type": "text/html; charset=utf-8" }, page("login.html")), true;
    if (p === "/employee") {
      if (!user) return redirect(res, "/login"), true;
      const html = page("employee.html").replace("__ROLE__", user.role);
      return send(res, 200, { "content-type": "text/html; charset=utf-8" }, html), true;
    }
    if (p === "/owner") {
      if (!user) return redirect(res, "/login"), true;
      if (user.role !== "owner") return redirect(res, "/employee"), true;
      const layout = ctx.layoutStore.get(user.id);
      const html = page("owner.html")
        .replace("__ROLE__", user.role)
        .replace("__SHOP_NAME__", readShopName(vaultPath))
        .replace("__THEME_CLASS__", layout.theme === "light" ? "light" : "");
      return send(res, 200, { "content-type": "text/html; charset=utf-8" }, html), true;
    }
    if (p === "/users") {
      if (!user || user.role !== "owner") return redirect(res, "/"), true;
      return send(res, 200, { "content-type": "text/html; charset=utf-8" }, page("users.html")), true;
    }
    return false;
  };
}
