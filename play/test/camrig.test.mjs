import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_DIST, TUCK_LIFT, LOOK_HEIGHT, REST, PARK_EXTRA, FADE_OPACITY, FADE_INSIDE,
  pitchDegrees, chaseLimit, fadeStep, gemScale, parkedLook, parkTarget, FRAME_HEIGHT,
} from '../js/camrig.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const BEHIND = Math.PI; // the camera's bearing from a car facing +z

test('pulled in to the closest, the camera still sits well behind and looks along the road', () => {
  // At MIN_DIST the car must still read from behind, not as a roof seen from above.
  assert.ok(MIN_DIST >= 7 && MIN_DIST <= REST.dist - 0.5, `MIN_DIST ${MIN_DIST}`); // near the resting distance
  assert.ok(TUCK_LIFT <= 0.85, `TUCK_LIFT ${TUCK_LIFT}`);
  assert.ok(LOOK_HEIGHT >= 2.3 && LOOK_HEIGHT <= 2.5);
  const pitch = pitchDegrees(MIN_DIST, REST.height + TUCK_LIFT);
  assert.ok(pitch < 12, `pitch ${pitch.toFixed(1)}`);
  // The old 3.5-unit tuck stared down at about 15 degrees and filled the frame with roof.
  assert.ok(pitchDegrees(3.5, REST.height + 0.8) > 14);
});

test('nothing behind the car: no limit', () => {
  assert.equal(chaseLimit(0, 0, BEHIND, REST.dist, []), Infinity);
});

test('a building the camera can see past is faded, not pulled in for', () => {
  // Thin wall between the car and the camera, camera clear of it on the far side.
  const wall = { type: 'box', x: 0, z: -4, hw: 6, hd: 0.5, rot: 0, kind: 'building' };
  assert.equal(chaseLimit(0, 0, BEHIND, REST.dist, [wall]), Infinity);
});

test('a camera that would sit inside a building eases in, but never closer than MIN_DIST', () => {
  // Wall 8.2 units behind the car (padding included), building deep: pull to just in front of it.
  const deep = { type: 'box', x: 0, z: -13.2, hw: 6, hd: 5, rot: 0, kind: 'building' };
  const lim = chaseLimit(0, 0, BEHIND, REST.dist, [deep]);
  assert.ok(lim < 8 && lim >= MIN_DIST, `limit ${lim}`);
  // Wall 2 units behind: pulling right in would put the lens on the boot, so stop at MIN_DIST
  // and let the fade do the rest.
  const close2 = { ...deep, z: -7 };
  close(chaseLimit(0, 0, BEHIND, REST.dist, [close2]), MIN_DIST);
});

test('trees never pull the camera in (they fade instead)', () => {
  const tree = { type: 'circle', x: 0, z: -8, r: 2, kind: 'tree' };
  assert.equal(chaseLimit(0, 0, BEHIND, REST.dist, [tree]), Infinity);
});

test('fadeStep eases towards see-through when blocked and back to solid when clear', () => {
  let o = 1;
  for (let i = 0; i < 60; i++) o = fadeStep(o, true, 1 / 60);
  assert.ok(Math.abs(o - FADE_OPACITY) < 0.02, `faded to ${o}`);
  assert.ok(FADE_OPACITY > 0 && FADE_OPACITY <= 0.3);
  // A building the camera sits inside fades further, so its walls don't fog the view.
  let deep = 1;
  for (let i = 0; i < 60; i++) deep = fadeStep(deep, true, 1 / 60, FADE_INSIDE);
  assert.ok(FADE_INSIDE < FADE_OPACITY && Math.abs(deep - FADE_INSIDE) < 0.02, `inside ${deep}`);
  let last = o;
  for (let i = 0; i < 120; i++) { o = fadeStep(o, false, 1 / 60); assert.ok(o >= last); last = o; }
  assert.equal(o, 1, 'snaps to exactly solid so the original material can come back');
  // Fading out is quicker than coming back.
  const out = 1 - fadeStep(1, true, 0.1), back = fadeStep(FADE_OPACITY, false, 0.1) - FADE_OPACITY;
  assert.ok(out > back, `${out} vs ${back}`);
});

test('gems shrink to nothing as the camera closes within about 5 units, full again by 9', () => {
  assert.equal(gemScale(2), 0);
  assert.equal(gemScale(5), 0);
  assert.equal(gemScale(9), 1);
  assert.equal(gemScale(40), 1);
  const mid = gemScale(7);
  assert.ok(mid > 0 && mid < 1);
  let last = 0;
  for (let d = 4; d <= 10; d += 0.25) { const s = gemScale(d); assert.ok(s >= last); last = s; }
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
