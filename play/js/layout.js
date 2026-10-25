// Pure town layout data: roads, square, ramps, start. Shared by world.js, car.js and the tests.
// The plot is a square of side 2 * PLOT_HALF centred on the origin, its corners rounded off with
// radius PLOT_CORNER so the rim of trees can follow it. +x is east, +z is south.

export const PLOT_HALF = 104;      // invisible boundary for the car
export const PLOT_CORNER = 28;     // corner radius of that boundary
export const ROAD_WIDTH = 10;
export const RING = 70;            // ring road centreline sits at x, z = +-RING

const W = ROAD_WIDTH;
const RING_LEN = RING * 2 + W;
const CROSS_LEN = RING * 2 - W;

// Axis-aligned rects { x, z, w, d }: w along x, d along z.
export const ROADS = [
  { id: 'ring-north', x: 0, z: -RING, w: RING_LEN, d: W },
  { id: 'ring-south', x: 0, z: RING, w: RING_LEN, d: W },
  { id: 'ring-west', x: -RING, z: 0, w: W, d: RING_LEN },
  { id: 'ring-east', x: RING, z: 0, w: W, d: RING_LEN },
  { id: 'high-street', x: 0, z: 0, w: W, d: CROSS_LEN },   // north to south
  { id: 'station-road', x: 0, z: 0, w: CROSS_LEN, d: W },  // west to east
];

export const PLAZA = { x: 0, z: 0, r: 18 };
export const FOUNTAIN = { x: 0, z: 0, r: 4.5 };

// Each ramp climbs along its heading (0 = towards +z) from 0 to `height`.
export const RAMPS = [
  { id: 'park', x: 36, z: 46, width: 6, length: 9, height: 2.2, heading: Math.PI / 2 },
  { id: 'high-street', x: 0, z: -25, width: 6, length: 10, height: 2, heading: Math.PI },
  { id: 'sites', x: 40, z: 88, width: 6, length: 10, height: 2.6, heading: Math.PI / 2 },
];

// Park: open grass in the south-east block, kept clear of trees near the ramp.
export const PARK = { x: 35, z: 46, w: 50, d: 30 };

// The car starts on the east side of the square facing north-east: the welcome sign stands at
// the square's corner, turned to greet it, with the Up Lock gym and its phone beyond.
export const START = { x: 11, z: 6, heading: 2.42 };
export const WELCOME_SIGN = { x: 20, z: -11, rotation: -0.54 };
