// Pure placement for the rim of the town: low hills and trees just outside the drivable plot,
// following its rounded corners so the edge never shows. No three.js.
import { PLOT_HALF } from './layout.js';
import { plotDistance } from './physics.js';

/** The point `out` units outside the plot edge along the ray from the centre at angle a. */
export function rayOut(a, out) {
  const dx = Math.cos(a), dz = Math.sin(a);
  let lo = 0, hi = PLOT_HALF * 2 + out + 10;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (plotDistance(dx * mid, dz * mid) < out) lo = mid; else hi = mid;
  }
  return { x: dx * hi, z: dz * hi };
}

/** n rim trees { x, z, s, rot, pine }: trunk and canopy (radius 1.6 s) wholly outside the plot. */
export function rimTrees(rand, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2;
    const s = 1 + rand() * 0.8;
    const p = rayOut(a, 1.6 * s + 0.8 + rand() * 14);
    out.push({ x: p.x, z: p.z, s, rot: rand() * 6, pine: rand() < 0.5 });
  }
  return out;
}

/** n low hills { x, z, r, sy, rot } spaced round the plot, each wholly outside it. */
export function rimHills(rand, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand() * 0.05;
    const r = 12 + rand() * 14;
    const p = rayOut(a, r + 2 + rand() * 22);
    out.push({ x: p.x, z: p.z, r, sy: 0.32 + rand() * 0.3, rot: rand() * 6 });
  }
  return out;
}
