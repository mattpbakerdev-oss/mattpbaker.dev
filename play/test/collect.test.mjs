import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLLECTIBLES, findPickups, loadFound, saveFound, FOUND_KEY } from '../js/collect.js';

const memory = (init = {}) => {
  const data = { ...init };
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, data };
};
const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
const byId = (id) => COLLECTIBLES.find((c) => c.id === id);

test('four collectibles with the agreed copy', () => {
  assert.deepEqual(COLLECTIBLES.map((c) => c.id), ['dumbbell', 'reel', 'cap', 'tuktuk']);
  assert.equal(byId('dumbbell').title, 'Golden dumbbell');
  assert.equal(byId('dumbbell').text, 'Up Lock would accept this as one rep.');
  assert.equal(byId('reel').title, 'Film reel');
  assert.equal(byId('reel').text, 'Cut from the transcript, never the script.');
  assert.equal(byId('cap').title, 'Graduation cap');
  assert.equal(byId('cap').text, 'First Class, UWE Bristol, 2026.');
  assert.equal(byId('tuktuk').title, 'Mini tuk-tuk');
  assert.equal(byId('tuktuk').text, 'Bangkok, next.');
  for (const c of COLLECTIBLES) assert.ok(!/—/.test(c.text + c.title));
});

test('driving through a collectible picks it up', () => {
  const d = byId('dumbbell');
  assert.deepEqual(findPickups({ x: d.x + 0.5, y: 0, z: d.z }, COLLECTIBLES, new Set()), ['dumbbell']);
});

test('nothing is picked up from a few units away', () => {
  const d = byId('dumbbell');
  assert.deepEqual(findPickups({ x: d.x + 3, y: 0, z: d.z }, COLLECTIBLES, new Set()), []);
});

test('an already found collectible is not picked up again', () => {
  const d = byId('dumbbell');
  assert.deepEqual(findPickups({ x: d.x, y: 0, z: d.z }, COLLECTIBLES, new Set(['dumbbell'])), []);
});

test('the film reel floats out of reach from the road and needs a jump', () => {
  const r = byId('reel');
  assert.deepEqual(findPickups({ x: r.x, y: 0, z: r.z }, COLLECTIBLES, new Set()), []);
  assert.deepEqual(findPickups({ x: r.x, y: 2.4, z: r.z }, COLLECTIBLES, new Set()), ['reel']);
});

test('found set round-trips through storage', () => {
  const s = memory();
  saveFound(s, new Set(['cap', 'reel']));
  assert.deepEqual([...loadFound(s)].sort(), ['cap', 'reel']);
  assert.ok(FOUND_KEY in s.data);
});

test('loadFound ignores junk, unknown ids and broken storage', () => {
  assert.equal(loadFound(memory({ [FOUND_KEY]: 'not json' })).size, 0);
  assert.deepEqual([...loadFound(memory({ [FOUND_KEY]: '["cap","banana"]' }))], ['cap']);
  assert.equal(loadFound(memory({ [FOUND_KEY]: '{"a":1}' })).size, 0);
  assert.equal(loadFound(broken).size, 0);
  assert.equal(loadFound(null).size, 0);
  assert.doesNotThrow(() => saveFound(broken, new Set(['cap'])));
});
