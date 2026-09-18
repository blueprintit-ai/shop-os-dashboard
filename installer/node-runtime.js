import { spawnSync as defaultSpawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
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

export async function resolveNode({ homeDir, fetchImpl = fetch, spawnSyncImpl = defaultSpawnSync, platformOverride, archOverride }) {
  const systemVersion = checkSystemNode(spawnSyncImpl);
  if (systemVersion) {
    return { node: "node", npm: (platformOverride ?? osPlatform()) === "win32" ? "npm.cmd" : "npm", system: true, version: systemVersion };
  }

  const runtimeDir = join(homeDir, "runtime");
  const isWin = (platformOverride ?? osPlatform()) === "win32";

  // Try with fallback version first to avoid unnecessary fetches
  let version = FALLBACK_LTS;
  let dist = buildDist({ version, platformOverride, archOverride });
  let extractDir = join(runtimeDir, dist.dirName);
  let nodeBin = isWin ? join(extractDir, "node.exe") : join(extractDir, "bin", "node");

  // If fallback doesn't exist, resolve the actual LTS version
  if (!existsSync(nodeBin)) {
    version = await resolveLtsVersion(fetchImpl);
    dist = buildDist({ version, platformOverride, archOverride });
    extractDir = join(runtimeDir, dist.dirName);
    nodeBin = isWin ? join(extractDir, "node.exe") : join(extractDir, "bin", "node");
  }

  const npmBin = isWin ? join(extractDir, "npm.cmd") : join(extractDir, "bin", "npm");

  if (!existsSync(nodeBin)) {
    mkdirSync(runtimeDir, { recursive: true });
    const resp = await fetchImpl(dist.url);
    if (!resp.ok) throw new Error(`Failed to download Node ${version} (${dist.url}): HTTP ${resp.status ?? "error"}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    if (dist.kind === "zip") extractZip(buf, runtimeDir);
    else extractTarGz(buf, runtimeDir);
  }

  if (!existsSync(nodeBin)) throw new Error(`Node extracted but binary not found at ${nodeBin}`);
  return { node: nodeBin, npm: npmBin, system: false, version };
}
