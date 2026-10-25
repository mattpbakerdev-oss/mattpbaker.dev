// Pure helpers for the places layer: which ring the car is in, and where fast travel drops it.
// No three.js, so node can test them.
import { RING_RADIUS, ringCentre } from './places.js';
import { resolveCollisions, pointInRect, nearestRoadPoint } from './physics.js';

/** Leaving needs a little more distance than entering, so the prompt never flickers at the edge. */
export const RING_EXIT = RING_RADIUS + 1;

/**
 * The place whose amber ring the car is in, or null. Pass the place returned last frame as
 * `current` to hold it until the car is clearly outside.
 */
export function placeInRange(x, z, places, current = null) {
  if (current) {
    const [cx, cz] = ringCentre(current);
    if (Math.hypot(x - cx, z - cz) <= RING_EXIT) return current;
  }
  let best = null, bestDist = Infinity;
  for (const place of places) {
    const [cx, cz] = ringCentre(place);
    const d = Math.hypot(x - cx, z - cz);
    if (d <= RING_RADIUS && d < bestDist) { best = place; bestDist = d; }
  }
  return best;
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Fast-travel spot for a place: on the road just beyond its ring, facing the door, clear of
 * every collider. Walks out from the ring along the door's direction, then sideways if needed.
 */
export function travelSpot(place, roads, colliders, carRadius = 1.35) {
  const [cx, cz] = ringCentre(place);
  const fx = Math.sin(place.rotation), fz = Math.cos(place.rotation);
  const heading = wrap(place.rotation + Math.PI);
  const clear = (x, z) =>
    roads.some((r) => pointInRect(x, z, r, carRadius)) &&
    resolveCollisions(x, z, carRadius, colliders, 1).hits.length === 0;

  for (const side of [0, 1.5, -1.5, 3, -3]) {
    for (let t = RING_RADIUS + carRadius; t <= RING_RADIUS + 10; t += 0.5) {
      const x = cx + fx * t + fz * side, z = cz + fz * t - fx * side;
      if (clear(x, z)) return { x, z, heading };
    }
  }
  const p = nearestRoadPoint(cx + fx * (RING_RADIUS + 3), cz + fz * (RING_RADIUS + 3), roads, heading);
  const out = resolveCollisions(p.x, p.z, carRadius + 0.3, colliders, 6);
  return { x: out.x, z: out.z, heading };
}
