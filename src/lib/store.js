import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export class JsonStore {
  constructor(filePath, defaults) {
    this.filePath = filePath;
    this.defaults = defaults;
  }
  load() {
    if (!existsSync(this.filePath)) return structuredClone(this.defaults);
    try {
      return JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch {
      return structuredClone(this.defaults);
    }
  }
  save(obj) {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + ".tmp";
    writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
    renameSync(tmp, this.filePath);
  }
}
