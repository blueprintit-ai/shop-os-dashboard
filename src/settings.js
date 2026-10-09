import { JsonStore } from "./lib/store.js";
import { join } from "node:path";
import * as nodePath from "node:path";

// The folder the Business Assets page reads. Stored resolved (no trailing slash, no .., one separator style) so
// every consumer can compare paths with startsWith(root + sep). Returns null when it is not a usable absolute path.
// `pathMod`/`platform` are injectable so the Windows rules can be tested anywhere.
export function normalizeAssetsDir(d, pathMod = nodePath, platform = process.platform) {
  if (typeof d !== "string" || !d || d.length > 500 || d.includes("\0")) return null;
  if (platform === "win32") {
    // drive-absolute (C:\ or C:/) or UNC only: "\\foo" and "/foo" are relative to the current drive, "C:foo" to the current dir
    if (!/^([A-Za-z]:[\\/]|\\\\[^\\/]|\/\/[^\\/])/.test(d)) return null;
  } else if (!pathMod.isAbsolute(d)) return null;
  return pathMod.resolve(d);
}

// The effective root, always resolved: also covers a value an earlier version saved unnormalized.
export function effectiveAssetsRoot(settingsStore, homeDir) {
  const saved = settingsStore.get().assetsDir;
  return nodePath.resolve((saved && normalizeAssetsDir(saved)) || join(homeDir, "business-assets"));
}

function defaults() {
  return { assetsDir: null, sessionCap: 3, portOverride: null };
}

export class SettingsStore {
  constructor(homeDir) {
    this.store = new JsonStore(join(homeDir, "settings.json"), defaults());
  }
  get() {
    return this.store.load();
  }
  save(patch) {
    const merged = { ...this.get(), ...patch };
    this.store.save(merged);
    return merged;
  }
}
