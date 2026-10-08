import { homedir } from "node:os";

const LICENSE_RE = /SHOP-([A-Z0-9]{4})-[A-Z0-9]{4}-([A-Z0-9]{4})/gi;
const SECRET_RES = [
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bcfut_[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
];
const BEARER_RE = /Bearer\s+[^\s"']+/g;
const OTHER_USER_RE = /([\\/]Users(?:\\\\|\\|\/))[^\\/\s"'<]+/gi;

export function shortenLicenseKey(key) {
  return String(key).replace(LICENSE_RE, "SHOP-$1-...-$2");
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function redactText(text, opts = {}) {
  const homeDir = opts.homeDir === undefined ? safeHome() : opts.homeDir;
  const homeToken = opts.homeToken ?? (process.platform === "win32" ? "%USERPROFILE%" : "~");
  let t = String(text ?? "");
  const home = typeof homeDir === "string" ? homeDir.replace(/[\\/]+$/, "") : "";
  if (home.length >= 3 && !/^([A-Za-z]:)?[\\/]*$/.test(home)) {
    const back = home.replace(/\//g, "\\");
    const variants = new Set([home, home.replace(/\\/g, "/"), back, back.replace(/\\/g, "\\\\")]);
    for (const variant of [...variants].sort((x, y) => y.length - x.length)) {
      t = t.replace(new RegExp(escapeRe(variant) + "(?=[\\\\/\\s\"']|$)", "gi"), () => homeToken);
    }
  }
  t = t.replace(LICENSE_RE, "SHOP-$1-...-$2");
  for (const re of SECRET_RES) t = t.replace(re, "[masked]");
  t = t.replace(BEARER_RE, "Bearer [masked]");
  t = t.replace(OTHER_USER_RE, "$1<user>");
  return t;
}

function safeHome() {
  try { return homedir(); } catch { return null; }
}

export function redactDeep(value, opts) {
  if (typeof value === "string") return redactText(value, opts);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, opts));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v, opts)]));
  }
  return value;
}

const size = (o) => Buffer.byteLength(JSON.stringify(o));

// Detail goes first, identity last: status/step/support_code always survive.
export function capReport(report, maxBytes = 20000) {
  let r = { ...report };
  if (size(r) <= maxBytes) return r;
  if (r.output_tail) r.output_tail = String(r.output_tail).slice(-2000);
  if (size(r) <= maxBytes) return r;
  if (Array.isArray(r.timeline)) r.timeline = r.timeline.map(({ outTail, ...rest }) => rest);
  if (size(r) <= maxBytes) return r;
  delete r.snapshot;
  if (size(r) <= maxBytes) return r;
  if (r.error_message) r.error_message = String(r.error_message).slice(0, 2000);
  if (size(r) <= maxBytes) return r;
  delete r.timeline;
  if (size(r) <= maxBytes) return r;
  for (const [k, v] of Object.entries(r)) {
    if (typeof v === "string" && v.length > 1024) r[k] = v.slice(0, 1024);
  }
  if (size(r) <= maxBytes) return r;
  const out = {};
  for (const k of ["status", "step", "support_code", "run_id", "license_key", "error_message"]) {
    if (r[k] === undefined) continue;
    out[k] = typeof r[k] === "string" ? r[k].slice(0, k === "error_message" ? 500 : 200) : r[k];
  }
  out.truncated = true;
  return out;
}
