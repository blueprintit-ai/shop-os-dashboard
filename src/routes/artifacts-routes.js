import { join } from "node:path";
import { requireUser, requireOwner } from "../auth.js";
import { send, sendJson, readJsonBody, serveStatic } from "../lib/http.js";
import { listArtifacts, removeArtifact, artifactsDir, artifactVisibility, isSafeArtifactFile } from "../artifacts.js";

const ARTIFACTS_PREFIX = "/artifacts/";

export function artifactsRoutes({ vaultPath, auth, audit }) {
  return async (req, res, url) => {
    const p = url.pathname;

    if (p === "/api/artifacts" && req.method === "GET") {
      const user = requireUser(req, res, auth); if (!user) return true;
      return sendJson(res, 200, listArtifacts(vaultPath, user)), true;
    }

    if (p === "/api/artifacts/remove" && req.method === "POST") {
      const user = requireOwner(req, res, auth); if (!user) return true;
      const body = await readJsonBody(req);
      const result = removeArtifact(vaultPath, body.file);
      audit.log("artifact.remove", { userId: user.id, username: user.username, role: user.role, file: body.file, ok: !!result.ok });
      if (result.error) return sendJson(res, result.code || 400, { error: result.error }), true;
      return sendJson(res, 200, result), true;
    }

    if (p.startsWith(ARTIFACTS_PREFIX) && req.method === "GET") {
      const user = requireUser(req, res, auth); if (!user) return true;
      const raw = p.slice(ARTIFACTS_PREFIX.length);
      let file;
      try { file = decodeURIComponent(raw); } catch { file = null; }
      // single path segment, .html/.htm only - mirrors the static-serve convention in routes/pages.js,
      // and (deliberately) can never resolve to a .json sidecar or anything inside _trash/.
      if (!isSafeArtifactFile(file)) {
        return send(res, 400, { "content-type": "text/plain" }, "Bad path"), true;
      }
      if (user.role !== "owner") {
        const shared = user.switches?.artifactsShared === true;
        const visibility = artifactVisibility(vaultPath, file);
        if (!shared || visibility !== "staff") {
          return send(res, 403, { "content-type": "text/plain" }, "Forbidden"), true;
        }
      }
      serveStatic(res, join(artifactsDir(vaultPath), file));
      return true;
    }

    return false;
  };
}
