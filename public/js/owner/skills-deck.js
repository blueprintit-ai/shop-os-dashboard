// Skills Deck widget: run a headless skill (Task 7's POST /api/runs) and show
// the last few run-history rows.
//
// Ported concept from Robonuggets/agentic-os/dashboard.html:2130-2151
// (renderDeck()) and :2057-2104 (playSkill()), with real deviations from both
// the kit and this task's own brief sketch:
//
// 1. Markup/CSS hooks: the brief's illustrative sketch used bare
//    <button data-id> / <ul class="runs"><li> markup with no CSS behind it.
//    owner.css already ports the kit's real skills-deck selectors
//    byte-identical (#deck, .row2.skrow, .cat, .act, .abtn.play/.running,
//    .prog > .track > i + .tm) -- this file targets those instead, same
//    pattern data-widgets.js already established for the other five widgets.
// 2. No polling: runSkill() (Task 7) is awaited synchronously by the route
//    handler -- there is no /api/run-status to poll like the kit's own
//    playSkill() does. The .prog bar here just shows for the duration of one
//    fetch, then the whole deck re-renders from the fresh run history.
// 3. No model/effort adjuster, no needsInput popup, no localStorage config:
//    src/runs.js's SKILLS are three fixed skills with fixed model/effort and
//    needsInput: false -- none of that kit machinery has anything to attach
//    to in this project (YAGNI).
import { api, escapeHtml } from "/static/js/api.js";

export function mountSkillsDeck(el) {
  render();

  async function render() {
    const res = await api("GET", "/api/runs");
    if (!res.ok) { el.innerHTML = `<p class="muted">Skills not available.</p>`; return; }
    const { skills, runs } = await res.json();
    const deck = skills.map((s) => `
      <div class="row2 skrow" data-id="${escapeHtml(s.id)}">
        <b><span class="sl">/</span>${escapeHtml(s.id)}</b>
        <span class="cat">${escapeHtml(s.model)} &middot; ${escapeHtml(s.effort)}</span>
        <span class="act"><button class="abtn play" type="button" title="Run">&#9654;</button></span>
      </div>`).join("");
    const history = runs.slice(0, 5).map((r) => `
      <div class="rowi"><span class="dot${r.exit === 0 ? " hot" : ""}"></span>/${escapeHtml(r.id)}<span class="meta">${r.exit === 0 ? "&#10003;" : "&#10007;"} &middot; ${r.seconds}s</span></div>`).join("");
    el.innerHTML = `<div id="deck">${deck}</div><div class="rows">${history}</div>`;

    el.querySelectorAll(".row2.skrow").forEach((row) => {
      const id = row.dataset.id;
      const btn = row.querySelector(".play");
      btn.addEventListener("click", async () => {
        if (row.querySelector(".prog")) return; // already running
        btn.classList.add("running");
        row.classList.add("busy");
        const bar = document.createElement("div");
        bar.className = "prog";
        bar.innerHTML = `<div class="track"><i></i></div><span class="tm">running&hellip;</span>`;
        row.appendChild(bar);
        bar.querySelector("i").style.width = "70%";
        try {
          await api("POST", "/api/runs", { id });
          window.dispatchEvent(new CustomEvent("artifacts:refresh"));
        } finally {
          await render();
        }
      });
    });
  }
}
