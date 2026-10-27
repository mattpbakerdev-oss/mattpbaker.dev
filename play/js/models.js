// The buildings of Mattsville, one builder per `model` in places.js. Each returns an Object3D in
// local space (door on +z, centred on the footprint, ground at y = 0). Every building is merged
// into one vertex-coloured mesh so it costs one draw call (plus one for a painted sign).
// Importing this module registers the builders; do it before buildWorld().
import * as THREE from 'three';
import { MODEL_BUILDERS, mergeColoured, COLOURS } from './world.js';

// A little self-light from each part's own colour keeps the shady sides candy-coloured rather
// than muddy, whichever way a building faces the sun.
const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
mat.onBeforeCompile = (shader) => {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <emissivemap_fragment>',
    '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += vColor.rgb * 0.2;',
  );
};

const C = {
  ...COLOURS,
  coralDark: '#b9533f', lilacDark: '#6c58b0', tealDark: '#3f8f7f', mustardDark: '#c99a30',
  glass: '#34495a', glint: '#9cc9dc', steel: '#c9c9cf', post: '#3d3537',
  red: '#cf3d31', redDark: '#a8302a', skin: '#e9b48f', paper: '#fbf8f2', brown: '#b07a45',
  dirt: '#b88a5a', dirtDark: '#a47a4c', cone: '#f08a3c', concrete: '#c9c4bd', blue: '#3a86c8',
  houseWall: '#f3e7d3', roofTile: '#c75b45', leaf: '#5aa652',
};

// Part helpers: each returns { geo, color } ready for mergeColoured.
const rot = (g, rx = 0, ry = 0, rz = 0) =>
  (rx || ry || rz ? g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz))) : g);
const B = (w, h, d, x, y, z, color, r = {}) => ({ geo: rot(new THREE.BoxGeometry(w, h, d), r.rx, r.ry, r.rz).translate(x, y, z), color });
const Cy = (rt, rb, h, seg, x, y, z, color, r = {}) =>
  ({ geo: rot(new THREE.CylinderGeometry(rt, rb, h, seg), r.rx, r.ry, r.rz).translate(x, y, z), color });
const G = (geo, color) => ({ geo, color });

/** Move, turn and scale a list of parts together (the parts are changed in place). */
function place(parts, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1 } = {}) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(s, s, s),
  );
  for (const p of parts) p.geo.applyMatrix4(m);
  return parts;
}

/** Gable roof: ridge along x, w wide, d deep, h tall, base at y = 0. */
function gable(w, h, d) {
  const [x0, x1, z0, z1] = [-w / 2, w / 2, -d / 2, d / 2];
  const A = [x0, 0, z1], Bp = [x1, 0, z1], E = [x1, 0, z0], F = [x0, 0, z0], Rl = [x0, h, 0], Rr = [x1, h, 0];
  const tris = [A, Bp, Rr, A, Rr, Rl, E, F, Rl, E, Rl, Rr, Bp, E, Rr, F, A, Rl];
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
}

/** A framed window on a +z facing wall at z. */
function windowParts(w, h, x, y, z, frame = C.cream) {
  return [
    B(w + 0.3, h + 0.3, 0.1, x, y, z + 0.02, frame),
    B(w, h, 0.1, x, y, z + 0.07, C.glass),
    B(w * 0.18, h * 0.8, 0.02, x - w * 0.22, y + h * 0.04, z + 0.13, C.glint),
  ];
}

/** Seven-segment digit facing +z, centred on (x, y). */
function digit(ch, x, y, z, h, w, t, color) {
  const on = { 8: 'abcdefg', 9: 'abcdfg', 0: 'abcdef', 1: 'bc' }[ch];
  const half = h / 2;
  const seg = {
    a: [w, t, x, y + half - t / 2], d: [w, t, x, y - half + t / 2], g: [w, t, x, y],
    f: [t, half, x - w / 2 + t / 2, y + half / 2], b: [t, half, x + w / 2 - t / 2, y + half / 2],
    e: [t, half, x - w / 2 + t / 2, y - half / 2], c: [t, half, x + w / 2 - t / 2, y - half / 2],
  };
  return [...on].map((k) => B(seg[k][0], seg[k][1], t * 0.6, seg[k][2], seg[k][3], z, color));
}

function dumbbell(x, y, z, len = 1.7, r = 0.42) {
  return [
    Cy(0.09, 0.09, len, 6, x, y, z, C.steel, { rz: Math.PI / 2 }),
    Cy(r, r, 0.26, 10, x - len * 0.34, y, z, C.ink, { rz: Math.PI / 2 }),
    Cy(r, r, 0.26, 10, x + len * 0.34, y, z, C.ink, { rz: Math.PI / 2 }),
    Cy(r * 0.75, r * 0.75, 0.16, 10, x - len * 0.46, y, z, C.ink, { rz: Math.PI / 2 }),
    Cy(r * 0.75, r * 0.75, 0.16, 10, x + len * 0.46, y, z, C.ink, { rz: Math.PI / 2 }),
  ];
}

function mesh(parts, extra = []) {
  const m = new THREE.Mesh(mergeColoured(parts), mat);
  m.castShadow = m.receiveShadow = true;
  if (!extra.length) return m;
  const g = new THREE.Group();
  g.add(m, ...extra);
  return g;
}

// Up Lock: a coral gym with a giant phone on the roof showing a padlock, dumbbells by the door.
function gym() {
  const p = [];
  const front = 4.8;
  p.push(
    B(16, 0.2, 12, 0, 0.1, 0, C.stone),
    B(15, 6, 10.4, 0, 3.2, -0.4, C.coral),
    B(15.1, 0.6, 10.5, 0, 0.5, -0.4, C.cream),
    B(15.4, 0.6, 10.8, 0, 6.5, -0.4, C.coralDark),
    ...windowParts(4.2, 2.4, -4.6, 2.3, front),
    ...windowParts(4.2, 2.4, 4.6, 2.3, front),
    // Sign band with a dumbbell on it.
    B(8.4, 1.4, 0.35, 0, 5.0, front + 0.15, C.mustard),
    B(3.2, 0.22, 0.1, 0, 5.0, front + 0.36, C.ink),
    B(0.42, 1.0, 0.12, -1.2, 5.0, front + 0.36, C.ink), B(0.42, 1.0, 0.12, 1.2, 5.0, front + 0.36, C.ink),
    B(0.32, 0.7, 0.12, -1.65, 5.0, front + 0.36, C.ink), B(0.32, 0.7, 0.12, 1.65, 5.0, front + 0.36, C.ink),
    // Glass double doors and a canopy.
    B(3.4, 3.4, 0.12, 0, 1.9, front + 0.04, C.cream),
    B(1.45, 3.0, 0.1, -0.78, 1.7, front + 0.1, C.glass), B(1.45, 3.0, 0.1, 0.78, 1.7, front + 0.1, C.glass),
    B(0.08, 0.8, 0.08, -0.16, 1.7, front + 0.2, C.cream), B(0.08, 0.8, 0.08, 0.16, 1.7, front + 0.2, C.cream),
    B(4.6, 0.25, 1.2, 0, 3.75, front + 0.6, C.coralDark),
    // Dumbbell racks either side of the door, and a kettlebell.
    B(2.6, 0.14, 0.9, -4.6, 0.95, 5.4, C.ink), B(2.6, 0.14, 0.9, 4.6, 0.95, 5.4, C.ink),
    ...[-5.7, -3.5, 3.5, 5.7].map((x) => B(0.12, 0.8, 0.8, x, 0.55, 5.4, C.ink)),
    ...dumbbell(-4.6, 1.42, 5.4), ...dumbbell(4.6, 1.42, 5.4),
    ...dumbbell(-2.6, 0.62, 5.5, 1.3, 0.38),
    G(new THREE.IcosahedronGeometry(0.5, 0).translate(2.6, 0.7, 5.5), C.ink),
    G(new THREE.TorusGeometry(0.3, 0.09, 4, 8, Math.PI).translate(2.6, 1.1, 5.5), C.ink),
  );
  // The phone on the roof, leaning back a touch on two struts.
  const phone = [
    B(4.6, 8.4, 0.7, 0, 0, 0, '#232026'),
    B(4.0, 7.6, 0.1, 0, 0, 0.36, '#3fa7c4'),
    B(1.2, 0.3, 0.05, 0, 3.45, 0.43, '#232026'),
    B(1.6, 0.4, 0.05, 0, 2.5, 0.43, C.cream),
    B(2.2, 1.8, 0.3, 0, -0.6, 0.5, C.mustard),
    G(new THREE.TorusGeometry(0.72, 0.2, 6, 12, Math.PI).translate(0, 0.3, 0.5), C.cream),
    Cy(0.22, 0.22, 0.1, 8, 0, -0.4, 0.68, C.ink, { rx: Math.PI / 2 }),
    B(0.16, 0.5, 0.1, 0, -0.75, 0.68, C.ink),
    B(2.8, 0.22, 0.05, 0, -2.3, 0.43, C.cream),
    B(2.6, 0.6, 0.06, 0, -3.0, 0.43, C.coral),
  ];
  p.push(...place(phone, { y: 11.0, z: -1.2, rx: -0.14 }));
  p.push(B(0.3, 4.4, 0.3, -1.5, 8.9, -2.3, C.post), B(0.3, 4.4, 0.3, 1.5, 8.9, -2.3, C.post));
  return mesh(p);
}

// Listing Check: a Bangkok condo tower beside an estate agent's with a "98" clipboard on the roof.
function condo() {
  const p = [];
  const tx = -5.75;
  p.push(B(18, 0.2, 12, 0, 0.1, 0, C.stone));
  p.push(B(6.5, 24, 10, tx, 12.2, -1, C.teal));
  p.push(B(7, 0.6, 10.5, tx, 24.5, -1, C.tealDark));
  p.push(...windowParts(2.4, 2.4, tx, 1.4, 4, C.cream));
  let floor = 0;
  for (let y = 3; y < 23; y += 2.5, floor++) {
    p.push(
      B(6.9, 0.22, 1.0, tx, y, 4.4, C.cream),
      B(5.9, 1.5, 0.1, tx, y + 0.95, 4.02, C.glass),
      B(6.9, 0.5, 0.08, tx, y + 0.36, 4.88, '#d8f0ee'),
      B(0.1, 1.4, 7, -2.47, y + 0.95, -1, C.glass),
      B(0.1, 1.4, 7, -9.03, y + 0.95, -1, C.glass),
      B(0.8, 0.55, 0.45, floor % 2 ? -8.3 : -3.3, y + 0.4, 4.5, '#e6e0d8'),
    );
    if (floor % 3 === 1) p.push(G(new THREE.IcosahedronGeometry(0.42, 0).translate(floor % 2 ? -3.5 : -8.1, y + 0.55, 4.5), C.leaf));
  }
  // Roof: lift housing, water tanks, an aerial.
  p.push(
    B(2.4, 2, 2.4, -4.4, 25.8, 0.4, C.tealDark),
    Cy(0.8, 0.8, 1.6, 8, -7.6, 25.6, -3, C.cream), Cy(0.8, 0.8, 1.6, 8, -5.6, 25.6, -3.6, C.cream),
    B(0.1, 3, 0.1, -8.4, 26.3, 2.2, C.post),
  );
  // Podium with a pool deck behind the agent's office.
  p.push(
    B(11.5, 3, 6, 3.25, 1.7, -3, C.tealDark),
    B(6, 0.14, 3.6, 4, 3.25, -3.2, '#7fd0e0'),
    B(0.7, 0.2, 1.6, 8, 3.3, -3.6, C.cream), B(0.7, 0.2, 1.6, 8.9, 3.3, -3.6, C.cream),
  );
  // The estate agent's: cream shop, striped awning, listing cards in the window.
  p.push(
    B(10, 4, 5.2, 3, 2.2, 2.6, C.cream),
    B(10.2, 0.4, 5.4, 3, 4.3, 2.6, C.mustardDark),
    B(5.4, 2.4, 0.1, 4.6, 1.75, 5.22, C.cream),
    B(5.2, 2.2, 0.1, 4.6, 1.75, 5.25, C.glass),
    B(1.4, 2.6, 0.1, 0.2, 1.5, 5.22, C.teal),
    B(0.1, 0.3, 0.1, 0.7, 1.5, 5.3, C.mustard),
  );
  for (let i = 0; i < 6; i++) {
    const x = 3.2 + (i % 3) * 1.4, y = 2.3 - Math.floor(i / 3) * 1.0;
    p.push(B(1.0, 0.72, 0.04, x, y, 5.33, C.paper), B(1.0, 0.16, 0.05, x, y + 0.28, 5.34, C.coral));
  }
  for (let i = 0; i < 8; i++) p.push(B(1.25, 0.12, 1.2, -1.4 + i * 1.25, 3.6, 5.6, i % 2 ? C.cream : C.coral, { rx: 0.45 }));
  // Clipboard on the roof: score 98 and three ticked lines.
  const clip = [
    B(4.6, 6.0, 0.3, 0, 0, 0, C.brown),
    B(4.0, 5.1, 0.06, 0, -0.25, 0.18, C.paper),
    B(1.8, 0.7, 0.4, 0, 2.9, 0.2, C.steel),
    B(0.8, 0.45, 0.2, 0, 3.35, 0.2, C.steel),
    ...digit('9', -0.8, 1.0, 0.25, 2.2, 1.25, 0.34, C.ink),
    ...digit('8', 0.75, 1.0, 0.25, 2.2, 1.25, 0.34, C.ink),
  ];
  for (let i = 0; i < 3; i++) {
    const y = -0.9 - i * 0.7;
    clip.push(B(0.38, 0.38, 0.05, -1.35, y, 0.24, '#3f9a5a'), B(2.2, 0.16, 0.05, 0.25, y, 0.24, '#b8afac'));
  }
  p.push(...place(clip, { x: 4.8, y: 7.6, z: 3.0, rx: -0.1 }));
  p.push(B(0.25, 3.6, 0.25, 3.2, 6.1, 2.6, C.post), B(0.25, 3.6, 0.25, 6.4, 6.1, 2.6, C.post));
  return mesh(p);
}

// UGC pipeline: a lilac film studio, a vertical video on the roof, clapperboard and ring light.
function studio() {
  const p = [];
  const front = 3.6;
  p.push(
    B(16, 0.2, 12, 0, 0.1, 0, C.stone),
    B(15, 7, 9.6, 0, 3.7, -1.2, C.lilac),
    B(15.1, 0.6, 9.7, 0, 0.5, -1.2, C.post),
    B(15.4, 0.5, 10, 0, 7.4, -1.2, C.lilacDark),
    B(15.1, 0.4, 9.7, 0, 6.2, -1.2, C.mustard),
    // Roller door.
    B(5.6, 5.0, 0.1, -3.4, 2.7, front + 0.02, C.post),
    ...Array.from({ length: 8 }, (_, i) => B(5.2, 0.52, 0.12, -3.4, 0.6 + i * 0.58, front + 0.08, i % 2 ? C.cream : '#e6dfd6')),
    // Side door with an ON AIR light.
    B(1.4, 2.6, 0.1, 3.5, 1.5, front + 0.02, C.ink),
    B(1.9, 0.6, 0.3, 3.5, 3.4, front + 0.12, C.red),
    B(1.3, 0.14, 0.05, 3.5, 3.4, front + 0.3, '#ffd9d0'),
    ...windowParts(4.6, 0.9, 4.6, 5.0, front),
  );
  // The roof screen: a talking head with a title card and captions, as in Matt's videos.
  const screen = [
    B(5.0, 8.9, 0.6, 0, 0, 0, '#232026'),
    B(4.5, 8.3, 0.1, 0, 0, 0.32, '#7cc6e6'),
    B(3.2, 1.8, 0.08, 0, -3.1, 0.38, C.coral),
    B(0.6, 0.6, 0.08, 0, -2.0, 0.38, C.skin),
    B(1.6, 1.9, 0.08, 0, -0.85, 0.39, C.skin),
    B(1.75, 0.6, 0.09, 0, 0.25, 0.4, '#5a3a2a'),
    B(0.18, 0.18, 0.05, -0.38, -0.7, 0.45, C.ink), B(0.18, 0.18, 0.05, 0.38, -0.7, 0.45, C.ink),
    B(0.55, 0.12, 0.05, 0, -1.3, 0.45, C.redDark),
    B(3.5, 0.75, 0.08, 0, -2.45, 0.46, '#ffffff'),
    B(1.0, 0.26, 0.04, -0.95, -2.45, 0.51, C.ink),
    B(1.2, 0.5, 0.04, 0.45, -2.45, 0.51, C.mustard),
    B(3.6, 0.95, 0.08, 0, 3.0, 0.42, C.coral),
    B(2.4, 0.22, 0.04, 0, 3.0, 0.47, C.cream),
    ...[0, 1, 2].map((i) => Cy(0.24, 0.24, 0.06, 8, 1.8, 1.2 - i * 0.75, 0.42, C.cream, { rx: Math.PI / 2 })),
    B(4.3, 0.12, 0.05, 0, -3.95, 0.42, '#ffffff'),
    B(1.6, 0.14, 0.06, -1.35, -3.95, 0.44, C.red),
  ];
  p.push(...place(screen, { y: 12.1, z: -1.6, rx: -0.12 }));
  p.push(B(0.3, 4.4, 0.3, -1.6, 9.8, -3.0, C.post), B(0.3, 4.4, 0.3, 1.6, 9.8, -3.0, C.post));
  // Clapperboard, its striped stick open.
  const stripes = (cx) => Array.from({ length: 5 }, (_, i) => B(0.2, 0.38, 0.27, cx - 1.04 + i * 0.52, 0, 0, C.cream, { rz: -0.45 }));
  const stick = place([B(2.6, 0.42, 0.24, 1.3, 0, 0, C.ink), ...place(stripes(1.3), {})], { x: -1.3, y: 1.48, rz: 0.36 });
  const clap = [
    B(2.6, 2.0, 0.22, 0, 0.0, 0, '#2a2628'),
    B(2.6, 0.42, 0.24, 0, 1.22, 0, C.ink), ...place(stripes(0), { y: 1.22 }),
    ...[0.35, -0.2, -0.7].map((y) => B(2.2, 0.06, 0.02, 0, y, 0.12, C.cream)),
    B(0.04, 1.1, 0.02, 0, -0.2, 0.12, C.cream),
    ...stick,
    B(0.3, 0.3, 0.9, -1.0, -1.1, 0, C.post), B(0.3, 0.3, 0.9, 1.0, -1.1, 0, C.post),
  ];
  p.push(...place(clap, { x: -5.6, y: 1.45, z: 4.9, ry: 0.3, rx: -0.1 }));
  // Ring light on a tripod.
  for (const a of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
    p.push(...place([Cy(0.05, 0.07, 2.1, 5, 0, -1.05, 0, C.post)], { x: 6.2, y: 2.05, z: 4.9, ry: a, rz: 0.35 }));
  }
  p.push(
    Cy(0.07, 0.07, 1.9, 6, 6.2, 2.95, 4.9, C.post),
    G(new THREE.TorusGeometry(1.0, 0.17, 6, 18).translate(6.2, 4.4, 4.9), '#fff6e0'),
    B(0.08, 1.0, 0.08, 6.2, 4.4, 4.9, C.post),
    B(0.5, 0.85, 0.08, 6.2, 4.4, 4.96, C.ink),
  );
  return mesh(p);
}

function tukTuk() {
  const seat = '#c8423b';
  return [
    B(1.7, 0.25, 2.9, 0, 0.55, 0, C.ink),
    B(1.7, 0.7, 1.5, 0, 0.98, -0.65, C.blue),
    B(1.74, 0.14, 1.54, 0, 1.2, -0.65, C.mustard),
    B(1.5, 0.35, 0.6, 0, 1.45, -0.95, seat),
    B(1.5, 0.7, 0.15, 0, 1.8, -1.3, seat),
    B(0.95, 0.9, 1.0, 0, 1.0, 0.95, C.blue),
    B(0.97, 0.14, 1.02, 0, 1.2, 0.95, C.mustard),
    B(1.3, 0.8, 0.06, 0, 1.85, 0.5, '#bfe3f0'),
    B(1.0, 0.08, 0.08, 0, 1.6, 0.72, C.ink),
    B(0.7, 0.2, 0.5, 0, 1.3, 0.15, seat),
    B(1.9, 0.14, 2.7, 0, 2.4, -0.25, C.ink),
    B(1.96, 0.14, 2.76, 0, 2.28, -0.25, C.mustard),
    B(0.08, 1.0, 0.08, -0.82, 1.85, -1.4, C.ink), B(0.08, 1.0, 0.08, 0.82, 1.85, -1.4, C.ink),
    B(0.08, 0.9, 0.08, -0.6, 1.9, 0.5, C.ink), B(0.08, 0.9, 0.08, 0.6, 1.9, 0.5, C.ink),
    Cy(0.36, 0.36, 0.25, 10, -0.92, 0.36, -0.65, C.ink, { rz: Math.PI / 2 }),
    Cy(0.36, 0.36, 0.25, 10, 0.92, 0.36, -0.65, C.ink, { rz: Math.PI / 2 }),
    Cy(0.18, 0.18, 0.27, 8, -0.92, 0.36, -0.65, C.cream, { rz: Math.PI / 2 }),
    Cy(0.18, 0.18, 0.27, 8, 0.92, 0.36, -0.65, C.cream, { rz: Math.PI / 2 }),
    Cy(0.33, 0.33, 0.22, 10, 0, 0.33, 1.25, C.ink, { rz: Math.PI / 2 }),
    Cy(0.15, 0.15, 0.06, 8, 0, 1.15, 1.47, '#fff6d8', { rx: Math.PI / 2 }),
  ];
}

// Matt's house: a small cream cottage, a tuk-tuk on the drive, a graduation cap on the post box.
function house() {
  const p = [];
  const hx = -1.5, hz = -1.65, front = 1.0;
  p.push(
    B(10, 0.12, 9, 0, 0.06, 0, '#8cc46c'),
    B(6.5, 3.4, 5.3, hx, 1.82, hz, C.houseWall),
    B(6.7, 0.4, 5.5, hx, 0.32, hz, '#d8c8b0'),
    G(gable(7.4, 2.6, 6.3).translate(hx, 3.52, hz), C.roofTile),
    B(0.8, 1.9, 0.8, -3.6, 5.0, -2.8, '#b4553f'), B(1.0, 0.2, 1.0, -3.6, 6.0, -2.8, C.post),
    B(1.5, 2.5, 0.08, hx, 1.37, front + 0.02, C.cream),
    B(1.1, 2.2, 0.1, hx, 1.22, front + 0.06, '#3f8f86'),
    Cy(0.07, 0.07, 0.1, 6, hx + 0.38, 1.25, front + 0.14, C.mustard, { rx: Math.PI / 2 }),
    B(1.6, 0.18, 0.7, hx, 0.2, front + 0.35, C.stone),
    B(1.2, 0.04, 3.2, hx, 0.14, 2.8, C.stone),
  );
  for (const wx of [-3.6, 0.6]) {
    p.push(
      ...windowParts(1.2, 1.1, wx, 2.0, front),
      B(0.32, 1.2, 0.08, wx - 0.85, 2.0, front + 0.06, '#3f8f86'), B(0.32, 1.2, 0.08, wx + 0.85, 2.0, front + 0.06, '#3f8f86'),
      B(1.4, 0.3, 0.35, wx, 1.3, front + 0.2, C.coral),
      G(new THREE.IcosahedronGeometry(0.22, 0).translate(wx - 0.4, 1.55, front + 0.2), C.leaf),
      G(new THREE.IcosahedronGeometry(0.22, 0).translate(wx + 0.3, 1.55, front + 0.2), '#e86a8a'),
    );
  }
  // Picket fence along the front, with a gap for the path and the drive.
  for (const [a, b] of [[-4.8, -2.4], [-0.6, 1.6]]) {
    for (let x = a; x <= b + 0.01; x += 0.6) p.push(B(0.14, 0.9, 0.08, x, 0.57, 4.2, C.cream));
    p.push(B(b - a, 0.1, 0.06, (a + b) / 2, 0.45, 4.15, C.cream), B(b - a, 0.1, 0.06, (a + b) / 2, 0.8, 4.15, C.cream));
  }
  p.push(
    G(new THREE.IcosahedronGeometry(0.7, 0).scale(1, 0.8, 1).translate(-4.2, 0.6, 3.2), '#4f9a4a'),
    G(new THREE.IcosahedronGeometry(0.6, 0).scale(1, 0.8, 1).translate(1.2, 0.5, 2.0), '#5aa652'),
    B(3.2, 0.04, 8.6, 3.4, 0.14, 0.1, '#bdb2a6'),
  );
  p.push(...place(tukTuk(), { x: 3.4, y: 0.1, z: 0.6, s: 1.15 }));
  // Post box with a graduation cap on top.
  const box = [
    B(0.16, 1.2, 0.16, 0, 0.6, 0, C.trunk),
    B(0.6, 0.5, 0.85, 0, 1.4, 0, C.red),
    Cy(0.3, 0.3, 0.85, 8, 0, 1.65, 0, C.red, { rx: Math.PI / 2 }),
    B(0.36, 0.06, 0.04, 0, 1.45, 0.44, C.ink),
    B(0.05, 0.4, 0.05, 0.33, 1.75, -0.2, C.mustard),
    B(0.5, 0.24, 0.5, 0, 2.05, 0, '#26222a'),
    B(0.95, 0.07, 0.95, 0, 2.2, 0, '#26222a', { ry: Math.PI / 4 }),
    Cy(0.07, 0.07, 0.06, 6, 0, 2.26, 0, C.mustard),
    B(0.5, 0.03, 0.03, 0.25, 2.25, 0.0, C.mustard),
    B(0.07, 0.4, 0.07, 0.5, 2.05, 0, C.mustard),
  ];
  p.push(...place(box, { x: 0.1, z: 3.5, s: 1.5, ry: -0.35 }));
  return mesh(p);
}

// Post office: a mustard sorting office with a red band, an envelope sign and a pillar box.
function postOffice() {
  const p = [];
  const front = 1.8;
  p.push(
    B(10, 0.2, 8, 0, 0.1, 0, C.stone),
    B(9, 4.2, 5.8, 0, 2.3, -1.1, C.mustard),
    B(9.2, 0.5, 6.0, 0, 0.45, -1.1, C.mustardDark),
    B(9.4, 0.4, 6.2, 0, 4.55, -1.1, C.mustardDark),
    B(9.2, 0.9, 0.3, 0, 3.75, front + 0.12, C.red),
    B(2.3, 3.0, 0.08, 0, 1.6, front + 0.02, C.cream),
    B(1.0, 2.7, 0.1, -0.52, 1.45, front + 0.07, C.red), B(1.0, 2.7, 0.1, 0.52, 1.45, front + 0.07, C.red),
    B(0.6, 1.0, 0.04, -0.52, 1.9, front + 0.14, C.glass), B(0.6, 1.0, 0.04, 0.52, 1.9, front + 0.14, C.glass),
    ...windowParts(2.0, 1.5, -3.0, 1.9, front), ...windowParts(2.0, 1.5, 3.0, 1.9, front),
    B(0.7, 0.5, 0.3, -3.3, 1.4, front - 0.1, '#c89b62'), B(0.5, 0.4, 0.3, -2.6, 1.35, front - 0.1, '#d9ae74'),
  );
  // Envelope sign on the roof.
  const env = [
    B(3.4, 2.2, 0.2, 0, 0, 0, C.paper),
    B(2.05, 0.12, 0.05, -0.85, 0.5, 0.12, '#c8b9a6', { rz: -0.574 }),
    B(2.05, 0.12, 0.05, 0.85, 0.5, 0.12, '#c8b9a6', { rz: 0.574 }),
    Cy(0.3, 0.3, 0.06, 10, 0, 0.0, 0.13, C.red, { rx: Math.PI / 2 }),
    B(0.2, 1.4, 0.2, -1.0, -1.4, -0.1, C.post), B(0.2, 1.4, 0.2, 1.0, -1.4, -0.1, C.post),
  ];
  p.push(...place(env, { y: 6.2, z: 0.4, rx: -0.08 }));
  // Pillar box by the door.
  const pillar = [
    B(1.0, 0.2, 1.0, 0, 0.1, 0, C.ink),
    Cy(0.5, 0.5, 1.7, 12, 0, 1.05, 0, C.red),
    Cy(0.53, 0.53, 0.22, 12, 0, 1.75, 0, C.redDark),
    Cy(0.58, 0.58, 0.14, 12, 0, 1.97, 0, C.red),
    G(new THREE.SphereGeometry(0.55, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 2.04, 0), C.red),
    B(0.55, 0.09, 0.1, 0, 1.6, 0.5, C.ink),
    B(0.4, 0.32, 0.04, 0, 1.2, 0.5, C.cream),
  ];
  p.push(...place(pillar, { x: 3.3, y: 0.2, z: 3.0, s: 1.3 }));
  // Parcels waiting outside.
  p.push(
    B(1.0, 0.8, 0.9, -3.4, 0.6, 3.0, '#c89b62'), B(1.02, 0.12, 0.2, -3.4, 1.0, 3.0, '#e9d6b0'),
    B(0.8, 0.6, 0.7, -3.3, 1.3, 2.9, '#d9ae74', { ry: 0.3 }),
    B(0.7, 0.5, 0.7, -2.3, 0.45, 3.2, '#c89b62', { ry: -0.2 }),
  );
  return mesh(p);
}

let boardMaterial;
function comingSoonMaterial() {
  if (boardMaterial) return boardMaterial;
  const canvas = document.createElement('canvas');
  canvas.width = 704; canvas.height = 400;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = C.coral;
  ctx.fillRect(0, 0, canvas.width, 44);
  ctx.fillStyle = '#2c2526';
  ctx.textAlign = 'center';
  ctx.font = '600 104px Onest, "Segoe UI", Helvetica, Arial, sans-serif';
  ctx.fillText('Coming soon', 352, 210);
  ctx.fillStyle = '#6b5f5c';
  ctx.font = '500 36px Onest, "Segoe UI", Helvetica, Arial, sans-serif';
  ctx.fillText('Something new is being built here.', 352, 300);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  boardMaterial = new THREE.MeshLambertMaterial({ map: tex });
  return boardMaterial;
}

function cone(x, z) {
  return [
    B(0.7, 0.1, 0.7, x, 0.15, z, C.ink),
    G(new THREE.ConeGeometry(0.3, 0.95, 8).translate(x, 0.67, z), C.cone),
    Cy(0.19, 0.23, 0.16, 8, x, 0.6, z, '#ffffff'),
  ];
}

/** A small tower crane on site, top of the mast at about 10 units. */
function crane(mx, mz, cabin) {
  const p = [];
  const top = 10;
  for (let i = 0; i < 6; i++) p.push(B(1.0, 1.5, 1.0, mx, 0.85 + i * 1.6, mz, C.mustard), B(1.06, 0.12, 1.06, mx, 1.6 + i * 1.6, mz, C.ink));
  p.push(B(2.2, 0.4, 2.2, mx, 0.2, mz, C.concrete));
  const jib = [
    B(1.4, 1.3, 1.6, 0.4, 0.3, 1.1, cabin),
    B(1.0, 0.6, 0.06, 0.4, 0.45, 1.92, C.glass),
    B(11, 0.5, 0.6, 5.0, 1.0, 0, C.mustard),
    B(4.4, 0.5, 0.6, -2.2, 1.0, 0, C.mustard),
    B(1.6, 1.4, 1.0, -3.8, 0.4, 0, '#9a9396'),
    B(0.3, 2.6, 0.3, 0, 2.3, 0, C.mustard),
    B(9.0, 0.08, 0.08, 4.3, 2.3, 0, C.ink, { rz: -0.27 }),
    B(4.6, 0.08, 0.08, -1.9, 2.3, 0, C.ink, { rz: 0.52 }),
    B(0.06, 4.2, 0.06, 8, -1.4, 0, C.ink),
    B(0.5, 0.5, 0.5, 8, -3.6, 0, C.coral),
    B(3, 0.35, 0.35, 8, -4.1, 0, C.red, { ry: 0.5 }),
  ];
  p.push(...place(jib, { x: mx, y: top, z: mz, ry: 2.6 }));
  return p;
}

/** A small yellow digger, arm down towards the spoil heap (local +x). */
function digger(cabin) {
  const p = [
    B(0.7, 0.7, 3.0, 0, 0.4, -1.0, C.ink), B(0.7, 0.7, 3.0, 0, 0.4, 1.0, C.ink),   // tracks
    ...[-1.1, 0, 1.1].flatMap((x) => [Cy(0.28, 0.28, 0.72, 8, x, 0.4, -1.0, '#5a5052', { rx: Math.PI / 2 }), Cy(0.28, 0.28, 0.72, 8, x, 0.4, 1.0, '#5a5052', { rx: Math.PI / 2 })]),
    B(2.6, 0.9, 2.4, -0.2, 1.25, 0, C.mustard),                                     // body
    B(1.0, 0.8, 2.2, -1.25, 1.35, 0, C.mustardDark),                                // counterweight
    B(1.3, 1.3, 1.1, 0.3, 2.35, -0.55, cabin),                                      // cab
    B(1.0, 0.8, 0.06, 0.3, 2.45, 0.02, C.glass), B(0.06, 0.8, 0.8, 0.96, 2.45, -0.55, C.glass),
    B(1.4, 0.1, 1.2, 0.3, 3.05, -0.55, C.cream),
  ];
  // Boom up and out, stick down, bucket.
  p.push(...place([B(3.2, 0.42, 0.42, 1.6, 0, 0, C.mustard)], { x: 0.9, y: 1.7, z: 0.45, rz: 0.55 }));
  p.push(...place([B(2.4, 0.36, 0.36, 1.2, 0, 0, C.mustard)], { x: 3.6, y: 3.4, z: 0.45, rz: -1.15 }));
  p.push(...place([B(0.9, 0.7, 0.9, 0, 0, 0, C.ink), B(0.1, 0.18, 0.9, 0.45, -0.4, 0, C.steel)], { x: 4.55, y: 1.1, z: 0.45, rz: 0.4 }));
  return p;
}

/** Stacked pallets, a pile of bricks and a huddle of cones, waiting for the builders. */
function pallets(mx, mz) {
  const p = [];
  const pallet = (x, y, z, ry = 0) => place([
    B(1.3, 0.08, 1.1, 0, 0.2, 0, '#c99258'),
    ...[-0.5, 0, 0.5].map((dx) => B(0.14, 0.14, 1.1, dx, 0.08, 0, C.brown)),
  ], { x, y, z, ry });
  for (let i = 0; i < 4; i++) p.push(...pallet(mx, i * 0.26, mz, i * 0.12));
  for (let i = 0; i < 2; i++) p.push(...pallet(mx + 1.6, i * 0.26, mz + 0.4, 0.4 + i * 0.1));
  // Bricks on the top pallet.
  for (let i = 0; i < 6; i++) p.push(B(0.5, 0.22, 0.24, mx - 0.3 + (i % 2) * 0.55, 1.15 + Math.floor(i / 2) * 0.23, mz - 0.1 + (i % 3) * 0.05, '#b4553f'));
  for (const [x, z] of [[-1.4, 1.2], [-0.6, 1.6], [0.3, 1.5], [-1.0, 2.2], [1.1, 1.9]]) p.push(...cone(mx + x, mz + z));
  return p;
}

// Building sites: a dirt plot inside striped barriers, one crane or a digger or pallets, cones
// and a "Coming soon" board.
const SITE_LOOK = [
  { cabin: C.teal },
  { cabin: C.lilac },
  { cabin: C.coral },
];
function site(place_) {
  const idx = Math.max(0, Number(String(place_.id).split('-').pop()) - 1) % SITE_LOOK.length;
  const look = SITE_LOOK[idx];
  const p = [];
  p.push(
    B(17.6, 0.1, 13.6, 0, 0.05, 0, C.dirt),
    G(new THREE.CircleGeometry(2.6, 7).rotateX(-Math.PI / 2).translate(2, 0.11, -1), C.dirtDark),
  );
  // Striped barriers round the edge, with a gate in the front.
  const rail = (x, z, len, alongX, i) => {
    const col = i % 2 ? C.coral : C.cream;
    const [w, d] = alongX ? [len, 0.08] : [0.08, len];
    return [B(w, 0.2, d, x, 0.6, z, col), B(w, 0.2, d, x, 1.1, z, col)];
  };
  const fenceRun = (x0, x1, z0, z1) => {
    const alongX = z0 === z1;
    const len = alongX ? x1 - x0 : z1 - z0;
    const n = Math.max(1, Math.round(len / 2));
    const seg = len / n;
    for (let i = 0; i < n; i++) {
      const cx = alongX ? x0 + seg * (i + 0.5) : x0, cz = alongX ? z0 : z0 + seg * (i + 0.5);
      p.push(...rail(cx, cz, seg - 0.1, alongX, i));
    }
    for (let i = 0; i <= n; i++) {
      const px = alongX ? x0 + seg * i : x0, pz = alongX ? z0 : z0 + seg * i;
      p.push(B(0.14, 1.4, 0.14, px, 0.75, pz, '#5a5052'), B(0.5, 0.18, 0.5, px, 0.12, pz, '#7a7072'));
    }
  };
  fenceRun(-8.6, 8.6, -6.6, -6.6);
  fenceRun(-8.6, -8.6, -6.6, 6.6);
  fenceRun(8.6, 8.6, -6.6, 6.6);
  fenceRun(-8.6, -2.2, 6.6, 6.6);
  fenceRun(2.2, 8.6, 6.6, 6.6);
  for (const x of [-1.5, -0.5, 0.5, 1.5]) p.push(...cone(x, 6.5));
  p.push(...cone(-6.5, 2.5), ...cone(6.8, -1.0));
  // "Coming soon" board frame (the painted face is its own mesh).
  p.push(
    B(0.22, 3.8, 0.22, 2.6, 1.9, 6.1, C.trunk), B(0.22, 3.8, 0.22, 6.6, 1.9, 6.1, C.trunk),
    B(4.7, 2.8, 0.16, 4.6, 2.55, 6.15, C.mustard),
  );
  // One plot gets a small tower crane (kept low so it doesn't rule the skyline); the others a
  // digger or a pile of pallets and cones.
  const mx = -5.4, mz = -3.6;
  if (idx === 1) p.push(...crane(mx, mz, look.cabin));
  else if (idx === 0) p.push(...place(digger(look.cabin), { x: mx + 0.6, z: mz + 0.4, ry: 0.7 }));
  else p.push(...pallets(mx, mz));
  // Site cabin.
  p.push(
    B(4.2, 2.4, 2.2, 5.2, 1.3, -4.8, look.cabin),
    B(4.4, 0.15, 2.4, 5.2, 2.55, -4.8, C.cream),
    ...windowParts(1.2, 0.8, 4.4, 1.6, -3.7),
    B(0.9, 1.9, 0.08, 6.4, 1.05, -3.67, C.ink),
  );
  // Each plot is at a different stage.
  if (idx === 0) {
    p.push(B(6, 0.4, 5, 2, 0.25, 1.5, C.concrete));
    for (let i = 0; i < 9; i++) p.push(B(0.07, 1.3, 0.07, -0.5 + (i % 3) * 2.5, 1.1, -0.5 + Math.floor(i / 3) * 2, C.post));
  } else if (idx === 1) {
    p.push(B(6, 0.4, 5, 2, 0.25, 1.5, C.concrete));
    for (const [x, z] of [[-0.6, -0.6], [4.6, -0.6], [-0.6, 3.6], [4.6, 3.6]]) p.push(B(0.45, 3.4, 0.45, x, 2.1, z, C.concrete));
    p.push(B(5.7, 0.4, 0.45, 2, 3.8, -0.6, C.concrete), B(5.7, 0.4, 0.45, 2, 3.8, 3.6, C.concrete));
    p.push(B(0.45, 0.4, 4.6, -0.6, 3.8, 1.5, C.concrete), B(0.45, 0.4, 4.6, 4.6, 3.8, 1.5, C.concrete));
  } else {
    p.push(G(new THREE.IcosahedronGeometry(1.8, 0).scale(1.2, 0.5, 1).translate(1.0, 0.4, 1.0), C.dirtDark));
    for (let i = 0; i < 3; i++) p.push(Cy(0.4, 0.4, 3.2, 8, 4.5, 0.5 + (i === 2 ? 0.7 : 0), 2.0 + (i % 2) * 0.8 + (i === 2 ? 0.4 : 0), C.concrete, { rx: Math.PI / 2 }));
  }
  p.push(B(1.2, 0.7, 1.0, 6.6, 0.45, 2.0, '#c06a4a'), G(new THREE.IcosahedronGeometry(1.4, 0).scale(1, 0.5, 1).translate(-5.0, 0.3, 3.4), C.dirtDark));

  const face = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.5), comingSoonMaterial());
  face.position.set(4.6, 2.55, 6.24);
  return mesh(p, [face]);
}

// Father Christmas Video: a snowy timber grotto, warm lit windows, a green door with a wreath,
// a gold star on the ridge, a green and gold sleigh and presents out front, a snowy fir.
const G_GREEN = '#24614a', G_GREEN_DARK = '#1b4a38', G_GOLD = '#e2b347', SNOW = '#f6f8fb';
const SNOW_PAD = '#dbe5ec', TIMBER = '#9a6a43', TIMBER_DARK = '#6b4429', GLOW = '#ffcf6a', STONE_G = '#b8ab98';

/** A lit cottage window on a +z facing wall at z: green frame, warm glass, gold sill. */
function litWindow(w, h, x, y, z) {
  return [
    B(w + 0.34, h + 0.34, 0.12, x, y, z + 0.02, G_GREEN),
    B(w, h, 0.1, x, y, z + 0.08, GLOW),
    B(0.1, h, 0.06, x, y, z + 0.15, TIMBER_DARK), B(w, 0.1, 0.06, x, y, z + 0.15, TIMBER_DARK),
    B(w + 0.6, 0.16, 0.4, x, y - h / 2 - 0.2, z + 0.2, G_GOLD),
    B(w + 0.5, 0.12, 0.34, x, y - h / 2 - 0.06, z + 0.2, SNOW),
  ];
}

/** A flat five-pointed star facing +z, centred on the origin. */
function starGeo(r, depth) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
    i ? shape.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : shape.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }).translate(0, 0, -depth / 2);
}

/** A wrapped present: box plus a ribbon cross over the top and down the sides. */
function present(w, h, d, x, z, color, ribbon, ry = 0) {
  return place([
    B(w, h, d, 0, h / 2, 0, color),
    B(w + 0.04, h + 0.02, 0.14, 0, h / 2, 0, ribbon), B(0.14, h + 0.02, d + 0.04, 0, h / 2, 0, ribbon),
    B(0.32, 0.14, 0.14, -0.1, h + 0.06, 0, ribbon, { rz: 0.5 }), B(0.32, 0.14, 0.14, 0.1, h + 0.06, 0, ribbon, { rz: -0.5 }),
  ], { x, y: 0.12, z, ry });
}

function grotto() {
  const p = [];
  const cx = -1.5, cz = -2, W = 10, D = 7, wallTop = 4.0, front = cz + D / 2;
  p.push(
    // Snowy ground with a stone path to the door.
    B(17.6, 0.12, 13.6, 0, 0.06, 0, SNOW_PAD),
    G(new THREE.CircleGeometry(4.2, 9).rotateX(-Math.PI / 2).scale(1.4, 1, 1).translate(-4.5, 0.13, 4.2), SNOW),
    G(new THREE.CircleGeometry(3.2, 8).rotateX(-Math.PI / 2).scale(1.3, 1, 1).translate(5.4, 0.13, -3.8), SNOW),
    ...[2.4, 3.6, 4.8, 6.0].map((z, i) => B(1.3, 0.08, 0.8, cx + (i % 2 ? 0.12 : -0.12), 0.15, z, STONE_G)),
    // Stone footing, timber walls, dark corner posts.
    B(W, 1.1, D, cx, 0.65, cz, STONE_G),
    B(W - 0.2, 2.9, D - 0.2, cx, 2.55, cz, TIMBER),
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => B(0.4, 2.9, 0.4, cx + sx * (W / 2 - 0.15), 2.55, cz + sz * (D / 2 - 0.15), TIMBER_DARK)),
    ...[1.55, 2.25, 2.95, 3.65].map((y) => B(W - 0.6, 0.07, 0.06, cx, y, front - 0.07, TIMBER_DARK)),
    // Gable ends in timber under the roof.
    G(gable(W - 0.2, 3.2, D - 0.2).translate(cx, wallTop, cz), TIMBER),
  );
  // Roof: two green slopes with snow on top, icicles along the front eave.
  const run = D / 2 + 0.7, rise = 3.2, a = Math.atan2(rise, run), len = Math.hypot(run, rise) + 0.2;
  for (const side of [1, -1]) {
    const zc = cz + side * run / 2, yc = wallTop + rise / 2;
    p.push(B(W + 1.4, 0.32, len, cx, yc + 0.12, zc, G_GREEN_DARK, { rx: side * a }));
    // Snow stops short of the eave, so a band of green roof shows along the bottom edge.
    const up = 0.45;
    p.push(B(W + 1.2, 0.3, len - 0.9, cx, yc + 0.12 + Math.cos(a) * 0.28 + Math.sin(a) * up, zc + side * (Math.sin(a) * 0.28 - Math.cos(a) * up), SNOW, { rx: side * a }));
    p.push(B(W + 1.5, 0.3, 0.16, cx, wallTop - 0.02, cz + side * (run + 0.05), G_GOLD));
  }
  p.push(B(W + 1.3, 0.3, 0.5, cx, wallTop + rise + 0.32, cz, SNOW));
  for (let i = 0; i < 9; i++) {
    const x = cx - W / 2 + 0.2 + i * ((W + 0.6) / 8), h = 0.35 + ((i * 37) % 5) * 0.08;
    p.push(G(new THREE.ConeGeometry(0.09, h, 4).rotateX(Math.PI).translate(x, wallTop - 0.05 - h / 2 + 0.02, cz + run - 0.05), '#dff3ff'));
  }
  // Chimney through the back slope, snow on its cap.
  p.push(
    B(1.2, 3.6, 1.2, 1.6, 6.4, cz - 1.7, STONE_G),
    B(1.45, 0.3, 1.45, 1.6, 8.3, cz - 1.7, '#8e8272'),
    B(1.5, 0.25, 1.5, 1.6, 8.55, cz - 1.7, SNOW),
  );
  // Gold star on the ridge above the door.
  p.push(G(starGeo(0.85, 0.22).translate(cx, wallTop + rise + 1.25, cz), G_GOLD));
  p.push(B(0.16, 0.6, 0.16, cx, wallTop + rise + 0.55, cz, G_GOLD));
  // Green door with a gold frame, a wreath with a red bow, and a lantern either side.
  p.push(
    B(1.9, 2.95, 0.12, cx, 1.6, front + 0.02, G_GOLD),
    B(1.55, 2.7, 0.12, cx, 1.48, front + 0.07, G_GREEN),
    B(0.08, 2.4, 0.04, cx, 1.48, front + 0.14, G_GREEN_DARK),
    Cy(0.08, 0.08, 0.1, 6, cx + 0.5, 1.4, front + 0.16, G_GOLD, { rx: Math.PI / 2 }),
    G(new THREE.TorusGeometry(0.42, 0.15, 5, 10).translate(cx, 2.15, front + 0.22), '#2f7a3f'),
    B(0.36, 0.2, 0.08, cx, 1.78, front + 0.34, '#c8423b'),
    B(0.1, 0.34, 0.06, cx - 0.1, 1.6, front + 0.34, '#c8423b', { rz: 0.3 }), B(0.1, 0.34, 0.06, cx + 0.1, 1.6, front + 0.34, '#c8423b', { rz: -0.3 }),
    ...[-0.32, 0.3, 0.05].map((dx, i) => G(new THREE.IcosahedronGeometry(0.07, 0).translate(cx + dx, 2.42 - i * 0.12, front + 0.36), G_GOLD)),
    B(1.9, 0.18, 0.9, cx, 0.2, front + 0.45, STONE_G),
  );
  for (const sx of [-1, 1]) {
    const lx = cx + sx * 1.35;
    p.push(B(0.42, 0.5, 0.42, lx, 2.85, front + 0.3, G_GOLD), B(0.3, 0.36, 0.44, lx, 2.85, front + 0.3, GLOW), B(0.5, 0.1, 0.5, lx, 3.14, front + 0.3, TIMBER_DARK));
  }
  p.push(...litWindow(1.8, 1.4, cx - 3.1, 2.45, front), ...litWindow(1.8, 1.4, cx + 3.1, 2.45, front));
  // A lit round window in each gable end.
  for (const sx of [-1, 1]) {
    p.push(
      Cy(0.6, 0.6, 0.12, 10, cx + sx * (W / 2 - 0.02), 5.0, cz, G_GREEN, { rz: Math.PI / 2 }),
      Cy(0.46, 0.46, 0.14, 10, cx + sx * (W / 2 + 0.02), 5.0, cz, GLOW, { rz: Math.PI / 2 }),
    );
  }
  // Presents by the door.
  p.push(
    ...present(0.9, 0.7, 0.9, cx - 2.0, front + 1.3, '#c8423b', G_GOLD, 0.3),
    ...present(0.7, 0.55, 0.7, cx - 2.9, front + 1.7, '#fbf3df', G_GREEN, -0.2),
    ...present(0.6, 0.9, 0.6, cx - 2.2, front + 2.2, G_GREEN, G_GOLD, 0.6),
    ...present(0.55, 0.45, 0.55, cx + 1.7, front + 1.4, G_GOLD, '#c8423b', -0.4),
  );
  // Green and gold sleigh, a sack and presents aboard.
  const runner = (x) => [
    B(0.12, 0.12, 3.6, x, 0.12, 0, G_GOLD),
    G(new THREE.TorusGeometry(0.45, 0.07, 4, 10, Math.PI).rotateY(Math.PI / 2).translate(x, 0.57, 1.8), G_GOLD),
    B(0.08, 0.45, 0.08, x, 0.38, -1.1, G_GOLD), B(0.08, 0.45, 0.08, x, 0.38, 0.9, G_GOLD),
  ];
  const sleigh = [
    ...runner(-0.7), ...runner(0.7),
    B(1.7, 0.8, 2.6, 0, 1.0, -0.2, G_GREEN),
    B(1.74, 0.12, 2.64, 0, 1.42, -0.2, G_GOLD),
    B(1.7, 1.1, 0.3, 0, 1.75, -1.4, G_GREEN), B(1.74, 0.12, 0.34, 0, 2.32, -1.4, G_GOLD),
    B(1.7, 1.0, 0.3, 0, 1.3, 1.15, G_GREEN, { rx: -0.35 }),
    B(1.3, 0.25, 0.9, 0, 1.5, -0.8, '#c8423b'),
    ...present(0.8, 0.7, 0.7, -0.25, -0.75, '#c8423b', G_GOLD, 0.2).map((q) => ({ ...q, geo: q.geo.translate(0, 1.55, 0) })),
    ...present(0.55, 0.5, 0.55, -0.2, -0.75, G_GOLD, G_GREEN, -0.3).map((q) => ({ ...q, geo: q.geo.translate(0, 2.27, 0) })),
    ...present(0.6, 0.5, 0.6, 0.3, 0.3, '#fbf3df', '#c8423b', 0.4).map((q) => ({ ...q, geo: q.geo.translate(0, 1.32, 0) })),
  ];
  p.push(...place(sleigh, { x: 5.6, z: 3.6, ry: -0.5 }));
  // A snowy fir with a gold star and baubles.
  const fx = 6.4, fz = -3.6;
  p.push(Cy(0.25, 0.3, 1.0, 6, fx, 0.6, fz, TIMBER_DARK));
  [[2.0, 1.7, 1.9], [1.6, 1.5, 3.1], [1.1, 1.3, 4.2]].forEach(([r, h, y], i) => {
    p.push(G(new THREE.ConeGeometry(r, h, 7).translate(fx, y, fz), i % 2 ? '#2f7a4a' : '#286a42'));
    p.push(G(new THREE.ConeGeometry(r * 0.55, h * 0.4, 7).translate(fx, y + h * 0.32, fz), SNOW));
  });
  p.push(G(starGeo(0.4, 0.14).translate(fx, 5.25, fz), G_GOLD));
  for (const [dx, y, dz, c] of [[1.1, 1.6, 1.0, G_GOLD], [-1.2, 1.7, 0.8, '#c8423b'], [0.8, 2.8, 0.9, '#c8423b'], [-0.6, 3.0, 1.0, G_GOLD], [0.2, 3.9, 0.75, G_GOLD]]) {
    p.push(G(new THREE.IcosahedronGeometry(0.16, 0).translate(fx + dx, y, fz + dz), c));
  }
  // Snow drifts against the walls.
  p.push(
    G(new THREE.IcosahedronGeometry(0.9, 0).scale(1.8, 0.45, 0.9).translate(cx - 3.6, 0.2, front + 0.5), SNOW),
    G(new THREE.IcosahedronGeometry(0.8, 0).scale(1.6, 0.4, 0.9).translate(cx + 3.8, 0.2, front + 0.45), SNOW),
  );
  return mesh(p);
}

Object.assign(MODEL_BUILDERS, { gym, condo, studio, house, 'post-office': postOffice, site, grotto });
