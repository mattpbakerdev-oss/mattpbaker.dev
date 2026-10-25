import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segmentHit, cameraOccluders } from '../js/occlusion.js';
import { clearSpot } from '../js/placement.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('nothing in the way: full length', () => {
  assert.equal(segmentHit(0, 0, 10, 0, [{ type: 'circle', x: 5, z: 5, r: 1 }]), 1);
});

test('a circle in the way stops the segment at its edge', () => {
  close(segmentHit(0, 0, 10, 0, [{ type: 'circle', x: 5, z: 0, r: 1 }]), 0.4);
});

test('an axis-aligned box in the way', () => {
  close(segmentHit(0, 0, 10, 0, [{ type: 'box', x: 7, z: 0, hw: 1, hd: 3, rot: 0 }]), 0.6);
});

test('a rotated box uses its own axes', () => {
  // A long thin box turned 90 degrees now spans along x.
  const t = segmentHit(0, 0, 10, 0, [{ type: 'box', x: 5, z: 2, hw: 0.5, hd: 6, rot: Math.PI / 2 }]);
  assert.equal(t, 1);
  const t2 = segmentHit(0, 0, 0, 10, [{ type: 'box', x: 0, z: 5, hw: 0.5, hd: 6, rot: Math.PI / 2 }]);
  close(t2, 0.45);
});

test('the nearest of several hits wins; a shape behind the start is ignored', () => {
  const t = segmentHit(0, 0, 10, 0, [
    { type: 'circle', x: 8, z: 0, r: 1 },
    { type: 'circle', x: 4, z: 0, r: 1 },
    { type: 'circle', x: -4, z: 0, r: 1 },
  ]);
  close(t, 0.3);
});

test('starting inside a shape does not collapse the camera', () => {
  assert.equal(segmentHit(0, 0, 10, 0, [{ type: 'circle', x: 0, z: 0, r: 2 }]), 1);
});

test('cameraOccluders keeps buildings and trees, widens trees to their canopy, skips the rest', () => {
  const out = cameraOccluders([
    { type: 'box', x: 0, z: 0, hw: 4, hd: 3, rot: 0, kind: 'building', id: 'up-lock' },
    { type: 'box', x: 0, z: 0, hw: 4, hd: 3, rot: 0, kind: 'building', id: 'site-1' },
    { type: 'circle', x: 0, z: 0, r: 0.6, kind: 'tree' },
    { type: 'circle', x: 0, z: 0, r: 0.35, kind: 'lamp' },
  ]);
  assert.equal(out.length, 2);
  assert.ok(out[0].hw > 4);
  assert.ok(out[1].r > 1.2);
});

test('clearSpot slides along a direction until clear of colliders', () => {
  const colliders = [{ type: 'circle', x: 0, z: 0, r: 1 }];
  const s = clearSpot(0, 0, 0.5, colliders, 1, 0);
  assert.ok(s.x >= 1.5 - 1e-9 && s.x < 2.1, `x ${s.x}`);
  close(s.z, 0);
  const free = clearSpot(5, 5, 0.5, colliders, 1, 0);
  assert.equal(free.x, 5);
});
