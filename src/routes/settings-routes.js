import { requireOwner } from "../auth.js";
import { normalizeAssetsDir } from "../settings.js";
import { sendJson, readJsonBody } from "../lib/http.js";

const KEYS = new Set(["assetsDir", "sessionCap", "portOverride"]);

// Returns an error string for a bad patch; normalizes an empty assetsDir to null (the default folder).
function checkPatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return "settings must be an object";
  for (const k of Object.keys(patch)) if (!KEYS.has(k)) return `unknown setting ${k}`;
  if ("assetsDir" in patch) {
    const d = patch.assetsDir;
    if (d === "" || d === null) patch.assetsDir = null;
    else {
      const n = normalizeAssetsDir(d);
      if (!n) return "assetsDir must be an absolute folder path";
      patch.assetsDir = n;
    }
  }
  if ("sessionCap" in patch && !(Number.isInteger(patch.sessionCap) && patch.sessionCap >= 1 && patch.sessionCap <= 50)) return "sessionCap must be a whole number from 1 to 50";
  if ("portOverride" in patch && patch.portOverride !== null && !(Number.isInteger(patch.portOverride) && patch.portOverride >= 1024 && patch.portOverride <= 65535)) return "portOverride must be null or a port from 1024 to 65535";
  return null;
}

export function settingsRoutes({ auth, settingsStore, audit }) {
  return async (req, res, url) => {
    if (url.pathname !== "/api/settings") return false;
    const user = requireOwner(req, res, auth); if (!user) return true;
    if (req.method === "GET") return sendJson(res, 200, settingsStore.get()), true;
    if (req.method === "PUT") {
      const patch = await readJsonBody(req).catch(() => null);
      const bad = checkPatch(patch);
      if (bad) return sendJson(res, 400, { error: bad }), true;
      const saved = settingsStore.save(patch);
      audit.log("settings.change", { userId: user.id, username: user.username, role: user.role, patch });
      return sendJson(res, 200, saved), true;
    }
    return false;
  };
}
