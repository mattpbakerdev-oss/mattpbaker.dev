// Pure maths for the chase camera (camera.js does the three.js side). No three.js.
//
// Bearing: the direction from the car to the camera, as a heading (0 = +z), so the resting
// camera sits at bearing = car heading + PI.
import { firstHit } from './occlusion.js';
import { wrapAngle } from './physics.js';

export const REST = { dist: 8.5, height: 3.6 }; // behind and above the car at a standstill
export const LOOK_AHEAD = 4;    // the camera looks at a point this far in front of the car
export const LOOK_HEIGHT = 2.4; // ...and this high, so roof props stay in frame
export const MIN_DIST = 3.5;    // never closer to the car than this
export const TUCK_LIFT = 0.8;   // how much higher the camera rides when pulled right in
export const SWING = (25 * Math.PI) / 180; // sideways swing tried before pulling in at a building
export const PARK_EXTRA = 2;    // extra distance when parked in a ring, to fit the building in
const LOOKAHEAD = 3;            // start easing in this far before the geometry
const CLEAR = 0.6;              // gap kept between the lens and the geometry
const PARK_SPEED = 3;           // below this the car counts as parked

/** Where the eye goes when parked at each kind of building: about its middle, roof prop included. */
export const FRAME_HEIGHT = { gym: 6.4, condo: 6.6, studio: 7, house: 3.4, 'post-office': 3.6, site: 3.2 };

/** Resting distance and height behind the car for a speed (units per second). */
export function chaseOffset(speed) {
  const s = Math.abs(speed);
  return { dist: REST.dist + s * 0.13, height: REST.height + s * 0.035 };
}

/** Downward pitch in degrees of a camera `dist` behind and `height` above the car. */
export function pitchDegrees(dist, height, lookAhead = LOOK_AHEAD, lookHeight = LOOK_HEIGHT) {
  return (Math.atan2(height - lookHeight, dist + lookAhead) * 180) / Math.PI;
}

/** How far out along `bearing` the camera may sit: { hard, soft, kind of thing in the way }. */
export function reach(x, z, bearing, len, occluders) {
  const open = { hard: Infinity, soft: Infinity, kind: null };
  if (!occluders.length || len < 0.01) return open;
  const far = len + LOOKAHEAD;
  const { t, shape } = firstHit(x, z, x + Math.sin(bearing) * far, z + Math.cos(bearing) * far, occluders);
  if (!shape) return open;
  const hit = t * far;
  return { hard: Math.max(MIN_DIST, hit - CLEAR), soft: Math.max(MIN_DIST, hit - LOOKAHEAD), kind: shape.kind ?? null };
}

/**
 * When a building would pull the camera in, try swinging SWING either way round the car and
 * return the offset (0, SWING or -SWING) with the most room. `current` is the swing in use, kept
 * when it is as good as the other side so the camera doesn't flip-flop.
 */
export function pickSwing(x, z, bearing, len, occluders, current = 0) {
  const straight = reach(x, z, bearing, len, occluders);
  if (straight.kind !== 'building' || straight.soft >= len) return 0;
  const room = (offset) => Math.min(reach(x, z, bearing + offset, len, occluders).soft, len);
  const base = room(0);
  const sides = [SWING, -SWING].map((o) => ({ o, room: room(o) }));
  if (current) sides.sort((a, b) => (a.o === current ? -1 : b.o === current ? 1 : 0));
  let best = { o: 0, room: base + 0.5 }; // a swing must win by half a unit to be worth it
  for (const s of sides) if (s.room > best.room) best = s;
  return best.o;
}

/** Marker gems vanish when the camera is within about 4 units, growing back by 6. */
export function gemScale(dist, near = 4, far = 6) {
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
