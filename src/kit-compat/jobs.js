import { randomUUID } from "node:crypto";
import { runSkill, SKILLS } from "../runs.js";

// The kit's "run a skill" is asynchronous: POST /api/run answers {job} at once and the
// page polls /api/run-status and /api/jobs/active. The product's runSkill() (src/runs.js,
// the Agent SDK mechanism) resolves when the run is over, so this keeps the in-flight
// state the kit page needs and feeds it from runSkill's onEvent hook. Nothing here
// spawns a process or builds a command line from page input.
const TAIL_CHARS = 700;
const MAX_JOBS = 50;
const KEEP_FINISHED_MS = 60 * 60 * 1000;

export class JobStore {
  constructor() { this.jobs = new Map(); }

  start({ vaultPath, skillId, model, effort, input, runTurn, audit, guard }) {
    const skill = SKILLS.find((s) => s.id === skillId);
    if (!skill) throw Object.assign(new Error("unknown skill"), { code: "unknown-skill" });
    this.prune();
    const jobId = `${skillId}-${randomUUID()}`;
    const job = { jobId, id: skillId, model: model || skill.model, effort: effort || skill.effort, status: "running", started: Date.now(), ended: null, code: null, report: null, text: "" };
    this.jobs.set(jobId, job);
    (async () => {
      const release = guard ? await guard.acquire(jobId) : () => {};
      try {
        const r = await runSkill({
          vaultPath, skillId, input: String(input || "").replace(/\s+/g, " ").trim(),
          model: job.model, effort: job.effort, runTurn, audit, jobId,
          onEvent: (ev) => { if (ev.type === "text" && ev.delta) job.text = (job.text + ev.delta).slice(-4000); },
        });
        job.status = r.status; job.code = r.code; job.report = r.reportFile;
      } catch (e) {
        job.status = "failed"; job.code = -1; job.text += `\n${e.message}`;
      } finally {
        job.ended = Date.now();
        release();
      }
    })();
    return job;
  }

  // Finished jobs older than an hour go; past MAX_JOBS the oldest finished ones go too. Running jobs never do.
  prune() {
    const now = Date.now();
    for (const [id, j] of this.jobs) if (j.status !== "running" && j.ended && now - j.ended > KEEP_FINISHED_MS) this.jobs.delete(id);
    if (this.jobs.size <= MAX_JOBS) return;
    for (const [id, j] of this.jobs) { if (this.jobs.size <= MAX_JOBS) break; if (j.status !== "running") this.jobs.delete(id); }
  }

  get(jobId) { return this.jobs.get(jobId) || null; }

  status(job) {
    return {
      status: job.status, code: job.code, report: job.report,
      elapsed: Math.round(((job.ended || Date.now()) - job.started) / 1000),
      tail: job.text.slice(-TAIL_CHARS).split("\n").slice(-6).join("\n"),
    };
  }

  active() {
    return [...this.jobs.values()].filter((j) => j.status === "running").map((j) => ({
      jobId: j.jobId, id: j.id, model: j.model, effort: j.effort, started: j.started,
      elapsed: Math.round((Date.now() - j.started) / 1000),
    }));
  }
}
