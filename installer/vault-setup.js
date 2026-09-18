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

export function enableForVault(vaultPath, pluginIds = PLUGINS_TO_ENABLE) {
  const settingsPath = join(vaultPath, ".claude", "settings.json");
  const settings = readJSON(settingsPath, {});
  if (!settings.enabledPlugins) settings.enabledPlugins = {};
  for (const id of pluginIds) settings.enabledPlugins[id] = true;
  if (!settings.permissions) settings.permissions = {};
  const existing = Array.isArray(settings.permissions.allow) ? settings.permissions.allow : [];
  settings.permissions.allow = Array.from(new Set([...existing, ...buildPermissionAllowList()]));
  writeJSON(settingsPath, settings);
  return settingsPath;
}

export function enableForUser(claudeRoot, pluginIds = PLUGINS_TO_ENABLE) {
  const settingsPath = join(claudeRoot, "settings.json");
  const settings = readJSON(settingsPath, {});
  if (!settings.enabledPlugins) settings.enabledPlugins = {};
  for (const id of pluginIds) settings.enabledPlugins[id] = true;
  writeJSON(settingsPath, settings);
  return settingsPath;
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
  for (const mp of MARKETPLACES) {
    const installLocation = join(claudeRoot, "plugins", "marketplaces", mp.name);
    const wasKnown = !!known[mp.name];
    const result = await fetchMarketplaceTarball({ repo: mp.repo, destDir: installLocation, fetchImpl });
    if (!result.ok) { failed.push({ name: mp.name, error: result.error }); continue; }
    if (!wasKnown) added.push(mp.name);
    known[mp.name] = { source: { source: "tarball", repo: mp.repo }, installLocation, lastUpdated: new Date().toISOString() };
  }
  writeJSON(path, known);
  return { added, failed };
}
