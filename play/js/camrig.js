// Pure maths for the chase camera (camera.js and fader.js do the three.js side). No three.js.
//
// Bearing: the direction from the car to the camera, as a heading (0 = +z), so the resting
// camera sits at bearing = car heading + PI.
import { firstHit, pointInside } from './occlusion.js';
import { wrapAngle } from './physics.js';

export const REST = { dist: 8.5, height: 3.6 }; // behind and above the car at a standstill
export const LOOK_AHEAD = 4;    // the camera looks at a point this far in front of the car
export const LOOK_HEIGHT = 2.4; // ...and this high, so roof props stay in frame
export const MIN_DIST = 7.5;    // pulling in never brings the camera closer than this
export const TUCK_LIFT = 0.6;   // how much higher the camera rides when pulled right in
export const PARK_EXTRA = 2;    // extra distance when parked in a ring, to fit the building in
export const FADE_OPACITY = 0.2; // how see-through a building or tree gets when it hides the car
export const FADE_INSIDE = 0.05; // ...and a building the camera is inside
const CLEAR = 0.6;              // gap kept between the lens and the geometry
const PARK_SPEED = 3;           // below this the car counts as parked
const FADE_OUT = 10;            // fade rates (per second): quick to clear the view...
const FADE_BACK = 4;            // ...gentler coming back

/** Where the eye goes when parked at each kind of building: about its middle, roof prop included. */
export const FRAME_HEIGHT = { gym: 6.4, condo: 6.6, studio: 7, house: 3.4, 'post-office': 3.6, site: 3.2, grotto: 4.2 };

/** Resting distance and height behind the car for a speed (units per second). */
export function chaseOffset(speed) {
  const s = Math.abs(speed);
  return { dist: REST.dist + s * 0.13, height: REST.height + s * 0.035 };
}

/** Downward pitch in degrees of a camera `dist` behind and `height` above the car. */
export function pitchDegrees(dist, height, lookAhead = LOOK_AHEAD, lookHeight = LOOK_HEIGHT) {
  return (Math.atan2(height - lookHeight, dist + lookAhead) * 180) / Math.PI;
}

/**
 * How far from the car the camera may sit along `bearing` when its resting spot is `len` away.
 * Things in between are faded rather than avoided, so this only bites when the resting spot
 * itself is inside a building: then the camera eases in towards the wall, never closer than
 * MIN_DIST, which is near the resting distance (the fade covers the rest). Infinity when there is no limit.
 */
export function chaseLimit(x, z, bearing, len, occluders) {
  if (len < 0.01) return Infinity;
  const ex = x + Math.sin(bearing) * len, ez = z + Math.cos(bearing) * len;
  let limit = Infinity;
  for (const s of occluders) {
    if (s.kind !== 'building' || !pointInside(ex, ez, s)) continue;
    const { t } = firstHit(x, z, ex, ez, [s]); // 1 when the car itself is inside the padding
    limit = Math.min(limit, Math.max(MIN_DIST, t * len - CLEAR));
  }
  return limit;
}

/** One frame of a mesh's opacity easing towards `floor` (blocked) or 1 (clear). */
export function fadeStep(opacity, blocked, dt, floor = FADE_OPACITY) {
  const target = blocked ? floor : 1;
  const next = opacity + (target - opacity) * (1 - Math.exp(-(blocked ? FADE_OUT : FADE_BACK) * dt));
  return !blocked && next > 0.995 ? 1 : next;
}

/** Marker gems vanish when the camera is within about 5 units, growing back by 9. */
export function gemScale(dist, near = 5, far = 9) {
  const t = Math.min(1, Math.max(0, (dist - near) / (far - near)));
  return t * t * (3 - 2 * t);
}

const PARK_FACING = Math.PI / 4; // the car must point within 45 degrees of the building

/**
 * 1 when the car is parked in a place's ring (slow) and facing the building, else 0. The
 * camera eases between them. car: { x, z, heading, speed }.
 */
export function parkTarget(place, car) {
  if (!place || Math.abs(car.speed) >= PARK_SPEED) return 0;
  const toward = Math.atan2(place.position[0] - car.x, place.position[1] - car.z);
  return Math.abs(wrapAngle(toward - car.heading)) < PARK_FACING ? 1 : 0;
}

/**
 * The look-at point and extra distance for parked framing amount k (0..1): k = 0 is the normal
 * chase view; k = 1 lifts the eye to the building's middle and leans halfway towards it.
 */
export function parkedLook(car, place, k) {
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  const look = { x: car.x + fx * LOOK_AHEAD, y: car.y + LOOK_HEIGHT, z: car.z + fz * LOOK_AHEAD, extra: 0 };
  if (!place || k <= 0) return look;
  const [bx, bz] = place.position;
  const h = k * 0.5;
  return {
    x: look.x + (bx - look.x) * h,
    y: look.y + ((FRAME_HEIGHT[place.model] ?? 4) - look.y) * k,
    z: look.z + (bz - look.z) * h,
    extra: PARK_EXTRA * k,
  };
}
