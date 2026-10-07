// Fake license server for CI. Usage: node test/helpers/fake-license-server.js <port> <outFile>
// GET /validate -> a valid blueprint-os license. POST /install-log -> body appended to <outFile> as one JSON line.
import { createServer } from "node:http";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

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
        let line;
        try { line = JSON.stringify(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { line = JSON.stringify({ unparseable_body: Buffer.concat(chunks).toString("utf8") }); }
        appendFileSync(out, line + "\n");
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
