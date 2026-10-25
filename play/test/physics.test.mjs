import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  circleVsCircle, circleVsBox, resolveCollisions, rampHeightAt, groundHeight,
  clampToPlot, nearestRoadPoint, circleOverlapsRect, rectsOverlap,
} from '../js/physics.js';
import { ROADS, RING } from '../js/layout.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('circleVsCircle: separate circles do not collide', () => {
  assert.equal(circleVsCircle(0, 0, 1, 3, 0, 1), null);
});

test('circleVsCircle: overlap gives normal pointing from b to a and the depth', () => {
  const hit = circleVsCircle(0, 0, 1, 1.5, 0, 1);
  close(hit.nx, -1); close(hit.nz, 0); close(hit.depth, 0.5);
});

test('circleVsCircle: concentric circles still push out', () => {
  const hit = circleVsCircle(2, 2, 1, 2, 2, 1);
  assert.ok(hit);
  close(Math.hypot(hit.nx, hit.nz), 1);
  close(hit.depth, 2);
});

test('circleVsBox: misses an axis-aligned box', () => {
  assert.equal(circleVsBox(10, 0, 1, { x: 0, z: 0, hw: 2, hd: 2, rot: 0 }), null);
});

test('circleVsBox: touching the +x face pushes along +x', () => {
  const hit = circleVsBox(2.5, 0, 1, { x: 0, z: 0, hw: 2, hd: 2, rot: 0 });
  close(hit.nx, 1); close(hit.nz, 0); close(hit.depth, 0.5);
});

test('circleVsBox: centre inside the box pushes out through the nearest face', () => {
  const hit = circleVsBox(0, 1.8, 0.5, { x: 0, z: 0, hw: 2, hd: 2, rot: 0 });
  close(hit.nx, 0); close(hit.nz, 1); close(hit.depth, 0.7);
});

test('circleVsBox: corner hit has a diagonal normal', () => {
  const hit = circleVsBox(2.5, 2.5, 1, { x: 0, z: 0, hw: 2, hd: 2, rot: 0 });
  close(hit.nx, Math.SQRT1_2); close(hit.nz, Math.SQRT1_2);
  close(hit.depth, 1 - Math.SQRT2 * 0.5);
});

test('circleVsBox: rotated box uses its own axes', () => {
  // A long thin box rotated 90 degrees: its long side now runs along x.
  const box = { x: 0, z: 0, hw: 0.5, hd: 5, rot: Math.PI / 2 };
  assert.ok(circleVsBox(4, 0, 0.6, box), 'inside the long side after rotation');
  assert.equal(circleVsBox(0, 4, 0.6, box), null, 'clear of the short side after rotation');
  const hit = circleVsBox(3, 0.9, 0.6, box);
  close(hit.nx, 0, 1e-9); close(hit.nz, 1, 1e-9); close(hit.depth, 0.2, 1e-9);
});

test('resolveCollisions pushes a circle clear of every collider and reports hits', () => {
  const colliders = [
    { type: 'box', x: 0, z: 0, hw: 2, hd: 2, rot: 0 },
    { type: 'box', x: 4, z: -3, hw: 2, hd: 1, rot: 0 }, // forms an inside corner with the first
    { type: 'circle', x: 10, z: 10, r: 0.5 },
  ];
  const out = resolveCollisions(2.6, -1.4, 1, colliders);
  assert.equal(out.hits.length, 2);
  for (const c of colliders) {
    const hit = c.type === 'box' ? circleVsBox(out.x, out.z, 1, c) : circleVsCircle(out.x, out.z, 1, c.x, c.z, c.r);
    assert.ok(!hit || hit.depth < 1e-6, 'still overlapping after resolve');
  }
});

test('resolveCollisions with no overlap returns the same point and no hits', () => {
  const out = resolveCollisions(20, 20, 1, [{ type: 'circle', x: 0, z: 0, r: 1 }]);
  assert.deepEqual(out, { x: 20, z: 20, hits: [] });
});

const ramp = { x: 0, z: 0, width: 6, length: 10, height: 2, heading: 0 };

test('rampHeightAt rises from 0 at the foot to full height at the lip', () => {
  close(rampHeightAt(ramp, 0, -5), 0);
  close(rampHeightAt(ramp, 0, 0), 1);
  close(rampHeightAt(ramp, 0, 4.999), 2, 1e-3);
});

test('rampHeightAt is null off the ramp', () => {
  assert.equal(rampHeightAt(ramp, 0, 6), null);
  assert.equal(rampHeightAt(ramp, 4, 0), null);
});

test('rampHeightAt follows the ramp heading', () => {
  const east = { ...ramp, heading: Math.PI / 2 }; // climbs towards +x
  close(rampHeightAt(east, -5, 0), 0, 1e-9);
  close(rampHeightAt(east, 2.5, 0), 1.5, 1e-9);
  assert.equal(rampHeightAt(east, 0, 4), null);
});

test('groundHeight is 0 on flat ground and the highest ramp otherwise', () => {
  close(groundHeight(50, 50, [ramp]), 0);
  close(groundHeight(0, 0, [ramp, { ...ramp, height: 4 }]), 2);
});

test('clampToPlot leaves points inside alone', () => {
  const out = clampToPlot(10, -20, 1, 100);
  assert.deepEqual(out, { x: 10, z: -20, hit: false, nx: 0, nz: 0 });
});

test('clampToPlot keeps a circle inside the boundary with an inward normal', () => {
  const out = clampToPlot(130, 0, 1, 100);
  close(out.x, 99); close(out.z, 0);
  assert.equal(out.hit, true);
  close(out.nx, -1); close(out.nz, 0);
  const corner = clampToPlot(-150, 150, 2, 100);
  close(corner.x, -98); close(corner.z, 98);
});

test('nearestRoadPoint snaps to a road centreline and returns a heading along it', () => {
  const roads = [
    { x: 0, z: 0, w: 100, d: 10 }, // runs along x
    { x: 60, z: 0, w: 10, d: 100 }, // runs along z
  ];
  const a = nearestRoadPoint(10, 7, roads);
  close(a.x, 10); close(a.z, 0);
  close(Math.abs(Math.sin(a.heading)), 1); // pointing along x
  const b = nearestRoadPoint(68, 30, roads);
  close(b.x, 60); close(b.z, 30);
  close(Math.abs(Math.cos(b.heading)), 1); // pointing along z
});

test('nearestRoadPoint never lands on a road end cap: outer ring corners snap to the corner centre', () => {
  // The real town: ring roads overhang their centreline loop by half a road width at each end.
  for (const [x, z] of [[82, -82], [-80, 79], [77, 85], [-90, -72], [74.9, -70]]) {
    const p = nearestRoadPoint(x, z, ROADS);
    // On a centreline, within the centreline's own length.
    const on = ROADS.some((r) => {
      const alongX = r.w >= r.d;
      const span = (alongX ? r.w : r.d) / 2 - Math.min(r.w, r.d) / 2;
      return alongX ? Math.abs(p.z - r.z) < 1e-9 && Math.abs(p.x - r.x) <= span + 1e-9
        : Math.abs(p.x - r.x) < 1e-9 && Math.abs(p.z - r.z) <= span + 1e-9;
    });
    assert.ok(on, `(${x}, ${z}) -> (${p.x}, ${p.z})`);
    assert.ok(Math.abs(Math.abs(p.x) - RING) < 1e-9 && Math.abs(Math.abs(p.z) - RING) < 1e-9, `corner (${p.x}, ${p.z})`);
    // ...and it faces along the ring, not off the end of the road into the grass.
    const ax = p.x + Math.sin(p.heading) * 8, az = p.z + Math.cos(p.heading) * 8;
    assert.ok(ROADS.some((r) => Math.abs(ax - r.x) < r.w / 2 && Math.abs(az - r.z) < r.d / 2), `faces off-road from (${x}, ${z})`);
  }
});

test('circleOverlapsRect and rectsOverlap', () => {
  const r = { x: 0, z: 0, w: 10, d: 4 };
  assert.equal(circleOverlapsRect(0, 3, 1.5, r), true);
  assert.equal(circleOverlapsRect(0, 4, 1.5, r), false);
  assert.equal(rectsOverlap(r, { x: 6, z: 0, w: 4, d: 4 }), true);
  assert.equal(rectsOverlap(r, { x: 8, z: 0, w: 4, d: 4 }), false);
});
