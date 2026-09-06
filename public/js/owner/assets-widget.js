// Business Assets widget: the starred documents from GET /api/assets
// (Task 6), plus a footer link to the full-page browser (/assets, this task).
//
// Ported concept from Robonuggets/agentic-os/dashboard.html:3437-3454
// (pullAssets()), with two deviations from both the kit and this task's own
// brief sketch:
//
// 1. Markup/CSS hooks: the brief's illustrative sketch used a bare list of
//    <a> tags with no CSS behind it. owner.css already ports the kit's real
//    #w-ba .row2/.st/.cat/.act and .foot2 selectors byte-identical -- this
//    file targets those instead, same pattern data-widgets.js already
//    established for the other five widgets.
// 2. No /api/assets/open: the kit's row click POSTed to a "reveal in
//    Finder"-style endpoint that has no equivalent route in this project.
//    Each favorite is a plain link to the real GET /assets/file/:id route
//    instead, opened in a new tab -- exactly what the brief's own sketch did.
import { api, escapeHtml } from "/static/js/api.js";

export function mountAssetsFavorites(el) {
  render();

  async function render() {
    const res = await api("GET", "/api/assets");
    if (!res.ok) { el.innerHTML = `<p class="muted">Assets not set up yet.</p>`; return; }
    const data = await res.json();
    const favs = data.favorites || [];
    const rows = favs.map((f) => `
      <a class="row2" href="/assets/file/${encodeURIComponent(f.id)}" target="_blank"
         title="${escapeHtml(f.name)} &middot; ${escapeHtml(f.category)}">
        <span class="st">&#9733;</span><b>${escapeHtml(f.name)}</b><span class="cat">${escapeHtml(f.category)}</span><span class="act">OPEN &rarr;</span>
      </a>`).join("");
    const count = (data.files || []).length;
    el.innerHTML = `${rows || `<p class="muted">No favorites pinned yet &mdash; star a document in <a href="/assets" target="_blank">Business Assets</a>.</p>`}
      <a class="foot2" href="/assets" target="_blank"><i></i>${count} DOCUMENT${count === 1 ? "" : "S"} &middot; VIEW ALL &rarr;</a>`;
  }
}
