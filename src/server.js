import { createServer as createHttpServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { UserStore } from "./users.js";
import { Auth, sameOriginOk } from "./auth.js";
import { Audit } from "./audit.js";
import { LinkIndex } from "./notes/index.js";
import { SessionsGuard } from "./sessions-guard.js";
import { SessionStore } from "./chat/sessions.js";
import { runTurn as defaultRunTurn } from "./chat/run-turn.js";
import { readLicense, validateLicense } from "./license.js";
import { dashboardHome } from "./lib/paths.js";
import { send, sendJson } from "./lib/http.js";
import { authRoutes } from "./routes/auth-routes.js";
import { usersRoutes } from "./routes/users-routes.js";
import { notesRoutes } from "./routes/notes-routes.js";
import { chatRoutes } from "./routes/chat-routes.js";
import { pageRoutes } from "./routes/pages.js";
import { LayoutStore } from "./layout.js";
import { layoutRoutes } from "./routes/layout-routes.js";
import { artifactsRoutes } from "./routes/artifacts-routes.js";
import { snapshotsRoutes } from "./routes/snapshots-routes.js";
import { SettingsStore } from "./settings.js";
import { settingsRoutes } from "./routes/settings-routes.js";
import { assetsRoutes } from "./routes/assets-routes.js";
import { runsRoutes } from "./routes/runs-routes.js";
import { StatusStore } from "./status.js";
import { statusRoutes } from "./routes/status-routes.js";
import { updateRoutes } from "./routes/update-routes.js";
import { kitCompatRoutes } from "./routes/kit-compat-routes.js";
import { BrainStore } from "./brain/store.js";
import { brainRoutes } from "./routes/brain-routes.js";

export const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
// /api/status is exempt because reporting a BROKEN license is part of what the
// status widget exists for — gating it behind the license check meant the
// owner's "License" card could never render the failure it was built to show.
// It is still behind requireUser, so nothing is exposed to anonymous callers.
// Also exempt: the owner-only management calls (users, settings, update) so an owner can still add people,
// fix the assets folder and self-update out of a bad license state. Chat, notes, runs and the kit page's data stay paused.
const LICENSE_EXEMPT = new Set(["/api/login", "/api/logout", "/api/me", "/api/setup", "/api/status", "/api/ping", "/api/settings", "/api/update"]);
const licenseExempt = (p) => LICENSE_EXEMPT.has(p) || p === "/api/users" || p.startsWith("/api/users/");

export function defaultLicenseCheck() { return validateLicense(readLicense()); }

export function createServer({ vaultPath, homeDir = dashboardHome(), runTurn = defaultRunTurn, licenseCheck = defaultLicenseCheck, guardMax = 3, port = null, appDir = null, npmBin = null, restart = () => {}, updateInfo = { updateAvailable: false }, applyUpdateImpl = undefined }) {
  mkdirSync(homeDir, { recursive: true });
  const audit = new Audit(join(homeDir, "activity.jsonl"));
  const users = new UserStore(join(homeDir, "users.json"));
  const auth = new Auth({ users, sessionsPath: join(homeDir, "sessions.json"), audit });
  const index = new LinkIndex(vaultPath); index.build();
  const brain = new BrainStore(vaultPath); // the Second Brain map (/brain); rescans after the notes watcher sees a change
  index.watch(() => brain.invalidate());
  const guard = new SessionsGuard({ max: guardMax });
  const chatSessions = new SessionStore();
  const layoutStore = new LayoutStore(homeDir);
  const settingsStore = new SettingsStore(homeDir);
  const statusStore = new StatusStore(homeDir);
  const ctx = { vaultPath, homeDir, users, auth, audit, index, brain, guard, chatSessions, runTurn, licenseCheck, publicDir: PUBLIC_DIR, layoutStore, settingsStore, statusStore, port, appDir, npmBin, restart, updateInfo, applyUpdateImpl };

  const routers = [authRoutes(ctx), usersRoutes(ctx), notesRoutes(ctx), brainRoutes(ctx), chatRoutes(ctx), pageRoutes(ctx), layoutRoutes(ctx), artifactsRoutes(ctx), snapshotsRoutes(ctx), settingsRoutes(ctx), assetsRoutes(ctx), runsRoutes(ctx), statusRoutes(ctx), updateRoutes(ctx), kitCompatRoutes(ctx)];
  const gc = setInterval(() => { auth.gc(); chatSessions.gc(); }, 10 * 60 * 1000); gc.unref?.();

  const server = createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if ((req.method === "POST" || req.method === "PATCH" || req.method === "PUT") && !sameOriginOk(req)) {
        return sendJson(res, 403, { error: "cross-origin" });
      }
      if (url.pathname.startsWith("/api/") && !licenseExempt(url.pathname)) {
        const lic = licenseCheck();
        if (!lic.ok) return sendJson(res, 402, { error: "license", message: lic.error });
      }
      for (const route of routers) {
        const handled = await route(req, res, url);
        if (handled) return;
      }
      send(res, 404, { "content-type": "text/plain" }, "Not found");
    } catch (err) {
      console.error("[server]", err);
      if (!res.headersSent) sendJson(res, 500, { error: err.message });
      else res.end();
    }
  });
  server.on("close", () => { clearInterval(gc); index.close(); });
  server.ctx = ctx;
  return server;
}
