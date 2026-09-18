import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isPathAllowed } from "../scope.js";

function snippetAround(text, needle) {
  const i = text.toLowerCase().indexOf(needle);
  if (i < 0) return text.slice(0, 160).replace(/\s+/g, " ").trim();
  const start = Math.max(0, i - 70);
  return (start > 0 ? "…" : "") + text.slice(start, i + needle.length + 90).replace(/\s+/g, " ").trim() + "…";
}

export function searchNotes(vaultPath, user, index, q, { limit = 30 } = {}) {
  const needle = String(q ?? "").trim().toLowerCase();
  if (!needle) return [];
  const out = [];
  for (const note of index.notes()) {
    const abs = join(vaultPath, note.path);
    if (!isPathAllowed(vaultPath, user, abs)) continue;
    let score = 0;
    const title = note.title.toLowerCase();
    if (title === needle) score += 100; else if (title.includes(needle)) score += 60;
    let text = ""; try { text = readFileSync(abs, "utf8"); } catch {}
    const lower = text.toLowerCase();
    let hits = 0, pos = 0;
    while ((pos = lower.indexOf(needle, pos)) >= 0 && hits < 5) { hits++; pos += needle.length; }
    score += Math.min(50, hits * 10);
    if (score > 0) out.push({ path: note.path, title: note.title, score, snippet: snippetAround(text, needle) });
  }
  return out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}
