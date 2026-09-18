import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export class Audit {
  constructor(filePath) { this.filePath = filePath; }
  log(event, fields = {}) {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      appendFileSync(this.filePath, JSON.stringify({ ts: new Date().toISOString(), event, ...fields }) + "\n", "utf8");
    } catch (e) {
      console.error("[audit] write failed", e.message);
    }
  }
}

export function readAll(filePath) {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
