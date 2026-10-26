// Title screen camera: a slow orbit round the town square while the title is up, then a swoop
// down to the chase position on Start. Pure maths, no three.js, so node can test it.
import { PLAZA } from './layout.js';

// Low and level enough that the top of the frame is blue sky rather than the hazy horizon.
export const ORBIT = { radius: 52, height: 22, speed: 0.05, start: 2.2, lookY: 8 };
export const SWOOP_SECONDS = 1.4;

/** Camera position and look-at point `t` seconds into the orbit (held still if `still`). */
export function orbitPose(t, still = false) {
  const a = ORBIT.start + (still ? 0 : t * ORBIT.speed);
  return {
    x: PLAZA.x + Math.sin(a) * ORBIT.radius,
    y: ORBIT.height,
    z: PLAZA.z + Math.cos(a) * ORBIT.radius,
    lookX: PLAZA.x, lookY: ORBIT.lookY, lookZ: PLAZA.z,
  };
}

/** 0..1 blend from the orbit to the chase camera, `elapsed` seconds after Start. Eased in-out. */
export function swoopBlend(elapsed, duration = SWOOP_SECONDS) {
  const t = Math.min(1, Math.max(0, elapsed / duration));
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}
