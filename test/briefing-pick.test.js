import { test } from "node:test";
import assert from "node:assert/strict";
import { pickDailyNote, hideScaffolding } from "../public/js/owner/daily-note.js";

const n = (path, mtime = 1) => ({ path, title: path.split("/").pop().replace(/\.md$/, ""), mtime });

test("today's dated note wins even if another is newer", () => {
  const notes = [n("Daily/2026-10-07.md", 9), n("Daily/2026-10-08.md", 1), n("Daily/CLAUDE.md", 99)];
  assert.equal(pickDailyNote(notes, "2026-10-08").path, "Daily/2026-10-08.md");
});
test("newest dated note wins when today is missing (by date, not mtime)", () => {
  const notes = [n("Daily/2026-10-05.md", 99), n("Daily/2026-10-07.md", 1), n("Daily/CLAUDE.md", 100)];
  assert.equal(pickDailyNote(notes, "2026-10-08").path, "Daily/2026-10-07.md");
});
test("suffix after the date is allowed", () => {
  const notes = [n("Daily/2026-10-08 briefing.md")];
  assert.equal(pickDailyNote(notes, "2026-10-08").path, "Daily/2026-10-08 briefing.md");
});
test("CLAUDE.md, README.md and other undated files are never chosen", () => {
  const notes = [n("Daily/CLAUDE.md"), n("Daily/README.md"), n("Daily/template.md"), n("Projects/2026-10-08.md")];
  assert.equal(pickDailyNote(notes, "2026-10-08"), null);
});
test("empty list gives null", () => assert.equal(pickDailyNote([], "2026-10-08"), null));
test("hideScaffolding drops CLAUDE.md and README.md at any depth, keeps the rest", () => {
  const notes = [n("CLAUDE.md"), n("Daily/CLAUDE.md"), n("Clients/README.md"), n("Clients/Acme.md"), n("Daily/2026-10-08.md")];
  assert.deepEqual(hideScaffolding(notes).map((x) => x.path), ["Clients/Acme.md", "Daily/2026-10-08.md"]);
});
