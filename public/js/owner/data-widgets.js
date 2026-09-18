// Data-widget renderers, one per defaultLayout() widget `kind` whose backend
// already exists (title/skills/assets are handled elsewhere -- see the note
// at the bottom of this file).
//
// Deliberate deviation from the brief's illustrative code: `api()`
// (public/js/api.js) returns the raw fetch Response, not parsed JSON (this
// was already flagged by Task 8's implementer for layout-client.js and holds
// here too) -- every call below awaits a `res.ok` check, then `.json()`.
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
// Fix-round-2 (post-review): the other four widgets (briefing/recent/
// team-activity/team-roster) used bare <ul><li>/<a> markup with zero CSS
// hooks. owner.css:245-254 defines a "generic widget list-row building
// blocks (routines/briefing/recent/etc)" section -- .rows (flex column
// container), .rowi (one row: flex, gap 8px, border-top divider except
// :first-child), .rowi .dot (6px circle, .dot.hot variant in --accent for a
// highlighted/active row), .rowi .meta (margin-left:auto trailing caption).
// All four widgets below now build .rows > .rowi (+ .dot/.meta as
// appropriate) instead of <ul><li>.
//
// Also fix-round-2: every renderer but renderTeamActivity called .json()
// straight off the fetch without checking res.ok, so a non-2xx response
// (e.g. an expired session) would throw an unhandled rejection and leave
// the panel silently blank. All six now check res.ok first and show a
// visible fallback message on failure, matching the pattern
// renderTeamActivity already used for its /api/users/activity call.
//
// escapeHtml() is applied throughout, consistent with how public/js/notes.js
// escapes every equivalent piece of vault/user content before it goes into
// innerHTML (tree names, backlinks, search rows) -- the original brief
// sketch skipped that.

import { api, escapeHtml } from "/static/js/api.js";

function relTime(ms) {
  const diffMin = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.round(diffHr / 24)}d ago`;
}

export async function renderBriefing(el) {
  const res = await api("GET", "/api/notes/recent?limit=1");
  if (!res.ok) { el.innerHTML = `<p class="muted">Briefing not available.</p>`; return; }
  const recent = await res.json();
  const daily = recent.find((n) => n.path.startsWith("Daily/"));
  if (!daily) { el.innerHTML = `<p class="muted">No note in Daily/ yet.</p>`; return; }
  el.innerHTML = `<div class="rows"><div class="rowi"><span class="dot hot"></span><a href="#" data-open="${escapeHtml(daily.path)}">${escapeHtml(daily.title)}</a></div></div>`;
  el.querySelector("[data-open]")?.addEventListener("click", (e) => {
    e.preventDefault();
    window.openNoteByTarget?.(daily.title);
  });
}

export async function renderRecent(el) {
  const res = await api("GET", "/api/notes/recent?limit=20");
  if (!res.ok) { el.innerHTML = `<p class="muted">Recent changes not available.</p>`; return; }
  const recent = await res.json();
  const rows = recent.map((n) =>
    `<div class="rowi"><span class="dot"></span><a href="#" data-open="${escapeHtml(n.path)}">${escapeHtml(n.title)}</a><span class="meta">${escapeHtml(relTime(n.mtime))}</span></div>`
  ).join("");
  el.innerHTML = `<div class="rows">${rows}</div>`;
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
  const rows = audit.map((e) =>
    `<div class="rowi"><span class="dot"></span>${escapeHtml(e.username || "?")}<span class="meta">${escapeHtml(e.event)}</span></div>`
  ).join("");
  el.innerHTML = `<div class="rows">${rows}</div>`;
}

export async function renderTeamRoster(el) {
  const res = await api("GET", "/api/users");
  if (!res.ok) { el.innerHTML = `<p class="muted">Team roster not available.</p>`; return; }
  const users = await res.json();
  const rows = users.map((u) =>
    `<div class="rowi"><span class="dot${u.active ? " hot" : ""}"></span>${escapeHtml(u.displayName)}<span class="meta">${escapeHtml(u.role)}</span></div>`
  ).join("");
  el.innerHTML = `<div class="rows">${rows}</div><a href="/users">Manage →</a>`;
}

export async function renderRoutines(el) {
  const res = await api("GET", "/api/snapshots/routines");
  if (!res.ok) { el.innerHTML = `<p class="muted">Routines feed not available.</p>`; return; }
  const feed = await res.json();
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
  const res = await api("GET", "/api/snapshots/stats");
  if (!res.ok) { el.innerHTML = `<p class="muted">Stats feed not available.</p>`; return; }
  const feed = await res.json();
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
