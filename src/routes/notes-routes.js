import { readFileSync, statSync, existsSync, createReadStream } from "node:fs";
import { join, basename, extname } from "node:path";
import { sendJson } from "../lib/http.js";
import { safeFileHeaders } from "../lib/safe-file-response.js";
import { requireUser, requireOwner } from "../auth.js";
import { isPathAllowed, toVaultRelative } from "../scope.js";
import { buildTree } from "../notes/tree.js";
import { searchNotes } from "../notes/search.js";
import { renderNote } from "../notes/render.js";

const MAX_RENDER = 2 * 1024 * 1024;
// /api/notes/raw serves vault files (written by staff and agents) from the dashboard's own origin.
// Only types that cannot run script display inline; SVG is served as an image under a CSP sandbox
// (the notes viewer embeds vault SVGs with <img>); everything else, html/xml/json/unknown, downloads.
const RAW_INLINE = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  svg: "image/svg+xml", pdf: "application/pdf",
  md: "text/plain; charset=utf-8", txt: "text/plain; charset=utf-8", csv: "text/plain; charset=utf-8",
};
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;

export function notesRoutes(ctx) {
  const { vaultPath, auth, audit, index } = ctx;

  function resolveFor(user) {
    return (target) => {
      const rel = index.resolve(target);
      if (!rel) return { href: "", exists: false };
      const abs = join(vaultPath, rel);
      if (!isPathAllowed(vaultPath, user, abs)) return { href: "", exists: false };
      const route = IMG_EXT.test(rel) || extname(rel).toLowerCase() === ".pdf" ? "raw" : "view";
      return { href: `/api/notes/${route}?path=${encodeURIComponent(rel)}`, exists: true };
    };
  }

  function scopedAbs(user, res, relParam) {
    if (!relParam) { sendJson(res, 400, { error: "path required" }); return null; }
    const abs = join(vaultPath, relParam);
    if (!isPathAllowed(vaultPath, user, abs)) { sendJson(res, 403, { error: "Outside your folders" }); return null; }
    if (!existsSync(abs) || !statSync(abs).isFile()) { sendJson(res, 404, { error: "Not found" }); return null; }
    return abs;
  }

  return async (req, res, url) => {
    const p = url.pathname;
    if (!p.startsWith("/api/notes/")) return false;
    if (req.method === "POST" && p === "/api/notes/rescan") {
      if (!requireOwner(req, res, auth)) return true;
      index.build(); res.writeHead(204); res.end(); return true;
    }
    const user = requireUser(req, res, auth); if (!user) return true;
    if (req.method !== "GET") return false;

    if (p === "/api/notes/tree") return sendJson(res, 200, buildTree(vaultPath, user)), true;
    if (p === "/api/notes/search") return sendJson(res, 200, searchNotes(vaultPath, user, index, url.searchParams.get("q"), {})), true;
    if (p === "/api/notes/recent") {
      const limit = Math.min(100, Number(url.searchParams.get("limit")) || 20);
      const rows = index.notes().filter((n) => isPathAllowed(vaultPath, user, join(vaultPath, n.path))).sort((a, b) => b.mtime - a.mtime).slice(0, limit);
      return sendJson(res, 200, rows), true;
    }
    if (p === "/api/notes/view") {
      const abs = scopedAbs(user, res, url.searchParams.get("path")); if (!abs) return true;
      const size = statSync(abs).size;
      if (size > MAX_RENDER) return sendJson(res, 413, { error: "too-large", size }), true;
      const rel = toVaultRelative(vaultPath, abs);
      const md = readFileSync(abs, "utf8");
      const { html, frontmatter } = renderNote(md, { resolveLink: resolveFor(user) });
      const backlinks = index.backlinks(rel).filter((b) => isPathAllowed(vaultPath, user, join(vaultPath, b))).map((b) => ({ path: b, title: index.meta.get(b)?.title ?? basename(b) }));
      audit.log("note.view", { userId: user.id, username: user.username, role: user.role, path: rel });
      const title = index.meta.get(rel)?.title ?? basename(abs, extname(abs));
      return sendJson(res, 200, { path: rel, title, html, frontmatter, backlinks }), true;
    }
    if (p === "/api/notes/raw") {
      const abs = scopedAbs(user, res, url.searchParams.get("path")); if (!abs) return true;
      audit.log("note.raw", { userId: user.id, username: user.username, role: user.role, path: toVaultRelative(vaultPath, abs) });
      const mime = RAW_INLINE[extname(abs).slice(1).toLowerCase()];
      res.writeHead(200, {
        ...safeFileHeaders({ filename: basename(abs), mime: mime ?? "application/octet-stream", inline: !!mime }),
        "content-length": statSync(abs).size,
      });
      createReadStream(abs).pipe(res); return true;
    }
    return false;
  };
}
