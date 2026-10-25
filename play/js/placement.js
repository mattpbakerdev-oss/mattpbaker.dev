// Pure helper for dropping extras (signs, props, townsfolk) on the pavement without landing
// inside a tree or lamp post that the world placed first.
import { resolveCollisions } from './physics.js';

/** Slide (x, z) along (dx, dz) in small steps until a circle of radius r touches nothing. */
export function clearSpot(x, z, r, colliders, dx, dz, maxSlide = 12) {
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len, uz = dz / len;
  for (let t = 0; t <= maxSlide; t += 0.25) {
    for (const sgn of t ? [1, -1] : [1]) {
      const px = x + ux * t * sgn, pz = z + uz * t * sgn;
      if (!resolveCollisions(px, pz, r, colliders, 1).hits.length) return { x: px, z: pz };
    }
  }
  return { x, z };
}
