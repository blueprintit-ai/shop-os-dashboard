// Data-widget renderers, one per defaultLayout() widget `kind` whose backend
// already exists (title/skills/assets are handled elsewhere -- see the note
// at the bottom of this file).
//
// Deliberate deviation from the brief's illustrative code: `api()`
// (public/js/api.js) returns the raw fetch Response, not parsed JSON (this
// was already flagged by Task 8's implementer for layout-client.js and holds
// here too) -- every call below awaits `.json()` itself.
//
// `renderRoutines` also deviates from the brief's sketch in one more way:
// the sketch used invented class names (.rows/.row/.t/.n/.src/.fired) that
// do not exist anywhere in public/css/owner.css. The real ported CSS for the
// routines board (see owner.css's "Routines firing board" section, ported
// byte-identical from Robonuggets/agentic-os/dashboard.html's renderBoard())
// uses .board/.bwrap/.brows/.brow/.flap/.nm/.srcwrap/.srclab/.done -- this
// file targets those real selectors instead, still simplified to a static
// row list per the brief's instruction (no split-flap flip animation).
// `renderStats`'s sketch already used real classes (.caprow/.bignum/.cap)
// and is used as-is.
//
// One more fix beyond the brief's sketch: every peer file that interpolates
// vault/user content into innerHTML (public/js/notes.js's tree/backlinks/
// search rows) escapes it with api.js's `escapeHtml` first -- the brief's
// sketch skipped that for these four widgets. Applied consistently below.

import { api, escapeHtml } from "/static/js/api.js";

export async function renderBriefing(el) {
  const recent = await (await api("GET", "/api/notes/recent?limit=1")).json();
  const daily = recent.find((n) => n.path.startsWith("Daily/"));
  el.innerHTML = daily
    ? `<a href="#" data-open="${escapeHtml(daily.path)}">${escapeHtml(daily.title)}</a>`
    : `<p class="muted">No note in Daily/ yet.</p>`;
  el.querySelector("[data-open]")?.addEventListener("click", (e) => {
    e.preventDefault();
    window.openNoteByTarget?.(daily.title);
  });
}

export async function renderRecent(el) {
  const recent = await (await api("GET", "/api/notes/recent?limit=20")).json();
  el.innerHTML = "<ul>" + recent.map((n) => `<li><a href="#" data-open="${escapeHtml(n.path)}">${escapeHtml(n.title)}</a></li>`).join("") + "</ul>";
  el.querySelectorAll("[data-open]").forEach((a) =>
    a.addEventListener("click", (e) => { e.preventDefault(); window.openNoteByTarget?.(a.textContent); })
  );
}

export async function renderTeamActivity(el) {
  const me = await (await api("GET", "/api/me")).json();
  if (me.user.role !== "owner") { el.innerHTML = `<p class="muted">Owner only.</p>`; return; }
  el.innerHTML = `<p class="muted">Loading…</p>`;
  // /api/users/activity does not exist yet -- Task 13 adds it alongside the
  // roster widget. Until then this call 404s and the widget shows an error
  // state below; that is expected here, not a bug to fix in this task.
  const res = await api("GET", "/api/users/activity?limit=20");
  if (!res.ok) { el.innerHTML = `<p class="muted">Activity feed not available yet.</p>`; return; }
  const audit = await res.json();
  el.innerHTML = "<ul>" + audit.map((e) => `<li>${escapeHtml(e.username || "?")} · ${escapeHtml(e.event)}</li>`).join("") + "</ul>";
}

export async function renderTeamRoster(el) {
  const users = await (await api("GET", "/api/users")).json();
  el.innerHTML = "<ul>" + users.map((u) => `<li>${escapeHtml(u.displayName)} (${escapeHtml(u.role)})</li>`).join("") + `</ul><a href="/users">Manage →</a>`;
}

export async function renderRoutines(el) {
  const feed = await (await api("GET", "/api/snapshots/routines")).json();
  if (feed.needsSetup) { el.innerHTML = `<p class="muted">No routines feed yet — see ROUTINES.md.</p>`; return; }
  if (feed.error) { el.innerHTML = `<p class="muted">${escapeHtml(feed.error)}</p>`; return; }
  const now = new Date();
  const hhmm = now.toTimeString().slice(0, 5);
  const rows = feed.routines.map((r) => {
    const fired = r.t < hhmm;
    const src = feed.sources.find((s) => s.key === r.src)?.label || r.src;
    return `<div class="brow${fired ? " done" : ""}"><span class="flap">${escapeHtml(r.t)}</span><span class="nm">${escapeHtml(r.n)}</span><span class="srcwrap"><span class="srclab">${escapeHtml(src)}</span></span></div>`;
  }).join("");
  el.innerHTML = `<div class="board"><div class="bwrap"><div class="brows">${rows}</div></div></div>`;
}

export async function renderStats(el) {
  const feed = await (await api("GET", "/api/snapshots/stats")).json();
  if (feed.needsSetup) { el.innerHTML = `<p class="muted">No stats feed yet — see WIRING.md.</p>`; return; }
  if (feed.error) { el.innerHTML = `<p class="muted">${escapeHtml(feed.error)}</p>`; return; }
  // m.cap legitimately carries a literal "<br>" (see the stats.json fixture
  // shape in test/snapshots.test.js, e.g. "GROSS PROFIT<br>margin") -- escape
  // the caption text but preserve that one intentional line break.
  el.innerHTML = feed.metrics.map((m) => `<div class="caprow"><span class="bignum">${escapeHtml(m.big)}</span><span class="cap">${escapeHtml(m.cap).replace(/&lt;br&gt;/g, "<br>")}</span></div>`).join("");
}

export const kindRenderers = {
  briefing: renderBriefing, recent: renderRecent, "team-activity": renderTeamActivity,
  "team-roster": renderTeamRoster, routines: renderRoutines, stats: renderStats,
};

// Not included above: `title` needs no fetch (static text already in the
// DOM), `skills`/`assets` are added by Task 13's mountSkillsDeck /
// mountAssetsFavorites (same (el) => void signature) and merged into this
// map in Task 13's boot.js.
