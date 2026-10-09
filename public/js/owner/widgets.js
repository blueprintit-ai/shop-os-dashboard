// Widget grid edit-mode engine.
//
// Ported in structure (32-column grid, CELL = width/32, pointerdown/move/up
// drag + resize state machine, delete-button-moves-to-layout.removed) from
// Robonuggets/agentic-os/dashboard.html lines 1264-1400, with two deliberate
// deviations from that source (and from this task's own brief sketch):
//
// 1. Persistence: saveLayout() over PUT /api/layout, debounced 400ms,
//    instead of the kit's localStorage.setItem.
// 2. DOM/CSS hooks: the brief's illustrative code used class="widget" and a
//    ".body" content div with CSS-grid gridColumn/gridRow placement. Task 8's
//    actually-shipped public/css/owner.css ports the kit's real widget-chrome
//    selectors byte-identical (.w / .wh / .wb / .wx / .rs) and positions
//    widgets via position:fixed + inline left/top/width/height (see the
//    comment block at the top of owner.css) -- there is no ".widget", ".body"
//    or ".grid" rule anywhere in the shipped CSS. This file targets the real
//    selectors so the chrome (remove button, resize handle, edit-mode cursor)
//    actually renders instead of silently matching nothing.

import { scheduleLayoutSave as scheduleSave } from "./layout-client.js";
import { iconCanvasHtml, paintHeaderIcons } from "./icons.js";
import { buildTitleHeading } from "./title-widget.js";

// Small right-aligned hint in a widget header (the kit's .tick).
const TICKS = { skills: "tap \u25B6 to run" };

// The kit's title widget is chromeless: no header label, no remove button, a
// big name with the icon row (this page's #owner-header: edit, search, users,
// tour, theme, logout) directly underneath. #owner-header is position:fixed
// (so the controls stay reachable when the chat/notes panel hides the grid);
// this keeps it glued under the title widget as that widget is placed/dragged.
function syncToolbar(el) {
  const bar = document.getElementById("owner-header");
  if (!bar) return;
  // Read the target geometry from the inline style (place() sets it), not
  // getBoundingClientRect(): .w animates left/top, so the rect lags behind.
  const h1 = el.querySelector("h1");
  bar.style.left = el.style.left;
  bar.style.width = el.style.width;
  bar.style.top = `${parseFloat(el.style.top) + 10 + (h1 ? h1.offsetHeight : 34) + 2}px`;
}
const COLS = 32;
const MIN_SPAN = 2;

export function mountGrid(root, layout, kindRenderers) {
  root.innerHTML = "";
  const mounted = [];
  const cell = () => root.clientWidth / COLS;

  function place(el, w) {
    const c = cell();
    const rect = root.getBoundingClientRect();
    el.style.left = `${rect.left + w.c * c}px`;
    el.style.top = `${rect.top + w.r * c}px`;
    el.style.width = `${w.cs * c}px`;
    el.style.height = `${w.rs * c}px`;
    if (w.kind === "title") syncToolbar(el);
  }

  function renderWidget(w) {
    const el = document.createElement("section");
    const isTitle = w.kind === "title";
    el.className = isTitle ? "w chromeless" : "w";
    el.id = w.id;
    el.dataset.id = w.id;
    if (isTitle) {
      el.innerHTML = `<div class="wh tb"></div><button class="wx" type="button" title="Remove">×</button><span class="rs" title="Resize"></span>`;
      el.querySelector(".wh").appendChild(buildTitleHeading());
    } else {
      const tick = TICKS[w.kind] ? `<span class="tick">${TICKS[w.kind]}</span>` : "";
      el.innerHTML = `<header class="wh"><span class="g" aria-hidden="true">\u283F</span>${iconCanvasHtml(w.kind)}<span class="wt"></span>${tick}<button class="wx" type="button" title="Remove">×</button><span class="rs" title="Resize"></span></header><div class="wb"></div>`;
      el.querySelector(".wt").textContent = w.name;
      paintHeaderIcons(el);
    }
    place(el, w);
    root.appendChild(el);
    mounted.push({ el, w });
    if (isTitle) { syncToolbar(el); document.fonts?.ready.then(() => syncToolbar(el)); }
    else kindRenderers[w.kind]?.(el.querySelector(".wb"));

    el.querySelector(".wx").addEventListener("click", () => {
      layout.widgets = layout.widgets.filter((x) => x.id !== w.id);
      layout.removed.push({ id: w.id, name: w.name, c: w.c, r: w.r, cs: w.cs, rs: w.rs });
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const idx = mounted.findIndex((m) => m.w.id === w.id);
      if (idx >= 0) mounted.splice(idx, 1);
      el.remove();
      scheduleSave(layout);
    });

    let drag = null;
    let resize = null;

    el.querySelector(".wh").addEventListener("pointerdown", (e) => {
      if (e.target.closest(".wx") || e.target.closest(".rs") || e.target.closest("button, a")) return;
      if (!document.body.classList.contains("edit")) return;
      drag = { startX: e.clientX, startY: e.clientY, origC: w.c, origR: w.r };
    });

    el.querySelector(".rs").addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      if (!document.body.classList.contains("edit")) return;
      resize = { startX: e.clientX, startY: e.clientY, origCs: w.cs, origRs: w.rs };
    });

    function onMove(e) {
      if (drag) {
        const c = cell();
        const dc = Math.round((e.clientX - drag.startX) / c);
        const dr = Math.round((e.clientY - drag.startY) / c);
        w.c = Math.max(0, Math.min(COLS - w.cs, drag.origC + dc));
        w.r = Math.max(0, drag.origR + dr);
        place(el, w);
      } else if (resize) {
        const c = cell();
        const dc = Math.round((e.clientX - resize.startX) / c);
        const dr = Math.round((e.clientY - resize.startY) / c);
        w.cs = Math.max(MIN_SPAN, Math.min(COLS - w.c, resize.origCs + dc));
        w.rs = Math.max(MIN_SPAN, resize.origRs + dr);
        place(el, w);
      }
    }
    function onUp() {
      if (drag || resize) scheduleSave(layout);
      drag = null;
      resize = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // Post-review fix (finding 8): src/layout.js's LayoutStore.save() now
  // guards against a malformed saved layout server-side, but this stays as
  // a second line of defense (client input is still not trusted) -- without
  // it, a `layout.widgets` that is missing, null, or not an array (e.g. the
  // string "not an array") would throw here and abort this whole module
  // load, taking mountSearch/mountTour/#editBtn down with it. `?? []` alone
  // would not catch a truthy non-array value, hence the explicit Array.isArray check.
  for (const w of Array.isArray(layout.widgets) ? layout.widgets : []) renderWidget(w);

  // Re-place everything on viewport resize -- CELL is derived from root's
  // width, so a resize invalidates every widget's pixel position/size.
  window.addEventListener("resize", () => {
    for (const { el, w } of mounted) place(el, w);
  });
}
