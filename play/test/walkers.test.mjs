import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loopLength, pointOnLoop, createWalker, stepWalker, hitWalker, hornWalker, TOWNSFOLK } from '../js/walkers.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const path = [[0, 0], [10, 0]];

test('a two-point path is walked there and back', () => {
  close(loopLength(path), 20);
  const a = pointOnLoop(path, 5); close(a.x, 5); close(a.z, 0); close(a.dx, 1);
  const b = pointOnLoop(path, 15); close(b.x, 5); close(b.dx, -1);
  const c = pointOnLoop(path, 25); close(c.x, 5); close(c.dx, 1); // wraps
});

test('a square loop turns the corners', () => {
  const sq = [[0, 0], [4, 0], [4, 4], [0, 4]];
  close(loopLength(sq), 16);
  const p = pointOnLoop(sq, 6); close(p.x, 4); close(p.z, 2); close(p.dz, 1);
});

test('stepWalker moves along the path at walking pace and faces the way it walks', () => {
  const w = createWalker({ path, speed: 1.2 });
  for (let i = 0; i < 60; i++) stepWalker(w, 1 / 60, null);
  close(w.x, 1.2, 1e-3);
  close(w.heading, Math.PI / 2, 0.05); // facing +x
});

test('hit: hops away from the car, says Oi!, lands and carries on', () => {
  const w = createWalker({ path, speed: 1.2, s: 5 });
  stepWalker(w, 0, null);
  const ok = hitWalker(w, { x: 5, z: -1.5, vx: 0, vz: 10 });
  assert.equal(ok, true);
  assert.equal(w.saying, 'Oi!');
  assert.ok(w.vy > 0);
  let maxY = 0, maxOff = 0;
  for (let i = 0; i < 60 * 4; i++) {
    stepWalker(w, 1 / 60, null);
    maxY = Math.max(maxY, w.y);
    maxOff = Math.max(maxOff, Math.hypot(w.ox, w.oz));
    assert.ok(w.y >= 0);
  }
  assert.ok(maxY > 0.4, 'hopped');
  assert.ok(maxOff > 1, 'moved out of the way');
  assert.ok(Math.hypot(w.ox, w.oz) < 0.2, 'went back to the pavement');
  assert.equal(w.y, 0);
  assert.ok(w.s > 5, 'kept walking');
});

test('hit has a cooldown so one bump is one hop', () => {
  const w = createWalker({ path });
  assert.equal(hitWalker(w, { x: 0, z: -1, vx: 0, vz: 5 }), true);
  assert.equal(hitWalker(w, { x: 0, z: -1, vx: 0, vz: 5 }), false);
});

test('flat hop under reduced motion: moves aside, no height', () => {
  const w = createWalker({ path, reducedMotion: true });
  hitWalker(w, { x: 0, z: -1, vx: 0, vz: 8 });
  let maxY = 0;
  for (let i = 0; i < 120; i++) { stepWalker(w, 1 / 60, null); maxY = Math.max(maxY, w.y); }
  assert.equal(maxY, 0);
});

test('horn: stops and turns to look at the car, then walks on', () => {
  const w = createWalker({ path });
  stepWalker(w, 0, null);
  hornWalker(w, 2);
  const car = { x: 0, z: 10 };
  const s0 = w.s;
  for (let i = 0; i < 60; i++) stepWalker(w, 1 / 60, car);
  close(w.s, s0);
  close(w.heading, 0, 0.1); // +z is heading 0
  for (let i = 0; i < 60 * 2; i++) stepWalker(w, 1 / 60, car);
  assert.ok(w.s > s0);
});

test('four townsfolk with the agreed lines', () => {
  assert.deepEqual(TOWNSFOLK.map((t) => t.line), [
    'Have you seen the gym? The phone won’t let me in until I do push-ups.',
    'I rented a flat in Bangkok. The listing scored 98.',
    'They filmed a video here. Captions and everything.',
    'Matt’s looking for a product role, you know. Just saying.',
  ]);
  for (const t of TOWNSFOLK) assert.ok(t.path.length >= 2);
});
