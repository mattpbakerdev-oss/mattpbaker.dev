// Pure maths for the breakaway lamp posts and in-town trees: hit test, topple and launch, car
// speed loss, reset rule. No three.js, so node can test it. smash.js draws and wires it.
//
// A gentle hit topples the object over its base (a hinge fall that speeds up as it goes, with a
// small bounce where it lands). A hard hit launches it: a rigid body thrown forward from the
// base with an upward kick and an end-over-end spin, then tumble.js's ground contact (gravity,
// bounce, friction, settle on a flat face) until it lies still.
//
// Pose: (x, y, z) is the centre of the object's contact box, q = [x, y, z, w] its rotation. The
// box sits `offset` above the base in the object's own frame (yaw `home.rot`), so the instance
// matrix is T(x, y, z) R(q) T(-offset) R_y(-rot) times the original instance's local transform.
import { lowestOffset, stepBody } from './tumble.js';
import { wrapAngle } from './physics.js';

export const BREAKABLE = {
  // Pole 4.6 high, arm and head reaching 1.4 out along local +z.
  lamp: { mass: 2, scrub: 0.10, half: () => [0.3, 2.35, 0.75], offset: () => [0, 2.35, 0.6], height: () => 4.6, rest: 1.52 },
  // Trunk plus canopy, about 4.8 s high; the wide box keeps the canopy out of the ground lying down.
  tree: { mass: 6, scrub: 0.25, half: (s) => [0.95 * s, 2.4 * s, 0.95 * s], offset: (s) => [0, 2.4 * s, 0], height: (s) => 4.8 * s, rest: 1.2 },
};

const CAR_MASS = 12;
const GRAVITY = 25;           // matches tumble.js
const RESET_AFTER = 20;       // seconds
const RESET_CLEAR = 4;        // the car must be this far from the spot (plus the object's reach)
const MAX_FLING = 26;         // cap on a launched object's speed across the ground
const TIP_PAUSE = 0.9;        // seconds a launched object may lie still before it counts as down

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

/** Car velocity after hitting one: a fixed share of speed lost, direction kept. */
export function speedAfterHit(kind, vx, vz) {
  const k = 1 - BREAKABLE[kind].scrub;
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
    landed: 0, flying: 0, lightOff: false,
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
  b.x = b.baseX + c[0]; b.y = c[1]; b.z = b.baseZ + c[2];
  b.low = lowestOffset(b);
}

/**
 * Does the car (circle of radius carR at { x, z, y }, previously at { x, z }) hit this standing
 * object? Sweeps the frame's movement so a fast car can't skip past a thin post.
 */
export function touchesCar(b, car, prev, carR) {
  if (isKnocked(b) || car.y > b.height * 0.6) return false;
  const reach = carR + b.r;
  const dx = car.x - prev.x, dz = car.z - prev.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 1e-9 ? Math.max(0, Math.min(1, ((b.home.x - prev.x) * dx + (b.home.z - prev.z) * dz) / len2)) : 1;
  return Math.hypot(prev.x + dx * t - b.home.x, prev.z + dz * t - b.home.z) < reach;
}

/**
 * The car { x, z, vx, vz } hits it at time `now`. Returns { mode, strength }. The fall goes the
 * way the car was going, leaning a little away from the car for glancing blows.
 */
export function strike(b, car, now, { reduced = false } = {}) {
  const speed = Math.hypot(car.vx, car.vz);
  let nx = b.home.x - car.x, nz = b.home.z - car.z;
  const nl = Math.hypot(nx, nz) || 1;
  nx /= nl; nz /= nl;
  let dx = nx, dz = nz;
  if (speed > 0.01) { dx = (car.vx / speed) * 0.75 + nx * 0.25; dz = (car.vz / speed) * 0.75 + nz * 0.25; }
  const dl = Math.hypot(dx, dz) || 1;
  dx /= dl; dz /= dl;
  const k = Math.sqrt(2 / b.mass); // lighter things go further and spin faster
  Object.assign(b, { knockedAt: now, knocked: true, asleep: false, still: 0, dirX: dx, dirZ: dz, landed: 0, flying: 0 });
  b.source.down = true;

  if (b.kind === 'lamp') {
    // Turn the arm side-on as it falls so the lamp head lands beside the pole, not under it.
    const side = Math.atan2(dz, -dx);
    const a = wrapAngle(side - b.home.rot), c = wrapAngle(side + Math.PI - b.home.rot);
    b.twist = Math.abs(a) < Math.abs(c) ? a : c;
  }

  if (speed < launchSpeed(b)) {
    b.mode = 'topple';
    b.omega = (0.7 + speed * 0.3) * k;
    b.bvx = car.vx * 0.25; b.bvz = car.vz * 0.25;
    return { mode: b.mode, strength: speed };
  }

  // Launch: kicked off its base along the car's line, the top tipping away end over end.
  b.mode = 'launch';
  const over = speed - launchSpeed(b);
  let fling = speed * (b.kind === 'lamp' ? 0.85 : 0.65);
  let lift = (3 + over * 0.35) * Math.sqrt(k);
  let spin = (2.5 + speed * 0.28) * k;
  if (reduced) { fling *= 0.7; lift *= 0.4; spin *= 0.45; }
  const wx = dz * spin, wz = -dx * spin;
  // Half the top's swing carries the centre forward, so the base snaps out from under it
  // without dropping back into the car.
  const swing = 0.5 * spin * b.offset[1];
  let vx = dx * (fling + swing), vz = dz * (fling + swing);
  const hs = Math.hypot(vx, vz);
  if (hs > MAX_FLING) { vx *= MAX_FLING / hs; vz *= MAX_FLING / hs; }
  Object.assign(b, { vx, vz, vy: lift, wx, wz, wy: (nx * car.vz - nz * car.vx) * 0.05, contact: false });
  return { mode: b.mode, strength: speed };
}

/**
 * Advance one step. env: { groundAt(x, z), solidAt?(x, z) for a falling top hitting a wall,
 * push?(x, z, r) => { x, z, nx, nz } | null to keep a flying body out of buildings }.
 */
export function stepBreakable(b, dt, env) {
  if (!(dt > 0) || b.mode === 'standing' || b.mode === 'down') return b;
  if (b.mode === 'topple') return stepTopple(b, dt, env);
  return stepLaunch(b, dt, env);
}

function stepTopple(b, dt, env) {
  // Base slides a touch with the knock, then friction holds it.
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
  // Its top meeting a wall stops the fall there: it leans on the building.
  if (env.solidAt && b.omega > 0) {
    const reach = L * Math.sin(Math.min(next, Math.PI / 2));
    if (env.solidAt(b.baseX + b.dirX * reach, b.baseZ + b.dirZ * reach)) {
      b.rest = Math.max(0.05, b.theta);
      next = b.rest;
    }
  }
  if (next >= b.rest) {
    next = b.rest;
    // A small, quick bounce where it lands; then still.
    if (b.omega > 2.2) b.omega = -b.omega * 0.18;
    else { b.omega = 0; b.mode = 'down'; }
  }
  b.theta = Math.max(0, next);
  hingePose(b);
  return b;
}

function stepLaunch(b, dt, env) {
  const wasContact = b.contact;
  const vyBefore = b.vy;
  stepBody(b, dt, env.groundAt);
  b.flying += dt;
  // Each hard landing scrubs speed: a tumbling post doesn't skate.
  if (b.contact && !wasContact && vyBefore < -3) {
    b.vx *= 0.45; b.vz *= 0.45;
    b.wx *= 0.55; b.wy *= 0.55; b.wz *= 0.55;
    b.landed++;
  }
  if (env.push) {
    const hit = env.push(b.x, b.z, b.half[0] + 0.2);
    if (hit) {
      b.x = hit.x; b.z = hit.z;
      const vn = b.vx * hit.nx + b.vz * hit.nz;
      if (vn < 0) { b.vx -= 1.3 * vn * hit.nx; b.vz -= 1.3 * vn * hit.nz; }
    }
  }
  b.low = lowestOffset(b);
  if (b.asleep || (b.contact && b.still > TIP_PAUSE) || b.flying > 12) {
    Object.assign(b, { mode: 'down', vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0 });
  }
  return b;
}

/**
 * Back to its spot 20 seconds after the knock, but only while neither its spot nor where it lies
 * is on screen (`visible`) and the car is well clear of the spot.
 */
export function canRestore(b, now, visible, carX, carZ) {
  if (!isKnocked(b) || now - b.knockedAt < RESET_AFTER || visible) return false;
  return Math.hypot(carX - b.home.x, carZ - b.home.z) > RESET_CLEAR + b.r + 1.35;
}
