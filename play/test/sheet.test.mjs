import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldDismiss, FLICK } from '../js/sheet.js';

test('a long drag down dismisses the sheet', () => {
  assert.equal(shouldDismiss(130, 2000), true);
});

test('a short quick flick dismisses it', () => {
  assert.equal(FLICK, 0.11);
  assert.equal(shouldDismiss(30, 200), true);   // 0.15 px/ms
});

test('a slow short drag, or a drag up, springs back', () => {
  assert.equal(shouldDismiss(30, 600), false);  // 0.05 px/ms
  assert.equal(shouldDismiss(12, 20), false);   // too small to be a flick
  assert.equal(shouldDismiss(-80, 100), false);
});
