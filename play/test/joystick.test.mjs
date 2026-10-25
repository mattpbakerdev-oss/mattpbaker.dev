import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joystickVector } from '../js/joystick.js';

const R = 60;
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('centre and the dead zone give no input', () => {
  assert.deepEqual(joystickVector(0, 0, R), { throttle: 0, steer: 0, knobX: 0, knobY: 0 });
  const v = joystickVector(3, -4, R); // 5px of 60, inside the dead zone
  assert.equal(v.throttle, 0); assert.equal(v.steer, 0);
  assert.equal(v.knobX, 3); assert.equal(v.knobY, -4); // the knob still follows the thumb
});

test('up is forward, down is reverse, right steers right', () => {
  assert.ok(close(joystickVector(0, -R, R).throttle, 1));
  assert.ok(close(joystickVector(0, R, R).throttle, -1));
  assert.ok(close(joystickVector(R, 0, R).steer, 1));
  assert.ok(close(joystickVector(-R, 0, R).steer, -1));
  assert.equal(joystickVector(R, 0, R).throttle, 0);
});

test('a push past the rim is clamped to the rim', () => {
  const v = joystickVector(0, -3 * R, R);
  assert.ok(close(v.throttle, 1));
  assert.equal(v.knobY, -R); assert.equal(v.knobX, 0);
  const d = joystickVector(2 * R, -2 * R, R);
  assert.ok(close(Math.hypot(d.knobX, d.knobY), R));
  assert.ok(close(d.steer, Math.SQRT1_2, 1e-3) && close(d.throttle, Math.SQRT1_2, 1e-3));
});

test('output rises smoothly from the dead zone edge and stays within -1..1', () => {
  let last = -1;
  for (let y = 0; y <= R * 1.5; y += 2) {
    const t = joystickVector(0, -y, R).throttle;
    assert.ok(t >= 0 && t <= 1);
    assert.ok(t >= last - 1e-9, 'monotonic');
    last = t;
  }
  assert.ok(joystickVector(0, -R * 0.2, R).throttle < 0.15, 'no jump at the dead zone edge');
});
