import { join, basename } from "node:path";
import { statSync, createReadStream, existsSync } from "node:fs";
import { requireUser } from "../auth.js";
import { sendJson, readJsonBody } from "../lib/http.js";
import { scanAssets, setFavorite, saveUpload, assetPath, assetMime } from "../assets.js";

const FILE_PREFIX = "/assets/file/";

function assetsRoot(settingsStore, homeDir) {
  const { assetsDir } = settingsStore.get();
  return assetsDir || join(homeDir, "business-assets");
}
function canSeeAssets(user) {
  return user.role === "owner" || user.switches?.assetsView === true;
}

export function assetsRoutes({ auth, settingsStore, homeDir, audit }) {
  return async (req, res, url) => {
    const p = url.pathname;
    const root = () => assetsRoot(settingsStore, homeDir);

    if (p === "/api/assets" && req.method === "GET") {
      const user = requireUser(req, res, auth); if (!user) return true;
      if (!canSeeAssets(user)) return sendJson(res, 403, { error: "forbidden" }), true;
      return sendJson(res, 200, scanAssets(root())), true;
    }

    if (p === "/api/assets/favorite" && req.method === "POST") {
      const user = requireUser(req, res, auth); if (!user) return true;
      if (!canSeeAssets(user)) return sendJson(res, 403, { error: "forbidden" }), true;
      const { id, on } = await readJsonBody(req);
      const result = setFavorite(root(), id, !!on);
      if (result.error) return sendJson(res, result.code, { error: result.error }), true;
      return sendJson(res, 200, result), true;
    }

    if (p === "/api/assets/upload" && req.method === "POST") {
      const user = requireUser(req, res, auth); if (!user) return true;
      if (!canSeeAssets(user)) return sendJson(res, 403, { error: "forbidden" }), true;
      const category = url.searchParams.get("category") || "";
      const name = url.searchParams.get("name") || "document";
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const result = saveUpload(root(), category, name, Buffer.concat(chunks));
      audit.log("assets.upload", { userId: user.id, username: user.username, role: user.role, name });
      if (result.error) return sendJson(res, result.code, { error: result.error }), true;
      return sendJson(res, 200, result), true;
    }

    if (p.startsWith(FILE_PREFIX) && req.method === "GET") {
      const user = requireUser(req, res, auth); if (!user) return true;
      if (!canSeeAssets(user)) return sendJson(res, 403, { error: "forbidden" }), true;
      const id = p.slice(FILE_PREFIX.length);
      const asset = assetPath(root(), id);
      if (!asset || !existsSync(asset.abs) || !statSync(asset.abs).isFile()) return sendJson(res, 404, { error: "not-found" }), true;
      audit.log("asset.open", { userId: user.id, username: user.username, role: user.role, path: asset.rel });
      const download = url.searchParams.has("download");
      res.writeHead(200, {
        "content-type": assetMime(asset.abs),
        "content-disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(basename(asset.abs))}`,
      });
      createReadStream(asset.abs).pipe(res);
      return true;
    }

    return false;
  };
}
