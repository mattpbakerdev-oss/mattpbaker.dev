import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLACES, RING_RADIUS, ringCentre } from '../js/places.js';
import { ROADS, FOUNTAIN } from '../js/layout.js';
import { resolveCollisions, pointInRect } from '../js/physics.js';
import { placeInRange, travelSpot, RING_EXIT } from '../js/proximity.js';

const CAR_R = 1.35;
const footprintColliders = PLACES.map((p) => ({
  type: 'box', x: p.position[0], z: p.position[1], hw: p.footprint[0] / 2, hd: p.footprint[1] / 2, rot: p.rotation,
}));
const colliders = [...footprintColliders, { type: 'circle', x: FOUNTAIN.x, z: FOUNTAIN.z, r: FOUNTAIN.r }];

test('placeInRange finds the place whose ring the car is in', () => {
  for (const place of PLACES) {
    const [cx, cz] = ringCentre(place);
    assert.equal(placeInRange(cx, cz, PLACES)?.id, place.id);
    assert.equal(placeInRange(cx + RING_RADIUS * 0.9, cz, PLACES)?.id, place.id, 'near the edge of the ring');
  }
});

test('placeInRange returns null away from every ring', () => {
  assert.equal(placeInRange(0, 14, PLACES), null); // the start, in the square
  const [cx, cz] = ringCentre(PLACES[0]);
  assert.equal(placeInRange(cx + RING_RADIUS + 0.2, cz, PLACES), null);
});

test('placeInRange keeps the current place until the car is clearly outside (no flicker at the edge)', () => {
  const place = PLACES[0];
  const [cx, cz] = ringCentre(place);
  const justOut = cx + RING_RADIUS + 0.5;
  assert.ok(justOut < cx + RING_EXIT);
  assert.equal(placeInRange(justOut, cz, PLACES), null, 'not entered from outside');
  assert.equal(placeInRange(justOut, cz, PLACES, place)?.id, place.id, 'held while leaving');
  assert.equal(placeInRange(cx + RING_EXIT + 0.1, cz, PLACES, place), null, 'released once clear');
});

for (const place of PLACES) {
  test(`${place.id}: fast travel lands outside the ring, on the road, facing the door, clear of colliders`, () => {
    const spot = travelSpot(place, ROADS, colliders, CAR_R);
    const [cx, cz] = ringCentre(place);
    const dist = Math.hypot(spot.x - cx, spot.z - cz);
    assert.ok(dist > RING_RADIUS, `inside the ring (${dist.toFixed(2)})`);
    assert.ok(dist < RING_RADIUS + 10, `too far from the ring (${dist.toFixed(2)})`);
    assert.ok(ROADS.some((r) => pointInRect(spot.x, spot.z, r, CAR_R)), 'not on a road');
    const hits = resolveCollisions(spot.x, spot.z, CAR_R, colliders).hits;
    assert.equal(hits.length, 0, 'inside a collider');
    // Facing the door: the car's forward vector points at the ring centre.
    const fx = Math.sin(spot.heading), fz = Math.cos(spot.heading);
    const tx = (cx - spot.x) / dist, tz = (cz - spot.z) / dist;
    assert.ok(fx * tx + fz * tz > 0.99, 'not facing the door');
  });
}

test('fast travel steps past a lamp post standing on the spot', () => {
  const place = PLACES[0];
  const first = travelSpot(place, ROADS, colliders, CAR_R);
  const lamp = { type: 'circle', x: first.x, z: first.z, r: 0.35 };
  const spot = travelSpot(place, ROADS, [...colliders, lamp], CAR_R);
  assert.equal(resolveCollisions(spot.x, spot.z, CAR_R, [...colliders, lamp]).hits.length, 0);
  assert.ok(ROADS.some((r) => pointInRect(spot.x, spot.z, r, CAR_R)));
});
