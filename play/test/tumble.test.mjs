import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBody, knock, stepBody, lowestOffset, isResting, shouldReset, PROP_KINDS } from '../js/tumble.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('a fresh body sits still at its home spot', () => {
  const b = createBody('cone', 3, 4, 0.5);
  assert.equal(b.x, 3); assert.equal(b.z, 4); assert.equal(b.knocked, false);
  close(b.y + lowestOffset(b), 0);
});

test('knock sends the prop the way the car is going, up, and spinning', () => {
  const b = createBody('crate', 0, 0, 0);
  knock(b, { x: 0, z: -1.5, vx: 0, vz: 20 }, 10);
  assert.ok(b.vz > 15, `vz ${b.vz}`);
  assert.ok(b.vy > 1);
  assert.ok(Math.hypot(b.wx, b.wy, b.wz) > 0.5);
  assert.equal(b.knocked, true);
  assert.equal(b.knockedAt, 10);
});

test('light props fly faster than heavy ones from the same hit', () => {
  const cone = createBody('cone', 0, 0, 0), crate = createBody('crate', 0, 0, 0);
  const car = { x: 0, z: -1.5, vx: 0, vz: 15 };
  knock(cone, car, 0); knock(crate, car, 0);
  assert.ok(cone.vz > crate.vz);
});

test('a slow nudge still pushes the prop away from the car', () => {
  const b = createBody('bin', 0, 0, 0);
  knock(b, { x: -1.5, z: 0, vx: 0, vz: 0 }, 0);
  assert.ok(b.vx > 0.5, `vx ${b.vx}`);
});

test('gravity brings it down, it bounces lower and friction stops it', () => {
  const b = createBody('bin', 0, 0, 0);
  knock(b, { x: 0, z: -1.5, vx: 0, vz: 12 }, 0);
  let maxY = b.y, landed = false;
  for (let i = 0; i < 60 * 8; i++) {
    stepBody(b, 1 / 60, () => 0);
    maxY = Math.max(maxY, b.y);
    assert.ok(b.y + lowestOffset(b) > -0.02, 'never sinks into the ground');
    if (b.contact) landed = true;
  }
  assert.ok(maxY > 0.6);
  assert.ok(landed);
  assert.ok(Math.hypot(b.vx, b.vz) < 0.05, `still sliding ${b.vx},${b.vz}`);
  assert.ok(isResting(b));
});

test('lowestOffset follows rotation: a crate on its corner reaches further down', () => {
  const b = createBody('crate', 0, 0, 0);
  const flat = lowestOffset(b);
  b.q = [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)]; // 45 degrees about z
  assert.ok(lowestOffset(b) < flat - 0.05);
});

test('reset waits 20 seconds and for the prop to be out of view', () => {
  const b = createBody('cone', 0, 0, 0);
  knock(b, { x: 0, z: -1, vx: 0, vz: 5 }, 100);
  assert.equal(shouldReset(b, 110, false), false);
  assert.equal(shouldReset(b, 121, true), false);
  assert.equal(shouldReset(b, 121, false), true);
  assert.equal(shouldReset(createBody('cone', 0, 0, 0), 500, false), false);
});

test('every prop kind has a size and a mass', () => {
  for (const k of ['cone', 'bin', 'crate', 'fence']) {
    assert.ok(PROP_KINDS[k].mass > 0);
    assert.equal(PROP_KINDS[k].half.length, 3);
  }
});
