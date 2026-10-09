// The API the RoboNuggets kit page (public/owner.html, synced by tools/sync-kit.mjs) expects,
// implemented on the product's own data and engines. Response SHAPES follow the kit's
// server.js / dashboard.html; behaviour is the product's: its session auth and roles, its
// vault feeds, its Agent-SDK runner. (The owner page has no chat bar any more; the product's own chat is /api/chat/* in chat-routes.js.) Nothing here shells out.
//
//   kit endpoint            product source                      notes
//   /api/calendar, /email   -                                   not wired: {needsSetup:true}
//   /api/stats, /routines   Dashboard/snapshots/*.json (src/snapshots.js), HTML-escaped for the kit page
//   /api/skills             src/runs.js SKILLS + run history    model/effort as indexes
//   /api/run, /run-status,
//   /jobs/active            src/runs.js runSkill via JobStore   async facade over the SDK run
//   /api/artifacts          src/artifacts.js (also at /api/artifacts, artifacts-routes.js)
//   /api/artifact-remove    src/artifacts.js removeArtifact     owner only
//   /api/assets/scan        chat engine (Read tool only)        owner only
//   /api/assets/remind      -                                   not wired (needs Google Calendar)
//   /api/apps               Dashboard/apps.json (src/apps.js)    GET any role, POST owner: SHOP APPS rows
//   /api/open               400, the server never opens local paths
import { requireUser, requireOwner } from "../auth.js";
import { sendJson, readJsonBody } from "../lib/http.js";
import { readStats, readRoutines } from "../snapshots.js";
import { listArtifacts, removeArtifact } from "../artifacts.js";
import { SKILLS, MODELS, EFFORTS, MODEL_IDS, readRunHistory } from "../runs.js";
import { listedAssetPath, getDocMeta, setDocMeta, isScannable } from "../assets.js";
import { effectiveAssetsRoot } from "../settings.js";
import { readApps, writeApps, validateApps } from "../apps.js";
import { sanitizeStats, sanitizeRoutines } from "../kit-compat/sanitize-feeds.js";
import { JobStore } from "../kit-compat/jobs.js";
import { extname, resolve } from "node:path";

const notWired = (extra = {}) => ({ needsSetup: true, note: "not wired", ...extra });

export function kitCompatRoutes(ctx) {
  const { vaultPath, auth, audit, guard, settingsStore, homeDir } = ctx;
  const jobs = new JobStore();
  const assetsRoot = () => effectiveAssetsRoot(settingsStore, homeDir);
  // A body that is not valid JSON, or is over the limit, is the caller's mistake: 400, not "{}".
  const body = (req) => readJsonBody(req).catch(() => { throw Object.assign(new Error("bad request body"), { badBody: true }); });
  const logUser = (user) => ({ userId: user.id, username: user.username, role: user.role });

  async function scanOne(user, abs, rel) {
    const ext = extname(abs).slice(1).toLowerCase();
    let result;
    if (!isScannable(ext)) result = { scanStatus: "unsupported" };
    else {
      const prompt = `Read the file at "${abs}". If it states an explicit expiration, renewal, or "valid until" date, reply with ONLY this compact JSON and nothing else: {"expires":"YYYY-MM-DD"}. If there is no such date in the document, reply with ONLY {"expires":null}.`;
      // Only this one document may be read. The SDK auto-approves read-only tools without calling
      // canUseTool (see src/chat/options.js), so the PreToolUse hook is what actually enforces it;
      // canUseTool stays as defense in depth.
      const allowed = (tool, input) => tool === "Read" && typeof input?.file_path === "string" && resolve(assetsRoot(), input.file_path) === abs; // relative paths mean relative to the assets root, like the engine's cwd
      const denyMsg = "Only the document being scanned can be read.";
      const options = {
        cwd: assetsRoot(), permissionMode: "default", settingSources: [], tools: ["Read"], maxTurns: 4, model: MODEL_IDS.HAIKU,
        canUseTool: async (tool, input) => (allowed(tool, input) ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: denyMsg }),
        hooks: { PreToolUse: [{ hooks: [async (h) => {
          if (h.hook_event_name !== "PreToolUse" || allowed(h.tool_name, h.tool_input)) return {};
          return { decision: "block", reason: denyMsg, hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: denyMsg } };
        }] }] },
      };
      let out = "";
      try {
        for await (const ev of ctx.runTurn({ prompt, options })) {
          if (ev.type === "text") out += ev.delta;
          if (ev.type === "done" && ev.text) out = ev.text;
          if (ev.type === "error") audit.log("assets.scan.error", { ...logUser(user), path: rel, error: String(ev.message).slice(0, 200) });
        }
      } catch (e) { audit.log("assets.scan.error", { ...logUser(user), path: rel, error: String(e?.message).slice(0, 200) }); }
      const m = out.match(/\{[^{}]*"expires"[^{}]*\}/);
      result = { scanStatus: "error" };
      if (m) {
        try {
          const j = JSON.parse(m[0]);
          if (j.expires === null || /^\d{4}-\d{2}-\d{2}$/.test(j.expires)) result = j.expires ? { expires: j.expires, scanStatus: "found" } : { scanStatus: "none" };
        } catch { /* keep error */ }
      }
    }
    setDocMeta(assetsRoot(), rel, result);
    audit.log("assets.scan", { ...logUser(user), path: rel, status: result.scanStatus });
    return result;
  }

  const handle = async (req, res, url) => {
    const p = url.pathname;
    if (!p.startsWith("/api/")) return false;
    const get = req.method === "GET", post = req.method === "POST";

    if (get && p === "/api/calendar") { if (!requireUser(req, res, auth)) return true; return sendJson(res, 200, notWired({ events: [] })), true; }
    if (get && p === "/api/email") { if (!requireUser(req, res, auth)) return true; return sendJson(res, 200, notWired()), true; }
    if (get && p === "/api/stats") { if (!requireUser(req, res, auth)) return true; return sendJson(res, 200, sanitizeStats(readStats(vaultPath))), true; }
    if (get && p === "/api/routines") { if (!requireUser(req, res, auth)) return true; return sendJson(res, 200, sanitizeRoutines(readRoutines(vaultPath))), true; }

    if (get && p === "/api/skills") {
      if (!requireOwner(req, res, auth)) return true;
      const skills = SKILLS.map((s) => ({
        id: s.id, icon: s.icon || "doc",
        model: Math.max(0, MODELS.indexOf(s.model)), effort: Math.max(0, EFFORTS.indexOf(s.effort)),
        needsInput: !!s.needsInput, ...(s.inputLabel ? { inputLabel: s.inputLabel } : {}),
      }));
      return sendJson(res, 200, { skills, models: MODELS, efforts: EFFORTS, runs: readRunHistory(vaultPath).slice(0, 20) }), true;
    }

    if (post && p === "/api/run") {
      const user = requireOwner(req, res, auth); if (!user) return true;
      const b = await body(req);
      if (!SKILLS.find((s) => s.id === b.id)) return sendJson(res, 400, { error: "unknown skill" }), true;
      const model = b.model === undefined || b.model === "" ? undefined : String(b.model).toUpperCase();
      const effort = b.effort === undefined || b.effort === "" ? undefined : String(b.effort).toUpperCase();
      if (typeof b.model === "number" || (model && !MODELS.includes(model))) return sendJson(res, 400, { error: "unknown model" }), true;
      if (typeof b.effort === "number" || (effort && !EFFORTS.includes(effort))) return sendJson(res, 400, { error: "unknown effort" }), true;
      audit.log("run.start", { ...logUser(user), skillId: b.id });
      const job = jobs.start({
        vaultPath, skillId: b.id, model, effort,
        input: b.input, runTurn: ctx.runTurn, audit, guard,
      });
      return sendJson(res, 200, { job: job.jobId }), true;
    }
    if (get && p === "/api/run-status") {
      if (!requireOwner(req, res, auth)) return true;
      const job = jobs.get(url.searchParams.get("job"));
      if (!job) return sendJson(res, 404, { error: "unknown job" }), true;
      return sendJson(res, 200, jobs.status(job)), true;
    }
    if (get && p === "/api/jobs/active") {
      if (!requireOwner(req, res, auth)) return true;
      return sendJson(res, 200, { jobs: jobs.active() }), true;
    }

    if (post && p === "/api/artifact-remove") {
      const user = requireOwner(req, res, auth); if (!user) return true;
      const b = await body(req);
      const r = removeArtifact(vaultPath, b.file);
      audit.log("artifact.remove", { ...logUser(user), file: b.file, ok: !!r.ok });
      if (r.error) return sendJson(res, r.code || 400, { error: r.error }), true;
      return sendJson(res, 200, { ok: true }), true;
    }

    // ---- business assets: the extras on top of assets-routes.js ----
    if (post && (p === "/api/assets/scan" || p === "/api/assets/remind")) {
      const user = requireOwner(req, res, auth); if (!user) return true;
      const b = await body(req);
      const a = listedAssetPath(assetsRoot(), b.id);
      if (!a) return sendJson(res, 404, { error: "unknown document" }), true;
      if (p === "/api/assets/scan") return sendJson(res, 200, { id: b.id, ...(await scanOne(user, a.abs, a.rel)) }), true;
      const dm = getDocMeta(assetsRoot(), a.rel);
      if (!dm || !dm.expires) return sendJson(res, 400, { error: "no expiration date set for this document yet" }), true;
      return sendJson(res, 501, { error: "Google Calendar isn't connected in Blueprint OS yet, so reminders can't be added" }), true;
    }

    // ---- SHOP APPS rows ----
    if (get && p === "/api/apps") { if (!requireUser(req, res, auth)) return true; return sendJson(res, 200, { apps: readApps(vaultPath) }), true; }
    if (post && p === "/api/apps") {
      const user = requireOwner(req, res, auth); if (!user) return true;
      const b = await body(req);
      const v = validateApps(Array.isArray(b) ? b : b.apps);
      if (v.error) return sendJson(res, 400, { error: v.error }), true;
      writeApps(vaultPath, v.apps);
      audit.log("apps.change", { ...logUser(user), count: v.apps.length });
      return sendJson(res, 200, { apps: v.apps }), true;
    }

    if (post && p === "/api/open") {
      if (!requireUser(req, res, auth)) return true;
      return sendJson(res, 400, { error: "not supported: the dashboard never opens files on the server" }), true;
    }
    return false;
  };
  return async (req, res, url) => {
    try { return await handle(req, res, url); }
    catch (e) {
      if (e.badBody && !res.headersSent) return sendJson(res, 400, { error: "bad request body" }), true;
      throw e;
    }
  };
}
