import { requireUser, requireOwner } from "../auth.js";
import { sendJson, readJsonBody } from "../lib/http.js";
import { resolveVaultFile, readViewable, readSkillText, viewerUrl } from "../brain/files.js";

// The Second Brain page (public/brain.html, synced from the RoboNuggets kit by tools/sync-brain.mjs) and its API.
// Kit endpoint -> product source:
//   GET  /api/brain/graph   (kit /api/graph)   BrainStore.graph(): vault walk + apps (Dashboard/apps.json) + routines feed + skills
//   GET  /api/brain/meta    (kit /api/meta)    the graph's meta block
//   GET  /api/brain/expand  (kit /api/expand)  children of a folded folder from the cached scan
//   GET  /api/brain/search  (kit /api/search)  file/folder/skill name search over the cached scan
//   GET  /api/brain/file    (kit /api/file)    one text file (or skill:<name>), vault-confined, size-capped
//   POST /api/brain/open    (kit /api/open)    no shell: returns the notes viewer URL
//   POST /api/brain/rescan  (kit /api/rescan)  owner, throttled
//   POST /api/brain/tweak   (kit /api/tweak)   owner, writes Dashboard/brain/tweaks.json
//   POST /api/brain/bake    (kit /api/bake)    owner, writes Dashboard/brain/bake.json
// The page is owner-only; the read endpoints that return the whole vault's shape (graph, meta, expand, search) are
// owner-only too, while file/open follow the notes viewer's rules (signed in + scope.js isPathAllowed).
// Staff get one answer (404 "Not available") whether a file is private, listed, outside their folders, hidden or missing.
function deny(res, user, found) {
  if (user.role !== "owner" && found.status !== 400) return sendJson(res, 404, { error: "Not available" });
  return sendJson(res, found.status, { error: found.error });
}

export function brainRoutes(ctx) {
  const { vaultPath, auth, audit, brain } = ctx;
  return async (req, res, url) => {
    const p = url.pathname;
    if (!p.startsWith("/api/brain/")) return false;
    const get = req.method === "GET", post = req.method === "POST";

    if (get && p === "/api/brain/file") {
      const user = requireUser(req, res, auth); if (!user) return true;
      const raw = url.searchParams.get("path");
      if (typeof raw === "string" && raw.startsWith("skill:")) {
        if (user.role !== "owner") return sendJson(res, 403, { error: "Owner only" }), true;
        const skill = await brain.skill(raw.slice(6));
        const text = skill && readSkillText(skill);
        if (!text) return sendJson(res, 404, { error: "Not found" }), true;
        return sendJson(res, 200, text, { "cache-control": "no-store" }), true;
      }
      const found = resolveVaultFile(vaultPath, user, raw);
      if (found.error) return deny(res, user, found), true;
      const r = readViewable(found);
      if (r.status === 200) audit.log("brain.file", { userId: user.id, username: user.username, role: user.role, path: found.rel });
      return sendJson(res, r.status, r.body, { "cache-control": "no-store" }), true;
    }

    if (post && p === "/api/brain/open") {
      const user = requireUser(req, res, auth); if (!user) return true;
      let body; try { body = await readJsonBody(req, 10_000); } catch { return sendJson(res, 400, { error: "Bad JSON" }), true; }
      if (typeof body?.path === "string" && body.path.startsWith("skill:")) return sendJson(res, 400, { error: "Skills open with View, not in the notes viewer" }), true;
      const found = resolveVaultFile(vaultPath, user, body?.path);
      if (found.error) return deny(res, user, found), true;
      const to = viewerUrl(found.rel);
      if (!to) return sendJson(res, 400, { error: "No viewer for this file type" }), true;
      return sendJson(res, 200, { ok: true, url: to }), true;
    }

    // everything below is owner-only
    if (get && ["/api/brain/graph", "/api/brain/meta", "/api/brain/expand", "/api/brain/search"].includes(p)) {
      if (!requireOwner(req, res, auth)) return true;
      const noStore = { "cache-control": "no-store" };
      if (p === "/api/brain/graph") return sendJson(res, 200, await brain.graph({ fresh: url.searchParams.get("fresh") === "1" }), noStore), true;
      if (p === "/api/brain/meta") return sendJson(res, 200, await brain.meta(), noStore), true;
      if (p === "/api/brain/search") return sendJson(res, 200, { q: String(url.searchParams.get("q") ?? "").slice(0, 100), results: await brain.search(url.searchParams.get("q")) }, noStore), true;
      const rel = (url.searchParams.get("path") || "").replace(/\\/g, "/");
      const children = rel ? await brain.expand(rel) : null;
      if (!children) return sendJson(res, 404, { error: "Unknown folder" }, noStore), true;
      return sendJson(res, 200, { path: rel, nodes: children }, noStore), true;
    }

    if (post && ["/api/brain/rescan", "/api/brain/tweak", "/api/brain/bake"].includes(p)) {
      const user = requireOwner(req, res, auth); if (!user) return true;
      if (p === "/api/brain/rescan") {
        const r = await brain.rescan();
        if (r.throttled) return sendJson(res, 429, { error: "A rescan just ran, try again in a few seconds" }, { "retry-after": "3" }), true;
        return sendJson(res, 200, { ok: true, meta: await brain.meta() }), true;
      }
      let body; try { body = await readJsonBody(req, p === "/api/brain/bake" ? 100_000 : 20_000); } catch { return sendJson(res, 400, { error: "Bad JSON" }), true; }
      const r = p === "/api/brain/tweak" ? await brain.applyTweak(body) : brain.saveBake(body);
      if (r.error) return sendJson(res, 400, { error: r.error }), true;
      audit.log(p === "/api/brain/tweak" ? "brain.tweak" : "brain.bake", { userId: user.id, username: user.username, role: user.role, action: body?.action });
      return sendJson(res, 200, r), true;
    }

    return false;
  };
}
