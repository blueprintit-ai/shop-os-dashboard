import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

export const SKILLS = [
  { id: "bp-digest", label: "Digest", model: "SONNET", effort: "MEDIUM", needsInput: false },
  { id: "morning-briefing", label: "Morning Briefing", model: "HAIKU", effort: "LOW", needsInput: false },
  { id: "bp-optimizer", label: "BP Optimizer", model: "OPUS", effort: "HIGH", needsInput: false },
];

const MODEL_IDS = {
  HAIKU: "claude-haiku-4-5-20251001",
  SONNET: "claude-sonnet-5",
  OPUS: "claude-opus-5",
  FABLE: "claude-fable-5-1",
};
const EFFORT_HINTS = {
  LOW: "Keep it brief. One pass, no deep exploration.",
  MEDIUM: "Normal thoroughness.",
  HIGH: "Be thorough — check your work before finishing.",
  XHIGH: "Be very thorough — verify assumptions, consider edge cases.",
  MAX: "Maximum rigor — this result will be read by the owner unattended.",
};

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function artifactsDir(vaultPath) { return join(vaultPath, "Dashboard", "artifacts"); }
function runsDir(vaultPath) { return join(vaultPath, "Dashboard", "runs"); }
function runLogPath(vaultPath) { return join(vaultPath, "Dashboard", "snapshots", "runs.json"); }

export function readRunHistory(vaultPath) {
  try { return JSON.parse(readFileSync(runLogPath(vaultPath), "utf8")); } catch { return []; }
}
function recordRun(vaultPath, entry) {
  const dir = join(vaultPath, "Dashboard", "snapshots");
  mkdirSync(dir, { recursive: true });
  const runs = [entry, ...readRunHistory(vaultPath)].slice(0, 200);
  writeFileSync(runLogPath(vaultPath), JSON.stringify(runs, null, 2));
}

function writeReport(vaultPath, { skillId, model, effort, seconds, ok, resultText, code }) {
  const dir = artifactsDir(vaultPath);
  mkdirSync(dir, { recursive: true });
  const now = new Date();
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/(\d{8})(\d{4})/, "$1-$2");
  const slug = `${skillId}-${stamp}`;
  const body = resultText?.trim() ? marked.parse(resultText) : "<p>(no output captured)</p>";
  const html = `<!doctype html><meta charset="utf-8"><title>/${esc(skillId)} run</title>
<body style="font:15px system-ui;max-width:760px;margin:56px auto;">
<p style="text-transform:uppercase;letter-spacing:2px;color:#8d8775;">Shop OS · headless skill run</p>
<h1>/${esc(skillId)}</h1>
<p>${ok ? "Result:" : "Run FAILED (exit " + esc(String(code)) + "). Last output below."}</p>
${body}
</body>`;
  writeFileSync(join(dir, `${slug}.html`), html);
  writeFileSync(join(dir, `${slug}.json`), JSON.stringify({
    title: `/${skillId} · ${now.toLocaleString()}`,
    icon: "bolt", kind: "run", visibility: "owner",
    created: now.toISOString(),
    note: `headless · ${model} · ${effort} · ${seconds}s · exit ${code}`,
  }, null, 2));
  return `${slug}.html`;
}

export async function runSkill({ vaultPath, skillId, input, model, effort, runTurn, audit }) {
  const dir = runsDir(vaultPath);
  mkdirSync(dir, { recursive: true });
  const startedAt = Date.now();
  const logFile = join(dir, `${skillId}-${startedAt}.log`);
  const prompt = `/${skillId}${input ? " " + input : ""}`.trim();
  const systemNote = EFFORT_HINTS[effort] || EFFORT_HINTS.MEDIUM;
  const options = {
    cwd: vaultPath, permissionMode: "acceptEdits", settingSources: ["user", "project"],
    skills: "all", maxTurns: 40, model: MODEL_IDS[model] || MODEL_IDS.SONNET,
    systemPromptAppend: systemNote,
  };
  let resultText = "", ok = false, log = "";
  try {
    for await (const ev of runTurn({ prompt, options })) {
      log += JSON.stringify(ev) + "\n";
      if (ev.type === "text") resultText += ev.delta;
      if (ev.type === "done") { resultText = ev.text ?? resultText; ok = true; }
      if (ev.type === "error") { log += `ERROR: ${ev.message}\n`; }
    }
  } catch (e) {
    log += `THROWN: ${e.message}\n`;
  }
  writeFileSync(logFile, log);
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  const code = ok ? 0 : 1;
  const reportFile = writeReport(vaultPath, { skillId, model, effort, seconds, ok, resultText, code });
  recordRun(vaultPath, { id: skillId, at: new Date().toISOString(), model, effort, seconds, exit: code, report: reportFile });
  audit?.log("run.end", { skillId, model, effort, ok, seconds });
  return { jobId: `${skillId}-${startedAt}`, id: skillId, status: ok ? "done" : "failed", startedAt, endedAt: Date.now(), code, reportFile };
}
