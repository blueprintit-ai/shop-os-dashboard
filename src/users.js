import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { JsonStore } from "./lib/store.js";

const scrypt = promisify(scryptCb);
export const ROLES = Object.freeze(["owner", "staff"]);
export const DEFAULT_STAFF_FOLDERS = Object.freeze(["Projects", "Resources", "Processes"]);
export const MIN_PASSWORD_LENGTH = 10;
export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };

function err(code, message) { const e = new Error(message); e.code = code; return e; }

export async function hashPassword(password) {
  const salt = randomBytes(32);
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem });
  return `scrypt$${salt.toString("base64")}$${Buffer.from(key).toString("base64")}`;
}

export async function verifyPassword(password, stored) {
  const [algo, saltB64, hashB64] = String(stored ?? "").split("$");
  if (algo !== "scrypt" || !saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const key = Buffer.from(await scrypt(password, salt, expected.length, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem }));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

function defaultSwitches(role) {
  if (role === "owner") return { folders: [], teamFolder: null, assetsView: true, artifactsShared: true };
  return { folders: [...DEFAULT_STAFF_FOLDERS], teamFolder: null, assetsView: false, artifactsShared: true };
}

function publicView(u) {
  const { passwordHash, ...rest } = u;
  return rest;
}

export class UserStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.store = new JsonStore(filePath, { users: [] });
  }
  _all() { return this.store.load().users; }
  _save(users) { this.store.save({ users }); }
  _find(users, id) {
    const u = users.find((x) => x.id === id);
    if (!u) throw err("NOT_FOUND", "User not found");
    return u;
  }

  count() { return this._all().length; }
  list() { return this._all().map(publicView); }
  get(id) { const u = this._all().find((x) => x.id === id); return u ? publicView(u) : null; }
  getWithHash(id) { return this._all().find((x) => x.id === id) ?? null; }
  findByUsername(username) {
    const n = String(username ?? "").trim().toLowerCase();
    return this._all().find((x) => x.username.toLowerCase() === n) ?? null;
  }

  async create({ username, displayName, password, role, switches = {} }) {
    if (!ROLES.includes(role)) throw err("INVALID_ROLE", `Role must be one of ${ROLES.join(", ")}`);
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) throw err("WEAK_PASSWORD", `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    const uname = String(username ?? "").trim();
    if (!/^[A-Za-z0-9._-]{2,32}$/.test(uname)) throw err("INVALID_USERNAME", "Username: 2-32 letters, numbers, dot, dash, underscore");
    if (this.findByUsername(uname)) throw err("USERNAME_TAKEN", "That username is already in use");
    const now = Date.now();
    const user = {
      id: randomUUID(), username: uname, displayName: String(displayName ?? uname).trim() || uname,
      role, active: true, switches: { ...defaultSwitches(role), ...switches },
      passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: null, createdAt: now, updatedAt: now,
    };
    const users = this._all(); users.push(user); this._save(users);
    return publicView(user);
  }

  update(id, patch) {
    const users = this._all(); const u = this._find(users, id);
    if (patch.displayName !== undefined) u.displayName = String(patch.displayName).trim() || u.displayName;
    if (patch.role !== undefined) {
      if (!ROLES.includes(patch.role)) throw err("INVALID_ROLE", "Invalid role");
      if (u.role === "owner" && patch.role !== "owner") this._assertNotLastOwner(users, u);
      u.role = patch.role;
    }
    if (patch.switches) u.switches = { ...u.switches, ...patch.switches };
    u.updatedAt = Date.now(); this._save(users); return publicView(u);
  }

  async setPassword(id, password) {
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) throw err("WEAK_PASSWORD", `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    const users = this._all(); const u = this._find(users, id);
    u.passwordHash = await hashPassword(password); u.failedLogins = 0; u.lockedUntil = null; u.updatedAt = Date.now();
    this._save(users);
  }

  _assertNotLastOwner(users, u) {
    const others = users.filter((x) => x.id !== u.id && x.role === "owner" && x.active);
    if (others.length === 0) throw err("LAST_OWNER", "At least one active owner must remain");
  }
  deactivate(id) {
    const users = this._all(); const u = this._find(users, id);
    if (u.role === "owner" && u.active) this._assertNotLastOwner(users, u);
    u.active = false; u.updatedAt = Date.now(); this._save(users); return publicView(u);
  }
  reactivate(id) {
    const users = this._all(); const u = this._find(users, id);
    u.active = true; u.updatedAt = Date.now(); this._save(users); return publicView(u);
  }
  recordFailedLogin(id) {
    const users = this._all(); const u = this._find(users, id);
    u.failedLogins = (u.failedLogins ?? 0) + 1;
    if (u.failedLogins >= LOCKOUT_THRESHOLD) u.lockedUntil = Date.now() + LOCKOUT_MS;
    this._save(users);
  }
  clearFailedLogins(id) {
    const users = this._all(); const u = this._find(users, id);
    u.failedLogins = 0; u.lockedUntil = null; this._save(users);
  }
}
