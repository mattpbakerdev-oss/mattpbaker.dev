import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MPH_PER_UNIT, DIAL_MAX_MPH, toMph, needleAngle, easeToward, createReadout } from '../js/speedo.js';

test('speed converts to mph at 2.237 mph per unit a second, either direction', () => {
  assert.equal(MPH_PER_UNIT, 2.237);
  assert.equal(toMph(0), 0);
  assert.ok(Math.abs(toMph(10) - 22.37) < 1e-9);
  assert.ok(Math.abs(toMph(-10) - 22.37) < 1e-9, 'reversing still reads as a positive speed');
});

test('top speed (28 units a second) reads about 63 mph', () => {
  assert.equal(Math.round(toMph(28)), 63);
});

test('the needle sweeps from -120deg at 0 to +120deg at 70 mph', () => {
  assert.equal(DIAL_MAX_MPH, 70);
  assert.equal(needleAngle(0), -120);
  assert.equal(needleAngle(35), 0);
  assert.equal(needleAngle(70), 120);
});

test('the needle clamps outside the dial', () => {
  assert.equal(needleAngle(-5), -120);
  assert.equal(needleAngle(90), 120);
  assert.equal(needleAngle(Number.NaN), -120);
});

test('easeToward moves part way, never overshoots and holds still with no time', () => {
  assert.equal(easeToward(10, 50, 0), 10);
  const step = easeToward(0, 60, 1 / 60);
  assert.ok(step > 0 && step < 60, `${step}`);
  let v = 0;
  for (let i = 0; i < 600; i++) { v = easeToward(v, 60, 1 / 60); assert.ok(v <= 60); }
  assert.ok(Math.abs(v - 60) < 0.01, 'settles on the target');
  assert.ok(easeToward(60, 0, 1 / 60) < 60, 'eases down too');
});

test('easeToward snaps the last hair so the number stops changing', () => {
  assert.equal(easeToward(59.99, 60, 1 / 60), 60);
});

test('the readout only reports what changed, so the DOM is written only when it must be', () => {
  const r = createReadout();
  const first = r.step(0);
  assert.equal(first.angle, -120);
  assert.equal(first.num, 0);
  const same = r.step(0.05);
  assert.equal(same.angle, null, 'a needle move under a quarter of a degree is not written');
  assert.equal(same.num, null, 'the number has not changed');
  const moved = r.step(10);
  assert.ok(moved.angle !== null && Math.abs(moved.angle - needleAngle(10)) <= 0.25);
  assert.equal(moved.num, 10);
  assert.equal(r.step(10.2).num, null, '10.2 still reads 10');
  assert.strictEqual(r.step(10.2), r.step(10.2), 'no new object each frame');
});
