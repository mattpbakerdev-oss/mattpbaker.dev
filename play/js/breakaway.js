// Pure maths for the breakaway lamp posts and in-town trees: hit test, topple and launch, car
// speed loss, reset rule. No three.js, so node can test it. smash.js draws and wires it.
//
// A gentle hit topples the object over its base (a hinge fall that speeds up as it goes, with a
// small bounce where it lands). A hard hit launches it, Hit & Run style: thrown forward faster
// than the car is still going, up, and off to the side of the car it was on, tumbling end over
// end along its flight line; then tumble.js's ground contact (gravity, bounce, friction, settle
// on a flat face) until it lies still. A launched tree rolls into its toppled pose on its first
// slow landing so the trunk base and canopy both rest on the ground. Under reduced motion
// nothing launches: it topples, turned well towards the glancing side, with the base shoved clear.
// Driving into one lying down shoves it along the ground and swings it round out of the way.
//
// Each body carries sample points (both ends, the middle, the pole and head or the canopy). In
// the air they only meet a building's real walls; on the ground they are also pushed off its
// plot and kept inside the town. Debris the car cannot shove clear stops the car instead.
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
const LATERAL = [0.25, 0.5]; // a launch's sideways speed as a share of its forward speed: dead centre, edge
const GLANCE_YAW = 1.5;       // yaw spin (rad/s) of a launch off the very edge of the car
const GLANCE = 0.15;          // below this sideways offset (sine), the side is a coin toss
const TIP_PAUSE = 0.9;        // seconds a launched object may lie still before it counts as down
const SETTLE = 0.35;          // seconds a launched tree takes to roll into its toppled pose
const SETTLE_SPEED = 4;       // ... starting on its first landing slower than this along the ground
const WALL_NEAR = 0.6;        // a plot's edge catches a falling top only this close to a real wall
export const KICK_MIN = 1;    // the car must be doing this to kick a knocked one again
const KICK_GAP = 0.3;         // ... and be this close to it
const KICK_PUSH = 4;          // slower than this, one still falling is pushed by the bumper, not kicked
const KICK_EXTRA = 4;         // a kick sends it on at least this much faster than the car
const KICK_SIDE = { lamp: 4, tree: 8 };
const KICK_YAW = 3.5;         // rad/s: a kicked one swings round towards the car's line
const REDUCED_TURN = (55 * Math.PI) / 180;
const REDUCED_PUSH = 5;       // most a reduced-motion hit shoves the base along (plus 4 aside)
const LAMP_TURNS = 1.3;       // turns a launched lamp makes in the air
const UPRIGHT = 0.8;          // a launched lamp leaning less than this on the ground is tipped over
const PLOT_RATE = 9;          // units a second a body on the ground is eased off a building's plot

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
 * far more than a launch, so the car stops short of what it pushed over. Pass strike()'s `loss`
 * so a reduced-motion topple costs what the full-motion hit would have.
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
    theta: 0, omega: 0, dirX: 0, dirZ: 1, twist: 0, yaw: 0, yawRate: 0, yawPivot: 0, rest: BREAKABLE[b.kind].rest,
    vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, knocked: false, asleep: false, contact: true, still: 0,
    landed: 0, flying: 0, lightOff: false, calm: false, groundY: 0, settleT: 0, hinge: true, slideSide: 0,
  });
  b.source.down = false;
  hingePose(b);
  return b;
}

/**
 * Pose from the hinge state: lean theta about the base, towards (dirX, dirZ). `twist` turns in
 * as it falls; `yaw` is a kicked one's swing round on the ground, so it turns with dir.
 */
function hingePose(b) {
  const p = b.rest > 0 ? Math.min(1, b.theta / b.rest) : 0;
  const yaw = qAxis(0, 1, 0, b.home.rot + b.twist * p + b.yaw, b.tmpQ);
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
 * Pushes the whole body out with `push` (x, z, r) => { x, z, nx, nz } | null until none of its
 * samples is caught, moving it at most `most` in all. Returns the last hit, or null if clear.
 */
function pushOut(b, push, most = Infinity) {
  if (!push) return null;
  let hit = null, left = most;
  for (let pass = 0; pass < 6 && left > 1e-9; pass++) {
    let moved = false;
    const pts = bodySamples(b);
    for (const p of pts) {
      const h = push(p[0], p[2], p[3]);
      if (!h) continue;
      let dx = h.x - p[0], dz = h.z - p[2];
      const d = Math.hypot(dx, dz);
      if (d < 1e-9) continue;
      if (d > left) { dx *= left / d; dz *= left / d; }
      left -= Math.min(d, left);
      shift(b, dx, dz);
      for (const o of pts) { o[0] += dx; o[2] += dz; }
      hit = h; moved = true;
      if (left <= 1e-9) break;
    }
    if (!moved) break;
  }
  return hit;
}

/** In the air only real walls push; on the ground (or with no wall data) the whole plot does. */
const airPush = (env) => env.pushWalls ?? env.push;

/**
 * On the ground: eased off a building's plot at up to `most` this frame (so landing on a garden
 * reads as sliding off it, not a jump), but held hard inside the town's edge.
 */
function groundPushOut(b, env, most) {
  if (!env.pushBuildings || !env.pushPlot) return pushOut(b, env.push, most);
  const hit = pushOut(b, env.pushBuildings, most);
  return pushOut(b, env.pushPlot) ?? hit;
}

/** Removes any part of the velocity (vx, vz or bvx, bvz) that points back at a car close behind it. */
function neverAtCar(b, env, kx, kz) {
  const car = env.car;
  if (!car) return;
  facing(car);
  const fx = FACE[0], fz = FACE[1];
  if ((b.x - car.x) * fx + (b.z - car.z) * fz <= 0 || bodyDist(b.x, b.z, car.x, car.z, fx, fz, CAR_BODY) > b.height) return;
  const along = b[kx] * fx + b[kz] * fz;
  if (along < 0) { b[kx] -= along * fx; b[kz] -= along * fz; }
}

/**
 * The side of the car's line the point is on: SIDE = unit vector across the car, towards it,
 * and SIDE[2] = +1 or -1 (which side). Reused each call.
 */
const SIDE = [0, 0, 1];
function sideOf(px, pz, car, ux, uz, rand) {
  const nx = px - car.x, nz = pz - car.z;
  const nl = Math.hypot(nx, nz) || 1;
  const cross = (nx / nl) * uz - (nz / nl) * ux;
  const side = Math.abs(cross) < GLANCE ? (rand() < 0.5 ? -1 : 1) : Math.sign(cross);
  SIDE[0] = side * uz; SIDE[1] = -side * ux; SIDE[2] = side;
  return SIDE;
}

/** The car's facing as a unit vector in FACE: its heading if it has one, else its velocity. */
const FACE = [0, 1];
function facing(car) {
  if (Number.isFinite(car.heading)) { FACE[0] = Math.sin(car.heading); FACE[1] = Math.cos(car.heading); return FACE; }
  const v = Math.hypot(car.vx ?? 0, car.vz ?? 0);
  if (v > 1e-6) { FACE[0] = car.vx / v; FACE[1] = car.vz / v; } else { FACE[0] = 0; FACE[1] = 1; }
  return FACE;
}

/** The car's body seen from above: half width and half length, to the bumpers (car.js). */
export const CAR_BODY = { hw: 1.1, hl: 2.03 };
const CAR_TOP = 2;            // the car's roof above its ground
const BONNET = { len: 1.3, top: 1.4 }; // the front 1.3 is only bonnet high
const CLEAR_STEP = 0.45;      // most clearOfCar slides a body in one frame

/** How high the car reaches at `lz` along its length from its middle. */
const carTop = (lz, body) => (lz > body.hl - BONNET.len ? BONNET.top : CAR_TOP);

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
  facing(car);
  const fx = FACE[0], fz = FACE[1];
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
  facing(car);
  const fx = FACE[0], fz = FACE[1];
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
 * The car { x, z, vx, vz } hits it at time `now`. Returns { mode, strength, loss }: `loss` is
 * the mode the car pays for in speed (the full-motion one, even under reduced motion). A topple
 * falls the way the car was going, turned towards the side of the car it was on; a launch flies
 * ahead of the car, up, and off to that side, further aside and with a little yaw the nearer the
 * car's edge it was hit. `reduced` never launches. `rand` picks a side for a dead-centre hit and
 * jitters a lamp's spin.
 */
export function strike(b, car, now, { reduced = false, rand = Math.random } = {}) {
  const speed = Math.hypot(car.vx, car.vz);
  let ux = b.home.x - car.x, uz = b.home.z - car.z;
  if (speed > 0.01) { ux = car.vx; uz = car.vz; }
  const ul = Math.hypot(ux, uz) || 1;
  ux /= ul; uz /= ul;
  sideOf(b.home.x, b.home.z, car, ux, uz, rand);
  const lx = SIDE[0], lz = SIDE[1], side = SIDE[2];
  // How far off the car's centreline it was: 0 dead centre, 1 at the edge of the body.
  const across = Math.abs((b.home.x - car.x) * uz - (b.home.z - car.z) * ux);
  const off = Math.min(1, across / (CAR_BODY.hw + b.r));
  const k = Math.sqrt(2 / b.mass); // lighter things go further and spin faster
  b.knockedAt = now; b.knocked = true; b.asleep = false; b.still = 0; b.landed = 0; b.flying = 0;
  b.calm = reduced; b.groundY = 0; b.yaw = 0; b.yawRate = 0; b.slideSide = 0;
  b.source.down = true;

  const wouldLaunch = speed >= launchSpeed(b);
  const launch = !reduced && wouldLaunch;
  const loss = wouldLaunch ? 'launch' : 'topple';
  let dx, dz;
  if (launch) { dx = ux; dz = uz; }
  else if (reduced) { dx = ux * Math.cos(REDUCED_TURN) + lx * Math.sin(REDUCED_TURN); dz = uz * Math.cos(REDUCED_TURN) + lz * Math.sin(REDUCED_TURN); }
  else { dx = ux * 0.65 + lx * 0.35; dz = uz * 0.65 + lz * 0.35; }
  const dl = Math.hypot(dx, dz) || 1;
  dx /= dl; dz /= dl;
  b.dirX = dx; b.dirZ = dz;

  if (b.kind === 'lamp') {
    // Turn the arm side-on as it falls so the lamp head lands beside the pole, not under it.
    const turn = Math.atan2(dz, -dx);
    const a = wrapAngle(turn - b.home.rot), c = wrapAngle(turn + Math.PI - b.home.rot);
    b.twist = Math.abs(a) < Math.abs(c) ? a : c;
  }

  if (!launch) {
    b.mode = 'topple'; b.hinge = true;
    b.omega = (0.7 + speed * 0.3) * k;
    // Shoved along with the car; under reduced motion only a short way, and out to the side.
    if (reduced) {
      const along = Math.min(0.6 * speed, REDUCED_PUSH);
      b.bvx = ux * along + lx * 4; b.bvz = uz * along + lz * 4;
    } else { b.bvx = car.vx * 0.6; b.bvz = car.vz * 0.6; }
    return { mode: b.mode, strength: speed, loss };
  }

  // Launch: forward faster than the car is still going, sideways to its side, up, end over end.
  b.mode = 'launch'; b.hinge = false;
  const def = BREAKABLE[b.kind];
  const over = speed - launchSpeed(b);
  const fling = speed * (b.kind === 'lamp' ? 0.85 : 0.65);
  const vy = (5.5 + over * 0.3) * Math.sqrt(k);
  // A lamp aims for about 1.3 turns (give or take 15%, never a whole one) by the time it drops
  // back to the height it left from: below that, passing upright would plant its foot.
  const air = (2 * vy) / GRAVITY;
  const spin = b.kind === 'lamp' ? ((LAMP_TURNS * 2 * Math.PI) / air) * (0.85 + 0.3 * rand()) : (2.5 + speed * 0.28) * k;
  const swing = 0.5 * spin * b.offset[1];
  const fwd = Math.min(MAX_FLING, Math.max(fling + swing, speed * (1 - def.scrub) + (b.kind === 'lamp' ? 9 : 7)));
  const lat = (LATERAL[0] + (LATERAL[1] - LATERAL[0]) * off) * fwd;
  const vx = ux * fwd + lx * lat, vz = uz * fwd + lz * lat;
  const hl = Math.hypot(vx, vz);
  const hx = vx / hl, hz = vz / hl;
  b.dirX = hx; b.dirZ = hz;
  b.vx = vx; b.vz = vz; b.vy = vy;
  b.wx = hz * spin; b.wz = -hx * spin;
  // A glancing blow drags its near side on with the car: a little yaw, more off the very edge.
  b.wy = off > 0 ? side * GLANCE_YAW * off * off : 0;
  b.contact = false; b.y += 0.02; // clear of the ground, so its first frame isn't a landing
  return { mode: b.mode, strength: speed, loss };
}

/**
 * Is the car driving into this knocked one (fallen, falling, or flying slower than the car)?
 * Any of its visible samples within `KICK_GAP` of the car's body, low enough to hit and ahead
 * of the car's middle. One still falling in front of a car under 4 isn't kicked: the bumper
 * pushes it along instead.
 */
export function debrisInWay(b, car, body = CAR_BODY) {
  if (b.mode === 'standing') return false;
  const speed = Math.hypot(car.vx, car.vz);
  if (speed < KICK_MIN) return false;
  // Still falling in front of a slow car: the bumper just pushes it along (clearOfCar), no kick.
  if (b.mode === 'topple' && b.theta < b.rest * 0.85 && speed < KICK_PUSH) return false;
  const ux = car.vx / speed, uz = car.vz / speed;
  const along = b.mode === 'launch' ? b.vx * ux + b.vz * uz : b.mode === 'topple' ? b.bvx * ux + b.bvz * uz : 0;
  if (along >= speed) return false; // already outrunning the car
  const cy = car.y ?? 0;
  if (b.y + b.low > cy + CAR_TOP) return false; // flying over it
  facing(car);
  const fx = FACE[0], fz = FACE[1];
  const pts = bodySamples(b), n = BREAKABLE[b.kind].visible;
  for (let i = 0; i < n; i++) {
    const p = pts[i], x = p[0], z = p[2], r = p[4];
    const dx = x - car.x, dz = z - car.z;
    if (p[1] - r > cy + carTop(dx * fx + dz * fz, body)) continue;
    if (dx * ux + dz * uz <= 0) continue; // behind the car's middle
    if (bodyDist(x, z, car.x, car.z, fx, fz, body) < r + KICK_GAP) return true;
  }
  return false;
}

/**
 * How far the car's body overlaps the body's visible parts, as seen along its facing (fx, fz):
 * OVER[0] the most any part ahead of its middle reaches back past the front bumper, OVER[1] the
 * most any part behind reaches past the rear one. Parts above the bonnet or roof don't count.
 */
const OVER = [0, 0];
function overlap(b, car, fx, fz, body) {
  OVER[0] = 0; OVER[1] = 0;
  const cy = car.y ?? 0;
  const pts = bodySamples(b), n = BREAKABLE[b.kind].visible;
  for (let i = 0; i < n; i++) {
    const p = pts[i], r = p[4];
    const dx = p[0] - car.x, dz = p[2] - car.z;
    const lz = dx * fx + dz * fz, lx = dx * fz - dz * fx;
    if (Math.abs(lx) >= body.hw + r || Math.abs(lz) >= body.hl + r) continue;
    if (p[1] - r > cy + carTop(lz, body)) continue;
    if (lz > 0) OVER[0] = Math.max(OVER[0], body.hl + r - lz);
    else OVER[1] = Math.max(OVER[1], body.hl + r + lz);
  }
  return OVER;
}

/** The sideways slide that takes every overlapping part ahead of the car's middle past its `side` (+1 or -1). */
function sideNeed(b, car, fx, fz, body, side) {
  const cy = car.y ?? 0;
  const pts = bodySamples(b), n = BREAKABLE[b.kind].visible;
  let need = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i], r = p[4];
    const dx = p[0] - car.x, dz = p[2] - car.z;
    const lz = dx * fx + dz * fz, lx = dx * fz - dz * fx;
    if (lz <= 0 || Math.abs(lx) >= body.hw + r || lz >= body.hl + r || p[1] - r > cy + carTop(lz, body)) continue;
    need = Math.max(need, body.hw + r - side * lx);
  }
  return need;
}

const SAVED = [0, 0, 0, 0, 0, 0];
function save(b) { SAVED[0] = b.x; SAVED[1] = b.z; SAVED[2] = b.baseX; SAVED[3] = b.baseZ; SAVED[4] = b.from.x; SAVED[5] = b.from.z; }
function restore(b) { b.x = SAVED[0]; b.z = SAVED[1]; b.baseX = SAVED[2]; b.baseZ = SAVED[3]; b.from.x = SAVED[4]; b.from.z = SAVED[5]; }
const groundPush = (b, env) => (b.mode === 'launch' && !b.contact ? airPush(env) : env.push);

/**
 * Last line of defence, run after each step: if any visible part of a knocked one sits inside
 * the car's body (a fresh launch's base swinging back as it tumbles, or a trunk the bumper has
 * reached), slide the whole body on along the car's facing so it reads as the car shoving it,
 * not a jump: up to CLEAR_STEP a frame, or for a falling one just over the car's own `step`. A
 * canopy above the bonnet doesn't count. With `env`, buildings and the plot edge still win: one
 * pinned against a wall slides sideways along it instead, towards the side with more room (and
 * if that can't clear it this frame, blockCar() stops the car). Returns true if it moved.
 */
export function clearOfCar(b, car, env = null, body = CAR_BODY, step = Infinity) {
  if (b.mode === 'standing') return false;
  facing(car);
  const fx = FACE[0], fz = FACE[1];
  const need = overlap(b, car, fx, fz, body)[0];
  if (need <= 0) { b.slideSide = 0; return false; }
  const most = b.mode === 'topple' ? Math.min(CLEAR_STEP, Math.max(step + 0.05, 0.1)) : CLEAR_STEP;
  const move = Math.min(need, most);
  const push = env ? groundPush(b, env) : null;
  save(b);
  shift(b, fx * move, fz * move);
  if (!push) return true;
  pushOut(b, push);
  const gained = (b.x - SAVED[0]) * fx + (b.z - SAVED[1]) * fz;
  if (gained > move * 0.5) { b.slideSide = 0; return true; }
  // Pinned: a wall ahead undoes the shove. Slide it along the wall to whichever side has room.
  restore(b);
  let best = 0, bestRoom = -Infinity;
  for (const side of b.slideSide ? [b.slideSide, -b.slideSide] : [1, -1]) {
    const want = sideNeed(b, car, fx, fz, body, side);
    if (want <= 0) continue;
    shift(b, fz * side * want, -fx * side * want);
    pushOut(b, push);
    const got = ((b.x - SAVED[0]) * fz - (b.z - SAVED[1]) * fx) * side;
    restore(b);
    const room = got / want - (side === b.slideSide ? 0 : 0.05); // stick with a side once chosen
    if (room > bestRoom) { bestRoom = room; best = side; }
  }
  if (!best || bestRoom <= 0.05) { b.slideSide = 0; return false; }
  b.slideSide = best;
  const slide = Math.min(sideNeed(b, car, fx, fz, body, best), CLEAR_STEP);
  shift(b, fz * best * slide, -fx * best * slide);
  pushOut(b, push);
  return true;
}

/**
 * Where a body is solid to the car: debris it could not shove clear (pinned against a wall),
 * one it is reversing or creeping into too slowly to kick, or a standing one it is resting
 * against too slowly to hit (caller decides which). Returns how to move the car back out,
 * { dx, dz, nx, nz } (n the unit direction), or null if they don't touch.
 */
const TOUCH = 0.01;
export function blockCar(b, car, body = CAR_BODY) {
  facing(car);
  const fx = FACE[0], fz = FACE[1];
  let front = 0, back = 0;
  if (b.mode === 'standing') {
    // Its trunk or pole as a circle on the ground.
    const dx = b.home.x - car.x, dz = b.home.z - car.z;
    const lz = dx * fx + dz * fz, lx = dx * fz - dz * fx;
    if (Math.abs(lx) >= body.hw + b.r || Math.abs(lz) >= body.hl + b.r) return null;
    if (lz > 0) front = body.hl + b.r - lz; else back = body.hl + b.r + lz;
  } else {
    overlap(b, car, fx, fz, body);
    front = OVER[0]; back = OVER[1];
  }
  if (front <= TOUCH && back <= TOUCH) return null; // float dust from an exact slide isn't contact
  // Back off the way it came: moving forwards it backs away from what is ahead, and vice versa.
  const vf = (car.vx ?? 0) * fx + (car.vz ?? 0) * fz;
  const backward = back <= 0 || (front > 0 && (vf > 0.01 || (Math.abs(vf) <= 0.01 && front <= back)));
  const d = backward ? front : back, s = backward ? -1 : 1;
  return { dx: fx * s * d, dz: fz * s * d, nx: fx * s, nz: fz * s };
}

/**
 * The car kicks a knocked one again: ahead of the car by at least 4 and off to the side of the
 * car its middle is on (8 for a tree, 4 for a lamp), all scaled down below a car speed of 4. One lying, settling or still falling is
 * shoved along the ground on its hinge (base and crown stay down) and swings round towards the
 * car's line on its trailing end (the one already off to the side), the end across the car's
 * path going first; a second kick keeps the swing it has. One still flying is
 * sent on, no lift.
 */
export function rekick(b, car, now, { reduced = false, rand = Math.random } = {}) {
  const speed = Math.hypot(car.vx, car.vz) || 1;
  const ux = car.vx / speed, uz = car.vz / speed;
  const cur = b.mode === 'launch' ? b.vx * ux + b.vz * uz : b.bvx * ux + b.bvz * uz;
  const k = Math.min(1, speed / KICK_PUSH); // a crawling car nudges it rather than flinging it
  let fwd = Math.max(cur, speed + KICK_EXTRA * k);
  let side = KICK_SIDE[b.kind] * k;
  // Reduced motion: a short shove off the car's line, never a long slide or a ride along with it.
  if (reduced || b.calm) { fwd = Math.min(fwd, REDUCED_PUSH); side = Math.max(side, 6); }
  b.knockedAt = now; b.source.down = true; b.asleep = false; b.still = 0;
  if (b.mode === 'launch') {
    if (reduced || b.calm) return b; // never in the air under reduced motion
    sideOf(b.x, b.z, car, ux, uz, rand);
    b.vx = ux * fwd + SIDE[0] * side; b.vz = uz * fwd + SIDE[1] * side; b.vy = Math.max(b.vy, 0);
    return b;
  }
  if (!b.hinge) toHinge(b);
  const def = BREAKABLE[b.kind];
  if (b.mode !== 'topple') { b.theta = b.rest; b.omega = 0; }
  if (b.rest < def.rest) b.rest = def.rest; // off the wall it leant on: it may fall the rest of the way
  b.mode = 'topple';
  const half = b.height * 0.5 * Math.sin(b.theta);
  const ex = b.dirX * half, ez = b.dirZ * half;
  sideOf(b.baseX + ex, b.baseZ + ez, car, ux, uz, rand);
  const lx = SIDE[0], lz = SIDE[1];
  b.bvx = ux * fwd + lx * side; b.bvz = uz * fwd + lz * side;
  if (reduced || b.calm) { b.yawRate = 0; return b; }
  b.yawX = ux; b.yawZ = uz;
  if (b.yawRate) return b; // already swinging round: carry on the same way
  // Already lined up with the car's travel: no swing.
  if (Math.abs(b.dirX * uz - b.dirZ * ux) < 0.1) return b;
  // The end on the far side from where it is going swings forward, pivoting on the trailing end
  // (already on the side it is going), so no part of it swings back towards the car.
  const s = ex * lx + ez * lz > 0 ? -1 : 1;
  b.yawPivot = s < 0 ? 1 : 0; // the trailing end: 0 the base, 1 the top
  const turn = s * (ez * ux - ex * uz);
  b.yawRate = (turn < 0 ? -1 : 1) * KICK_YAW * k;
  return b;
}

/**
 * Advance one step. env: { groundAt(x, z), solidAt?(x, z) for a falling top meeting a building,
 * push?(x, z, r) => { x, z, nx, nz } | null to keep the body out of buildings' plots and in the
 * town, pushWalls?(x, z, r) the same for real walls only (in the air), car? to never throw it
 * back at the car }. See worldEnv() for the town's.
 */
export function stepBreakable(b, dt, env) {
  if (!(dt > 0) || b.mode === 'standing' || b.mode === 'down') return b;
  if (b.mode === 'topple') return stepTopple(b, dt, env);
  if (b.mode === 'settle') return stepSettle(b, dt, env);
  return stepLaunch(b, dt, env);
}

/** Does any sample (the top, the canopy) reach a wall at lean `th`? Each reaches out its own radius. */
function wallAt(b, th, env) {
  const sn = Math.sin(Math.min(th, Math.PI / 2));
  for (let i = 0; i < b.local.length; i++) {
    const l = b.local[i];
    const along = l[1] + b.offset[1];
    if (along < 0.5) continue; // the base is on the ground, not falling into anything
    const reach = along * sn + l[3];
    if (env.solidAt(b.baseX + b.dirX * reach, b.baseZ + b.dirZ * reach)) return true;
  }
  return false;
}

/** Ground friction on a sliding base (bvx, bvz). */
function slide(b, dt) {
  const hs = Math.hypot(b.bvx, b.bvz);
  if (hs <= 0) return;
  const f = Math.max(0, hs - 0.55 * GRAVITY * dt) / hs;
  b.bvx *= f; b.bvz *= f;
  b.baseX += b.bvx * dt; b.baseZ += b.bvz * dt;
}

/** A kicked one swings round on its trailing end until it lines up with the kick (yawX, yawZ). */
function swing(b, dt) {
  if (!b.yawRate) return;
  const a = b.yawRate * dt, c = Math.cos(a), s = Math.sin(a);
  const half = b.height * Math.sin(b.theta) * b.yawPivot;
  const mx = b.baseX + b.dirX * half, mz = b.baseZ + b.dirZ * half;
  const before = b.dirX * b.yawZ - b.dirZ * b.yawX;
  // Same sense as a turn about +y (hingePose's yaw): (x, z) -> (x c + z s, -x s + z c).
  const dx = b.dirX * c + b.dirZ * s, dz = -b.dirX * s + b.dirZ * c;
  b.dirX = dx; b.dirZ = dz; b.yaw += a;
  b.baseX = mx - dx * half; b.baseZ = mz - dz * half;
  const after = dx * b.yawZ - dz * b.yawX;
  // Lined up (either end first), or the slide has stopped: no more swing.
  if (Math.sign(after) !== Math.sign(before) || Math.abs(after) < 0.05 || (b.bvx === 0 && b.bvz === 0)) b.yawRate = 0;
}

function stepTopple(b, dt, env) {
  // Base slides with the knock, then friction holds it.
  slide(b, dt);
  swing(b, dt);
  // A rod falling about its end: theta'' = (3 g / 2 L) sin theta.
  const L = b.height;
  b.omega += (1.5 * GRAVITY / L) * Math.sin(Math.max(b.theta, 0.02)) * dt;
  let next = b.theta + b.omega * dt;
  // Its top meeting a building stops the fall there: it leans on the wall.
  if (env.solidAt && b.omega > 0 && wallAt(b, Math.min(next, b.rest), env)) {
    // Find where between this frame and the next the top meets the wall, whatever the frame rate.
    let lo = b.theta, hi = Math.min(next, b.rest);
    if (wallAt(b, lo, env)) hi = lo;
    else for (let i = 0; i < 8; i++) { const mid = (lo + hi) / 2; if (wallAt(b, mid, env)) hi = mid; else lo = mid; }
    b.rest = Math.max(0.05, lo);
    next = b.rest;
  }
  if (next >= b.rest) {
    next = b.rest;
    // A small, quick bounce where it lands (none under reduced motion); then still once the
    // base has stopped sliding.
    if (b.omega > 2.2 && !b.calm) b.omega = -b.omega * 0.18;
    else { b.omega = 0; if (b.bvx === 0 && b.bvz === 0) { b.mode = 'down'; b.yawRate = 0; } }
  }
  b.theta = Math.max(0, next);
  hingePose(b);
  // Leaning on a wall: its top is meant to be at the building, so only the plot edge pushes.
  const leaning = b.rest < BREAKABLE[b.kind].rest;
  const hit = pushOut(b, leaning && env.pushPlot ? env.pushPlot : env.push);
  if (hit) {
    const vn = b.bvx * hit.nx + b.bvz * hit.nz;
    if (vn < 0) { b.bvx -= vn * hit.nx; b.bvz -= vn * hit.nz; }
    neverAtCar(b, env, 'bvx', 'bvz');
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
    const keep = b.kind === 'lamp' ? (b.landed ? 0.2 : 0.28) : 0.45;
    b.vx *= keep; b.vz *= keep;
    b.wx *= 0.55; b.wy *= 0.55; b.wz *= 0.55;
    b.landed++;
  }
  if (b.contact && b.kind === 'lamp') {
    // A long pole drags along the ground: twice a box's friction once it is down. With the harder
    // later landings, a launched lamp post slides about half as far as a box would.
    const hs = Math.hypot(b.vx, b.vz);
    if (b.landed && hs > 0) { const f = Math.max(0, hs - 0.55 * GRAVITY * dt) / hs; b.vx *= f; b.vz *= f; }
    // Landed on its foot (or its head): it topples over rather than skating upright.
    const tip = tipAngle(b);
    if (tip < UPRIGHT || tip > Math.PI - UPRIGHT) tipOver(b, dt);
  }
  // In the air only real walls push (spin and gravity carry on); on the ground the plot eases it off.
  const hit = b.contact ? groundPushOut(b, env, Math.max(0.12, PLOT_RATE * dt)) : pushOut(b, airPush(env));
  if (hit) {
    const vn = b.vx * hit.nx + b.vz * hit.nz;
    if (vn < 0) { b.vx -= 1.3 * vn * hit.nx; b.vz -= 1.3 * vn * hit.nz; }
    neverAtCar(b, env, 'vx', 'vz');
  }
  b.low = lowestOffset(b);
  // A tree rolls onto its crown as soon as it lands slowly enough.
  if (b.kind === 'tree' && b.contact && b.landed && Math.hypot(b.vx, b.vz) < SETTLE_SPEED && beginSettle(b, env)) return b;
  if (b.asleep || (b.contact && b.still > TIP_PAUSE) || b.flying > 12) {
    b.vx = b.vy = b.vz = b.wx = b.wy = b.wz = 0;
    if (b.kind !== 'tree' || !beginSettle(b, env)) { b.mode = 'down'; pushOut(b, env.push); }
  }
  return b;
}

/**
 * A pole on the ground near upright (or upside down): tip it on over the way it already leans
 * (or the way it is going, if it is dead upright) at 4 rad/s or more, and stop it skating.
 */
function tipOver(b, dt) {
  const v = b.tmpV;
  v[0] = 0; v[1] = 1; v[2] = 0;
  rotate(b.q, v, v);
  let hx = v[0], hz = v[2], hl = Math.hypot(hx, hz);
  if (hl < 0.1) { hx = b.vx; hz = b.vz; hl = Math.hypot(hx, hz); }
  if (hl < 1e-6) { hx = b.dirX; hz = b.dirZ; hl = Math.hypot(hx, hz) || 1; }
  hx /= hl; hz /= hl;
  // Turning about (hz, 0, -hx) swings its +y end towards (hx, hz); upside down, the other way.
  const sg = v[1] >= 0 ? 1 : -1;
  const w = sg * (b.wx * hz - b.wz * hx);
  if (w < 4) { b.wx += sg * hz * (4 - w); b.wz -= sg * hx * (4 - w); }
  const k = Math.exp(-12 * dt);
  b.vx *= k; b.vz *= k;
}

/** Where the body's base, fall line and yaw are, from its pose: HINGE = [baseX, baseZ, dirX, dirZ, yaw]. */
const HINGE = [0, 0, 0, 1, 0];
function hingeFromPose(b, rest) {
  const v = b.tmpV;
  v[0] = 0; v[1] = 1; v[2] = 0;
  rotate(b.q, v, v);
  let dx = v[0], dz = v[2];
  const dl = Math.hypot(dx, dz);
  if (dl > 1e-6) { dx /= dl; dz /= dl; } else { dx = b.dirX; dz = b.dirZ; }
  rotate(b.q, b.offset, v);
  HINGE[0] = b.x - v[0]; HINGE[1] = b.z - v[2]; HINGE[2] = dx; HINGE[3] = dz;
  // Keep its spin about its own axis: the yaw left over once the lean is taken out.
  const lean = qAxis(dz, 0, -dx, rest, b.tmpQ2);
  lean[0] = -lean[0]; lean[1] = -lean[1]; lean[2] = -lean[2];
  const yaw = qMul(lean, b.q, b.tmpQ);
  HINGE[4] = 2 * Math.atan2(yaw[1], yaw[3]);
  return HINGE;
}

/** One that came to rest from a launch, put back on its hinge (lying at its rest lean) so it can be shoved. */
function toHinge(b) {
  const rest = BREAKABLE[b.kind].rest;
  const h = hingeFromPose(b, rest);
  const groundY = b.y + lowestOffset(b);
  b.baseX = h[0]; b.baseZ = h[1]; b.dirX = h[2]; b.dirZ = h[3]; b.twist = wrapAngle(h[4] - b.home.rot);
  b.theta = rest; b.rest = rest; b.omega = 0; b.yaw = 0; b.groundY = groundY; b.hinge = true;
  b.vx = b.vy = b.vz = b.wx = b.wy = b.wz = 0;
  hingePose(b);
}

/**
 * A launched tree lies on its box, trunk floating and canopy sunk. Roll it into the toppled
 * resting pose instead: trunk base on the ground where it lies, crown on the ground beyond,
 * still sliding with whatever ground speed it had. Returns false (and leaves it as it is) where
 * the ground isn't flat enough for that.
 */
function beginSettle(b, env) {
  const rest = BREAKABLE[b.kind].rest;
  const h = hingeFromPose(b, rest);
  const baseX = h[0], baseZ = h[1], dx = h[2], dz = h[3];
  // The toppled pose assumes flat ground from trunk to crown; across a ramp's edge it stays as it landed.
  const crown = b.height * Math.sin(rest);
  const g0 = env.groundAt(baseX, baseZ), g1 = env.groundAt(baseX + dx * crown, baseZ + dz * crown);
  if (Math.abs(g1 - g0) > 0.2 || Math.abs(env.groundAt(b.x, b.z) - g0) > 0.2) return false;
  const f = b.from;
  f.x = b.x; f.y = b.y; f.z = b.z; f.q[0] = b.q[0]; f.q[1] = b.q[1]; f.q[2] = b.q[2]; f.q[3] = b.q[3];
  b.mode = 'settle'; b.settleT = 0; b.baseX = baseX; b.baseZ = baseZ; b.dirX = dx; b.dirZ = dz;
  b.theta = rest; b.rest = rest; b.omega = 0; b.bvx = b.vx; b.bvz = b.vz; b.yaw = 0; b.yawRate = 0;
  b.twist = wrapAngle(h[4] - b.home.rot); b.groundY = g0; b.hinge = true;
  b.vx = b.vy = b.vz = b.wx = b.wy = b.wz = 0;
  return true;
}

function stepSettle(b, dt, env) {
  b.settleT += dt;
  // Carries on sliding (the start pose with it), friction slowing it.
  const bx = b.baseX, bz = b.baseZ;
  slide(b, dt);
  b.from.x += b.baseX - bx; b.from.z += b.baseZ - bz;
  const t = Math.min(1, b.settleT / SETTLE);
  const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; // ease in-out: it moves on screen
  hingePose(b);
  const f = b.from;
  b.x = f.x + (b.x - f.x) * e; b.y = f.y + (b.y - f.y) * e; b.z = f.z + (b.z - f.z) * e;
  qSlerp(f.q, b.q, e, b.q);
  const hit = groundPushOut(b, env, t >= 1 ? Infinity : Math.max(0.12, PLOT_RATE * dt));
  if (hit) {
    const vn = b.bvx * hit.nx + b.bvz * hit.nz;
    if (vn < 0) { b.bvx -= vn * hit.nx; b.bvz -= vn * hit.nz; }
  }
  b.low = lowestOffset(b);
  if (t >= 1) {
    if (b.bvx || b.bvz) b.mode = 'topple'; // still sliding: finish on the hinge, already at rest lean
    else b.mode = 'down';
  }
  return b;
}

/**
 * The town's env for stepBreakable from world { colliders, places?, plotHalf, plotCorner,
 * groundHeightAt }. Only real buildings (not building sites) count; low solids (benches,
 * fountain, signs) let a body fall past or over them. On the ground bodies are pushed out of a
 * building's whole plot and kept inside the town's plot; in the air only out of its real walls
 * (places.js WALLS, grown by WALL_NEAR), so nothing hangs on a garden's invisible edge. A falling
 * top only catches (and leans) on those walls, never on an open forecourt or garden.
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
  const allWalls = walls.flat();
  const { plotHalf, plotCorner } = world;
  const solidAt = (x, z) => {
    for (let i = 0; i < plots.length; i++) {
      if (!pointInside(x, z, plots[i])) continue;
      for (const w of walls[i]) if (pointInside(x, z, w)) return true;
    }
    return false;
  };
  const pushOutOf = (list) => (x, z, r) => {
    for (const c of list) {
      const reach = r + (c.type === 'circle' ? c.r : Math.hypot(c.hw, c.hd));
      if (Math.abs(x - c.x) > reach || Math.abs(z - c.z) > reach) continue;
      const hit = c.type === 'circle' ? circleVsCircle(x, z, r, c.x, c.z, c.r) : circleVsBox(x, z, r, c);
      if (hit) return { x: x + hit.nx * hit.depth, z: z + hit.nz * hit.depth, nx: hit.nx, nz: hit.nz };
    }
    return null;
  };
  const pushBuildings = pushOutOf(plots), pushJustWalls = pushOutOf(allWalls);
  const pushPlot = (x, z, r) => {
    if (plotDistance(x, z, plotHalf, plotCorner) <= -r) return null;
    const edge = clampToPlot(x, z, r, plotHalf, plotCorner);
    return edge.hit ? edge : null;
  };
  const push = (x, z, r) => pushBuildings(x, z, r) ?? pushPlot(x, z, r);
  const pushWalls = (x, z, r) => pushJustWalls(x, z, r) ?? pushPlot(x, z, r);
  return { groundAt: world.groundHeightAt, solidAt, push, pushWalls, pushBuildings, pushPlot, car: null };
}

/**
 * Back to its spot 20 seconds after the knock, but only while neither its spot nor where it lies
 * is on screen (`visible`) and the car is well clear of the spot.
 */
export function canRestore(b, now, visible, carX, carZ) {
  if (!isKnocked(b) || now - b.knockedAt < RESET_AFTER || visible) return false;
  return Math.hypot(carX - b.home.x, carZ - b.home.z) > RESET_CLEAR + b.r + 1.35;
}
