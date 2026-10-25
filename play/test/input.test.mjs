import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, applyKeys, risingEdges } from '../js/input.js';

test('createState starts at rest with every field', () => {
  assert.deepEqual(createState(), { throttle: 0, steer: 0, brake: false, interact: false, horn: false, map: false, reset: false });
});

test('WASD and arrows map to throttle and steer', () => {
  const s = createState();
  applyKeys(s, new Set(['KeyW', 'KeyD']));
  assert.equal(s.throttle, 1); assert.equal(s.steer, 1);
  applyKeys(s, new Set(['ArrowDown', 'ArrowLeft']));
  assert.equal(s.throttle, -1); assert.equal(s.steer, -1);
  applyKeys(s, new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD']));
  assert.equal(s.throttle, 0); assert.equal(s.steer, 0);
});

test('action keys', () => {
  const s = createState();
  applyKeys(s, new Set(['Space', 'KeyE', 'KeyH', 'KeyM', 'KeyR']));
  assert.deepEqual(s, { throttle: 0, steer: 0, brake: true, interact: true, horn: true, map: true, reset: true });
  applyKeys(s, new Set(['Enter']));
  assert.equal(s.interact, true); assert.equal(s.brake, false);
});

test('risingEdges reports only buttons that went from up to down', () => {
  const prev = { interact: false, horn: true, map: false, reset: false };
  const cur = { interact: true, horn: true, map: false, reset: true };
  assert.deepEqual(risingEdges(prev, cur), { interact: true, horn: false, map: false, reset: true });
});
