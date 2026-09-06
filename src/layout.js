import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { JsonStore } from "./lib/store.js";

export function defaultLayout() {
  return {
    theme: "dark",
    tourSeen: false,
    gridV2: true,
    orb: { c: 16, r: 9, s: 1.7, z: 2.6 },
    removed: [{ id: "w-wheel", name: "ACTION WHEEL", c: 20, r: 2, cs: 4, rs: 4 }],
    widgets: [
      { id: "w-title", name: "TITLE", kind: "title", c: 8, r: 0, cs: 16, rs: 2 },
      { id: "w-rt", name: "ROUTINES", kind: "routines", c: 0, r: 2, cs: 8, rs: 6 },
      { id: "w-sk", name: "SKILLS DECK", kind: "skills", c: 24, r: 2, cs: 8, rs: 8 },
      { id: "w-stats", name: "STATS", kind: "stats", c: 0, r: 8, cs: 8, rs: 4 },
      { id: "w-ba", name: "BUSINESS ASSETS", kind: "assets", c: 24, r: 10, cs: 8, rs: 4 },
      { id: "w-brief", name: "TODAY'S BRIEFING", kind: "briefing", c: 0, r: 12, cs: 8, rs: 4 },
      { id: "w-recent", name: "RECENT CHANGES", kind: "recent", c: 8, r: 16, cs: 8, rs: 5 },
      { id: "w-team", name: "TEAM ACTIVITY", kind: "team-activity", c: 16, r: 16, cs: 8, rs: 5 },
      { id: "w-roster", name: "TEAM ROSTER", kind: "team-roster", c: 24, r: 16, cs: 8, rs: 5 },
    ],
  };
}

export class LayoutStore {
  constructor(homeDir) {
    this.dir = join(homeDir, "layouts");
  }
  #storeFor(userId) {
    return new JsonStore(join(this.dir, `${userId}.json`), defaultLayout());
  }
  get(userId) {
    return this.#storeFor(userId).load();
  }
  save(userId, layout) {
    mkdirSync(this.dir, { recursive: true });
    this.#storeFor(userId).save(layout);
    return layout;
  }
}
