// Pure orb geometry + layout-block helpers for the legacy server-side layout store
// (src/layout.js, PUT /api/layout; no longer used by the owner page) and unit-tested.
// No DOM, no imports.
//
// Ported from Robonuggets/agentic-os/dashboard.html (CC BY 4.0):
//   CELL = W / COLS, SCALE = CELL / 60 ............ lines 1015-1017
//   orbCX/orbCY/mS/RINGpx/BALLbase/FOOT_R ......... lines 1246-1250
//   orb move (clamp -6..COLS+6) ................... lines 1632-1636
//   orb resize clamp [.5, 1.7] .................... lines 1641-1643
//   snap to half cells on release ................. lines 1671-1673
//   placeGrip (45 degrees on FOOT_R) .............. lines 2149-2154
//   placeOrb box size (RINGpx * 2.1) .............. lines 2283-2290

export const COLS = 32;
// Defaults reproduce the reference screenshot's proportions (measured from
// reference-look.png: ring outer edge = 20.1% of the viewport width, wireframe
// radius = 60% of the ring's outer radius), i.e. the kit author's saved tweaks,
// not the kit's raw s 1.7 / z 2.6.
export const ORB_DEFAULT = Object.freeze({ c: 16, r: 9, s: 1.12, z: 2.15 });
// What every install saved before the proportions fix (the old default). A
// stored orb block equal to this is "never touched by the user": see migrateOrb.
export const ORB_LEGACY_DEFAULT = Object.freeze({ c: 16, r: 9, s: 1.7, z: 2.6 });
// [min, max] per field. c/r use the kit's drag clamp (an orb may sit up to 6
// cells off screen); r's upper bound is generous because ROWS depends on the
// screen. s is the kit's resize clamp; z (three.js zoom) is a sanity range.
export const ORB_LIMITS = Object.freeze({ c: [-6, COLS + 6], r: [-6, 60], s: [.5, 1.7], z: [.5, 5] });

// Largest orb footprint radius, as a share of the viewport HEIGHT, before the
// module scale is reduced for display (the saved s is never changed). 0.56 is
// just above what the kit's default (s 1.7) uses on a 16:9 screen (0.553), so
// 16:9 desktops render exactly like the kit and only wider/shorter windows
// (2:1, ultrawide, a half-height browser) get a smaller ring that still fits.
export const FOOT_MAX_FRAC = 0.56;

// Kit constants (RS.ring / RS.size) and footprint padding, all in 60px-cell units.
const RING = 316, BALL = 48, FOOT_PAD = 10;

const num = (v) => typeof v === "number" && Number.isFinite(v);
const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));

// Accepts anything. Non-numbers fall back to the default for that field,
// out-of-range numbers are clamped, unknown keys are dropped.
export function normalizeOrb(orb) {
  const src = orb && typeof orb === "object" && !Array.isArray(orb) ? orb : {};
  const out = {};
  for (const k of ["c", "r", "s", "z"]) {
    out[k] = Object.hasOwn(src, k) && num(src[k]) ? clamp(src[k], ORB_LIMITS[k]) : ORB_DEFAULT[k];
  }
  return out;
}

// A saved block that is exactly the legacy default was never changed by the
// user (the client saves the whole layout, orb included, on any edit), so it
// moves to the new default. Anything the user actually changed is left alone.
export function migrateOrb(orb) {
  const o = normalizeOrb(orb);
  const same = ["c", "r", "s", "z"].every((k) => o[k] === ORB_LEGACY_DEFAULT[k]);
  return same ? { ...ORB_DEFAULT } : o;
}

export const rowsFor = (H, cell) => Math.max(6, Math.floor(H / cell + .001));

export function orbMetrics(orb, W, H) {
  const cell = W / COLS;
  const scale = cell / 60;
  let sEff = orb.s;
  // Containment clamp: the kit has none (it assumes ~16:9), but on a short or
  // very wide window the ring would run off the bottom of the screen.
  const maxFoot = FOOT_MAX_FRAC * H;
  const footAtS = (RING + BALL / 2 + FOOT_PAD) * scale * sEff;
  let clamped = false;
  if (footAtS > maxFoot) { sEff = orb.s * (maxFoot / footAtS); clamped = true; }
  const k = scale * sEff;
  const ring = RING * k, ball = BALL * k;
  return {
    cell, scale, sEff, clamped,
    cx: orb.c * cell, cy: orb.r * cell,
    ring, ball, footR: ring + ball / 2 + FOOT_PAD * k,
    ob: Math.round(ring * 2.1), k,
    // outer edge of the ring band (ring + half the band width, 30 cell-units): the orb canvas is clipped to this
    clipR: ring + 30 * k,
  };
}

export const snapHalf = (v) => Math.round(v * 2) / 2;

export function resizeScale(s0, d, d0) {
  if (!(d0 > 0)) return s0;
  return clamp(s0 * d / d0, ORB_LIMITS.s);
}

export function dragPosition({ x, y, ox, oy, cell, rows }) {
  return {
    c: Math.max(-6, Math.min(COLS + 6, (x - ox) / cell)),
    r: Math.max(-6, Math.min(rows + 6, (y - oy) / cell)),
  };
}

export function gripPosition(cx, cy, footR) {
  const a = Math.PI * .25;
  return { x: cx + Math.cos(a) * footR, y: cy + Math.sin(a) * footR };
}
