import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { send, serveStatic, isLoopback } from "../lib/http.js";
import { readShopName } from "../chat/system-prompt.js";

const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// The shop name also lands inside a JS template literal in the kit's title widget
// (owner.html, rule title-h1), so besides HTML escaping, neutralize \, ` and ${.
const escapeForTemplate = (s) => escapeHtml(s).replace(/[\\`]/g, "\\$&").replace(/\$\{/g, "\\${");

// The kit pages show a sea of empty widgets when every /api call answers 402, so a failed license check
// gets this page instead. The owner's management side keeps working (login, /users with its users/settings/status/update
// API calls, which src/server.js exempts from the license check); chat, notes and the kit data stay paused.
function licenseGate(ctx, res) {
  const lic = ctx.licenseCheck();
  if (lic.ok) return false;
  const html = readFileSync(join(ctx.publicDir, "license.html"), "utf8").replace("__REASON__", () => escapeHtml(lic.error || "the license is not valid"));
  send(res, 402, { "content-type": "text/html; charset=utf-8" }, html);
  return true;
}

// Content-Security-Policy for pages that render vault text (/brain, /notes): scripts only from this origin (the page's two
// inline blocks carry a per-response nonce), no external images, fonts, frames or connections, so a note cannot beacon out.
export function pageCsp(nonce) {
  const script = nonce ? `script-src 'self' 'nonce-${nonce}'` : "script-src 'self'";
  return `default-src 'self'; ${script}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`;
}

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
      if (licenseGate(ctx, res)) return true;
      // The page is the RoboNuggets kit page, synced by tools/sync-kit.mjs; theme,
      // layout and profiles live in the browser's localStorage like the kit's.
      const shop = readShopName(vaultPath);
      const html = page("owner.html")
        .replace("__SHOP_NAME__", () => escapeHtml(shop))
        .replace("__SHOP_NAME_JS__", () => escapeForTemplate(shop));
      return send(res, 200, { "content-type": "text/html; charset=utf-8" }, html), true;
    }
    if (p === "/brain") {
      // The Second Brain map: the RoboNuggets kit page synced by tools/sync-brain.mjs, data from /api/brain/*. Owner-only in v1.
      if (!user) return redirect(res, "/login"), true;
      if (user.role !== "owner") return redirect(res, "/notes"), true;
      if (licenseGate(ctx, res)) return true;
      const shop = readShopName(vaultPath);
      // the HUD subtitle is a JS string literal holding HTML: the name is HTML-escaped, then JSON-quoted with < as \u003c
      const tagline = JSON.stringify(`<em>${escapeHtml(shop)}</em>`).replace(/</g, "\\u003c");
      const nonce = randomBytes(16).toString("base64");
      const html = page("brain.html")
        .replace("__SHOP_NAME__", () => escapeHtml(shop))
        .replace("__BRAIN_TAGLINE_JS__", () => tagline)
        .replace(/<script>/g, `<script nonce="${nonce}">`); // the kit page's inline blocks are the only attribute-less <script> tags
      return send(res, 200, { "content-type": "text/html; charset=utf-8", "content-security-policy": pageCsp(nonce) }, html), true;
    }
    if (p === "/widgets") {
      if (!user) return redirect(res, "/login"), true;
      if (user.role !== "owner") return redirect(res, "/"), true;
      if (licenseGate(ctx, res)) return true;
      return send(res, 200, { "content-type": "text/html; charset=utf-8" }, page("widgets.html")), true;
    }
    if (p === "/notes") {
      if (!user) return redirect(res, "/login"), true;
      if (licenseGate(ctx, res)) return true;
      return send(res, 200, { "content-type": "text/html; charset=utf-8", "content-security-policy": pageCsp() }, page("notes.html")), true;
    }
    if (p === "/users") {
      if (!user || user.role !== "owner") return redirect(res, "/"), true;
      return send(res, 200, { "content-type": "text/html; charset=utf-8" }, page("users.html")), true;
    }
    if (p === "/assets") {
      if (!user) return redirect(res, "/login"), true;
      if (user.role !== "owner" && user.switches?.assetsView !== true) return redirect(res, "/"), true;
      if (licenseGate(ctx, res)) return true;
      let html = page("assets.html").replace("__ROLE__", user.role);
      // The synced kit page has an upload button and a drop zone. Staff cannot upload (the server refuses it), so the page is
      // served to them without the control, by CSS injected here rather than a change to the synced file.
      if (user.role !== "owner") html = html.replace("</head>", "<style>#upBtn,#drop,#upOv{display:none!important}</style></head>");
      return send(res, 200, { "content-type": "text/html; charset=utf-8" }, html), true;
    }
    return false;
  };
}
