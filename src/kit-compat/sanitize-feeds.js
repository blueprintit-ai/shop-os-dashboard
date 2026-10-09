// The kit page renders stats.json / routines.json fields as HTML (innerHTML, template
// strings). Those files are agent-writable, so the kit-compat handlers escape every string
// before the page sees it. The plain /api/snapshots/* routes stay as they were.
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => s.replace(/[&<>"']/g, (c) => ESC[c]);

function escapeDeep(v) {
  if (typeof v === "string") return esc(v);
  if (Array.isArray(v)) return v.map(escapeDeep);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, escapeDeep(x)]));
  return v;
}

// WIRING.md lets a metric caption carry a line break: restore exactly `<br>` and nothing else.
const restoreBr = (s) => s.replace(/&lt;br&gt;/g, "<br>");

export function sanitizeStats(feed) {
  if (!feed || typeof feed !== "object") return feed;
  const out = escapeDeep(feed);
  if (Array.isArray(out.metrics)) {
    out.metrics = out.metrics.map((m) => (m && typeof m === "object" && typeof m.cap === "string" ? { ...m, cap: restoreBr(m.cap) } : m));
  }
  return out;
}

const SAFE_KEY = /^[a-z0-9_-]+$/;
const PROTO = new Set(["__proto__", "constructor", "prototype"]);
const safeKey = (k) => typeof k === "string" && SAFE_KEY.test(k) && !PROTO.has(k);
const SAFE_TIME = /^\d{2}:\d{2}$/;

export function sanitizeRoutines(feed) {
  if (!feed || typeof feed !== "object") return feed;
  const out = escapeDeep(feed);
  if (Array.isArray(out.sources)) out.sources = out.sources.filter((s) => s && typeof s === "object" && safeKey(s.key));
  if (Array.isArray(out.routines)) {
    out.routines = out.routines.filter((r) => r && typeof r === "object" && safeKey(r.src) && typeof r.d === "string" && typeof r.t === "string" && SAFE_TIME.test(r.t) && typeof r.n === "string");
  }
  return out;
}
