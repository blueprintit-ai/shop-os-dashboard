import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readJsonBody, sendJson } from "../lib/http.js";
import { requireOwner } from "../auth.js";
import { HIDDEN_DIRS } from "../scope.js";

const CODE_STATUS = { USERNAME_TAKEN: 409, INVALID_USERNAME: 400, INVALID_ROLE: 400, WEAK_PASSWORD: 400, LAST_OWNER: 409, NOT_FOUND: 404 };
function fail(res, e) { return sendJson(res, CODE_STATUS[e.code] ?? 500, { error: e.message, code: e.code ?? "ERROR" }); }

function listFolders(vaultPath) {
  const top = readdirSync(vaultPath, { withFileTypes: true }).filter((e) => e.isDirectory() && !HIDDEN_DIRS.includes(e.name)).map((e) => e.name).sort();
  const team = [];
  const teamRoot = join(vaultPath, "Team");
  try {
    for (const org of readdirSync(teamRoot, { withFileTypes: true })) {
      if (!org.isDirectory()) continue;
      const prof = join(teamRoot, org.name, "Profiles");
      try { for (const p of readdirSync(prof, { withFileTypes: true })) if (p.isDirectory()) team.push(`Team/${org.name}/Profiles/${p.name}`); } catch {}
    }
  } catch {}
  return { folders: top, teamFolders: team };
}

export function usersRoutes(ctx) {
  const { users, auth, audit, vaultPath } = ctx;
  return async (req, res, url) => {
    const p = url.pathname;
    if (!p.startsWith("/api/users")) return false;
    const owner = requireOwner(req, res, auth); if (!owner) return true;
    const m = p.match(/^\/api\/users\/([^/]+)(?:\/(password|deactivate|reactivate))?$/);
    try {
      if (req.method === "GET" && p === "/api/users/folders") return sendJson(res, 200, listFolders(vaultPath)), true;
      if (req.method === "GET" && p === "/api/users") return sendJson(res, 200, users.list()), true;
      if (req.method === "POST" && p === "/api/users") {
        const b = await readJsonBody(req);
        const u = await users.create({ username: b.username, displayName: b.displayName, password: b.password, role: b.role ?? "staff", switches: b.switches ?? {} });
        audit.log("user.created", { by: owner.id, userId: u.id, username: u.username, role: u.role });
        return sendJson(res, 201, u), true;
      }
      if (m && req.method === "PATCH" && !m[2]) {
        const b = await readJsonBody(req);
        const u = users.update(m[1], { displayName: b.displayName, role: b.role, switches: b.switches });
        audit.log("user.updated", { by: owner.id, userId: u.id, patch: Object.keys(b) });
        return sendJson(res, 200, u), true;
      }
      if (m && req.method === "POST" && m[2] === "password") {
        const b = await readJsonBody(req);
        await users.setPassword(m[1], b.password);
        audit.log("user.password-reset", { by: owner.id, userId: m[1] });
        res.writeHead(204); res.end(); return true;
      }
      if (m && req.method === "POST" && (m[2] === "deactivate" || m[2] === "reactivate")) {
        const u = m[2] === "deactivate" ? users.deactivate(m[1]) : users.reactivate(m[1]);
        audit.log(`user.${m[2]}d`, { by: owner.id, userId: u.id });
        return sendJson(res, 200, u), true;
      }
    } catch (e) { return fail(res, e), true; }
    return false;
  };
}
