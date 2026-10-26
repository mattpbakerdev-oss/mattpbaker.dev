import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scatter, rng } from '../js/spots.js';
import { plotDistance } from '../js/physics.js';

test('the seeded scatter is the same every time and stays inside the plot', () => {
  const a = scatter(), b = scatter();
  assert.deepEqual(a.breakables, b.breakables);
  assert.equal(a.lamps.length + a.trees.length, a.breakables.length);
  assert.ok(a.trees.length > 100 && a.lamps.length > 50, `${a.trees.length} trees, ${a.lamps.length} lamps`);
  for (const s of a.breakables) assert.ok(plotDistance(s.x, s.z) < 0, `${s.kind} at ${s.x}, ${s.z}`);
  // The rim carries on from the same stream, so the draw count is part of the layout.
  const fresh = rng(20261025);
  assert.notEqual(a.rand(), fresh());
});

test('breakable footprints: lamps first (index lamp), then trees (index tree, radius by size)', () => {
  const { breakables } = scatter();
  const firstTree = breakables.findIndex((s) => s.kind === 'tree');
  assert.ok(breakables.slice(0, firstTree).every((s, i) => s.kind === 'lamp' && s.lamp === i && s.r === 0.35));
  breakables.slice(firstTree).forEach((s, i) => { assert.equal(s.tree, i); assert.ok(Math.abs(s.r - (0.45 * s.s + 0.15)) < 1e-12); });
});
