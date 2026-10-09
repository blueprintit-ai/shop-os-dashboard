// Pure helpers for the Briefing and Recent widgets (no DOM, no imports, so
// they can be unit-tested). Paths are vault-relative with forward slashes.

const DATED = /^\d{4}-\d{2}-\d{2}/;
const SCAFFOLDING = new Set(["claude.md", "readme.md"]);

const base = (p) => String(p).split("/").pop();

// Folder routing indexes (/bp-setup creates CLAUDE.md in every major folder)
// are scaffolding, not content the owner wrote.
export function hideScaffolding(notes) {
  return notes.filter((n) => !SCAFFOLDING.has(base(n.path).toLowerCase()));
}

// Today's dated note under Daily/, else the newest dated one, else null.
export function pickDailyNote(notes, todayISO) {
  const dated = notes.filter((n) => n.path.startsWith("Daily/") && DATED.test(base(n.path)));
  if (!dated.length) return null;
  const day = (n) => base(n.path).slice(0, 10);
  const today = dated.find((n) => day(n) === todayISO);
  if (today) return today;
  return dated.reduce((a, b) => (day(b) > day(a) ? b : a));
}

export function localISODate(d = new Date()) {
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
