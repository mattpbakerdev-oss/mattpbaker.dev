import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orbitPose, swoopBlend, ORBIT } from '../js/titlecam.js';
import { PLAZA } from '../js/layout.js';

test('the orbit circles the square at a fixed radius and height, looking at its centre', () => {
  for (const t of [0, 10, 60]) {
    const p = orbitPose(t);
    assert.ok(Math.abs(Math.hypot(p.x - PLAZA.x, p.z - PLAZA.z) - ORBIT.radius) < 1e-9);
    assert.equal(p.y, ORBIT.height);
    assert.deepEqual([p.lookX, p.lookZ], [PLAZA.x, PLAZA.z]);
  }
  assert.notDeepEqual(orbitPose(0), orbitPose(10), 'it moves');
});

test('with reduced motion the orbit holds still', () => {
  assert.deepEqual(orbitPose(0, true), orbitPose(30, true));
});

test('the swoop eases from 0 to 1 and stays put after', () => {
  assert.equal(swoopBlend(0), 0);
  assert.equal(swoopBlend(0.7, 1.4), 0.5);
  assert.equal(swoopBlend(1.4, 1.4), 1);
  assert.equal(swoopBlend(5), 1);
  assert.ok(swoopBlend(0.1, 1.4) < 0.1, 'starts gently');
});
