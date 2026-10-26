import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLACES, ringCentre } from '../js/places.js';
import { createArrivals, ARRIVE_RADIUS, LEAVE_RADIUS, arrivalKey } from '../js/arrival.js';

const byId = (id) => PLACES.find((p) => p.id === id);
const at = (id, dx = 0, dz = 0) => { const [x, z] = ringCentre(byId(id)); return [x + dx, z + dz]; };

test('the zone is a bit wider than the ring, and leaving needs more distance than arriving', () => {
  assert.equal(ARRIVE_RADIUS, 12);
  assert.ok(LEAVE_RADIUS > ARRIVE_RADIUS);
});

test('fires once when the car enters a zone, not before', () => {
  const a = createArrivals(PLACES);
  assert.equal(a.update(...at('up-lock', ARRIVE_RADIUS + 0.5)), null, 'outside');
  assert.equal(a.update(...at('up-lock', ARRIVE_RADIUS - 0.5))?.id, 'up-lock', 'entering fires');
  assert.equal(a.update(...at('up-lock', 2)), null, 'already shown this approach');
  assert.equal(a.update(...at('up-lock')), null);
});

test('hovering at the edge does not fire again (hysteresis)', () => {
  const a = createArrivals(PLACES);
  assert.equal(a.update(...at('post-office', ARRIVE_RADIUS - 0.1))?.id, 'post-office');
  for (let i = 0; i < 10; i++) {
    assert.equal(a.update(...at('post-office', ARRIVE_RADIUS + 0.5)), null, 'just outside, still inside the leave radius');
    assert.equal(a.update(...at('post-office', ARRIVE_RADIUS - 0.1)), null, 'back in');
  }
});

test('leaving the zone properly lets it fire on the next approach', () => {
  const a = createArrivals(PLACES);
  assert.equal(a.update(...at('listing-check', 3))?.id, 'listing-check');
  assert.equal(a.update(...at('listing-check', LEAVE_RADIUS + 1)), null);
  assert.equal(a.update(...at('listing-check', 3))?.id, 'listing-check', 'a new approach');
});

test('never fires while blocked (a dialog is open), and that approach is used up', () => {
  const a = createArrivals(PLACES);
  assert.equal(a.update(...at('house', 2), { blocked: true }), null);
  assert.equal(a.update(...at('house', 2)), null, 'no late banner once the dialog closes');
  a.update(...at('house', LEAVE_RADIUS + 1));
  assert.equal(a.update(...at('house', 2))?.id, 'house');
});

test('the building sites count as one place, so driving along them shows one banner', () => {
  assert.equal(arrivalKey(byId('site-1')), arrivalKey(byId('site-3')));
  assert.notEqual(arrivalKey(byId('up-lock')), arrivalKey(byId('house')));
  const a = createArrivals(PLACES);
  const [x1, z] = at('site-1');
  const [x3] = at('site-3');
  let fired = 0;
  for (let x = x1; x <= x3; x += 0.5) if (a.update(x, z)) fired++;
  assert.equal(fired, 1);
});

test('driving straight from one zone into another fires for the new place', () => {
  const a = createArrivals([
    { id: 'a', kind: 'project', position: [0, 0], rotation: 0, footprint: [2, 2] },
    { id: 'b', kind: 'project', position: [20, 0], rotation: 0, footprint: [2, 2] },
  ]);
  const seen = [];
  for (let x = -20; x <= 40; x += 0.5) { const p = a.update(x, ringZ(a)); if (p) seen.push(p.id); }
  assert.deepEqual(seen, ['a', 'b']);
});
// The ring centre of the test places sits on the same z for both.
function ringZ() { return ringCentre({ position: [0, 0], rotation: 0, footprint: [2, 2] })[1]; }

test('reset forgets the current approach (after fast travel the banner can show)', () => {
  const a = createArrivals(PLACES);
  assert.equal(a.update(...at('up-lock'))?.id, 'up-lock');
  a.reset();
  assert.equal(a.update(...at('up-lock'))?.id, 'up-lock');
});
