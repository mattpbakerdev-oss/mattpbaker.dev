import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLACES } from '../js/places.js';
import { OBJECTIVES, objectiveProgress, extrasRow } from '../js/objectives.js';

test('the to-do list has the four stops, in order, with the brief\'s exact wording', () => {
  assert.deepEqual(OBJECTIVES.map((o) => o.label), [
    'Visit Up Lock', 'Visit Listing Check', 'Visit the UGC studio', 'Say hello at the post office',
  ]);
  for (const o of OBJECTIVES) assert.ok(PLACES.some((p) => p.id === o.id), `${o.id} is a real place`);
});

test('nothing visited: nothing ticked', () => {
  const p = objectiveProgress(new Set());
  assert.equal(p.done, 0);
  assert.equal(p.total, 4);
  assert.equal(p.complete, false);
  assert.ok(p.items.every((i) => i.done === false));
});

test('ticks follow the visited set and ignore places that are not on the list', () => {
  const p = objectiveProgress(new Set(['listing-check', 'house', 'site-2']));
  assert.equal(p.done, 1);
  assert.deepEqual(p.items.map((i) => i.done), [false, true, false, false]);
});

test('all four visited is complete', () => {
  const p = objectiveProgress(new Set(['up-lock', 'listing-check', 'ugc-pipeline', 'post-office', 'house']));
  assert.equal(p.done, 4);
  assert.equal(p.complete, true);
});

test('accepts any iterable of ids', () => {
  assert.equal(objectiveProgress(['up-lock']).done, 1);
});

test('the hidden extras sit on the list as an optional fifth row, outside the four stops', () => {
  assert.deepEqual(extrasRow(0, 4), { label: 'Find the hidden extras', count: '0/4', done: false });
  assert.deepEqual(extrasRow(4, 4), { label: 'Find the hidden extras', count: '4/4', done: true });
  assert.equal(objectiveProgress(new Set()).total, 4, 'the to-do count stays the four visits');
});
