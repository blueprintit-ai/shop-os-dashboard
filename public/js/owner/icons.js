// Widget header pixel icons, ported in concept from the reference kit's HICONS
// table and paintSprite() (Robonuggets/agentic-os/dashboard.html ~1330, ~2738):
// 10x10 sprites painted onto a small canvas, 'k' = cream ink, 'o' = accent.
// The sprite shapes for apps/assets/skills/routines/in-flight are the kit's;
// the stats/briefing/recent/roster/status ones are new, drawn in the same style.
// Colours are read from the CSS tokens at paint time so light/dark both work.

const SPRITES = {
  routines: ["..........", "...kkkk...", "..k....k..", ".k..o...k.", ".k..oo..k.", ".k......k.", "..k....k..", "...kkkk...", "..........", ".........."],
  skills: ["..........", ".....kk...", "....kk....", "...kk.....", "..kkkkk...", ".....kk...", "....kk....", "...kk.....", "..........", ".........."],
  assets: ["..........", "..kkkkk...", "..k...kk..", "..k...kkk.", "..k.....k.", "..k.oo..k.", "..k.oo..k.", "..k.....k.", "..kkkkkkk.", ".........."],
  stats: ["..........", ".......kk.", ".......kk.", "....kk.kk.", "....kk.kk.", ".kk.kk.kk.", ".kk.kk.kk.", ".kk.kk.kk.", ".oo.oo.oo.", ".........."],
  briefing: ["..........", ".kkkkkkk..", ".k.....k..", ".k.ooo.k..", ".k.....k..", ".k.kkk.k..", ".k.....k..", ".kkkkkkk..", "..........", ".........."],
  recent: ["..........", "...kkkk...", "..k....k..", ".k...o..k.", ".k...o..k.", ".k...oo.k.", "..k....k..", "...kkkk...", "..........", ".........."],
  "team-activity": ["..........", "....kk....", "...kkkk...", "...k..k...", "..k....k..", "..k.oo.k..", ".k..kk..k.", ".k......k.", "....kk....", ".........."],
  "team-roster": ["..........", "..kk..kk..", ".k..kk..k.", ".k..kk..k.", "..kk..kk..", ".kkkk.kkkk", ".k..k.k..k", ".k..k.k..k", "..........", ".........."],
  status: ["..........", ".kkkkkkkk.", ".k......k.", ".k.oooo.k.", ".k......k.", ".k.kkk..k.", ".kkkkkkkk.", "....kk....", "..kkkkkk..", ".........."],
};

export function hasIcon(kind) { return Object.hasOwn(SPRITES, kind); }

export function iconCanvasHtml(kind) {
  if (!hasIcon(kind)) return "";
  return `<canvas class="hic" data-h="${kind}" width="24" height="24" aria-hidden="true"></canvas>`;
}

function paintSprite(cv, rows, p) {
  const g = cv.getContext("2d");
  const css = getComputedStyle(document.documentElement);
  const cream = css.getPropertyValue("--cream").trim() || "#e8e2d2";
  const accent = css.getPropertyValue("--accent").trim() || "#1c6ea4";
  g.clearRect(0, 0, cv.width, cv.height);
  let minX = 99, maxX = -1, minY = 99, maxY = -1;
  rows.forEach((r, y) => [...r].forEach((k, x) => {
    if (k === ".") return;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }));
  if (maxX < 0) return;
  const ox = Math.round((cv.width - (maxX - minX + 1) * p) / 2) - minX * p;
  const oy = Math.round((cv.height - (maxY - minY + 1) * p) / 2) - minY * p;
  rows.forEach((r, y) => [...r].forEach((k, x) => {
    if (k === ".") return;
    g.fillStyle = k === "o" ? accent : cream;
    g.fillRect(ox + x * p, oy + y * p, p, p);
  }));
}

export function paintHeaderIcons(scope) {
  scope.querySelectorAll("canvas.hic").forEach((c) => {
    const rows = SPRITES[c.dataset.h];
    if (rows) paintSprite(c, rows, 2);
  });
}
