// The town: sky, terrain, roads, square, ramps, trees, benches and the rim, built from
// layout.js and places.js (the buildings themselves come from models.js). Repeated props are instanced and static parts merged to keep draw
// calls low. Every solid thing registers a collider in `colliders` (see physics.js shapes).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PLOT_HALF, PLOT_CORNER, ROADS, PLAZA, FOUNTAIN, RAMPS, PARK, START, WELCOME_SIGN, ROAD_WIDTH } from './layout.js';
import { PLACES, RING_RADIUS, ringCentre, footprintRect } from './places.js';
import { groundHeight, circleOverlapsRect, rectsOverlap, rampFootprint, plotDistance } from './physics.js';
import { rimTrees, rimHills } from './rim.js';
import { TOWNSFOLK } from './walkers.js';

export const COLOURS = {
  skyTop: '#9fd3ff', skyMid: '#cfe8fb', horizon: '#ffd9b0',
  grass: '#7cb860', grassDark: '#5f9a48',
  road: '#4a4547', line: '#f5f1ee', kerb: '#d8d0c8',
  coral: '#e8735a', mustard: '#f2c14e', teal: '#5bb5a2', lilac: '#8f7ad8', cream: '#f5f1ee',
  stone: '#dccbb4', stoneDark: '#c9b496', trunk: '#8a5a3b', ink: '#2c2526',
};

/** Builders for each place model: (place) => Object3D in local space, door facing +z. */
export const MODEL_BUILDERS = {};

export const material = (opts = {}) => new THREE.MeshLambertMaterial({ flatShading: true, ...opts });
const shade = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

/** Merge [{ geo, color }] into one non-indexed geometry with vertex colours. */
export function mergeColoured(parts) {
  const geos = parts.map(({ geo, color }) => {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  });
  const merged = mergeGeometries(geos);
  merged.computeVertexNormals();
  return merged;
}

export function box(w, h, d, x = 0, y = 0, z = 0, rotY = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rotY) g.rotateY(rotY);
  return g.translate(x, y, z);
}

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildWorld(scene) {
  const colliders = [];
  const updaters = [];
  const vertexMat = material({ vertexColors: true });

  // Sky dome and fog share the horizon colour so the edge melts away.
  scene.fog = new THREE.Fog(COLOURS.horizon, 80, 250);
  scene.background = new THREE.Color(COLOURS.horizon);
  // Three stops mixed in sRGB (so the warm horizon doesn't grey the blue): horizon, a pale
  // blue at about 7 degrees up, full sky blue from about 20 degrees.
  const srgb = (hex) => new THREE.Vector3(...['1', '3', '5'].map((i) => parseInt(hex.slice(+i, +i + 2), 16) / 255));
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(500, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: srgb(COLOURS.skyTop) }, mid: { value: srgb(COLOURS.skyMid) }, bottom: { value: srgb(COLOURS.horizon) } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      // Writes sRGB directly (no colorspace include): the stops are already sRGB.
      fragmentShader: [
        'uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vDir;',
        'void main(){',
        '  float y = clamp(normalize(vDir).y, 0.0, 1.0);',
        '  vec3 c = mix(bottom, mid, smoothstep(0.0, 0.12, y));',
        '  c = mix(c, top, smoothstep(0.12, 0.35, y));',
        '  gl_FragColor = vec4(c, 1.0);',
        '}',
      ].join('\n'),
    }),
  );
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);
  updaters.push((dt, focus, camera) => sky.position.copy(camera.position));

  // Lights: soft sky fill plus one warm late-afternoon sun whose shadow box follows the car.
  scene.add(new THREE.HemisphereLight('#d6ecff', '#6f9a52', 1.5));
  const sun = new THREE.DirectionalLight('#ffe7c4', 2.4);
  const sunOffset = new THREE.Vector3(-40, 70, -45); // from the north-west, so the welcome sign faces the light
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 200 });
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const texel = 80 / 1024;
  updaters.push((dt, focus) => {
    // Snap to shadow texels so edges don't shimmer as the car moves.
    const x = Math.round(focus.x / texel) * texel, z = Math.round(focus.z / texel) * texel;
    sun.target.position.set(x, 0, z);
    sun.position.set(x + sunOffset.x, sunOffset.y, z + sunOffset.z);
  });

  const rand = rng(20261025);
  const onAnyRoad = (x, z, r) => ROADS.some((road) => circleOverlapsRect(x, z, r, road));
  const placeRects = PLACES.map((p) => footprintRect(p));
  const rings = PLACES.map((p) => ringCentre(p));
  const rampZones = RAMPS.map((ramp) => {
    // Keep the run-up and the landing strip clear as well as the ramp itself.
    const f = rampFootprint(ramp);
    const fx = Math.sin(ramp.heading), fz = Math.cos(ramp.heading);
    return [f, { x: ramp.x + fx * 16, z: ramp.z + fz * 16, w: Math.abs(fx) * 26 + ramp.width + 4, d: Math.abs(fz) * 26 + ramp.width + 4 },
      { x: ramp.x - fx * 9, z: ramp.z - fz * 9, w: Math.abs(fx) * 12 + ramp.width, d: Math.abs(fz) * 12 + ramp.width }];
  }).flat();
  const blocked = (x, z, r) =>
    onAnyRoad(x, z, r) ||
    Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + r + 1 ||
    placeRects.some((rect) => circleOverlapsRect(x, z, r + 2, rect)) ||
    rings.some(([cx, cz]) => Math.hypot(x - cx, z - cz) < RING_RADIUS + r + 2) ||
    rampZones.some((rect) => circleOverlapsRect(x, z, r + 1, rect)) ||
    Math.hypot(x - WELCOME_SIGN.x, z - WELCOME_SIGN.z) < r + 4 ||
    plotDistance(x, z) > -(r + 3);

  buildGround(scene, rand, vertexMat);
  buildRoads(scene, vertexMat);
  buildPlaza(scene, colliders, updaters, vertexMat);
  buildRamps(scene, vertexMat);
  buildPlaces(scene, colliders);
  const props = [];
  buildLampPosts(scene, colliders, blocked, props);
  const trees = buildTrees(scene, colliders, rand, blocked, props);
  buildBenches(scene, colliders, props);
  buildRim(scene, rand, vertexMat);

  return {
    colliders,
    ramps: RAMPS,
    roads: ROADS,
    places: PLACES,
    plotHalf: PLOT_HALF,
    plotCorner: PLOT_CORNER,
    start: START,
    sun,
    /** Per tree (collider `tree` index): its instanced parts, [{ mesh, index }], for fading. */
    trees,
    groundHeightAt: (x, z) => groundHeight(x, z, RAMPS),
    /** Call once per frame with the point the shadows should centre on. */
    update(dt, focus, camera) { for (const fn of updaters) fn(dt, focus, camera); },
  };
}

function buildGround(scene, rand, mat) {
  const grass = new THREE.Mesh(new THREE.CircleGeometry(520, 48).rotateX(-Math.PI / 2), material({ color: COLOURS.grass }));
  grass.receiveShadow = true;
  scene.add(grass);

  // Darker mown patches for texture, kept off the roads.
  const parts = [];
  for (let i = 0; i < 70; i++) {
    const x = (rand() * 2 - 1) * 110, z = (rand() * 2 - 1) * 110, r = 3 + rand() * 8;
    if (ROADS.some((road) => circleOverlapsRect(x, z, r, road)) || Math.hypot(x, z) < PLAZA.r + r) continue;
    const g = new THREE.CircleGeometry(r, 7).rotateX(-Math.PI / 2).rotateY(rand() * 6).scale(1, 1, 0.6 + rand() * 0.4);
    parts.push({ geo: g.translate(x, 0.01, z), color: COLOURS.grassDark });
  }
  const patches = new THREE.Mesh(mergeColoured(parts), mat);
  patches.receiveShadow = true;
  scene.add(patches);
}

function buildRoads(scene, mat) {
  const surface = ROADS.map((r) => ({ geo: new THREE.PlaneGeometry(r.w, r.d).rotateX(-Math.PI / 2).translate(r.x, 0.03, r.z), color: COLOURS.road }));
  const roads = new THREE.Mesh(mergeColoured(surface), mat);
  roads.receiveShadow = true;
  scene.add(roads);

  const others = (road) => ROADS.filter((o) => o !== road);
  const inPlaza = (x, z, pad) => Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + pad;

  // Kerbs: short segments along both edges, dropped where another road meets this one.
  const kerbs = [];
  const SEG = 2;
  for (const road of ROADS) {
    const alongX = road.w >= road.d;
    const len = alongX ? road.w : road.d;
    const half = (alongX ? road.d : road.w) / 2 + 0.25;
    for (const side of [-1, 1]) {
      for (let s = -len / 2 + SEG / 2; s < len / 2; s += SEG) {
        const x = alongX ? road.x + s : road.x + side * half;
        const z = alongX ? road.z + side * half : road.z + s;
        const rect = alongX ? { x, z, w: SEG, d: 0.5 } : { x, z, w: 0.5, d: SEG };
        if (others(road).some((o) => rectsOverlap(rect, o)) || inPlaza(x, z, 1.2)) continue;
        kerbs.push({ x, z, rot: alongX ? 0 : Math.PI / 2 });
      }
    }
  }
  // Round kerb around the square, with gaps for the streets.
  const ringR = PLAZA.r + 0.25;
  const steps = Math.round((Math.PI * 2 * ringR) / SEG);
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const x = PLAZA.x + Math.cos(a) * ringR, z = PLAZA.z + Math.sin(a) * ringR;
    if (ROADS.some((road) => circleOverlapsRect(x, z, 0.9, road))) continue;
    kerbs.push({ x, z, rot: -a + Math.PI / 2 });
  }
  const kerbMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(SEG * 0.98, 0.22, 0.5), material(), kerbs.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const light = new THREE.Color(COLOURS.kerb), dark = shade(COLOURS.kerb, 0.86);
  kerbs.forEach((k, i) => {
    q.setFromAxisAngle(up, k.rot);
    m.compose(new THREE.Vector3(k.x, 0.11, k.z), q, new THREE.Vector3(1, 1, 1));
    kerbMesh.setMatrixAt(i, m);
    kerbMesh.setColorAt(i, i % 2 ? light : dark);
  });
  kerbMesh.receiveShadow = true;
  scene.add(kerbMesh);

  // Dashed centre lines.
  const dashes = [];
  for (const road of ROADS) {
    const alongX = road.w >= road.d;
    const len = alongX ? road.w : road.d;
    for (let s = -len / 2 + 2.5; s < len / 2 - 1; s += 5) {
      const x = alongX ? road.x + s : road.x, z = alongX ? road.z : road.z + s;
      const rect = alongX ? { x, z, w: 2.4, d: ROAD_WIDTH * 0.2 } : { x, z, w: ROAD_WIDTH * 0.2, d: 2.4 };
      // Break the line where a perpendicular road crosses this one.
      const perpendicular = others(road).filter((o) => (o.w >= o.d) !== alongX);
      const crosses = perpendicular.some((o) => rectsOverlap(rect, { ...o, w: o.w + 1, d: o.d + 1 }));
      if (crosses || inPlaza(x, z, 1)) continue;
      dashes.push(new THREE.PlaneGeometry(alongX ? 2.4 : 0.28, alongX ? 0.28 : 2.4).rotateX(-Math.PI / 2).translate(x, 0.05, z));
    }
  }
  const lines = new THREE.Mesh(mergeGeometries(dashes), new THREE.MeshLambertMaterial({ color: COLOURS.line }));
  lines.receiveShadow = true;
  scene.add(lines);
}

function buildPlaza(scene, colliders, updaters, mat) {
  const paving = [
    { geo: new THREE.CircleGeometry(PLAZA.r, 40).rotateX(-Math.PI / 2).translate(PLAZA.x, 0.06, PLAZA.z), color: COLOURS.stone },
    { geo: new THREE.RingGeometry(9, 10.2, 40).rotateX(-Math.PI / 2).translate(PLAZA.x, 0.07, PLAZA.z), color: COLOURS.stoneDark },
  ];
  const ground = new THREE.Mesh(mergeColoured(paving), mat);
  ground.receiveShadow = true;
  scene.add(ground);

  // Fountain: stone basin, water, a column and a top bowl.
  const { x, z, r } = FOUNTAIN;
  const fountain = new THREE.Mesh(mergeColoured([
    { geo: new THREE.CylinderGeometry(r, r + 0.2, 0.8, 16).translate(x, 0.4, z), color: COLOURS.cream },
    { geo: new THREE.CylinderGeometry(r - 0.45, r - 0.45, 0.1, 16).translate(x, 0.72, z), color: '#7fcfd6' },
    { geo: new THREE.CylinderGeometry(0.45, 0.6, 2.2, 8).translate(x, 1.8, z), color: COLOURS.cream },
    { geo: new THREE.CylinderGeometry(1.5, 0.6, 0.5, 12).translate(x, 2.9, z), color: COLOURS.cream },
    { geo: new THREE.CylinderGeometry(1.25, 1.25, 0.08, 12).translate(x, 3.12, z), color: '#7fcfd6' },
  ]), mat);
  fountain.castShadow = fountain.receiveShadow = true;
  scene.add(fountain);
  colliders.push({ type: 'circle', x, z, r: r + 0.1, kind: 'fountain' });

  const spout = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.6, 8), material({ color: '#bfeef0', transparent: true, opacity: 0.85 }));
  spout.position.set(x, 3.9, z);
  scene.add(spout);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let t = 0;
  if (!still) updaters.push((dt) => { t += dt; spout.scale.y = 1 + Math.sin(t * 3.1) * 0.08; });

  // Welcome sign on two posts, text drawn to a canvas once the fonts are in.
  const s = WELCOME_SIGN;
  const sign = new THREE.Group();
  sign.position.set(s.x, 0, s.z);
  sign.rotation.y = s.rotation;
  const posts = new THREE.Mesh(mergeColoured([
    { geo: box(0.3, 3.2, 0.3, -3.3, 1.6, 0), color: COLOURS.trunk },
    { geo: box(0.3, 3.2, 0.3, 3.3, 1.6, 0), color: COLOURS.trunk },
    { geo: box(7.6, 2.5, 0.25, 0, 2.6, -0.05), color: COLOURS.coral },
  ]), mat);
  posts.castShadow = true;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 2.1), new THREE.MeshLambertMaterial({ map: signTexture() }));
  face.position.set(0, 2.6, 0.08);
  sign.add(posts, face);
  scene.add(sign);
  colliders.push({ type: 'box', x: s.x, z: s.z, hw: 3.9, hd: 0.3, rot: s.rotation, kind: 'sign' });
}

function signTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 300;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = COLOURS.cream;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#2c2526';
  ctx.textAlign = 'center';
  ctx.font = '600 80px Onest, "Segoe UI", Helvetica, Arial, sans-serif';
  ctx.fillText('Welcome to Mattsville', 512, 140);
  ctx.fillStyle = '#6b5f5c';
  ctx.font = '500 42px Onest, "Segoe UI", Helvetica, Arial, sans-serif';
  ctx.fillText('Population: 1, plus whoever’s driving', 512, 222);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Wedge climbing along local +z from 0 to h, centred on the origin. */
function wedge(w, l, h) {
  const [x0, x1, z0, z1] = [-w / 2, w / 2, -l / 2, l / 2];
  const A = [x0, 0, z0], B = [x1, 0, z0], C = [x0, 0, z1], D = [x1, 0, z1], E = [x0, h, z1], F = [x1, h, z1];
  const tris = { top: [A, F, B, A, E, F], back: [C, D, F, C, F, E], sides: [B, F, D, A, C, E] };
  const geo = (pts) => new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
  return { top: geo(tris.top), back: geo(tris.back), sides: geo(tris.sides) };
}

function buildRamps(scene, mat) {
  const parts = [];
  for (const ramp of RAMPS) {
    const w = wedge(ramp.width, ramp.length, ramp.height);
    const place = (g) => g.rotateY(ramp.heading).translate(ramp.x, 0.02, ramp.z);
    parts.push({ geo: place(w.top), color: COLOURS.mustard }, { geo: place(w.back), color: shade(COLOURS.coral, 0.85) }, { geo: place(w.sides), color: COLOURS.coral });
    // Two cream stripes up the slope so the ramp reads at a distance.
    for (const off of [-ramp.width * 0.22, ramp.width * 0.22]) {
      const s = wedge(0.45, ramp.length, ramp.height).top.translate(off, 0.03, 0);
      parts.push({ geo: place(s), color: COLOURS.cream });
    }
  }
  const mesh = new THREE.Mesh(mergeColoured(parts), mat);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
}

function buildPlaces(scene, colliders) {
  for (const place of PLACES) {
    const builder = MODEL_BUILDERS[place.model];
    if (!builder) throw new Error(`No model for ${place.model}: import models.js before buildWorld()`);
    const obj = builder(place);
    obj.position.set(place.position[0], 0, place.position[1]);
    obj.rotation.y = place.rotation;
    obj.name = `place:${place.id}`;
    scene.add(obj);
    const [w, d] = place.footprint;
    colliders.push({ type: 'box', x: place.position[0], z: place.position[1], hw: w / 2, hd: d / 2, rot: place.rotation, kind: 'building', id: place.id });
  }
}

function instanced(geo, mat, items, castShadow = true) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(items.length, 1));
  mesh.count = items.length;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  items.forEach((it, i) => {
    q.setFromAxisAngle(up, it.rot ?? 0);
    m.compose(new THREE.Vector3(it.x, it.y ?? 0, it.z), q, new THREE.Vector3(it.sx ?? it.s ?? 1, it.sy ?? it.s ?? 1, it.sz ?? it.s ?? 1));
    mesh.setMatrixAt(i, m);
    if (it.color) mesh.setColorAt(i, it.color);
  });
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  return mesh;
}

function buildLampPosts(scene, colliders, blocked, props) {
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
  const pole = new THREE.CylinderGeometry(0.12, 0.17, 4.6, 6).translate(0, 2.3, 0);
  const arm = box(0.12, 0.12, 1.2, 0, 4.5, 0.5);
  const geo = mergeGeometries([pole.toNonIndexed().deleteAttribute('uv'), arm.toNonIndexed().deleteAttribute('uv')]);
  scene.add(instanced(geo, material({ color: '#3d3537' }), spots));
  const head = box(0.5, 0.25, 0.7, 0, 4.35, 1.05);
  scene.add(instanced(head, new THREE.MeshBasicMaterial({ color: '#fff0c6' }), spots, false));
  for (const s of spots) colliders.push({ type: 'circle', x: s.x, z: s.z, r: 0.35, kind: 'lamp' });
}

function buildTrees(scene, colliders, rand, blocked, props) {
  const trunks = [], round = [], pines = [], links = [];
  const greens = ['#4f9a4a', '#5aa652', '#6db35a', '#3f8a48', '#7fbf5e'].map((c) => new THREE.Color(c));
  const pineGreens = ['#2f7a4a', '#3b8a52', '#2a6e44'].map((c) => new THREE.Color(c));
  const near = (x, z, d) => props.some((p) => Math.hypot(p.x - x, p.z - z) < d);
  const inPark = (x, z) => Math.abs(x - PARK.x) < PARK.w / 2 && Math.abs(z - PARK.z) < PARK.d / 2;
  let tries = 0;
  while (trunks.length < 150 && tries++ < 6000) {
    const x = (rand() * 2 - 1) * (PLOT_HALF - 4), z = (rand() * 2 - 1) * (PLOT_HALF - 4); // blocked() keeps them off the rounded edge
    if (blocked(x, z, 1.4) || near(x, z, 4.2)) continue;
    if (inPark(x, z) && rand() < 0.6) continue; // the park stays mostly open lawn
    const s = 0.8 + rand() * 0.6;
    const pine = rand() < 0.35;
    const canopy = pine ? pines : round;
    links.push({ pine, index: canopy.length });
    colliders.push({ type: 'circle', x, z, r: 0.45 * s + 0.15, kind: 'tree', tree: trunks.length });
    trunks.push({ x, z, s, rot: rand() * 6 });
    canopy.push({ x, z, s, rot: rand() * 6, color: (pine ? pineGreens : greens)[Math.floor(rand() * (pine ? 3 : 5))] });
    props.push({ x, z });
  }
  const meshes = addTreeMeshes(scene, trunks, round, pines);
  return links.map(({ pine, index }, i) => [
    { mesh: meshes.trunk, index: i },
    { mesh: pine ? meshes.pine : meshes.round, index },
  ]);
}

function addTreeMeshes(scene, trunks, round, pines) {
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 1.8, 5).translate(0, 0.9, 0);
  const roundGeo = new THREE.IcosahedronGeometry(1.6, 0).scale(1, 1.1, 1).translate(0, 3.0, 0);
  const pineGeo = new THREE.ConeGeometry(1.5, 3.6, 6).translate(0, 3.3, 0);
  const meshes = {
    trunk: instanced(trunkGeo, material({ color: COLOURS.trunk }), trunks),
    round: instanced(roundGeo, material(), round),
    pine: instanced(pineGeo, material(), pines),
  };
  scene.add(meshes.trunk, meshes.round, meshes.pine);
  return meshes;
}

// Benches: a few on the pavements facing the road, and some in the park facing the lawn. Each
// slides along its length until it is clear of lamp posts, trees, the townsfolk's walks, the
// rings and the ramps. Solid, but low, so the camera ignores them.
const BENCH_SPOTS = [
  // [x, z, rot]: rot turns the seat (local +z) to face that way.
  [-30, 7.4, Math.PI], [30, -7.4, 0], [7.4, -38, -Math.PI / 2], [-7.4, 46, Math.PI / 2],
  [-56, -7.4, 0], [64.6, -40, Math.PI / 2],
  [20, 36, 0.98], [50, 58, -2.24], [24, 58, 2.4],
];
function buildBenches(scene, colliders, props) {
  const nearWalk = (x, z) => TOWNSFOLK.some(({ path: [[ax, az], [bx, bz]] }) => {
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2)));
    return Math.hypot(x - (ax + (bx - ax) * t), z - (az + (bz - az) * t)) < 2.6;
  });
  const taken = (x, z) =>
    props.some((p) => Math.hypot(p.x - x, p.z - z) < 2.4) ||
    ROADS.some((road) => circleOverlapsRect(x, z, 1.1, road)) ||
    PLACES.some((p) => circleOverlapsRect(x, z, 1.4, footprintRect(p))) ||
    PLACES.some((p) => { const [cx, cz] = ringCentre(p); return Math.hypot(x - cx, z - cz) < RING_RADIUS + 1.6; }) ||
    RAMPS.some((ramp) => circleOverlapsRect(x, z, 2, rampFootprint(ramp))) ||
    Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + 1 ||
    Math.hypot(x - WELCOME_SIGN.x, z - WELCOME_SIGN.z) < 5.5 ||
    nearWalk(x, z);
  const spots = [];
  for (const [x0, z0, rot] of BENCH_SPOTS) {
    const ux = Math.cos(rot), uz = -Math.sin(rot); // along the bench's length
    let spot = null;
    for (let t = 0; t <= 8 && !spot; t += 0.5) {
      for (const sgn of t ? [1, -1] : [1]) {
        const x = x0 + ux * t * sgn, z = z0 + uz * t * sgn;
        if (!taken(x, z)) { spot = { x, z, rot }; break; }
      }
    }
    if (!spot) continue;
    spots.push(spot);
    props.push({ x: spot.x, z: spot.z });
    colliders.push({ type: 'box', x: spot.x, z: spot.z, hw: 1.05, hd: 0.45, rot: spot.rot, kind: 'bench' });
  }
  const wood = '#b07a45', woodDark = '#9a6537', iron = '#3d3537';
  const parts = [
    { geo: box(2.0, 0.1, 0.66, 0, 0.5, 0.02), color: wood },               // seat
    { geo: box(2.0, 0.06, 0.08, 0, 0.53, 0.32), color: woodDark },
    { geo: box(2.0, 0.22, 0.08, 0, 0.82, -0.3), color: wood },             // back, two rails
    { geo: box(2.0, 0.22, 0.08, 0, 1.1, -0.3), color: wood },
    ...[-0.86, 0.86].flatMap((x) => [
      { geo: box(0.09, 0.5, 0.09, x, 0.25, 0.26), color: iron },           // legs
      { geo: box(0.09, 1.2, 0.09, x, 0.6, -0.3), color: iron },
      { geo: box(0.09, 0.07, 0.62, x, 0.72, 0.0), color: iron },           // arm rest
    ]),
  ];
  const mesh = instanced(mergeColoured(parts), material({ vertexColors: true }), spots);
  mesh.name = 'benches';
  scene.add(mesh);
}

// Rim: low hills and trees just outside the boundary (rim.js keeps them out of the plot and
// round its rounded corners), so the town has no visible edge and nothing solid looks drivable.
function buildRim(scene, rand, mat) {
  const greens = ['#6aa955', '#5f9a48', '#77b35e', '#548c45'];
  const hills = rimHills(rand, 70).map((h, i) => ({
    geo: new THREE.IcosahedronGeometry(h.r, 1).scale(1, h.sy, 1).rotateY(h.rot).translate(h.x, -1.5, h.z),
    color: greens[i % greens.length],
  }));
  const hillMesh = new THREE.Mesh(mergeColoured(hills), mat);
  hillMesh.receiveShadow = true;
  scene.add(hillMesh);

  const trunks = [], round = [], pines = [], links = [];
  const leaf = ['#4f9a4a', '#3f8a48', '#5aa652'].map((c) => new THREE.Color(c));
  rimTrees(rand, 120).forEach((t, i) => {
    trunks.push({ x: t.x, z: t.z, s: t.s });
    (t.pine ? pines : round).push({ x: t.x, z: t.z, s: t.s, rot: t.rot, color: leaf[i % 3] });
  });
  addTreeMeshes(scene, trunks, round, pines);
}
