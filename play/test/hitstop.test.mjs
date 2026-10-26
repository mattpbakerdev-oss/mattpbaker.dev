import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHitStop, wantsHitStop } from '../js/hitstop.js';

test('hit-stop: about 3 frames (50 ms of real time) at a fifth speed, then normal time', () => {
  const h = createHitStop();
  assert.equal(h.step(1 / 60), 1 / 60, 'normal time until triggered');
  h.trigger();
  const out = [];
  for (let i = 0; i < 5; i++) out.push(h.step(1 / 60));
  assert.ok(Math.abs(out[0] - 0.2 / 60) < 1e-12 && Math.abs(out[1] - 0.2 / 60) < 1e-12 && Math.abs(out[2] - 0.2 / 60) < 1e-12, out.join(', '));
  assert.equal(out[3], 1 / 60);
  assert.equal(out[4], 1 / 60);
  // A long frame only slows the part of it inside the stop.
  h.trigger();
  assert.ok(Math.abs(h.step(0.05) - 0.05 * 0.2) < 1e-12);
  h.trigger();
  assert.ok(Math.abs(h.step(0.1) - (0.05 * 0.2 + 0.05)) < 1e-12);
});

test('hit-stop only on a fast hit, on a phone (coarse pointer, narrow screen), never under reduced motion', () => {
  const phone = { coarse: true, narrow: true, reduced: false };
  assert.equal(wantsHitStop({ mode: 'launch', strength: 20 }, phone), true);
  assert.equal(wantsHitStop({ mode: 'launch', strength: 10 }, phone), false, 'not a fast hit');
  assert.equal(wantsHitStop({ mode: 'topple', strength: 20 }, phone), false, 'a reduced-motion topple at speed');
  assert.equal(wantsHitStop({ mode: 'kick', strength: 20 }, phone), false);
  assert.equal(wantsHitStop({ mode: 'launch', strength: 20 }, { ...phone, reduced: true }), false);
  assert.equal(wantsHitStop({ mode: 'launch', strength: 20 }, { ...phone, coarse: false }), false, 'desktop');
  assert.equal(wantsHitStop({ mode: 'launch', strength: 20 }, { ...phone, narrow: false }), false, 'tablet');
});
