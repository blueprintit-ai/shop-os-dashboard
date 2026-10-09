// Pure orb geometry + layout-block helpers, shared by ring.js (browser) and
// src/layout.js (server-side validation) and unit-tested under node:test.
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
export const ORB_DEFAULT = Object.freeze({ c: 16, r: 9, s: 1.7, z: 2.6 });
// [min, max] per field. c/r use the kit's drag clamp (an orb may sit up to 6
// cells off screen); r's upper bound is generous because ROWS depends on the
// screen. s is the kit's resize clamp; z (three.js zoom) is a sanity range.
export const ORB_LIMITS = Object.freeze({ c: [-6, COLS + 6], r: [-6, 60], s: [.5, 1.7], z: [.5, 5] });

// Share of the short viewport side the orb footprint may occupy before the
// module scale is reduced for display (small windows only; s is never changed).
export const FOOT_MAX_FRAC = 0.65;

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

export const rowsFor = (H, cell) => Math.max(6, Math.floor(H / cell + .001));

export function orbMetrics(orb, W, H) {
  const cell = W / COLS;
  const scale = cell / 60;
  let sEff = orb.s;
  // Containment clamp for small / very wide windows: the kit has none, but a
  // 700px-tall window would otherwise cut the ring off.
  const maxFoot = FOOT_MAX_FRAC * Math.min(W, H);
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
