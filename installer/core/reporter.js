import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { redactDeep, capReport } from "./redact.js";

export function createReporter({
  licenseKey, runId, supportCode, serverBase, fetchImpl = globalThis.fetch, logDir, homeDir, homeToken,
  timeoutMs = 4000, installerVersion = "2.0.0",
}) {
  const pending = new Set();
  const logPath = join(logDir, `install-${runId}.log`);
  const redactOpts = { homeDir, homeToken };

  function logLocal(entry) {
    try {
      mkdirSync(logDir, { recursive: true });
      appendFileSync(logPath, JSON.stringify(redactDeep({ at: new Date().toISOString(), ...entry }, redactOpts)) + "\n");
    } catch { /* a log we cannot write must never stop the install */ }
  }

  function send(event) {
    // Nothing in here may throw or reject: reporting is best-effort.
    const p = (async () => {
      let timer;
      try {
        const clean = redactDeep(event, redactOpts);
        logLocal(clean);
        // license_key stays FULL (the server keys by it); every other string was redacted above.
        const payload = capReport({
          license_key: licenseKey, run_id: runId, support_code: supportCode, installer_version: installerVersion,
          ...clean,
          machine: { os: clean.snapshot?.os, source: "installer-v2" },
        });
        const ctl = new AbortController();
        timer = setTimeout(() => ctl.abort(), timeoutMs);
        timer.unref?.();
        await fetchImpl(`${serverBase}/install-log`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: ctl.signal,
        });
      } catch { /* reporting is best-effort */ } finally { if (timer) clearTimeout(timer); }
    })();
    pending.add(p);
    p.finally(() => pending.delete(p));
    return p;
  }

  async function flush() {
    let t;
    const cap = new Promise((r) => { t = setTimeout(r, timeoutMs + 500); t.unref?.(); });
    try {
      await Promise.race([Promise.all([...pending]), cap]);
    } catch { /* never throws */ } finally { clearTimeout(t); }
  }

  return { send, flush, logLocal, logPath };
}
