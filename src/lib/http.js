import { readFileSync, existsSync } from "node:fs";
import { extname } from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".svg": "image/svg+xml", ".webp": "image/webp", ".pdf": "application/pdf",
  ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8",
};

export function mimeFor(path) {
  return MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
}

export async function readJsonBody(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on("data", (c) => {
      total += c.length;
      if (total > maxBytes) { req.destroy(); reject(new Error("Body too large")); }
      chunks.push(c);
    });
    req.on("end", () => {
      try { const t = Buffer.concat(chunks).toString("utf8"); resolve(t ? JSON.parse(t) : {}); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

export function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

export function sendJson(res, status, obj, extraHeaders = {}) {
  send(res, status, { "content-type": "application/json; charset=utf-8", ...extraHeaders }, JSON.stringify(obj));
}

export function serveStatic(res, absPath) {
  if (!existsSync(absPath)) return send(res, 404, { "content-type": "text/plain" }, "Not found");
  res.writeHead(200, { "content-type": mimeFor(absPath) });
  res.end(readFileSync(absPath));
}

export function parseCookies(req) {
  const header = req.headers?.cookie;
  if (!header) return {};
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function serializeCookie(name, value, { maxAge, httpOnly = true, sameSite = "Lax", path = "/" } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  parts.push(`Path=${path}`);
  if (httpOnly) parts.push("HttpOnly");
  parts.push(`SameSite=${sameSite}`);
  return parts.join("; ");
}

export function isLoopback(req) {
  const a = req.socket?.remoteAddress ?? "";
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}
