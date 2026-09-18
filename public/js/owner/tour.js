// Onboarding tour: 7 step callouts that walk a new owner around the
// dashboard, ending on a Credits step carrying the CC BY 4.0 attribution
// this project's Licensing and attribution section requires (see NOTICE.md
// and specs/2026-09-05-shop-os-dashboard-design.md). That credit-card text
// is kept byte-identical to the plan -- do not edit it.
//
// Ported from Robonuggets/agentic-os/dashboard.html:1530-1605 (TOUR_STEPS,
// wireTour()), with deviations from the kit (and from this task's own brief
// sketch, which used illustrative element ids/selectors that don't match
// what earlier tasks actually shipped):
//   1. Persistence: tourSeen is read from/written to the server-side layout
//      (getLayout/saveLayout, Task 8) instead of the kit's
//      localStorage.getItem('os-tour-seen').
//   2. Step targets point at what this project actually renders:
//        - Skills Deck / Routines: #w-sk / #w-rt (the widget ids from
//          src/layout.js's defaultLayout()), not the kit's [data-kind]
//          attributes -- this project's widgets.js never sets data-kind.
//        - Theme toggle: #theme-btn (Task 1's header markup, wired in
//          theme.js), not the kit's #themeBtn.
//   3. #tourCard's own children are structured to match owner.css's real
//      selectors (Task 8 ports the kit's CSS byte-identical by selector
//      name): the close control is #tourX (owner.css positions it
//      absolute, top-right), Back/Next sit inside a .tfoot wrapper
//      (owner.css's footer flex/spacing/button rules are scoped to
//      "#tourCard .tfoot"), and visibility is toggled via the .show class --
//      owner.css hides #tourCard with a plain "display: none" rule (not an
//      [hidden] selector), so toggling the hidden property alone (the
//      brief's sketch) would never actually reveal the card.
import { saveLayout } from "./layout-client.js";

const TOUR_STEPS = [
  { el: () => document.getElementById("ring-root"), t: "The Ring", b: "Every report your agent builds lands here as a ball." },
  { el: () => document.getElementById("searchBtn"), t: "Search", b: "Press / any time to search the ring." },
  { el: () => document.getElementById("w-sk"), t: "Skills Deck", b: "Run a skill headlessly — the result becomes a new ball." },
  { el: () => document.getElementById("w-rt"), t: "Routines", b: "Today's automated schedule, if your agent maintains one." },
  { el: () => document.getElementById("editBtn"), t: "Edit Mode", b: "Drag, resize, or remove any widget. It's saved per-person." },
  { el: () => document.getElementById("theme-btn"), t: "Theme", b: "Light or dark — your choice, saved to your login." },
  { el: () => document.getElementById("infoBtn"), t: "Credits",
    b: 'Shop OS Dashboard is based on <b>Rubric Agentic OS</b> by Jay E | <a href="https://skool.com/robonuggets" target="_blank" rel="noopener">RoboNuggets</a>, used under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>. Modified by Blueprint IT. RoboNuggets does not endorse Shop OS.' },
];

export function mountTour(layout) {
  let i = 0;
  const card = document.createElement("div");
  card.id = "tourCard";
  card.innerHTML = `<h3 id="tourT"></h3><p id="tourB"></p><div class="tfoot"><button id="tourBack" type="button">Back</button><button id="tourNext" type="button">Next</button></div><button id="tourX" type="button" aria-label="Close tour">×</button>`;
  document.body.appendChild(card);

  function show(idx) {
    i = Math.max(0, Math.min(TOUR_STEPS.length - 1, idx));
    const step = TOUR_STEPS[i];
    card.querySelector("#tourT").textContent = step.t;
    card.querySelector("#tourB").innerHTML = step.b;
    const target = step.el();
    if (target) {
      const r = target.getBoundingClientRect();
      card.style.top = r.bottom + 8 + "px";
      card.style.left = r.left + "px";
    }
    card.classList.add("show");
  }
  async function close() {
    card.classList.remove("show");
    if (!layout.tourSeen) await saveLayout({ ...layout, tourSeen: true });
    layout.tourSeen = true;
  }
  card.querySelector("#tourNext").addEventListener("click", () => (i < TOUR_STEPS.length - 1 ? show(i + 1) : close()));
  card.querySelector("#tourBack").addEventListener("click", () => show(i - 1));
  card.querySelector("#tourX").addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && card.classList.contains("show")) close(); });
  document.getElementById("infoBtn")?.addEventListener("click", () => show(0));

  if (!layout.tourSeen) setTimeout(() => show(0), 1400);
}
