import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { vaultDashboardDir } from "./lib/paths.js";

// SHOP APPS widget rows (the kit page's launcher). Stored in <vault>/Dashboard/apps.json as
// [{ id, name, sub, url, icon }]. `icon` is one of the kit page's sprite names (its ICS map;
// test/kit-compat.test.js checks this list against the synced page). `url` is http(s), or a
// path on this dashboard (/brain); the page opens it in a new tab with noopener.
export const APP_ICONS = ["gen", "tele", "brain", "exca", "wall", "docs", "links", "sprint", "story", "edit", "anim"];
export const MAX_APPS = 24;
export const DEFAULT_APPS = Object.freeze([Object.freeze({ id: "sbRow", name: "Second Brain", sub: "Your whole workspace as a living map", url: "/brain", icon: "brain" })]);

const appsFile = (vaultPath) => join(vaultDashboardDir(vaultPath), "apps.json");

function validUrl(u) {
  if (typeof u !== "string" || u.length > 500 || /[\s\u0000-\u001f]/.test(u)) return false;
  if (/^\/(?![/\\])/.test(u)) return true;
  try { const p = new URL(u); return p.protocol === "http:" || p.protocol === "https:"; } catch { return false; }
}

// Returns an error string, or null when the row is fine.
function rowError(a) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return "each app must be an object";
  if (typeof a.id !== "string" || !/^[A-Za-z][\w-]{0,31}$/.test(a.id)) return "id must be letters, digits, - or _ (start with a letter, max 32)";
  if (typeof a.name !== "string" || !a.name.trim() || a.name.length > 80) return "name is required (max 80 characters)";
  if (a.sub !== undefined && (typeof a.sub !== "string" || a.sub.length > 120)) return "sub must be text (max 120 characters)";
  if (!validUrl(a.url)) return "url must be http(s) or a path on this dashboard";
  if (!APP_ICONS.includes(a.icon)) return `icon must be one of: ${APP_ICONS.join(", ")}`;
  return null;
}
const clean = (a) => ({ id: a.id, name: a.name.trim(), sub: (a.sub || "").trim(), url: a.url, icon: a.icon });

// Older installs saved the default Second Brain row pointing at /notes; the product now has /brain. Applied on read only
// (nothing is written back until the owner saves the list).
function migrate(a) {
  return a.id === "sbRow" && a.url === "/notes" ? { ...a, url: "/brain", sub: DEFAULT_APPS[0].sub } : a;
}

export function validateApps(list) {
  if (!Array.isArray(list)) return { error: "apps must be a list" };
  if (list.length > MAX_APPS) return { error: `at most ${MAX_APPS} apps` };
  const seen = new Set();
  for (const a of list) {
    const e = rowError(a);
    if (e) return { error: e };
    if (seen.has(a.id)) return { error: `duplicate id ${a.id}` };
    seen.add(a.id);
  }
  return { apps: list.map(clean) };
}

// Reading is forgiving: the file may be hand-edited by an agent. Bad rows are dropped; a missing or
// unreadable file gives the default (the Second Brain row only).
export function readApps(vaultPath) {
  const f = appsFile(vaultPath);
  if (!existsSync(f)) return DEFAULT_APPS.map((a) => ({ ...a }));
  let raw;
  try { raw = JSON.parse(readFileSync(f, "utf8")); } catch { return DEFAULT_APPS.map((a) => ({ ...a })); }
  if (!Array.isArray(raw)) return DEFAULT_APPS.map((a) => ({ ...a }));
  const seen = new Set();
  return raw.filter((a) => !rowError(a) && !seen.has(a.id) && seen.add(a.id)).slice(0, MAX_APPS).map(clean).map(migrate);
}

export function writeApps(vaultPath, apps) {
  mkdirSync(vaultDashboardDir(vaultPath), { recursive: true });
  writeFileSync(appsFile(vaultPath), JSON.stringify(apps, null, 2));
}
