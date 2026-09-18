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
      { id: "w-status", name: "SYSTEM STATUS", kind: "status", c: 0, r: 21, cs: 16, rs: 7 },
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
  // Post-review fix (finding 8): PUT /api/layout hands this whatever the
  // request body parsed to (src/routes/layout-routes.js does no validation
  // of its own), and the saved value round-trips straight back out through
  // GET /api/layout into boot.js's mountGrid(root, layout, allKinds) ->
  // widgets.js's `for (const w of layout.widgets)`. A malformed body (e.g.
  // `{}`, or `{widgets: "not an array"}`) used to be written verbatim, and
  // `for (const w of undefined)` throws, aborting boot.js's whole module --
  // so mountSearch/mountTour/#editBtn never mount and the page half-boots on
  // every later load with no UI path to reset. Merging onto defaultLayout()
  // and coercing widgets/removed back to arrays means a bad patch degrades
  // to "your other saved fields stick, widgets/removed reset to default"
  // instead of bricking the page.
  save(userId, layout) {
    mkdirSync(this.dir, { recursive: true });
    const safe = { ...defaultLayout(), ...layout };
    if (!Array.isArray(safe.widgets)) safe.widgets = defaultLayout().widgets;
    if (!Array.isArray(safe.removed)) safe.removed = defaultLayout().removed;
    this.#storeFor(userId).save(safe);
    return safe;
  }
}
