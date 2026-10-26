// Arrival banners: which place's zone the car has just driven into. The zone is wider than the
// amber ring; leaving needs a little more distance than arriving, so a car hovering at the edge
// never retriggers it. One banner per approach. No three.js, so node can test it.
import { ringCentre } from './places.js';

export const ARRIVE_RADIUS = 12;
export const LEAVE_RADIUS = 14;

/** The building sites share one banner: driving along the row shows it once. */
export const arrivalKey = (place) => (place.kind === 'soon' ? 'soon' : place.id);

export function createArrivals(places) {
  const zones = places.map((place) => ({ place, centre: ringCentre(place) }));
  let current = null;   // zone the car is in
  let shownKey = null;  // key of the banner already used on this approach

  const dist = (z, x, y) => Math.hypot(x - z.centre[0], y - z.centre[1]);

  return {
    /**
     * Call each frame with the car's position. Returns the place to show a banner for, or null.
     * While `blocked` (a dialog is open) it returns null and the approach still counts as used.
     */
    update(x, z, { blocked = false } = {}) {
      if (current && dist(current, x, z) > LEAVE_RADIUS) current = null;
      // A different zone the car is now well inside takes over (zones can overlap).
      let best = null, bestD = ARRIVE_RADIUS;
      for (const zone of zones) {
        if (zone === current) continue;
        const d = dist(zone, x, z);
        if (d <= bestD) { best = zone; bestD = d; }
      }
      if (best && (!current || bestD < dist(current, x, z))) current = best;
      if (!current) { shownKey = null; return null; }
      const key = arrivalKey(current.place);
      if (key === shownKey) return null;
      shownKey = key;
      return blocked ? null : current.place;
    },
    /** Forget the current approach, e.g. after fast travel. */
    reset() { current = null; shownKey = null; },
  };
}
