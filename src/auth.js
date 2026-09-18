import { randomBytes } from "node:crypto";
import { JsonStore } from "./lib/store.js";
import { parseCookies, serializeCookie, sendJson } from "./lib/http.js";
import { verifyPassword } from "./users.js";

export const COOKIE_NAME = "sod_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class Auth {
  constructor({ users, sessionsPath, audit }) {
    this.users = users;
    this.audit = audit;
    this.store = new JsonStore(sessionsPath, { sessions: {} });
  }
  _load() { return this.store.load().sessions; }
  _save(sessions) { this.store.save({ sessions }); }

  async login({ username, password, remember = false, ip = "" }) {
    const record = this.users.findByUsername(username);
    if (!record) {
      // Burn comparable time so a missing username is not distinguishable by latency.
      await verifyPassword(password ?? "", "scrypt$AAAA$AAAA");
      this.audit.log("login.failed", { username: String(username ?? ""), ip, reason: "unknown-user" });
      return { ok: false, reason: "invalid" };
    }
    if (record.lockedUntil && record.lockedUntil > Date.now()) {
      this.audit.log("login.locked", { userId: record.id, username: record.username, role: record.role, ip });
      return { ok: false, reason: "locked" };
    }
    if (!record.active) {
      this.audit.log("login.failed", { userId: record.id, username: record.username, role: record.role, ip, reason: "inactive" });
      return { ok: false, reason: "inactive" };
    }
    const good = await verifyPassword(password ?? "", record.passwordHash);
    if (!good) {
      this.users.recordFailedLogin(record.id);
      const after = this.users.get(record.id);
      this.audit.log(after.lockedUntil ? "login.lockout" : "login.failed", { userId: record.id, username: record.username, role: record.role, ip, reason: "bad-password" });
      return { ok: false, reason: "invalid" };
    }
    this.users.clearFailedLogins(record.id);
    const token = randomBytes(32).toString("base64url");
    const ttl = remember ? REMEMBER_TTL_MS : SESSION_TTL_MS;
    const sessions = this._load();
    sessions[token] = { userId: record.id, createdAt: Date.now(), expiresAt: Date.now() + ttl, remember: !!remember, ip };
    this._save(sessions);
    this.audit.log("login", { userId: record.id, username: record.username, role: record.role, ip, remember: !!remember });
    return { ok: true, token, maxAgeSec: Math.floor(ttl / 1000), user: this.users.get(record.id) };
  }

  logout(token) {
    if (!token) return;
    const sessions = this._load();
    const s = sessions[token];
    delete sessions[token];
    this._save(sessions);
    if (s) {
      const u = this.users.get(s.userId);
      this.audit.log("logout", { userId: s.userId, username: u?.username, role: u?.role });
    }
  }

  revokeAllForUser(userId) {
    const sessions = this._load();
    let removed = 0;
    for (const [t, s] of Object.entries(sessions)) {
      if (s.userId === userId) { delete sessions[t]; removed++; }
    }
    if (removed) {
      this._save(sessions);
      const u = this.users.get(userId);
      this.audit.log("sessions.revoked", { userId, username: u?.username, role: u?.role, count: removed });
    }
    return removed;
  }

  tokenFor(req) { return parseCookies(req)[COOKIE_NAME] ?? null; }

  userForRequest(req) {
    const token = this.tokenFor(req);
    if (!token) return null;
    const s = this._load()[token];
    if (!s || s.expiresAt < Date.now()) return null;
    const user = this.users.get(s.userId);
    if (!user || !user.active) return null;
    return user;
  }

  issueCookie(token, maxAgeSec) { return serializeCookie(COOKIE_NAME, token, { maxAge: maxAgeSec, httpOnly: true, sameSite: "Lax", path: "/" }); }
  clearCookie() { return serializeCookie(COOKIE_NAME, "", { maxAge: 0, httpOnly: true, sameSite: "Lax", path: "/" }); }

  gc() {
    const sessions = this._load();
    const now = Date.now();
    let removed = 0;
    for (const [t, s] of Object.entries(sessions)) if (s.expiresAt < now) { delete sessions[t]; removed++; }
    if (removed) this._save(sessions);
    return removed;
  }
}

export function requireUser(req, res, auth) {
  const user = auth.userForRequest(req);
  if (!user) { sendJson(res, 401, { error: "Sign in required" }); return null; }
  return user;
}

export function requireOwner(req, res, auth) {
  const user = auth.userForRequest(req);
  if (!user) { sendJson(res, 401, { error: "Sign in required" }); return null; }
  if (user.role !== "owner") { sendJson(res, 403, { error: "Owner only" }); return null; }
  return user;
}

export function sameOriginOk(req) {
  const host = req.headers?.host;
  const src = req.headers?.origin || req.headers?.referer;
  if (!host || !src) return false;
  try { return new URL(src).host === host; } catch { return false; }
}
