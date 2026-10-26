// Pure maths for the breakaway lamp posts and in-town trees: hit test, topple and launch, car
// speed loss, reset rule. No three.js, so node can test it. smash.js draws and wires it.
//
// A gentle hit topples the object over its base (a hinge fall that speeds up as it goes, with a
// small bounce where it lands). A hard hit launches it, Hit & Run style: thrown forward faster
// than the car is still going, up, and off to the side of the car it was on, tumbling end over
// end along its flight line; then tumble.js's ground contact (gravity, bounce, friction, settle
// on a flat face) until it lies still. A launched tree then eases into its toppled pose so the
// trunk base and canopy both rest on the ground. Under reduced motion nothing launches: it
// topples, turned well towards the glancing side, with the base shoved clear.
//
// Each body carries sample points (both ends, the middle, the pole and head or the canopy) that
// are pushed out of buildings and kept inside the plot, every frame, in flight and at rest.
//
// Pose: (x, y, z) is the centre of the object's contact box, q = [x, y, z, w] its rotation. The
// box sits `offset` above the base in the object's own frame (yaw `home.rot`), so the instance
// matrix is T(x, y, z) R(q) T(-offset) R_y(-rot) times the original instance's local transform.
import { lowestOffset, stepBody } from './tumble.js';
import { wrapAngle, circleVsCircle, circleVsBox, clampToPlot, plotDistance } from './physics.js';
import { pointInside } from './occlusion.js';
import { WALLS } from './places.js';

// scrub: the car's speed lost to a launch; topple: lost to a topple (much more, so the car
// doesn't roll on into what it just knocked over). samples: [x, y, z, r, rc] relative to the box
// centre (times s): r keeps the body out of buildings and the plot, rc (the drawn size) keeps it
// out of the car. The first is the base; the first `visible` sit on what is drawn (the rest fill
// out the box's centreline).
export const BREAKABLE = {
  // Pole 4.6 high, arm and head reaching 1.4 out along local +z.
  lamp: {
    mass: 2, scrub: 0.10, topple: 0.35, visible: 4, half: () => [0.3, 2.35, 0.75], offset: () => [0, 2.35, 0.6], height: () => 4.6, rest: 1.52,
    samples: [[0, -2.35, -0.6, 0.2, 0.17], [0, 0, -0.6, 0.2, 0.15], [0, 2.35, -0.6, 0.2, 0.15], [0, 2.0, 0.45, 0.35, 0.35],
      [0, -2.35, 0, 0.2, 0], [0, -1.175, 0, 0.2, 0], [0, 0, 0, 0.2, 0], [0, 1.175, 0, 0.2, 0], [0, 2.35, 0, 0.2, 0]],
  },
  // Trunk plus canopy, about 4.8 s high; the wide box keeps the canopy out of the ground lying down.
  tree: {
    mass: 6, scrub: 0.30, topple: 0.6, visible: 6, half: (s) => [0.95 * s, 2.4 * s, 0.95 * s], offset: (s) => [0, 2.4 * s, 0], height: (s) => 4.8 * s, rest: 1.2,
    samples: [[0, -2.4, 0, 0.3, 0.3], [0, -1.2, 0, 0.3, 0.3], [0, 0, 0, 0.3, 0.3], [0, 1.2, 0, 0.3, 0.3], [0, 2.4, 0, 0.3, 0.3], [0, 0.6, 0, 1.0, 1.52]],
  },
};

const CAR_MASS = 12;
const GRAVITY = 25;           // matches tumble.js
const RESET_AFTER = 20;       // seconds
const RESET_CLEAR = 4;        // the car must be this far from the spot (plus the object's reach)
const MAX_FLING = 38;         // cap on a launched object's forward speed (beats the car's top speed)
const LATERAL = 0.35;         // a launch's sideways speed, as a share of its forward speed
const GLANCE = 0.15;          // below this sideways offset (sine), the side is a coin toss
const TIP_PAUSE = 0.9;        // seconds a launched object may lie still before it counts as down
const SETTLE = 0.25;          // seconds a launched tree takes to ease into its toppled pose
const WALL_NEAR = 0.6;        // a plot's edge catches a falling top only this close to a real wall
const KICK_MIN = 1;           // the car must be doing this to kick a knocked one again
const KICK_GAP = 0.3;         // ... and be this close to it
const KICK_LIFT = 3, KICK_EXTRA = 4, KICK_SIDE = 4;
const REDUCED_TURN = (55 * Math.PI) / 180;

const isKnocked = (b) => b.mode !== 'standing';

export const isBreakable = (c) => c.kind === 'lamp' || c.kind === 'tree';

/** Splits the world's colliders into the solid set (the car bounces off) and the breakables. */
export function splitColliders(colliders) {
  const solid = [], breakable = [];
  for (const c of colliders) (isBreakable(c) ? breakable : solid).push(c);
  return { solid, breakable };
}

/**
 * Colliders for placing things (signs, props, reset and fast-travel spots): the solid set plus
 * every breakable still standing. `items` are bodies or their source footprints.
 */
export function clearanceColliders(solid, items) {
  const out = solid.slice();
  for (const it of items) {
    const src = it.source ?? it;
    if (!src.down) out.push(src);
  }
  return out;
}

/** The car speed (along the ground) at which a hit launches rather than topples. */
export function launchSpeed(b) {
  return 5 + BREAKABLE[b.kind].mass * 1.4;
}

/**
 * Car velocity after hitting one: a fixed share of speed lost, direction kept. A topple costs
 * far more than a launch, so the car stops short of what it pushed over.
 */
export function speedAfterHit(kind, vx, vz, mode = 'launch') {
  const def = BREAKABLE[kind];
  const k = 1 - (mode === 'topple' ? def.topple : def.scrub);
  return { vx: vx * k, vz: vz * k };
}

// ---------- Quaternions [x, y, z, w] ----------
function qAxis(ax, ay, az, angle, out = [0, 0, 0, 1]) {
  const s = Math.sin(angle / 2);
  out[0] = ax * s; out[1] = ay * s; out[2] = az * s; out[3] = Math.cos(angle / 2);
  return out;
}
function qMul(a, b, out) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}
function rotate(q, v, out) {
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  // t = 2 q.xyz x v; v' = v + w t + q.xyz x t
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  out[0] = vx + w * tx + (y * tz - z * ty);
  out[1] = vy + w * ty + (z * tx - x * tz);
  out[2] = vz + w * tz + (x * ty - y * tx);
  return out;
}

function qSlerp(a, b, t, out) {
  let [bx, by, bz, bw] = b;
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let ka = 1 - t, kb = t;
  if (cos < 0.9995) {
    const ang = Math.acos(cos), sin = Math.sin(ang);
    ka = Math.sin((1 - t) * ang) / sin; kb = Math.sin(t * ang) / sin;
  }
  out[0] = a[0] * ka + bx * kb; out[1] = a[1] * ka + by * kb; out[2] = a[2] * ka + bz * kb; out[3] = a[3] * ka + bw * kb;
  const l = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
  out[0] /= l; out[1] /= l; out[2] /= l; out[3] /= l;
  return out;
}

/**
 * The body's sample points in the world, [[x, y, z, r, rc], ...] (reused each call): both ends
 * and the middle of its long axis, plus the pole and head (lamp) or the canopy (tree). The first
 * is the base of the pole or trunk. r is the radius for buildings, rc the drawn radius.
 */
export function bodySamples(b) {
  const v = b.tmpV;
  for (let i = 0; i < b.local.length; i++) {
    const [lx, ly, lz, r, rc] = b.local[i];
    v[0] = lx; v[1] = ly; v[2] = lz;
    rotate(b.q, v, v);
    const o = b.samples[i];
    o[0] = b.x + v[0]; o[1] = b.y + v[1]; o[2] = b.z + v[2]; o[3] = r; o[4] = rc;
  }
  return b.samples;
}

/** How far the object leans from upright, in radians (0 standing, PI/2 lying flat). */
export function tipAngle(b) {
  const [x, , z] = b.q;
  return Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (x * x + z * z))));
}

/** A breakable body from its footprint collider { kind, x, z, r, rot, s }. */
export function createBreakable(source) {
  const def = BREAKABLE[source.kind];
  const s = source.s ?? 1;
  const b = {
    kind: source.kind, source, s, r: source.r, mass: def.mass,
    half: def.half(s), offset: def.offset(s), height: def.height(s),
    home: { x: source.x, z: source.z, rot: source.rot ?? 0 },
    lieAxes: [0, 2], // tumble.js settles it on a side, never on an end
    q: [0, 0, 0, 1], tmpQ: [0, 0, 0, 1], tmpQ2: [0, 0, 0, 1], tmpV: [0, 0, 0],
    local: def.samples.map(([x, y, z, r, rc]) => [x * s, y * s, z * s, r * s, rc * s]),
    samples: def.samples.map(() => [0, 0, 0, 0, 0]),
    from: { x: 0, y: 0, z: 0, q: [0, 0, 0, 1] }, settleT: 0,
  };
  return restoreBreakable(b);
}

/** Back to standing at its home spot. */
export function restoreBreakable(b) {
  const { x, z, rot } = b.home;
  Object.assign(b, {
    mode: 'standing', knockedAt: -Infinity, baseX: x, baseZ: z, bvx: 0, bvz: 0,
    theta: 0, omega: 0, dirX: 0, dirZ: 1, twist: 0, rest: BREAKABLE[b.kind].rest,
    vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, knocked: false, asleep: false, contact: true, still: 0,
    landed: 0, flying: 0, lightOff: false, calm: false, groundY: 0, settleT: 0,
  });
  b.source.down = false;
  hingePose(b);
  return b;
}

/** Pose from the hinge state: lean theta about the base, towards (dirX, dirZ). */
function hingePose(b) {
  const p = b.rest > 0 ? Math.min(1, b.theta / b.rest) : 0;
  const yaw = qAxis(0, 1, 0, b.home.rot + b.twist * p, b.tmpQ);
  const lean = qAxis(b.dirZ, 0, -b.dirX, b.theta, b.tmpQ2);
  qMul(lean, yaw, b.q);
  const c = rotate(b.q, b.offset, b.tmpV);
  b.x = b.baseX + c[0]; b.y = b.groundY + c[1]; b.z = b.baseZ + c[2];
  b.low = lowestOffset(b);
}

/** Moves the whole body across the ground (base, centre, and a settle's starting pose). */
function shift(b, dx, dz) {
  b.x += dx; b.z += dz; b.baseX += dx; b.baseZ += dz; b.from.x += dx; b.from.z += dz;
}

/**
 * Pushes the whole body out of buildings and back inside the plot until none of its samples is
 * in either. Returns the last wall's normal { nx, nz }, or null if it was clear.
 */
function pushOut(b, env) {
  if (!env.push) return null;
  let hit = null;
  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    const pts = bodySamples(b);
    for (const p of pts) {
      const h = env.push(p[0], p[2], p[3]);
      if (!h) continue;
      const dx = h.x - p[0], dz = h.z - p[2];
      if (Math.abs(dx) + Math.abs(dz) < 1e-9) continue;
      shift(b, dx, dz);
      for (const o of pts) { o[0] += dx; o[2] += dz; }
      hit = h; moved = true;
    }
    if (!moved) break;
  }
  return hit;
}

/** The side of the car's line the point is on: unit vector across the car, towards it. */
function sideOf(px, pz, car, ux, uz, rand) {
  let nx = px - car.x, nz = pz - car.z;
  const nl = Math.hypot(nx, nz) || 1;
  const cross = (nx / nl) * uz - (nz / nl) * ux;
  const side = Math.abs(cross) < GLANCE ? (rand() < 0.5 ? -1 : 1) : Math.sign(cross);
  return [side * uz, -side * ux];
}

/** The car's facing as a unit vector: its heading if it has one, else its velocity. */
function facing(car) {
  if (Number.isFinite(car.heading)) return [Math.sin(car.heading), Math.cos(car.heading)];
  const v = Math.hypot(car.vx ?? 0, car.vz ?? 0);
  return v > 1e-6 ? [car.vx / v, car.vz / v] : [0, 1];
}

/** The car's body seen from above: half width and half length (bumper included). */
export const CAR_BODY = { hw: 1.05, hl: 1.95 };
const CAR_TOP = 2;            // the car's roof above its ground
const CLEAR_STEP = 0.45;      // most clearOfCar slides a body in one frame

/** How far (x, z) is outside the car's body at (cx, cz) facing (fx, fz); 0 inside. */
function bodyDist(x, z, cx, cz, fx, fz, body) {
  const dx = x - cx, dz = z - cz;
  const lz = dx * fx + dz * fz, lx = dx * fz - dz * fx;
  return Math.hypot(Math.max(0, Math.abs(lx) - body.hw), Math.max(0, Math.abs(lz) - body.hl));
}

/**
 * Does the car's body (a box, `body`) hit this standing object this frame? Sweeps the move from
 * prev in short steps so a fast car can't skip past a thin post.
 */
export function touchesCar(b, car, prev, body = CAR_BODY) {
  if (isKnocked(b) || car.y > b.height * 0.6) return false;
  const [fx, fz] = facing(car);
  const dx = car.x - prev.x, dz = car.z - prev.z;
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.25));
  for (let i = 0; i <= n; i++) {
    if (bodyDist(b.home.x, b.home.z, prev.x + (dx * i) / n, prev.z + (dz * i) / n, fx, fz, body) < b.r) return true;
  }
  return false;
}

/**
 * Is the car heading into this one, so pulling away from it never knocks it? Judged at the point
 * of the frame's sweep (prev to car) nearest the object, so a fast glancing sweep that ends past
 * it still counts. Touching it always counts.
 */
export function headingInto(b, car, prev, body = CAR_BODY) {
  const hx = b.home.x, hz = b.home.z;
  const [fx, fz] = facing(car);
  if (bodyDist(hx, hz, car.x, car.z, fx, fz, body) < b.r) return true;
  const dx = car.x - prev.x, dz = car.z - prev.z;
  const len2 = dx * dx + dz * dz;
  if (len2 > 1e-9) {
    const t = ((hx - prev.x) * dx + (hz - prev.z) * dz) / len2;
    if (t > 0 && t < 1) return true; // it sits alongside the sweep
    if (t <= 0) return false;        // behind where the car started
  }
  return (hx - car.x) * car.vx + (hz - car.z) * car.vz > 0;
}

/**
 * The car { x, z, vx, vz } hits it at time `now`. Returns { mode, strength }. A topple falls the
 * way the car was going, turned towards the side of the car it was on; a launch flies ahead of
 * the car, up, and off to that side. `reduced` never launches. `rand` picks a side for a dead-
 * centre hit.
 */
export function strike(b, car, now, { reduced = false, rand = Math.random } = {}) {
  const speed = Math.hypot(car.vx, car.vz);
  let ux = b.home.x - car.x, uz = b.home.z - car.z;
  if (speed > 0.01) { ux = car.vx; uz = car.vz; }
  const ul = Math.hypot(ux, uz) || 1;
  ux /= ul; uz /= ul;
  const [lx, lz] = sideOf(b.home.x, b.home.z, car, ux, uz, rand);
  const k = Math.sqrt(2 / b.mass); // lighter things go further and spin faster
  Object.assign(b, { knockedAt: now, knocked: true, asleep: false, still: 0, landed: 0, flying: 0, calm: reduced, groundY: 0 });
  b.source.down = true;

  const launch = !reduced && speed >= launchSpeed(b);
  let dx, dz;
  if (launch) { dx = ux; dz = uz; }
  else if (reduced) { dx = ux * Math.cos(REDUCED_TURN) + lx * Math.sin(REDUCED_TURN); dz = uz * Math.cos(REDUCED_TURN) + lz * Math.sin(REDUCED_TURN); }
  else { dx = ux * 0.65 + lx * 0.35; dz = uz * 0.65 + lz * 0.35; }
  const dl = Math.hypot(dx, dz) || 1;
  dx /= dl; dz /= dl;
  b.dirX = dx; b.dirZ = dz;

  if (b.kind === 'lamp') {
    // Turn the arm side-on as it falls so the lamp head lands beside the pole, not under it.
    const side = Math.atan2(dz, -dx);
    const a = wrapAngle(side - b.home.rot), c = wrapAngle(side + Math.PI - b.home.rot);
    b.twist = Math.abs(a) < Math.abs(c) ? a : c;
  }

  if (!launch) {
    b.mode = 'topple';
    b.omega = (0.7 + speed * 0.3) * k;
    // Shoved along with the car; under reduced motion also pushed out to the side, clear of it.
    b.bvx = car.vx * 0.6 + (reduced ? lx * 4 : 0);
    b.bvz = car.vz * 0.6 + (reduced ? lz * 4 : 0);
    return { mode: b.mode, strength: speed };
  }

  // Launch: forward faster than the car is still going, sideways to its side, up, end over end.
  b.mode = 'launch';
  const def = BREAKABLE[b.kind];
  const over = speed - launchSpeed(b);
  const fling = speed * (b.kind === 'lamp' ? 0.85 : 0.65);
  const spin = (b.kind === 'lamp' ? 2 + speed * 0.17 : 2.5 + speed * 0.28) * k;
  const swing = 0.5 * spin * b.offset[1];
  const fwd = Math.min(MAX_FLING, Math.max(fling + swing, speed * (1 - def.scrub) + (b.kind === 'lamp' ? 9 : 7)));
  const lat = LATERAL * fwd;
  const vx = ux * fwd + lx * lat, vz = uz * fwd + lz * lat;
  const hl = Math.hypot(vx, vz);
  const hx = vx / hl, hz = vz / hl;
  b.dirX = hx; b.dirZ = hz;
  Object.assign(b, { vx, vz, vy: (5.5 + over * 0.3) * Math.sqrt(k), wx: hz * spin, wy: 0, wz: -hx * spin, contact: false });
  return { mode: b.mode, strength: speed };
}

/**
 * Is the car driving into this knocked one (fallen, falling, or flying slower than the car)?
 * Any of its visible samples within `KICK_GAP` of the car's body, low enough to hit and ahead
 * of the car's middle.
 */
export function debrisInWay(b, car, body = CAR_BODY) {
  if (b.mode === 'standing') return false;
  const speed = Math.hypot(car.vx, car.vz);
  if (speed < KICK_MIN) return false;
  const ux = car.vx / speed, uz = car.vz / speed;
  const along = b.mode === 'launch' ? b.vx * ux + b.vz * uz : b.mode === 'topple' ? b.bvx * ux + b.bvz * uz : 0;
  if (along >= speed) return false; // already outrunning the car
  const cy = car.y ?? 0;
  if (b.y + b.low > cy + CAR_TOP) return false; // flying over it
  const [fx, fz] = facing(car);
  const pts = bodySamples(b), n = BREAKABLE[b.kind].visible;
  for (let i = 0; i < n; i++) {
    const [x, y, z, , r] = pts[i];
    if (y - r > cy + CAR_TOP) continue;
    if ((x - car.x) * ux + (z - car.z) * uz <= 0) continue; // behind the car's middle
    if (bodyDist(x, z, car.x, car.z, fx, fz, body) < r + KICK_GAP) return true;
  }
  return false;
}

/**
 * Last line of defence, run after each step: if any visible part of a knocked one sits inside
 * the car's body (a fresh launch's base swinging back as it tumbles, or a canopy hanging over
 * the bonnet as the trunk is hit), slide the whole body on along the car's facing, up to
 * CLEAR_STEP a frame so it reads as the car shoving it, not a jump. With `env`, buildings and
 * the plot edge still win. Returns true if it moved.
 */
export function clearOfCar(b, car, env = null, body = CAR_BODY) {
  if (b.mode === 'standing') return false;
  const cy = car.y ?? 0;
  const [fx, fz] = facing(car);
  const pts = bodySamples(b), n = BREAKABLE[b.kind].visible;
  let need = 0;
  for (let i = 0; i < n; i++) {
    const [x, y, z, , r] = pts[i];
    if (y - r > cy + CAR_TOP) continue;
    const dx = x - car.x, dz = z - car.z;
    const lz = dx * fx + dz * fz, lx = dx * fz - dz * fx;
    if (lz <= 0 || Math.abs(lx) >= body.hw + r) continue; // behind the middle, or beside it
    need = Math.max(need, body.hl + r - lz);
  }
  if (need <= 0) return false;
  need = Math.min(need, CLEAR_STEP);
  shift(b, fx * need, fz * need);
  if (env) pushOut(b, env);
  return true;
}

const AXIS = [0, 0, 0], NEAR = [0, 0];
function closestOnAxis(b, x, z) {
  AXIS[0] = 0; AXIS[1] = b.half[1]; AXIS[2] = 0;
  rotate(b.q, AXIS, AXIS);
  const ax = AXIS[0], az = AXIS[2];
  const len2 = ax * ax + az * az;
  const t = len2 > 1e-9 ? Math.max(-1, Math.min(1, ((x - b.x) * ax + (z - b.z) * az) / len2)) : 0;
  NEAR[0] = b.x + ax * t; NEAR[1] = b.z + az * t;
  return NEAR;
}

/**
 * The car kicks a knocked one again: ahead of the car by at least 4 and 4 off to the side of
 * the car it is on. One lying down or flying hops back into the air (3 up); one still falling,
 * or any under reduced motion, has its base shoved along the ground instead.
 */
export function rekick(b, car, now, { reduced = false, rand = Math.random } = {}) {
  const speed = Math.hypot(car.vx, car.vz) || 1;
  const ux = car.vx / speed, uz = car.vz / speed;
  const p = closestOnAxis(b, car.x, car.z);
  const [lx, lz] = sideOf(p[0], p[1], car, ux, uz, rand);
  const cur = b.mode === 'launch' ? b.vx * ux + b.vz * uz : b.bvx * ux + b.bvz * uz;
  const fwd = Math.max(cur, speed + KICK_EXTRA);
  b.knockedAt = now; b.source.down = true;
  // Still falling: shove its base on ahead (as a topple). Under reduced motion, always that.
  if (reduced || b.calm || (b.mode === 'topple' && b.theta < b.rest * 0.85)) {
    if (b.mode !== 'topple' && b.mode !== 'down') return b; // never in the air under reduced motion
    b.mode = 'topple';
    b.bvx = ux * fwd + lx * KICK_SIDE; b.bvz = uz * fwd + lz * KICK_SIDE;
    return b;
  }
  // Lying or flying: a hop. Start clear of the ground so it doesn't roll straight back.
  if (b.mode !== 'launch') b.y += Math.max(0, -(b.y + b.low - b.groundY)) + 0.02;
  // No added spin: a tumble would swing its near end back into the car. It rolls flat on landing.
  Object.assign(b, {
    mode: 'launch', vx: ux * fwd + lx * KICK_SIDE, vz: uz * fwd + lz * KICK_SIDE, vy: KICK_LIFT, wx: 0, wy: 0, wz: 0,
    contact: false, asleep: false, still: 0, flying: 0, landed: 0, bvx: 0, bvz: 0,
  });
  return b;
}

/**
 * Advance one step. env: { groundAt(x, z), solidAt?(x, z) for a falling top meeting a building,
 * push?(x, z, r) => { x, z, nx, nz } | null to keep the body out of buildings and in the plot }.
 * See worldEnv() for the town's.
 */
export function stepBreakable(b, dt, env) {
  if (!(dt > 0) || b.mode === 'standing' || b.mode === 'down') return b;
  if (b.mode === 'topple') return stepTopple(b, dt, env);
  if (b.mode === 'settle') return stepSettle(b, dt, env);
  return stepLaunch(b, dt, env);
}

function stepTopple(b, dt, env) {
  // Base slides with the knock, then friction holds it.
  const hs = Math.hypot(b.bvx, b.bvz);
  if (hs > 0) {
    const f = Math.max(0, hs - 0.55 * GRAVITY * dt) / hs;
    b.bvx *= f; b.bvz *= f;
    b.baseX += b.bvx * dt; b.baseZ += b.bvz * dt;
  }
  // A rod falling about its end: theta'' = (3 g / 2 L) sin theta.
  const L = b.height;
  b.omega += (1.5 * GRAVITY / L) * Math.sin(Math.max(b.theta, 0.02)) * dt;
  let next = b.theta + b.omega * dt;
  // Its top meeting a building stops the fall there: it leans on the wall.
  if (env.solidAt && b.omega > 0) {
    // Does any sample (the top, the canopy) reach a wall at this lean? Each reaches out its own
    // radius, the same circle the push-out uses, so it catches before it would be pushed.
    const hits = (th) => {
      const sn = Math.sin(Math.min(th, Math.PI / 2));
      for (const [, ly, , r] of b.local) {
        const along = ly + b.offset[1];
        if (along < 0.5) continue; // the base is on the ground, not falling into anything
        const reach = along * sn + r;
        if (env.solidAt(b.baseX + b.dirX * reach, b.baseZ + b.dirZ * reach)) return true;
      }
      return false;
    };
    if (hits(Math.min(next, b.rest))) {
      // Find where between this frame and the next the top meets the wall, whatever the frame rate.
      let lo = b.theta, hi = Math.min(next, b.rest);
      if (hits(lo)) hi = lo;
      else for (let i = 0; i < 8; i++) { const mid = (lo + hi) / 2; if (hits(mid)) hi = mid; else lo = mid; }
      b.rest = Math.max(0.05, lo);
      next = b.rest;
    }
  }
  if (next >= b.rest) {
    next = b.rest;
    // A small, quick bounce where it lands (none under reduced motion); then still once the
    // base has stopped sliding.
    if (b.omega > 2.2 && !b.calm) b.omega = -b.omega * 0.18;
    else { b.omega = 0; if (b.bvx === 0 && b.bvz === 0) b.mode = 'down'; }
  }
  b.theta = Math.max(0, next);
  hingePose(b);
  // Leaning on a wall: its top is meant to be at the building, so only the plot edge pushes.
  const leaning = b.rest < BREAKABLE[b.kind].rest;
  const hit = pushOut(b, leaning && env.pushPlot ? { push: env.pushPlot } : env);
  if (hit) {
    const vn = b.bvx * hit.nx + b.bvz * hit.nz;
    if (vn < 0) { b.bvx -= vn * hit.nx; b.bvz -= vn * hit.nz; }
  }
  return b;
}

function stepLaunch(b, dt, env) {
  const wasContact = b.contact;
  const vyBefore = b.vy;
  stepBody(b, dt, env.groundAt);
  b.flying += dt;
  // Each hard landing scrubs speed: a tumbling post doesn't skate.
  if (b.contact && !wasContact && vyBefore < -3) {
    // A lamp post's landings scrub harder, the later ones most: a long pole digs in.
    const keep = b.kind === 'lamp' ? (b.landed ? 0.2 : 0.35) : 0.45;
    b.vx *= keep; b.vz *= keep;
    b.wx *= 0.55; b.wy *= 0.55; b.wz *= 0.55;
    b.landed++;
  }
  // A long pole drags along the ground: twice a box's friction once it is down. With the harder
  // later landings, a launched lamp post slides about half as far as a box would.
  if (b.contact && b.landed && b.kind === 'lamp') {
    const hs = Math.hypot(b.vx, b.vz);
    if (hs > 0) { const f = Math.max(0, hs - 0.55 * GRAVITY * dt) / hs; b.vx *= f; b.vz *= f; }
  }
  const hit = pushOut(b, env);
  if (hit) {
    const vn = b.vx * hit.nx + b.vz * hit.nz;
    if (vn < 0) { b.vx -= 1.3 * vn * hit.nx; b.vz -= 1.3 * vn * hit.nz; }
  }
  b.low = lowestOffset(b);
  if (b.asleep || (b.contact && b.still > TIP_PAUSE) || b.flying > 12) {
    Object.assign(b, { vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0 });
    if (b.kind !== 'tree' || !beginSettle(b, env)) b.mode = 'down';
  }
  return b;
}

/**
 * A launched tree lies on its box, trunk floating and canopy sunk. Ease it into the toppled
 * resting pose instead: trunk base on the ground where it lies, crown on the ground beyond.
 * Returns false (and leaves it as it landed) where the ground isn't flat enough for that.
 */
function beginSettle(b, env) {
  const v = b.tmpV;
  v[0] = 0; v[1] = 1; v[2] = 0;
  rotate(b.q, v, v);
  let dx = v[0], dz = v[2];
  const dl = Math.hypot(dx, dz);
  if (dl > 1e-6) { dx /= dl; dz /= dl; } else { dx = b.dirX; dz = b.dirZ; }
  rotate(b.q, b.offset, v);
  const baseX = b.x - v[0], baseZ = b.z - v[2];
  const rest = BREAKABLE[b.kind].rest;
  // The toppled pose assumes flat ground from trunk to crown; across a ramp's edge it stays as it landed.
  const crown = b.height * Math.sin(rest);
  const g0 = env.groundAt(baseX, baseZ), g1 = env.groundAt(baseX + dx * crown, baseZ + dz * crown);
  if (Math.abs(g1 - g0) > 0.2 || Math.abs(env.groundAt(b.x, b.z) - g0) > 0.2) return false;
  const f = b.from;
  f.x = b.x; f.y = b.y; f.z = b.z; f.q[0] = b.q[0]; f.q[1] = b.q[1]; f.q[2] = b.q[2]; f.q[3] = b.q[3];
  // Keep its spin about its own axis: the yaw left over once the lean is taken out.
  const lean = qAxis(dz, 0, -dx, rest, b.tmpQ2);
  lean[0] = -lean[0]; lean[1] = -lean[1]; lean[2] = -lean[2];
  const yaw = qMul(lean, b.q, b.tmpQ);
  const psi = 2 * Math.atan2(yaw[1], yaw[3]);
  Object.assign(b, {
    mode: 'settle', settleT: 0, baseX, baseZ, dirX: dx, dirZ: dz, theta: rest, rest, omega: 0, bvx: 0, bvz: 0,
    twist: wrapAngle(psi - b.home.rot), groundY: g0,
  });
  return true;
}

function stepSettle(b, dt, env) {
  b.settleT += dt;
  const t = Math.min(1, b.settleT / SETTLE);
  const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; // ease in-out: it moves on screen
  hingePose(b);
  const f = b.from;
  b.x = f.x + (b.x - f.x) * e; b.y = f.y + (b.y - f.y) * e; b.z = f.z + (b.z - f.z) * e;
  qSlerp(f.q, b.q, e, b.q);
  pushOut(b, env);
  b.low = lowestOffset(b);
  if (t >= 1) b.mode = 'down';
  return b;
}

/**
 * The town's env for stepBreakable from world { colliders, places?, plotHalf, plotCorner,
 * groundHeightAt }. Only real buildings (not building sites) count; low solids (benches,
 * fountain, signs) let a body fall past or over them. Bodies are pushed out of a building's whole
 * plot and kept inside the town's plot. A falling top only catches (and leans) where the plot's
 * edge is within WALL_NEAR of the building's real walls (places.js WALLS), never on an open
 * forecourt or garden.
 */
export function worldEnv(world) {
  const plots = world.colliders.filter((c) => c.kind === 'building' && !String(c.id ?? '').startsWith('site'));
  const byId = new Map((world.places ?? []).map((p) => [p.id, p]));
  // Each plot's walls as world boxes, grown by WALL_NEAR; a plot with no wall data is all wall.
  const walls = plots.map((c) => {
    const place = byId.get(c.id), rects = place && WALLS[place.model];
    if (!rects) return [{ ...c, type: 'box' }];
    const rot = place.rotation, cos = Math.cos(rot), sin = Math.sin(rot);
    return rects.map(([lx, lz, w, d]) => ({
      type: 'box', x: c.x + lx * cos + lz * sin, z: c.z - lx * sin + lz * cos,
      hw: w / 2 + WALL_NEAR, hd: d / 2 + WALL_NEAR, rot,
    }));
  });
  const { plotHalf, plotCorner } = world;
  const solidAt = (x, z) => {
    for (let i = 0; i < plots.length; i++) {
      if (!pointInside(x, z, plots[i])) continue;
      for (const w of walls[i]) if (pointInside(x, z, w)) return true;
    }
    return false;
  };
  const pushBuildings = (x, z, r) => {
    for (const c of plots) {
      const reach = r + (c.type === 'circle' ? c.r : Math.hypot(c.hw, c.hd));
      if (Math.abs(x - c.x) > reach || Math.abs(z - c.z) > reach) continue;
      const hit = c.type === 'circle' ? circleVsCircle(x, z, r, c.x, c.z, c.r) : circleVsBox(x, z, r, c);
      if (hit) return { x: x + hit.nx * hit.depth, z: z + hit.nz * hit.depth, nx: hit.nx, nz: hit.nz };
    }
    return null;
  };
  const pushPlot = (x, z, r) => {
    if (plotDistance(x, z, plotHalf, plotCorner) <= -r) return null;
    const edge = clampToPlot(x, z, r, plotHalf, plotCorner);
    return edge.hit ? edge : null;
  };
  const push = (x, z, r) => pushBuildings(x, z, r) ?? pushPlot(x, z, r);
  return { groundAt: world.groundHeightAt, solidAt, push, pushPlot };
}

/**
 * Back to its spot 20 seconds after the knock, but only while neither its spot nor where it lies
 * is on screen (`visible`) and the car is well clear of the spot.
 */
export function canRestore(b, now, visible, carX, carZ) {
  if (!isKnocked(b) || now - b.knockedAt < RESET_AFTER || visible) return false;
  return Math.hypot(carX - b.home.x, carZ - b.home.z) > RESET_CLEAR + b.r + 1.35;
}
