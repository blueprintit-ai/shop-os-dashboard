// Fake license server for CI. Usage: node test/helpers/fake-license-server.js <port> <outFile>
// GET /validate -> a valid blueprint-os license. POST /install-log -> body appended to <outFile> as one JSON line.
// It mirrors the real server's validation: a body the real server would answer 400 gets 400 here too, and is
// recorded to <outFile>.rejected instead (assert-install.mjs fails the run if that file has anything in it).
import { createServer } from "node:http";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const KEY_RE = /^[A-Za-z0-9-]{1,64}$/;
const STATUSES = ["success", "error", "retry", "progress"];

// Returns null when the real server would accept this parsed body, else the reason it would answer 400.
export function rejectReason(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "body is not a JSON object";
  if (typeof body.license_key !== "string" || !KEY_RE.test(body.license_key.trim())) return "license_key must be a string matching /^[A-Za-z0-9-]{1,64}$/ after trim";
  if (!STATUSES.includes(body.status)) return "status must be one of success|error|retry|progress";
  if (body.run_id !== undefined && body.run_id !== null && !(typeof body.run_id === "string" && KEY_RE.test(body.run_id))) return "run_id must match /^[A-Za-z0-9-]{1,64}$/";
  return null;
}

export function createFakeLicenseServer(out) {
  return createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (req.method === "GET" && url.pathname === "/validate") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ customer: "CI Test", product: "blueprint-os", valid: true, entitlements: [], valid_until: null }));
    }
    if (req.method === "POST" && url.pathname === "/install-log") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        // One line per report: re-serialize so a pretty-printed body cannot split a record.
        const raw = Buffer.concat(chunks).toString("utf8");
        let parsed, reason;
        try { parsed = JSON.parse(raw); reason = rejectReason(parsed); } catch { reason = "body is not valid JSON"; }
        if (reason) {
          appendFileSync(`${out}.rejected`, JSON.stringify({ reason, body: raw.slice(0, 4000) }) + "\n");
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: reason }));
        }
        appendFileSync(out, JSON.stringify(parsed) + "\n");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [port = "8787", out = "reports.jsonl"] = process.argv.slice(2);
  createFakeLicenseServer(out).listen(Number(port), "127.0.0.1", () => console.log(`fake license server on ${port}`));
}
