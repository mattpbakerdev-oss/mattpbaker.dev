import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLOT_HALF, PLOT_CORNER } from '../js/layout.js';
import { plotDistance, clampToPlot } from '../js/physics.js';
import { rimTrees, rimHills } from '../js/rim.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test('plotDistance is negative inside, zero on the edge, positive outside', () => {
  close(plotDistance(0, 0), -PLOT_HALF);
  close(plotDistance(PLOT_HALF, 0), 0);
  close(plotDistance(0, -PLOT_HALF - 5), 5);
  // The corners are rounded: the square corner itself is outside.
  assert.ok(PLOT_CORNER >= 20);
  assert.ok(plotDistance(PLOT_HALF - 1, PLOT_HALF - 1) > 0);
});

test('clampToPlot with rounded corners pulls a car back inside at a corner', () => {
  const r = 1.35;
  const out = clampToPlot(100, 100, r, PLOT_HALF, PLOT_CORNER);
  assert.equal(out.hit, true);
  close(plotDistance(out.x, out.z), -r, 1e-6);
  // Normal points back into the town, diagonally at the corner.
  assert.ok(out.nx < 0 && out.nz < 0);
  close(Math.hypot(out.nx, out.nz), 1);
});

test('clampToPlot with rounded corners leaves the straight edges as they were', () => {
  const out = clampToPlot(30, 130, 1, PLOT_HALF, PLOT_CORNER);
  close(out.x, 30); close(out.z, PLOT_HALF - 1);
  close(out.nx, 0); close(out.nz, -1);
  const inside = clampToPlot(30, 40, 1, PLOT_HALF, PLOT_CORNER);
  assert.equal(inside.hit, false);
});

test('every rim tree, canopy included, stands outside the drivable plot', () => {
  for (const seed of [1, 7, 20261025]) {
    const trees = rimTrees(seeded(seed), 120);
    assert.equal(trees.length, 120);
    for (const t of trees) {
      const canopy = 1.6 * t.s;
      assert.ok(plotDistance(t.x, t.z) > canopy + 0.3, `tree at ${t.x.toFixed(1)},${t.z.toFixed(1)} is ${plotDistance(t.x, t.z).toFixed(2)} out`);
    }
  }
});

test('rim trees ring the whole plot, corners included', () => {
  const trees = rimTrees(seeded(3), 120);
  const corners = trees.filter((t) => Math.abs(Math.abs(Math.atan2(t.z, t.x)) % (Math.PI / 2) - Math.PI / 4) < 0.15);
  assert.ok(corners.length >= 4, `only ${corners.length} trees near the diagonals`);
});

test('every rim hill sits wholly outside the drivable plot', () => {
  const hills = rimHills(seeded(11), 70);
  assert.equal(hills.length, 70);
  for (const h of hills) assert.ok(plotDistance(h.x, h.z) >= h.r, `hill r ${h.r.toFixed(1)} only ${plotDistance(h.x, h.z).toFixed(1)} out`);
});
