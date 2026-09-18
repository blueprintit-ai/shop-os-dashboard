import { spawnSync as defaultSpawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { platform as osPlatform, arch as osArch } from "node:os";
import { extractTarGz } from "./tar.js";
import { extractZip } from "./zip.js";

const MIN_MAJOR = 20;
// Pinned fallback if index.json is unreachable or its shape changes — same
// defensive pattern as shop-os-installer/scripts/setup-windows.ps1's MSI fallback.
const FALLBACK_LTS = "v22.20.0";

function parseMajor(versionString) {
  const m = /^v?(\d+)\./.exec(versionString.trim());
  return m ? Number(m[1]) : 0;
}

function checkSystemNode(spawnSyncImpl) {
  try {
    const result = spawnSyncImpl("node", ["--version"], { encoding: "utf8" });
    if (result.status !== 0 || !result.stdout) return null;
    const version = result.stdout.trim();
    if (parseMajor(version) < MIN_MAJOR) return null;
    return version;
  } catch {
    return null;
  }
}

async function resolveLtsVersion(fetchImpl) {
  try {
    const resp = await fetchImpl("https://nodejs.org/dist/index.json");
    if (!resp.ok) return FALLBACK_LTS;
    const index = await resp.json();
    const lts = index.find((r) => r.lts);
    return lts?.version && /^v\d+\.\d+\.\d+$/.test(lts.version) ? lts.version : FALLBACK_LTS;
  } catch {
    return FALLBACK_LTS;
  }
}

function buildDist({ version, platformOverride, archOverride }) {
  const plat = platformOverride ?? osPlatform();
  const arch = archOverride ?? osArch();
  if (plat === "win32") {
    return { url: `https://nodejs.org/dist/${version}/node-${version}-win-x64.zip`, kind: "zip", dirName: `node-${version}-win-x64` };
  }
  const darwinArch = arch === "arm64" ? "arm64" : "x64";
  return { url: `https://nodejs.org/dist/${version}/node-${version}-darwin-${darwinArch}.tar.gz`, kind: "targz", dirName: `node-${version}-darwin-${darwinArch}` };
}

// Scans for an already-extracted portable Node instead of guessing a version
// string: a version-string guess (even the "current LTS at plan-writing-time"
// FALLBACK_LTS constant) goes stale the moment nodejs.org cuts a new LTS,
// silently reintroducing a network fetch on every call. Scanning the actual
// directory names already on disk means the cache check never depends on
// which version happens to be current.
function findCachedNode(runtimeDir, isWin) {
  if (!existsSync(runtimeDir)) return null;
  for (const name of readdirSync(runtimeDir)) {
    if (!name.startsWith("node-v")) continue;
    const dir = join(runtimeDir, name);
    const nodeBin = isWin ? join(dir, "node.exe") : join(dir, "bin", "node");
    if (!existsSync(nodeBin)) continue;
    const versionMatch = name.match(/^node-(v\d+\.\d+\.\d+)-/);
    return { nodeBin, npmBin: isWin ? join(dir, "npm.cmd") : join(dir, "bin", "npm"), version: versionMatch?.[1] ?? "unknown" };
  }
  return null;
}

export async function resolveNode({ homeDir, fetchImpl = fetch, spawnSyncImpl = defaultSpawnSync, platformOverride, archOverride }) {
  const systemVersion = checkSystemNode(spawnSyncImpl);
  if (systemVersion) {
    return { node: "node", npm: (platformOverride ?? osPlatform()) === "win32" ? "npm.cmd" : "npm", system: true, version: systemVersion };
  }

  const runtimeDir = join(homeDir, "runtime");
  const isWin = (platformOverride ?? osPlatform()) === "win32";

  const cached = findCachedNode(runtimeDir, isWin);
  if (cached) return { node: cached.nodeBin, npm: cached.npmBin, system: false, version: cached.version };

  const version = await resolveLtsVersion(fetchImpl);
  const dist = buildDist({ version, platformOverride, archOverride });
  const extractDir = join(runtimeDir, dist.dirName);
  const nodeBin = isWin ? join(extractDir, "node.exe") : join(extractDir, "bin", "node");
  const npmBin = isWin ? join(extractDir, "npm.cmd") : join(extractDir, "bin", "npm");

  mkdirSync(runtimeDir, { recursive: true });
  const resp = await fetchImpl(dist.url);
  if (!resp.ok) throw new Error(`Failed to download Node ${version} (${dist.url}): HTTP ${resp.status ?? "error"}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  if (dist.kind === "zip") extractZip(buf, runtimeDir);
  else extractTarGz(buf, runtimeDir);

  if (!existsSync(nodeBin)) throw new Error(`Node extracted but binary not found at ${nodeBin}`);
  return { node: nodeBin, npm: npmBin, system: false, version };
}
