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

export const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const LICENSE_EXEMPT = new Set(["/api/login", "/api/logout", "/api/me", "/api/setup"]);

export function defaultLicenseCheck() { return validateLicense(readLicense()); }

export function createServer({ vaultPath, homeDir = dashboardHome(), runTurn = defaultRunTurn, licenseCheck = defaultLicenseCheck, guardMax = 3 }) {
  mkdirSync(homeDir, { recursive: true });
  const audit = new Audit(join(homeDir, "activity.jsonl"));
  const users = new UserStore(join(homeDir, "users.json"));
  const auth = new Auth({ users, sessionsPath: join(homeDir, "sessions.json"), audit });
  const index = new LinkIndex(vaultPath); index.build(); index.watch();
  const guard = new SessionsGuard({ max: guardMax });
  const chatSessions = new SessionStore();
  const layoutStore = new LayoutStore(homeDir);
  const ctx = { vaultPath, homeDir, users, auth, audit, index, guard, chatSessions, runTurn, licenseCheck, publicDir: PUBLIC_DIR, layoutStore };

  const routers = [authRoutes(ctx), usersRoutes(ctx), notesRoutes(ctx), chatRoutes(ctx), pageRoutes(ctx), layoutRoutes(ctx), artifactsRoutes(ctx)];
  const gc = setInterval(() => { auth.gc(); chatSessions.gc(); }, 10 * 60 * 1000); gc.unref?.();

  const server = createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if ((req.method === "POST" || req.method === "PATCH" || req.method === "PUT") && !sameOriginOk(req)) {
        return sendJson(res, 403, { error: "cross-origin" });
      }
      if (url.pathname.startsWith("/api/") && !LICENSE_EXEMPT.has(url.pathname)) {
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
