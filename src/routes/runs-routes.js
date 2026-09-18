import { requireOwner } from "../auth.js";
import { sendJson, readJsonBody } from "../lib/http.js";
import { runSkill, readRunHistory, SKILLS } from "../runs.js";
import { runTurn as defaultRunTurn } from "../chat/run-turn.js";

export function runsRoutes({ vaultPath, auth, audit, runTurn = defaultRunTurn }) {
  return async (req, res, url) => {
    const p = url.pathname;
    if (p === "/api/runs" && req.method === "GET") {
      const user = requireOwner(req, res, auth); if (!user) return true;
      return sendJson(res, 200, { skills: SKILLS, runs: readRunHistory(vaultPath).slice(0, 20) }), true;
    }
    if (p === "/api/runs" && req.method === "POST") {
      const user = requireOwner(req, res, auth); if (!user) return true;
      const { id, input, model, effort } = await readJsonBody(req);
      const skill = SKILLS.find((s) => s.id === id);
      if (!skill) return sendJson(res, 400, { error: "unknown-skill" }), true;
      audit.log("run.start", { userId: user.id, username: user.username, role: user.role, skillId: id });
      const job = await runSkill({
        vaultPath, skillId: id, input: input || "",
        model: model || skill.model, effort: effort || skill.effort, runTurn, audit,
      });
      return sendJson(res, 200, job), true;
    }
    return false;
  };
}
