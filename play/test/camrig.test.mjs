import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_DIST, TUCK_LIFT, SWING, LOOK_HEIGHT, REST, PARK_EXTRA,
  pitchDegrees, reach, pickSwing, gemScale, parkedLook, parkTarget, FRAME_HEIGHT,
} from '../js/camrig.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const BEHIND = Math.PI; // the camera's bearing from a car facing +z

test('tucked in at the closest, the camera still looks along the road (pitch under 18 degrees)', () => {
  assert.ok(MIN_DIST >= 3.4 && MIN_DIST <= 3.6, `MIN_DIST ${MIN_DIST}`);
  assert.ok(TUCK_LIFT <= 0.85, `TUCK_LIFT ${TUCK_LIFT}`);
  assert.ok(LOOK_HEIGHT >= 2.3 && LOOK_HEIGHT <= 2.5);
  const pitch = pitchDegrees(MIN_DIST, REST.height + TUCK_LIFT);
  assert.ok(pitch < 18, `pitch ${pitch.toFixed(1)}`);
  // The old numbers (2.6 away, lifted 2.6, looking at 1.3) gave a steep ~37 degree stare.
  assert.ok(pitchDegrees(2.6, REST.height + 2.6, 4, 1.3) > 30);
});

test('reach is unlimited with nothing behind the car', () => {
  const r = reach(0, 0, BEHIND, REST.dist, []);
  assert.equal(r.hard, Infinity);
  assert.equal(r.kind, null);
});

test('reach stops short of a building and never comes closer than MIN_DIST', () => {
  const wall = { type: 'box', x: 0, z: -6, hw: 6, hd: 1, rot: 0, kind: 'building' };
  const r = reach(0, 0, BEHIND, REST.dist, [wall]);
  assert.equal(r.kind, 'building');
  assert.ok(r.hard < 5 && r.hard >= MIN_DIST, `hard ${r.hard}`);
  const tight = reach(0, 0, BEHIND, REST.dist, [{ ...wall, z: -2.5, hd: 0.5 }]);
  close(tight.hard, MIN_DIST);
});

test('with a narrow building behind, the camera swings to a clear side', () => {
  const block = { type: 'box', x: 0, z: -5, hw: 1.5, hd: 1, rot: 0, kind: 'building' };
  const s = pickSwing(0, 0, BEHIND, REST.dist, [block]);
  close(Math.abs(s), SWING);
  close(SWING, (25 * Math.PI) / 180);
});

test('it picks the side the building does not cover', () => {
  const offLeft = { type: 'box', x: -1.75, z: -5, hw: 2.25, hd: 1, rot: 0, kind: 'building' };
  // Bearing PI + SWING points towards -x (the covered side), PI - SWING towards +x (clear).
  close(pickSwing(0, 0, BEHIND, REST.dist, [offLeft]), -SWING);
  const offRight = { ...offLeft, x: 1.75 };
  close(pickSwing(0, 0, BEHIND, REST.dist, [offRight]), SWING);
});

test('no swing for open ground, for trees, or when swinging would not help', () => {
  assert.equal(pickSwing(0, 0, BEHIND, REST.dist, []), 0);
  const tree = { type: 'circle', x: 0, z: -5, r: 1.2, kind: 'tree' };
  assert.equal(pickSwing(0, 0, BEHIND, REST.dist, [tree]), 0);
  const longWall = { type: 'box', x: 0, z: -5, hw: 30, hd: 1, rot: 0, kind: 'building' };
  assert.equal(pickSwing(0, 0, BEHIND, REST.dist, [longWall]), 0);
});

test('a swing already under way holds its side when both sides are equally clear', () => {
  const block = { type: 'box', x: 0, z: -5, hw: 1.5, hd: 1, rot: 0, kind: 'building' };
  close(pickSwing(0, 0, BEHIND, REST.dist, [block], SWING), SWING);
  close(pickSwing(0, 0, BEHIND, REST.dist, [block], -SWING), -SWING);
});

test('gems shrink to nothing as the camera closes within about 4 units', () => {
  assert.equal(gemScale(2), 0);
  assert.equal(gemScale(4), 0);
  assert.equal(gemScale(7), 1);
  assert.equal(gemScale(40), 1);
  const mid = gemScale(5);
  assert.ok(mid > 0 && mid < 1);
  let last = 0;
  for (let d = 3; d <= 7; d += 0.25) { const s = gemScale(d); assert.ok(s >= last); last = s; }
});

test('parked framing: k = 0 is the normal chase view', () => {
  const car = { x: 10, y: 0, z: 0, heading: 0 };
  const place = { model: 'gym', position: [10, 20] };
  const v = parkedLook(car, place, 0);
  close(v.x, 10); close(v.z, 4); close(v.y, LOOK_HEIGHT); close(v.extra, 0);
});

test('parked framing: k = 1 looks at the building mid-height from further back', () => {
  const car = { x: 10, y: 0, z: 0, heading: 0 };
  const place = { model: 'gym', position: [10, 20] };
  const v = parkedLook(car, place, 1);
  close(v.y, FRAME_HEIGHT.gym);
  assert.ok(v.z > 4 && v.z <= 20, `look z ${v.z}`);
  close(v.extra, PARK_EXTRA);
  assert.ok(PARK_EXTRA >= 1.8 && PARK_EXTRA <= 2.2);
  for (const model of ['gym', 'condo', 'studio']) assert.ok(FRAME_HEIGHT[model] > LOOK_HEIGHT + 2, model);
});

test('framing eases in only when the car is in a ring, slow, and facing the building', () => {
  const gym = { model: 'gym', position: [0, 20] };
  const facing = { x: 0, z: 8, heading: 0, speed: 0.5 };
  assert.equal(parkTarget(gym, facing), 1);
  assert.equal(parkTarget(gym, { ...facing, speed: 12 }), 0);
  assert.equal(parkTarget(null, facing), 0);
  assert.equal(parkTarget(gym, { ...facing, heading: Math.PI }), 0, 'facing away');
  assert.equal(parkTarget(gym, { ...facing, heading: Math.PI / 2 }), 0, 'side on');
  assert.equal(parkTarget(gym, { ...facing, heading: 0.6 }), 1, 'a little askew');
});
