// Arrival banners: which place's zone the car has just driven into. The zone is a little wider
// than the amber ring; leaving needs more distance than arriving, and once the car is in a zone it
// stays there until it is properly out, so overlapping zones never flip the banner back and forth.
// A zone is only claimed when the place is ahead of the car (or the car is right on top of it), so
// a building behind you never names itself. One banner per approach. No three.js, so node can test it.
import { ringCentre } from './places.js';

export const ARRIVE_RADIUS = 9;
export const LEAVE_RADIUS = 11;
/** Inside this distance the "is it ahead" check is waived. */
export const NEAR_RADIUS = 5;
/** Cosine of the widest angle off the nose that still counts as ahead (about 70deg). */
export const AHEAD_DOT = 0.35;

/** The building sites share one banner: driving along the row shows it once. */
export const arrivalKey = (place) => (place.kind === 'soon' ? 'soon' : place.id);

export function createArrivals(places) {
  // One zone per banner key. A zone covers the box round its ring centres (a point for most
  // places, a line along the row for the building sites), so the row counts as one stretch.
  const byKey = new Map();
  for (const place of places) {
    const key = arrivalKey(place);
    const [x, z] = ringCentre(place);
    const zone = byKey.get(key);
    if (!zone) byKey.set(key, { key, place, x0: x, x1: x, z0: z, z1: z });
    else Object.assign(zone, { x0: Math.min(zone.x0, x), x1: Math.max(zone.x1, x), z0: Math.min(zone.z0, z), z1: Math.max(zone.z1, z) });
  }
  const zones = [...byKey.values()];
  let current = null;   // zone the car is in
  let shownKey = null;  // key of the banner already used on this approach

  // Distance from the car to the nearest point of the zone. The offset lands in ox, oz rather
  // than a fresh array: this runs per zone per frame.
  let ox = 0, oz = 0;
  const measure = (zone, x, z) => {
    ox = Math.min(zone.x1, Math.max(zone.x0, x)) - x;
    oz = Math.min(zone.z1, Math.max(zone.z0, z)) - z;
    return Math.hypot(ox, oz);
  };
  // Reads the offset left by the `measure` call just before it.
  const ahead = (d, heading) => {
    if (!Number.isFinite(heading)) return true;
    if (d <= NEAR_RADIUS) return true;
    return (Math.sin(heading) * ox + Math.cos(heading) * oz) / d > AHEAD_DOT;
  };

  return {
    /**
     * Call each frame with the car's position (and heading, 0 = towards +z). Returns the place to
     * show a banner for, or null. While `blocked` (a dialog is open) it returns null and the
     * approach still counts as used.
     */
    update(x, z, { blocked = false, heading } = {}) {
      if (current && measure(current, x, z) > LEAVE_RADIUS) current = null;
      if (!current) {
        let best = null, bestD = ARRIVE_RADIUS;
        for (const zone of zones) {
          const d = measure(zone, x, z);
          if (d <= bestD && ahead(d, heading)) { best = zone; bestD = d; }
        }
        current = best;
      }
      if (!current) { shownKey = null; return null; }
      if (current.key === shownKey) return null;
      shownKey = current.key;
      return blocked ? null : current.place;
    },
    /** Forget the current approach, e.g. after fast travel. */
    reset() { current = null; shownKey = null; },
  };
}
