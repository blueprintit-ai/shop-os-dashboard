import { api } from "/static/js/api.js";

// One live layout object per page: boot.js (widgets + orb) and theme.js both
// call getLayout(), and they must see each other's edits (an orb or widget move
// followed by a theme toggle used to save theme.js's stale snapshot over it).
let live = null;
export function getLayout() {
  live ??= api("GET", "/api/layout").then((r) => r.json()).catch((e) => { live = null; throw e; });
  return live;
}
export async function saveLayout(layout) {
  return (await api("PUT", "/api/layout", layout)).json();
}

// One debounced save shared by everything that edits the layout object
// (widgets.js drags/resizes/removes, ring.js orb move/resize), so a single
// PUT carries all pending changes and two editors never race each other.
let saveTimer = null;
export function scheduleLayoutSave(layout, ms = 400) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveLayout(layout), ms);
}
