import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

const MAX_STDOUT = 1024 * 1024;
const MAX_MERGED = 64 * 1024;

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
    let stdout = "";
    let truncated = false;
    let child;
    const finish = (extra) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const lines = out.replace(/\r\n/g, "\n").split("\n");
      while (lines.length && lines[lines.length - 1] === "") lines.pop();
      resolve({
        ok: false, code: null, signal: null, timedOut, durationMs: Date.now() - started, cmdline,
        outTail: lines.slice(-tailLines).join("\n"), stdout, truncated, ...extra,
      });
    };
    const timer = setTimeout(() => { timedOut = true; try { child?.kill("SIGKILL"); } catch {} finish({ ok: false }); }, timeoutMs);
    try {
      child = spawnImpl(command, args, { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      return finish({ errorCode: e.code ?? "SPAWN" });
    }
    const addMerged = (text) => { out += text; if (out.length > MAX_MERGED) out = out.slice(-MAX_MERGED); };
    const addStdout = (text) => {
      if (truncated) return;
      const room = MAX_STDOUT - stdout.length;
      if (text.length > room) { stdout += text.slice(0, room); truncated = true; } else stdout += text;
    };
    const outDec = new StringDecoder("utf8");
    const errDec = new StringDecoder("utf8");
    child.stdout?.on("data", (buf) => { const t = outDec.write(buf); addStdout(t); addMerged(t); });
    child.stderr?.on("data", (buf) => { addMerged(errDec.write(buf)); });
    child.on("error", (e) => finish({ errorCode: e.code ?? "SPAWN", outTail: String(e.message) }));
    child.on("close", (code, signal) => { const a = outDec.end(); addStdout(a); addMerged(a); addMerged(errDec.end()); finish({ ok: code === 0 && !timedOut, code, signal }); });
  });
}
