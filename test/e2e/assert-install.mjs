// usage: node test/e2e/assert-install.mjs <vaultPath> <reportsFile> <mode: ok|fail-github>
// The pure checks (checkOkReports, checkFailGithubReports, homeLeaks) are exported and unit-tested offline.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const SUPPORT_CODE = /^BP-[A-HJ-NP-Z2-9]{4}$/;
const PLUGINS = ["obsidian@blueprint-skills", "superpowers@claude-plugins-official"];
// Steps whose failure the customer would feel; a "warn" here is a real finding even though the run still succeeds.
export const STRICT_STEPS = ["machine-check", "license", "vault-location", "claude-code", "plugins", "vault", "dashboard", "health"];

// True when `text` contains the home dir in any form it could take inside a report: raw, JSON-escaped
// (backslashes doubled), forward-slash, each compared case-insensitively (Windows paths are).
export function homeLeaks(text, home) {
  const h = String(home ?? "").replace(/[\\/]+$/, "");
  if (h.length < 3) return false;
  const jsonEscaped = JSON.stringify(h).slice(1, -1);
  const variants = new Set([h, jsonEscaped, h.replace(/\\/g, "/"), h.replace(/\//g, "\\"), h.replace(/\//g, "\\").replace(/\\/g, "\\\\")]);
  const hay = String(text).toLowerCase();
  return [...variants].some((v) => hay.includes(v.toLowerCase()));
}

function checkCommon(reports, home) {
  assert.ok(reports.length > 0, "no reports were received");
  const last = reports.at(-1);
  assert.match(String(last.support_code ?? ""), SUPPORT_CODE, "support_code on the last report");
  assert.ok(last.run_id, "run_id on the last report");
  assert.ok(reports.every((r) => r.run_id === last.run_id && r.support_code === last.support_code), "all reports share one run_id and support_code");
  assert.ok(Array.isArray(last.timeline), "timeline is an array");
  assert.ok(Array.isArray(last.notes) && last.notes.every((n) => typeof n === "string"), "notes is an array of strings");
  assert.ok(Number.isFinite(last.duration_ms), "duration_ms is a number");
  assert.ok(last.snapshot && typeof last.snapshot === "object", "snapshot is present");
  assert.ok(!homeLeaks(JSON.stringify(reports), home) && !reports.some((r) => homeLeaks(JSON.stringify(r), home)), "home directory leaked into a report");
  return last;
}

// Two-phase run with SHOPOS_NO_LAUNCH=1: progress per step, then ONE success report, nothing after it.
export function checkOkReports(reports, { home = homedir(), strictSteps = [] } = {}) {
  const last = checkCommon(reports, home);
  assert.equal(last.status, "success", `last report status was ${last.status} (a report after the success report, such as launch progress, is not allowed)`);
  assert.equal(last.step, "complete", "success report step");
  assert.equal(reports.filter((r) => r.status === "success").length, 1, "exactly one success report");
  assert.ok(!reports.some((r) => r.status === "error"), "no error report in a successful run");
  assert.ok(reports.some((r) => r.status === "progress" && r.step === "claude-code"), "progress reports were sent per step (claude-code)");
  assert.ok(!reports.some((r) => r.step === "launch"), "no launch report (SHOPOS_NO_LAUNCH=1)");
  assert.ok(!last.timeline.some((t) => t.status === "failed"), "a timeline entry is failed");
  for (const id of strictSteps) {
    const t = last.timeline.find((e) => e.id === id);
    assert.ok(t, `timeline has step ${id}`);
    assert.ok(["ok", "skipped"].includes(t.status), `step ${id} finished ${t.status}: ${t.error ?? ""}`);
  }
}

// SHOPOS_TEST_FAIL_HOSTS blocks github.com inside the installer, so machine-check is the step that must stop the run.
export function checkFailGithubReports(reports, { home = homedir() } = {}) {
  const last = checkCommon(reports, home);
  assert.equal(last.status, "error", `last report status was ${last.status}`);
  assert.equal(last.step, "machine-check", `failing step was ${last.step}`);
  assert.ok(last.step_title, "step_title on the error report");
  assert.ok(!reports.some((r) => r.status === "success"), "no success report");
  assert.match(last.hint ?? "", /GitHub unreachable|firewall|DNS/i, "hint explains the likely cause");
  assert.equal(last.snapshot?.reach?.github, false, "snapshot shows github unreachable");
  assert.ok(last.timeline.some((t) => t.id === "machine-check" && t.status === "failed"), "timeline marks machine-check failed");
}

function claudeBin() {
  return join(homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude");
}

function checkMachine(vault) {
  const claude = claudeBin();
  const v = spawnSync(claude, ["--version"], { encoding: "utf8" });
  assert.equal(v.status, 0, `claude --version (${v.error ?? v.stderr})`);
  const pl = spawnSync(claude, ["plugin", "list", "--json"], { encoding: "utf8" });
  assert.equal(pl.status, 0, "claude plugin list --json");
  const list = JSON.parse(pl.stdout);
  for (const id of PLUGINS) assert.ok(list.some((p) => p.id === id && p.enabled), `${id} enabled`);
  for (const f of ["CLAUDE.md", join("Raw", "README.md"), join(".claude", "settings.json")]) assert.ok(existsSync(join(vault, f)), f);
  assert.ok(existsSync(join(homedir(), ".shopos", "license.json")), "~/.shopos/license.json");
  if (process.platform === "win32") {
    assert.equal(spawnSync("schtasks", ["/query", "/tn", "ShopOSDashboard"]).status, 0, "scheduled task ShopOSDashboard registered");
    const d = spawnSync("powershell", ["-NoProfile", "-Command", "[Environment]::GetFolderPath('Desktop')"], { encoding: "utf8" });
    const desktop = d.status === 0 && d.stdout.trim() ? d.stdout.trim() : join(homedir(), "Desktop");
    assert.ok(existsSync(join(desktop, "Blueprint OS.lnk")), "desktop shortcut Blueprint OS.lnk");
  } else {
    assert.ok(existsSync(join(homedir(), "Desktop", "Blueprint OS.app")), "desktop app Blueprint OS.app");
    assert.ok(existsSync(join(homedir(), "Library", "LaunchAgents", "ai.blueprintit.shop-os-dashboard.plist")), "LaunchAgent plist");
  }
}

function readReports(file) {
  return readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [vault, reportsFile, mode = "ok"] = process.argv.slice(2);
  const reports = readReports(reportsFile);
  if (mode === "ok") {
    checkMachine(vault);
    checkOkReports(reports, { strictSteps: STRICT_STEPS });
    console.log("OK: install verified");
  } else if (mode === "fail-github") {
    checkFailGithubReports(reports);
    console.log("OK: deliberate failure reported with a hint");
  } else {
    throw new Error(`unknown mode ${mode}`);
  }
}
