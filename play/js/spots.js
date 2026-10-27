// Pure placement for the town's seeded scatter: the mown grass patches, the lamp posts and the
// in-plot trees. No three.js, so the tests place exactly what the game places (world.js draws
// these; the breakaway fuzz test hits every one of them).
import { PLOT_HALF, ROADS, PLAZA, RAMPS, PARK, WELCOME_SIGN, ROAD_WIDTH } from './layout.js';
import { PLACES, RING_RADIUS, ringCentre, footprintRect } from './places.js';
import { circleOverlapsRect, rampFootprint, plotDistance } from './physics.js';

export const SEED = 20261025;

/** A small seeded random number generator (mulberry32): () => [0, 1). */
export function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Darker mown patches for texture, kept off the roads: [{ x, z, r, rot, sz }]. */
export function grassPatches(rand) {
  const out = [];
  for (let i = 0; i < 70; i++) {
    const x = (rand() * 2 - 1) * 110, z = (rand() * 2 - 1) * 110, r = 3 + rand() * 8;
    if (ROADS.some((road) => circleOverlapsRect(x, z, r, road)) || Math.hypot(x, z) < PLAZA.r + r) continue;
    out.push({ x, z, r, rot: rand() * 6, sz: 0.6 + rand() * 0.4 });
  }
  return out;
}

/** Where scattered things may not go: roads, the square, plots, rings, ramps, the sign, the edge. */
export function blockedSpot() {
  const placeRects = PLACES.map((p) => footprintRect(p));
  const rings = PLACES.map((p) => ringCentre(p));
  const rampZones = RAMPS.map((ramp) => {
    // Keep the run-up and the landing strip clear as well as the ramp itself.
    const f = rampFootprint(ramp);
    const fx = Math.sin(ramp.heading), fz = Math.cos(ramp.heading);
    return [f, { x: ramp.x + fx * 16, z: ramp.z + fz * 16, w: Math.abs(fx) * 26 + ramp.width + 4, d: Math.abs(fz) * 26 + ramp.width + 4 },
      { x: ramp.x - fx * 9, z: ramp.z - fz * 9, w: Math.abs(fx) * 12 + ramp.width, d: Math.abs(fz) * 12 + ramp.width }];
  }).flat();
  return (x, z, r) =>
    ROADS.some((road) => circleOverlapsRect(x, z, r, road)) ||
    Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + r + 1 ||
    placeRects.some((rect) => circleOverlapsRect(x, z, r + 2, rect)) ||
    rings.some(([cx, cz]) => Math.hypot(x - cx, z - cz) < RING_RADIUS + r + 2) ||
    rampZones.some((rect) => circleOverlapsRect(x, z, r + 1, rect)) ||
    Math.hypot(x - WELCOME_SIGN.x, z - WELCOME_SIGN.z) < r + 4 ||
    plotDistance(x, z) > -(r + 3);
}

/** Lamp posts along both sides of every road, 18 apart, plus four round the square: [{ x, z, rot }]. */
export function lampSpots(blocked, props) {
  const spots = [];
  const tooClose = (x, z) => props.some((p) => Math.hypot(p.x - x, p.z - z) < 6);
  const off = ROAD_WIDTH / 2 + 1.3;
  for (const road of ROADS) {
    const alongX = road.w >= road.d;
    const len = alongX ? road.w : road.d;
    for (const side of [-1, 1]) {
      for (let s = -len / 2 + 9 + (side > 0 ? 9 : 0); s < len / 2 - 6; s += 18) {
        const x = alongX ? road.x + s : road.x + side * off;
        const z = alongX ? road.z + side * off : road.z + s;
        if (blocked(x, z, 0.4) || tooClose(x, z)) continue;
        // Arm reaches over the road.
        const rot = alongX ? (side > 0 ? Math.PI : 0) : (side > 0 ? -Math.PI / 2 : Math.PI / 2);
        spots.push({ x, z, rot });
        props.push({ x, z });
      }
    }
  }
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const r = PLAZA.r + 1.4;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    spots.push({ x, z, rot: Math.atan2(-x, -z) });
    props.push({ x, z });
  }
  return spots;
}

/**
 * Up to 150 trees scattered over the plot, clear of everything placed so far and mostly off the
 * park's lawn: [{ x, z, s, trunkRot, canopyRot, pine, shade }] (shade picks a green, 0 to 1).
 */
export function treeSpots(rand, blocked, props) {
  const inPark = (x, z) => Math.abs(x - PARK.x) < PARK.w / 2 && Math.abs(z - PARK.z) < PARK.d / 2;
  const near = (x, z, d) => props.some((p) => Math.hypot(p.x - x, p.z - z) < d);
  const out = [];
  let tries = 0;
  while (out.length < 150 && tries++ < 6000) {
    const x = (rand() * 2 - 1) * (PLOT_HALF - 4), z = (rand() * 2 - 1) * (PLOT_HALF - 4); // blocked() keeps them off the rounded edge
    if (blocked(x, z, 1.4) || near(x, z, 4.2)) continue;
    if (inPark(x, z) && rand() < 0.6) continue; // the park stays mostly open lawn
    const s = 0.8 + rand() * 0.6;
    const pine = rand() < 0.35;
    const trunkRot = rand() * 6, canopyRot = rand() * 6, shade = rand();
    out.push({ x, z, s, trunkRot, canopyRot, pine, shade });
    props.push({ x, z });
  }
  return out;
}

/** The breakables' footprints, as world.breakables carries them (without the drawn parts). */
export function breakableFootprints(lamps, trees) {
  return [
    ...lamps.map((s, i) => ({ type: 'circle', x: s.x, z: s.z, r: 0.35, rot: s.rot, kind: 'lamp', lamp: i })),
    ...trees.map((t, i) => ({ type: 'circle', x: t.x, z: t.z, r: 0.45 * t.s + 0.15, s: t.s, rot: 0, kind: 'tree', tree: i })),
  ];
}

/**
 * The whole seeded scatter in the order the game draws it: grass, lamps, trees. Returns the
 * random stream (the rim carries on from it), the spots, and the props list benches avoid.
 */
export function scatter(seed = SEED) {
  const rand = rng(seed);
  const blocked = blockedSpot();
  const props = [];
  const patches = grassPatches(rand);
  const lamps = lampSpots(blocked, props);
  const trees = treeSpots(rand, blocked, props);
  return { rand, blocked, props, patches, lamps, trees, breakables: breakableFootprints(lamps, trees) };
}
