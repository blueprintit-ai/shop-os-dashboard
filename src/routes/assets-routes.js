import { join, basename, extname } from "node:path";
import { statSync, createReadStream, existsSync } from "node:fs";
import { requireUser, requireOwner } from "../auth.js";
import { sendJson, readJsonBody } from "../lib/http.js";
import { scanAssets, setFavorite, saveUpload, listedAssetPath, assetMime, MAX_UPLOAD } from "../assets.js";
import { safeFileHeaders } from "../lib/safe-file-response.js";
import { effectiveAssetsRoot } from "../settings.js";
import { isPrivateRelPath, isPrivatePath } from "../scope.js";

const FILE_PREFIX = "/assets/file/";
const INLINE_EXTS = new Set(["pdf", "png", "jpg", "jpeg", "gif", "webp", "txt", "md", "csv"]);

function canSeeAssets(user) {
  return user.role === "owner" || user.switches?.assetsView === true;
}

export function assetsRoutes({ auth, settingsStore, homeDir, audit, vaultPath }) {
  return async (req, res, url) => {
    const p = url.pathname;
    const root = () => effectiveAssetsRoot(settingsStore, homeDir);
    // Names under the assets root, and (when the assets folder sits inside the vault) the same private rules on the real
    // location: a Private folder, a listed path, a private-front-matter note, a link into Private.
    const hiddenFromStaff = (rel) => isPrivateRelPath(vaultPath, rel) || isPrivatePath(vaultPath, join(root(), rel));

    if (p === "/api/assets" && req.method === "GET") {
      const user = requireUser(req, res, auth); if (!user) return true;
      if (!canSeeAssets(user)) return sendJson(res, 403, { error: "forbidden" }), true;
      const all = scanAssets(root());
      if (user.role === "owner") return sendJson(res, 200, all), true;
      // staff never see a Private category/file (or one the owner listed in Dashboard/private-paths.json)
      const files = all.files.filter((f) => !hiddenFromStaff(f.category === "Uncategorized" ? f.name : join(f.category, f.name)));
      const categories = all.categories.filter((c) => !hiddenFromStaff(c.name)).map((c) => ({ ...c, count: files.filter((f) => f.category === c.name).length }));
      return sendJson(res, 200, { ...all, files, categories, favorites: all.favorites.filter((f) => files.some((x) => x.id === f.id)) }), true;
    }

    if (p === "/api/assets/favorite" && req.method === "POST") {
      const user = requireUser(req, res, auth); if (!user) return true;
      if (!canSeeAssets(user)) return sendJson(res, 403, { error: "forbidden" }), true;
      const { id, on } = await readJsonBody(req);
      const target = user.role === "owner" ? null : listedAssetPath(root(), id);
      if (target && hiddenFromStaff(target.rel)) return sendJson(res, 404, { error: "not-found" }), true;
      const result = setFavorite(root(), id, !!on);
      if (result.error) return sendJson(res, result.code, { error: result.error }), true;
      return sendJson(res, 200, result), true;
    }

    if (p === "/api/assets/upload" && req.method === "POST") {
      // assetsView is a view switch: only the owner writes (the folder may sit inside the vault)
      const user = requireOwner(req, res, auth); if (!user) return true;
      const category = url.searchParams.get("category") || "";
      const name = url.searchParams.get("name") ?? "";
      if (user.role !== "owner" && (hiddenFromStaff(category) || hiddenFromStaff(join(category, String(name))))) return sendJson(res, 404, { error: "not-found" }), true;
      const declaredLength = Number(req.headers["content-length"] || 0);
      if (declaredLength > MAX_UPLOAD) return sendJson(res, 413, { error: "file over 50 MB" }), true;
      // content-length can be absent (chunked) or a lie: count what actually arrives and stop buffering at the limit
      const chunks = []; let received = 0, over = false;
      for await (const chunk of req) { received += chunk.length; if (received > MAX_UPLOAD) { over = true; chunks.length = 0; } else if (!over) chunks.push(chunk); }
      if (over) return sendJson(res, 413, { error: "file over 50 MB" }), true;
      const result = saveUpload(root(), category, name, Buffer.concat(chunks));
      audit.log("assets.upload", { userId: user.id, username: user.username, role: user.role, name });
      if (result.error) return sendJson(res, result.code, { error: result.error }), true;
      return sendJson(res, 200, { ok: true, ...result }), true;
    }

    if (p.startsWith(FILE_PREFIX) && req.method === "GET") {
      const user = requireUser(req, res, auth); if (!user) return true;
      if (!canSeeAssets(user)) return sendJson(res, 403, { error: "forbidden" }), true;
      const id = p.slice(FILE_PREFIX.length);
      const asset = listedAssetPath(root(), id);
      if (!asset || !existsSync(asset.abs) || !statSync(asset.abs).isFile()) return sendJson(res, 404, { error: "not-found" }), true;
      if (user.role !== "owner" && hiddenFromStaff(asset.rel)) return sendJson(res, 404, { error: "not-found" }), true;
      audit.log("asset.open", { userId: user.id, username: user.username, role: user.role, path: asset.rel });
      // Business documents are user-supplied and served from the dashboard's own origin, so only
      // types that cannot run script display inline; everything else (html, svg, xml, json, ...)
      // downloads. nosniff stops a browser re-typing a file; the CSP sandbox is the backstop.
      // PDFs are the exception to the sandbox: Chrome's built-in viewer refuses sandboxed documents.
      const ext = extname(asset.abs).slice(1).toLowerCase();
      const inline = INLINE_EXTS.has(ext) && !url.searchParams.has("download");
      res.writeHead(200, safeFileHeaders({ filename: basename(asset.abs), mime: assetMime(asset.abs), inline }));
      createReadStream(asset.abs).pipe(res);
      return true;
    }

    return false;
  };
}
