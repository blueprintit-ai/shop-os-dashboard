// usage: node test/e2e/assert-install.mjs <vaultPath> <reportsFile> <mode: ok|fail-github>
// env: SHOPOS_LICENSE_KEY (the full key must appear only in the license_key field of reports, never in other fields or local logs)
// The pure checks (checkOkReports, checkFailGithubReports, homeLeaks) are exported and unit-tested offline.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir, userInfo } from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const SUPPORT_CODE = /^BP-[A-HJ-NP-Z2-9]{4}$/;
const PLUGINS = ["obsidian@blueprint-skills", "superpowers@claude-plugins-official"];
// Steps whose failure the customer would feel; a "warn" here is a real finding even though the run still succeeds.
export const STRICT_STEPS = ["machine-check", "license", "vault-location", "claude-code", "plugins", "obsidian", "vault", "dashboard", "health"];

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

// What leaked, as a list of kinds ([] = clean): the home dir in any form, the bare user name (whole word,
// case-insensitive, 3+ characters so "al" cannot flag everything), and the Windows 8.3 short form of the home dir.
export function findLeaks(text, { home, username, shortHome } = {}) {
  const found = [];
  if (homeLeaks(text, home)) found.push("home");
  if (shortHome) {
    if (homeLeaks(text, shortHome)) found.push("short-home");
    else {
      const seg = String(shortHome).split(/[\\/]/).filter(Boolean).pop();
      if (seg && seg.includes("~") && String(text).toLowerCase().includes(seg.toLowerCase())) found.push("short-home");
    }
  }
  const u = String(username ?? "");
  if (u.length >= 3 && new RegExp(`(?<![A-Za-z0-9_])${u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_])`, "i").test(String(text))) found.push("username");
  return found;
}

// Windows only: the 8.3 form of the home dir (C:\Users\RUNNER~1). null when the platform has none.
export function shortHomeDir(home = homedir()) {
  if (process.platform !== "win32") return null;
  try {
    const r = spawnSync("powershell", ["-NoProfile", "-Command", "(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:SHOPOS_HOME_FOR_SHORT).ShortPath"],
      { encoding: "utf8", env: { ...process.env, SHOPOS_HOME_FOR_SHORT: home } });
    const out = r.status === 0 ? r.stdout.trim() : "";
    return out && out.toLowerCase() !== String(home).toLowerCase() ? out : null;
  } catch { return null; }
}

// Every file under dir as { name, text }; a missing folder is [].
export function readLogs(dir) {
  const out = [];
  const walk = (d) => {
    let names;
    try { names = readdirSync(d); } catch { return; }
    for (const n of names) {
      const p = join(d, n);
      try { statSync(p).isDirectory() ? walk(p) : out.push({ name: p, text: readFileSync(p, "utf8") }); } catch { /* unreadable: skip */ }
    }
  };
  walk(dir);
  return out;
}

// The full license key may appear only in the TOP-LEVEL license_key field of a report. Anywhere else in a report,
// or anywhere in a local log, is a leak. Unshortened block pairs (CI12-TEST, TEST-0001) count too.
export function licenseKeyLeaks(reports, logs, key) {
  const k = String(key ?? "").trim();
  if (!k) return [];
  const needles = [k.toLowerCase()];
  const blocks = k.split("-");
  if (blocks.length === 4) needles.push(`${blocks[1]}-${blocks[2]}`.toLowerCase(), `${blocks[2]}-${blocks[3]}`.toLowerCase());
  const has = (t) => needles.some((n) => String(t).toLowerCase().includes(n));
  const found = [];
  reports.forEach((r, i) => {
    const { license_key: _top, ...rest } = r;
    if (has(JSON.stringify(rest))) found.push(`report ${i}`);
  });
  for (const l of logs) if (has(l.text)) found.push(`log ${l.name}`);
  return found;
}

export function checkNoRejected(file) {
  const text = existsSync(file) ? readFileSync(file, "utf8").trim() : "";
  assert.equal(text, "", `the fake license server rejected (400) ${text.split("\n").length} report(s) the real server would also reject: ${text.slice(0, 600)}`);
}

function checkCommon(reports, { home, username, shortHome, logs = [], licenseKey }) {
  assert.ok(reports.length > 0, "no reports were received");
  const last = reports.at(-1);
  assert.match(String(last.support_code ?? ""), SUPPORT_CODE, "support_code on the last report");
  assert.ok(last.run_id, "run_id on the last report");
  assert.ok(reports.every((r) => r.run_id === last.run_id && r.support_code === last.support_code), "all reports share one run_id and support_code");
  assert.ok(Array.isArray(last.timeline), "timeline is an array");
  assert.ok(Array.isArray(last.notes) && last.notes.every((n) => typeof n === "string"), "notes is an array of strings");
  assert.ok(Number.isFinite(last.duration_ms), "duration_ms is a number");
  assert.ok(last.snapshot && typeof last.snapshot === "object", "snapshot is present");
  const leaks = findLeaks(JSON.stringify(reports), { home, username, shortHome });
  assert.deepEqual(leaks.filter((l) => l === "home"), [], "home directory leaked into a report");
  assert.deepEqual(leaks, [], `report leaks: ${leaks.join(", ")} (username / short home dir)`);
  for (const l of logs) assert.deepEqual(findLeaks(l.text, { home, username, shortHome }), [], `local log ${l.name} leaks the home dir or user name`);
  assert.deepEqual(licenseKeyLeaks(reports, logs, licenseKey), [], "license key outside the license_key field of a report, or in a local log");
  return last;
}

// Two-phase run with SHOPOS_NO_LAUNCH=1: progress per step, then ONE success report, nothing after it.
export function checkOkReports(reports, { home = homedir(), strictSteps = [], ...leakOpts } = {}) {
  const last = checkCommon(reports, { home, ...leakOpts });
  assert.equal(last.status, "success", `last report status was ${last.status} (a report after the success report, such as launch progress, is not allowed)`);
  assert.equal(last.step, "complete", "success report step");
  assert.equal(reports.filter((r) => r.status === "success").length, 1, "exactly one success report");
  assert.ok(!reports.some((r) => r.status === "error"), "no error report in a successful run");
  assert.ok(reports.some((r) => r.status === "progress" && r.step === "claude-code"), "progress reports were sent per step (claude-code)");
  assert.ok(!reports.some((r) => r.step === "launch"), "no report after the success report: launch runs in phase two without a reporter");
  assert.ok(!last.timeline.some((t) => t.status === "failed"), "a timeline entry is failed");
  for (const id of strictSteps) {
    const t = last.timeline.find((e) => e.id === id);
    assert.ok(t, `timeline has step ${id}`);
    assert.ok(["ok", "skipped"].includes(t.status), `step ${id} finished ${t.status}: ${t.error ?? ""}`);
  }
}

// SHOPOS_TEST_FAIL_HOSTS blocks github.com inside the installer, so machine-check is the step that must stop the run.
export function checkFailGithubReports(reports, { home = homedir(), ...leakOpts } = {}) {
  const last = checkCommon(reports, { home, ...leakOpts });
  assert.equal(last.status, "error", `last report status was ${last.status}`);
  assert.equal(last.step, "machine-check", `failing step was ${last.step}`);
  assert.ok(last.step_title, "step_title on the error report");
  assert.ok(!reports.some((r) => r.status === "success"), "no success report");
  assert.match(last.hint ?? "", /GitHub unreachable|firewall|DNS/i, "hint explains the likely cause");
  assert.equal(last.snapshot?.reach?.github, false, "snapshot shows github unreachable");
  assert.ok(last.timeline.some((t) => t.id === "machine-check" && t.status === "failed"), "timeline marks machine-check failed");
}

// Mirrors installer/core/claude.js claudePath: ~/.local/bin first, PATH fallback.
function claudeBin() {
  const p = join(homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude");
  return existsSync(p) ? p : "claude";
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
  checkNoRejected(`${reportsFile}.rejected`);
  const home = homedir();
  let username = "";
  try { username = userInfo().username; } catch { /* no user name available */ }
  const logDir = process.env.SHOPOS_LOGS || join(home, ".shopos", "logs");
  const leakOpts = { home, username, shortHome: shortHomeDir(home), logs: readLogs(logDir), licenseKey: process.env.SHOPOS_LICENSE_KEY ?? "" };
  if (mode === "ok") {
    checkMachine(vault);
    assert.ok(leakOpts.logs.length > 0, `no local install log found under ${logDir}`);
    checkOkReports(reports, { strictSteps: STRICT_STEPS, ...leakOpts });
    console.log("OK: install verified");
  } else if (mode === "fail-github") {
    checkFailGithubReports(reports, leakOpts);
    console.log("OK: deliberate failure reported with a hint");
  } else {
    throw new Error(`unknown mode ${mode}`);
  }
}
