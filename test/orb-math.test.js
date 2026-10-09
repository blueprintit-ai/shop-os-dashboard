import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ORB_DEFAULT, ORB_LIMITS, COLS, normalizeOrb, orbMetrics, snapHalf, resizeScale, dragPosition, gripPosition, rowsFor,
} from "../public/js/owner/orb-math.js";

test("normalizeOrb: missing or non-object input becomes the defaults (a fresh copy)", () => {
  for (const bad of [undefined, null, 5, "x", [], true]) {
    const o = normalizeOrb(bad);
    assert.deepEqual(o, ORB_DEFAULT);
    assert.notEqual(o, ORB_DEFAULT);
  }
  assert.deepEqual(ORB_DEFAULT, { c: 16, r: 9, s: 1.7, z: 2.6 });
});

test("normalizeOrb: keeps valid numbers, defaults non-numbers per field, clamps out-of-range, drops extra keys", () => {
  assert.deepEqual(normalizeOrb({ c: 10.5, r: 4, s: 1, z: 2 }), { c: 10.5, r: 4, s: 1, z: 2 });
  assert.deepEqual(normalizeOrb({ c: "10", r: NaN, s: null, z: Infinity }), ORB_DEFAULT);
  assert.deepEqual(normalizeOrb({ c: 1e9, r: -1e9, s: 9, z: 0 }), { c: ORB_LIMITS.c[1], r: ORB_LIMITS.r[0], s: ORB_LIMITS.s[1], z: ORB_LIMITS.z[0] });
  assert.deepEqual(normalizeOrb({ c: 3, evil: "<script>", __proto__: { s: 1 } }), { ...ORB_DEFAULT, c: 3 });
});

test("orbMetrics: matches the kit's CELL/SCALE sizing at 1600x900 (s=1.7)", () => {
  const m = orbMetrics({ c: 16, r: 9, s: 1.7, z: 2.6 }, 1600, 900);
  assert.equal(m.cell, 50);
  assert.equal(m.cx, 800);
  assert.equal(m.cy, 450);
  assert.ok(Math.abs(m.scale - 50 / 60) < 1e-9);
  assert.ok(Math.abs(m.ring - 316 * (50 / 60) * 1.7) < 1e-9);
  assert.ok(Math.abs(m.ball - 48 * (50 / 60) * 1.7) < 1e-9);
  assert.ok(Math.abs(m.footR - (m.ring + m.ball / 2 + 10 * (50 / 60) * 1.7)) < 1e-9);
  assert.equal(m.ob, Math.round(m.ring * 2.1));
  assert.equal(m.clamped, false);
});

test("orbMetrics: scales with s and with the viewport width", () => {
  const a = orbMetrics({ c: 16, r: 9, s: 1, z: 1 }, 1600, 900);
  const b = orbMetrics({ c: 16, r: 9, s: .5, z: 1 }, 1600, 900);
  assert.ok(Math.abs(a.ring / b.ring - 2) < 1e-9);
  const wide = orbMetrics({ c: 16, r: 9, s: 1, z: 1 }, 2400, 1350);
  assert.ok(Math.abs(wide.ring / a.ring - 1.5) < 1e-9);
});

test("orbMetrics: small-window clamp keeps the footprint inside 65% of the short side, never touches s itself", () => {
  const m = orbMetrics({ c: 16, r: 9, s: 1.7, z: 2.6 }, 1900, 600);
  assert.equal(m.clamped, true);
  assert.ok(m.footR <= 0.65 * 600 + 1e-6);
  assert.ok(m.sEff < 1.7);
  // the common desktop sizes are NOT clamped
  for (const [w, h] of [[1280, 720], [1366, 768], [1600, 900], [1920, 1080], [2000, 1000], [2560, 1440]]) {
    assert.equal(orbMetrics(ORB_DEFAULT, w, h).clamped, false, `${w}x${h}`);
  }
});

test("snapHalf rounds to half cells", () => {
  assert.equal(snapHalf(10.26), 10.5);
  assert.equal(snapHalf(10.24), 10);
  assert.equal(snapHalf(-0.3), -0.5);
});

test("resizeScale follows the grip distance ratio and clamps to [.5, 1.7]", () => {
  assert.equal(resizeScale(1, 200, 100), 1.7);
  assert.equal(resizeScale(1, 100, 200), 0.5);
  assert.equal(resizeScale(1, 1, 1000), 0.5);
  assert.ok(Math.abs(resizeScale(1, 120, 100) - 1.2) < 1e-9);
  assert.equal(resizeScale(1, 100, 0), 1); // zero start distance: no change instead of NaN
});

test("dragPosition: grab offset kept, clamped to [-6, COLS+6] / [-6, ROWS+6] cells", () => {
  const p = dragPosition({ x: 810, y: 460, ox: 10, oy: 10, cell: 50, rows: 18 });
  assert.deepEqual(p, { c: 16, r: 9 });
  assert.deepEqual(dragPosition({ x: -9999, y: 9999, ox: 0, oy: 0, cell: 50, rows: 18 }), { c: -6, r: 24 });
  assert.equal(COLS, 32);
  assert.equal(rowsFor(900, 50), 18);
  assert.equal(rowsFor(100, 50), 6);
});

test("gripPosition sits at 45 degrees on the footprint edge", () => {
  const g = gripPosition(800, 450, 100);
  assert.ok(Math.abs(g.x - (800 + 100 * Math.SQRT1_2)) < 1e-9);
  assert.ok(Math.abs(g.y - (450 + 100 * Math.SQRT1_2)) < 1e-9);
});
