import { spawn } from "node:child_process";

const MAX_STDOUT = 1024 * 1024;

// The ONLY way the installer runs an outside command. No shell, so a path with
// spaces or non-ASCII characters is never re-parsed. Never rejects: failures
// come back as { ok: false } so a step can report them with full detail.
export function runCommand(command, args = [], { timeoutMs = 120000, cwd, env, spawnImpl = spawn, tailLines = 40 } = {}) {
  const started = Date.now();
  const cmdline = [command, ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let out = "";
    let child;
    const finish = (extra) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const lines = out.replace(/\r\n/g, "\n").split("\n");
      while (lines.length && lines[lines.length - 1] === "") lines.pop();
      resolve({
        ok: false, code: null, signal: null, timedOut, durationMs: Date.now() - started, cmdline,
        outTail: lines.slice(-tailLines).join("\n"), stdout: out.slice(0, MAX_STDOUT), ...extra,
      });
    };
    const timer = setTimeout(() => { timedOut = true; try { child?.kill("SIGKILL"); } catch {} finish({ ok: false }); }, timeoutMs);
    try {
      child = spawnImpl(command, args, { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      return finish({ errorCode: e.code ?? "SPAWN" });
    }
    const onData = (buf) => { out += buf.toString("utf8"); if (out.length > MAX_STDOUT * 2) out = out.slice(-MAX_STDOUT); };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (e) => finish({ errorCode: e.code ?? "SPAWN", outTail: String(e.message) }));
    child.on("close", (code, signal) => finish({ ok: code === 0 && !timedOut, code, signal }));
  });
}
