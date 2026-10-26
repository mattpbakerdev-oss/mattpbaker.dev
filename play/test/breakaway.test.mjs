import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BREAKABLE, launchSpeed, createBreakable, strike, stepBreakable, speedAfterHit,
  canRestore, restoreBreakable, splitColliders, clearanceColliders, tipAngle, touchesCar,
} from '../js/breakaway.js';
import { blockers } from '../js/occlusion.js';

const flat = () => 0;
const open = { groundAt: flat };
const lamp = () => createBreakable({ type: 'circle', kind: 'lamp', x: 0, z: 0, r: 0.35, rot: 0 });
const tree = (s = 1) => createBreakable({ type: 'circle', kind: 'tree', x: 0, z: 0, r: 0.45 * s + 0.15, rot: 0, s });
const carAt = (speed, z = -1.5) => ({ x: 0, z, vx: 0, vz: speed });
const run = (b, secs, env = open, cb) => {
  for (let i = 0; i < secs * 60; i++) { stepBreakable(b, 1 / 60, env); cb?.(b); }
  return b;
};

test('lamp posts are lighter than trees and launch at a lower speed', () => {
  assert.ok(BREAKABLE.lamp.mass < BREAKABLE.tree.mass);
  assert.ok(launchSpeed(lamp()) < launchSpeed(tree()));
  assert.ok(launchSpeed(tree()) < 28, 'top speed must launch a tree');
});

test('a walking-pace tap topples it from the base: the base stays put, nothing leaves the ground', () => {
  for (const b of [lamp(), tree()]) {
    assert.equal(strike(b, carAt(1.5), 0).mode, 'topple');
    let maxBase = 0;
    run(b, 3, open, (x) => { maxBase = Math.max(maxBase, Math.hypot(x.baseX, x.baseZ)); });
    assert.ok(maxBase < 0.5, `${b.kind} base slid ${maxBase}`);
    assert.equal(b.mode, 'down');
    assert.ok(tipAngle(b) > 1.1, `${b.kind} only tipped ${tipAngle(b)}`);
  }
});

test('a topple falls the way the car was going', () => {
  const b = lamp();
  strike(b, { x: -1.5, z: 0, vx: 2, vz: 0 }, 0);
  run(b, 3);
  assert.ok(b.x > 1.5, `centre ended at x ${b.x}`);
  assert.ok(Math.abs(b.z) < 1.2);
});

test('top speed launches it into the air, spinning, well down the road', () => {
  const b = lamp();
  assert.equal(strike(b, carAt(28), 0).mode, 'launch');
  let maxY = 0, turned = 0, prev = tipAngle(b);
  run(b, 1.2, open, (x) => { maxY = Math.max(maxY, x.y); const a = tipAngle(x); turned += Math.abs(a - prev); prev = a; });
  assert.ok(maxY > 4, `apex ${maxY}`);
  assert.ok(turned > Math.PI, `only turned ${turned}`);
  run(b, 8);
  assert.ok(b.z > 10, `landed at z ${b.z}`);
  assert.equal(b.mode, 'down');
});

test('a launched object lands, bounces lower, settles lying down and never sinks', () => {
  const b = tree(1.2);
  strike(b, carAt(26), 0);
  run(b, 10, open, (x) => {
    if (x.mode === 'launch') assert.ok(x.y + x.low > -0.05, `sank to ${x.y + x.low}`);
  });
  assert.equal(b.mode, 'down');
  assert.ok(Math.abs(tipAngle(b) - Math.PI / 2) < 0.45, `not lying on its side: ${tipAngle(b)}`);
});

test('a launched object never comes to rest stood on its end, even dropped upside down', () => {
  for (const speed of [16, 20, 24, 28]) {
    for (const b of [lamp(), tree(0.9), tree(1.35)]) {
      strike(b, carAt(speed), 0);
      run(b, 12);
      assert.equal(b.mode, 'down');
      assert.ok(Math.abs(tipAngle(b) - Math.PI / 2) < 0.45, `${b.kind} at ${speed}: tip ${tipAngle(b)}`);
    }
  }
  const b = tree();
  strike(b, carAt(20), 0);
  b.q = [1, 0, 0, 0]; b.y = 4; b.vx = b.vz = b.wx = b.wz = 0; b.vy = 0;
  run(b, 12);
  assert.ok(Math.abs(tipAngle(b) - Math.PI / 2) < 0.45, `upside-down drop: tip ${tipAngle(b)}`);
});

test('faster hits fly further and higher; lamps further than trees', () => {
  const reach = (b, v) => { strike(b, carAt(v), 0); let top = 0; run(b, 8, open, (x) => { top = Math.max(top, x.y); }); return { z: b.z, top }; };
  const slow = reach(lamp(), 14), fast = reach(lamp(), 28);
  assert.ok(fast.z > slow.z && fast.top > slow.top);
  assert.ok(reach(lamp(), 28).z > reach(tree(), 28).z);
});

test('reduced motion: still breaks away, with a shorter, flatter arc', () => {
  const peak = (reduced) => { const b = lamp(); strike(b, carAt(28), 0, { reduced }); let top = 0; run(b, 8, open, (x) => { top = Math.max(top, x.y); }); return { top, z: b.z, mode: b.mode }; };
  const full = peak(false), calm = peak(true);
  assert.equal(calm.mode, 'down');
  assert.ok(calm.top < full.top * 0.7, `${calm.top} vs ${full.top}`);
  assert.ok(calm.z < full.z);
});

test('a falling tree stops against a building rather than through it', () => {
  const b = tree();
  strike(b, carAt(2), 0);
  // A wall 2 units ahead of the trunk.
  const solidAt = (x, z) => z > 2;
  run(b, 4, { groundAt: flat, solidAt });
  assert.equal(b.mode, 'down');
  assert.ok(tipAngle(b) < 1.0, `leaned ${tipAngle(b)} into the wall`);
});

test('a launched object is pushed back out of buildings', () => {
  const b = lamp();
  strike(b, carAt(28), 0);
  const push = (x, z, r) => (z + r > 6 ? { x, z: 6 - r, nx: 0, nz: -1 } : null);
  run(b, 6, { groundAt: flat, push });
  assert.ok(b.z <= 6, `went through to z ${b.z}`);
});

test('the car keeps going: about 10% off for a lamp post, 25% for a tree', () => {
  const l = speedAfterHit('lamp', 0, 20), t = speedAfterHit('tree', 0, 20);
  assert.ok(Math.abs(Math.hypot(l.vx, l.vz) - 18) < 0.5);
  assert.ok(Math.abs(Math.hypot(t.vx, t.vz) - 15) < 0.5);
  assert.ok(t.vz > 0, 'no reversal');
});

test('touchesCar: a car overlapping or sweeping through the spot hits, one passing by does not', () => {
  const b = lamp();
  assert.ok(touchesCar(b, { x: 0, z: -1.5, y: 0 }, { x: 0, z: -3 }, 1.35));
  assert.ok(touchesCar(b, { x: 0, z: 2.5, y: 0 }, { x: 0, z: -2.5 }, 1.35), 'swept through in one frame');
  assert.ok(!touchesCar(b, { x: 3, z: 0, y: 0 }, { x: 3, z: -1 }, 1.35));
  assert.ok(!touchesCar(b, { x: 0, z: -1.5, y: 6 }, { x: 0, z: -3 }, 1.35), 'flying over');
  strike(b, carAt(5), 0);
  assert.ok(!touchesCar(b, { x: 0, z: -1.5, y: 0 }, { x: 0, z: -3 }, 1.35), 'already knocked');
});

test('reset waits 20 seconds, for both spots to be off screen, and for the car to be clear', () => {
  const b = lamp();
  assert.equal(canRestore(b, 100, false, 50, 50), false, 'never knocked');
  strike(b, carAt(5), 10);
  run(b, 3);
  assert.equal(canRestore(b, 25, false, 50, 50), false, 'too soon');
  assert.equal(canRestore(b, 31, true, 50, 50), false, 'in view');
  assert.equal(canRestore(b, 31, false, 1, 1), false, 'car on the spot');
  assert.equal(canRestore(b, 31, false, 50, 50), true);
  restoreBreakable(b);
  assert.equal(b.mode, 'standing');
  assert.equal(b.baseX, 0); assert.equal(b.baseZ, 0);
  assert.equal(b.source.down, false);
  assert.ok(tipAngle(b) < 1e-6);
});

test('the solid set drops in-plot trees and lamp posts but keeps buildings and everything else', () => {
  const all = [
    { type: 'box', kind: 'building', id: 'gym', x: 0, z: 0, hw: 5, hd: 5 },
    { type: 'circle', kind: 'fountain', x: 0, z: 0, r: 4 },
    { type: 'box', kind: 'bench', x: 0, z: 0, hw: 1, hd: 0.4 },
    { type: 'circle', kind: 'lamp', x: 9, z: 0, r: 0.35 },
    { type: 'circle', kind: 'tree', x: 20, z: 0, r: 0.6, tree: 0 },
  ];
  const { solid, breakable } = splitColliders(all);
  assert.deepEqual(solid.map((c) => c.kind), ['building', 'fountain', 'bench']);
  assert.deepEqual(breakable.map((c) => c.kind), ['lamp', 'tree']);
});

test('placement still steers round standing trees and posts, but not knocked ones', () => {
  const solid = [{ type: 'box', kind: 'building', x: 0, z: 0, hw: 5, hd: 5 }];
  const b = lamp();
  assert.equal(clearanceColliders(solid, [b]).length, 2);
  strike(b, carAt(5), 0);
  assert.equal(clearanceColliders(solid, [b]).length, 1);
});

test('the camera stops fading a tree once it is knocked (occluder switched off)', () => {
  const shape = { type: 'circle', x: 0, z: 5, r: 2, kind: 'tree', key: 't:0' };
  assert.equal(blockers(0, 0, 0, 10, [shape], 1).length, 1);
  shape.off = true;
  assert.equal(blockers(0, 0, 0, 10, [shape], 1).length, 0);
});
