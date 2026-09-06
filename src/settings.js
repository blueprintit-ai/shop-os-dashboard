import { JsonStore } from "./lib/store.js";
import { join } from "node:path";

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
