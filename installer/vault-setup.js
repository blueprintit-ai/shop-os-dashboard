// installer/vault-setup.js
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { fetchMarketplaceTarball } from "./marketplaces.js";

const MARKETPLACES = [
  { name: "blueprint-skills", repo: "blueprintit-ai/blueprint-skills" },
  { name: "claude-plugins-official", repo: "anthropics/claude-plugins-official" },
];
export const PLUGINS_TO_ENABLE = ["obsidian@blueprint-skills", "superpowers@claude-plugins-official"];
const LICENSE_SERVER = "https://shop-os-license-server.glenn-15d.workers.dev";
const LICENSE_KEY_SHAPE = /^SHOP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export function normalizeLicenseKey(raw) {
  return String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
}

export function looksLikeLicenseKey(key) {
  return LICENSE_KEY_SHAPE.test(key);
}

export async function validateLicense(key, { fetchImpl = fetch } = {}) {
  const url = `${LICENSE_SERVER}/validate?key=${encodeURIComponent(key)}`;
  let resp;
  try {
    resp = await fetchImpl(url);
  } catch (e) {
    return { ok: false, error: `network: ${e.message}` };
  }
  const text = await resp.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, error: `unexpected response (HTTP ${resp.status})` };
  }
  if (!resp.ok) return { ok: false, error: body.error || `HTTP ${resp.status}` };
  return { ok: true, license: body };
}

function readJSON(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

// Same as readJSON but distinguishes "no file" from "file exists and is
// unparseable" — the difference between a fresh install and silently
// obliterating a real ~/.claude/settings.json that had a trailing comma or was
// caught mid-write. On a parse failure the original bytes are copied to
// settings.json.bak first, and the caller reports a warning.
function readSettingsForMerge(path) {
  if (!existsSync(path)) return { settings: {}, warning: null };
  const raw = readFileSync(path, "utf8");
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return { settings: parsed, warning: null };
    return backupUnparseable(path, raw, "not a JSON object");
  } catch (e) {
    return backupUnparseable(path, raw, e.message);
  }
}

function backupUnparseable(path, raw, reason) {
  const backupPath = `${path}.bak`;
  try {
    writeFileSync(backupPath, raw, "utf8");
    return { settings: {}, warning: `${path} was not valid JSON (${reason}); the original was backed up to ${backupPath} and replaced.` };
  } catch (e) {
    return { settings: {}, warning: `${path} was not valid JSON (${reason}) and could not be backed up: ${e.message}` };
  }
}
function writeJSON(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

export function createVaultClaudeMd(vaultPath, license) {
  const claudeMd = join(vaultPath, "CLAUDE.md");
  if (existsSync(claudeMd)) return false;
  const content = `---\nos-mode: business\nbp-setup-state: pending\nlicense-customer: ${license.customer}\nlicense-product: ${license.product}\ninstalled-at: ${new Date().toISOString()}\n---\n\n# Shop OS Vault\n\nWelcome to your Shop OS vault. This is the operating system Blueprint IT installed for ${license.customer}.\n\nTo finish onboarding, run the following slash command inside Claude Code:\n\n\`/bp-setup\`\n`;
  mkdirSync(vaultPath, { recursive: true });
  writeFileSync(claudeMd, content, "utf8");
  return true;
}

export function createRawInbox(vaultPath) {
  const rawDir = join(vaultPath, "Raw");
  const processedDir = join(rawDir, "processed");
  const readmePath = join(rawDir, "README.md");
  const existed = existsSync(rawDir);
  mkdirSync(processedDir, { recursive: true });
  if (existsSync(readmePath)) return { created: false };
  writeFileSync(readmePath, "---\ntype: inbox-readme\ntags: [shop-os, inbox, raw]\n---\n\n# Raw / Inbox\n\nDrop any raw materials here. Run `/bp-digest` in Claude Code to file them into the vault.\n", "utf8");
  return { created: true, alreadyExisted: existed };
}

export function buildPermissionAllowList() {
  return [
    "Read", "Glob", "Grep", "Write(/**)", "Edit(/**)",
    "Bash(mkdir:*)", "Bash(chmod:*)", "Bash(find:*)", "Bash(ls:*)", "Bash(cat:*)",
    "Bash(grep:*)", "Bash(echo:*)", "Bash(test:*)", "Bash(touch:*)",
    "WebFetch", "WebSearch", "TodoWrite",
  ];
}

// Returns { path, warning }: `warning` is non-null only when an existing
// settings.json could not be parsed and was therefore backed up and replaced.
export function enableForVault(vaultPath, pluginIds = PLUGINS_TO_ENABLE) {
  const settingsPath = join(vaultPath, ".claude", "settings.json");
  const { settings, warning } = readSettingsForMerge(settingsPath);
  if (!settings.enabledPlugins) settings.enabledPlugins = {};
  for (const id of pluginIds) settings.enabledPlugins[id] = true;
  if (!settings.permissions) settings.permissions = {};
  const existing = Array.isArray(settings.permissions.allow) ? settings.permissions.allow : [];
  settings.permissions.allow = Array.from(new Set([...existing, ...buildPermissionAllowList()]));
  writeJSON(settingsPath, settings);
  return { path: settingsPath, warning };
}

export function enableForUser(claudeRoot, pluginIds = PLUGINS_TO_ENABLE) {
  const settingsPath = join(claudeRoot, "settings.json");
  const { settings, warning } = readSettingsForMerge(settingsPath);
  if (!settings.enabledPlugins) settings.enabledPlugins = {};
  for (const id of pluginIds) settings.enabledPlugins[id] = true;
  writeJSON(settingsPath, settings);
  return { path: settingsPath, warning };
}

export function saveLicenseFile(license, homeOverride) {
  const dir = join(homeOverride ?? homedir(), ".shopos");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "license.json");
  writeFileSync(path, JSON.stringify({
    key: license.key ?? null, customer: license.customer, product: license.product,
    entitlements: license.entitlements, valid_until: license.valid_until,
    activated_at: new Date().toISOString(),
  }, null, 2) + "\n", "utf8");
  try { chmodSync(path, 0o600); } catch { /* no-op on Windows */ }
  return path;
}

// Replaces shop-os-install.js's ensureMarketplaces()/refreshMarketplaceClone():
// same known_marketplaces.json shape, no git subprocess, no install-location
// clone directory — the plugin files land straight from the tarball.
export async function installMarketplaces({ claudeRoot, fetchImpl = fetch }) {
  const path = join(claudeRoot, "plugins", "known_marketplaces.json");
  const known = readJSON(path, {});
  const added = [];
  const failed = [];
  let wrote = false;
  for (const mp of MARKETPLACES) {
    const installLocation = join(claudeRoot, "plugins", "marketplaces", mp.name);
    const wasKnown = !!known[mp.name];
    const result = await fetchMarketplaceTarball({ repo: mp.repo, destDir: installLocation, fetchImpl });
    if (!result.ok) { failed.push({ name: mp.name, error: result.error }); continue; }
    if (!wasKnown) added.push(mp.name);
    // "github" — not "tarball": this field is the marketplace's SOURCE TYPE as
    // Claude Code understands it (github | directory | path), not how this
    // installer happened to fetch the bytes. An unrecognized type risks Claude
    // Code refusing to load or refresh the entry.
    known[mp.name] = { source: { source: "github", repo: mp.repo }, installLocation, lastUpdated: new Date().toISOString() };
    wrote = true;
  }
  // Don't create an empty known_marketplaces.json where none existed just
  // because every fetch failed (offline install, GitHub down).
  if (wrote || Object.keys(known).length > 0) writeJSON(path, known);
  return { added, failed };
}
