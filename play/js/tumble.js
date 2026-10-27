// Pure rigid-body maths for the knock-over props (cones, bins, crates, fence panels). Each prop
// is a box for ground contact. Quaternions are [x, y, z, w]. No three.js, so node can test it.

export const PROP_KINDS = {
  cone: { half: [0.3, 0.5, 0.3], mass: 1, r: 0.35 },
  bin: { half: [0.36, 0.55, 0.36], mass: 3, r: 0.45 },
  crate: { half: [0.48, 0.48, 0.48], mass: 5, r: 0.6 },
  fence: { half: [1.0, 0.55, 0.07], mass: 4, r: 1.0 }, // hit-tested as a box, not a circle
};

const CAR_MASS = 12;
const RESTITUTION = 0.4;
const GRAVITY = 25;
const MAX_SPEED = 30;

export function createBody(kind, x, z, rot = 0) {
  const b = { kind, home: { x, z, rot } };
  return resetBody(b);
}

export function resetBody(b) {
  const { x, z, rot } = b.home;
  Object.assign(b, {
    x, z, y: PROP_KINDS[b.kind].half[1],
    q: [0, Math.sin(rot / 2), 0, Math.cos(rot / 2)],
    vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0,
    knocked: false, knockedAt: -Infinity, contact: true, still: 0, asleep: false,
  });
  return b;
}

/** Row 1 of the rotation matrix: how far each local axis points up. */
function upRow(q) {
  const [x, y, z, w] = q;
  return [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)];
}

/** How far below its centre the prop's lowest corner reaches (negative). */
export function lowestOffset(b) {
  const [hx, hy, hz] = b.half ?? PROP_KINDS[b.kind].half; // breakaway.js bodies carry their own box
  const [m0, m1, m2] = upRow(b.q);
  return -(Math.abs(m0) * hx + Math.abs(m1) * hy + Math.abs(m2) * hz);
}

/**
 * The car { x, z, vx, vz } hits the prop. A momentum share of the car's velocity (light props
 * fly further), a push straight away from the car, a hop, a tip forward and a little yaw.
 */
export function knock(b, car, now) {
  const kind = PROP_KINDS[b.kind];
  let nx = b.x - car.x, nz = b.z - car.z;
  const nl = Math.hypot(nx, nz) || 1;
  nx /= nl; nz /= nl;
  const share = ((1 + RESTITUTION) * CAR_MASS) / (CAR_MASS + kind.mass);
  const speed = Math.hypot(car.vx, car.vz);
  const push = 1.6 + speed * 0.15;
  b.vx = car.vx * share + nx * push;
  b.vz = car.vz * share + nz * push;
  const hs = Math.hypot(b.vx, b.vz);
  if (hs > MAX_SPEED) { b.vx *= MAX_SPEED / hs; b.vz *= MAX_SPEED / hs; }
  b.vy = 1.4 + Math.min(speed, 28) * 0.28 / Math.sqrt(kind.mass);
  // Tip over the way it is going: rotate about the horizontal axis across the motion.
  const dl = Math.hypot(b.vx, b.vz) || 1;
  const tip = (2 + speed * 0.45) / (1 + kind.half[1]);
  b.wx = (b.vz / dl) * tip;
  b.wz = (-b.vx / dl) * tip;
  // Glancing blows spin it round (offset across the car's direction of travel).
  b.wy = (nx * car.vz - nz * car.vx) * 0.25 + (speed > 1 ? 0.6 : 0);
  Object.assign(b, { knocked: true, knockedAt: now, contact: false, still: 0, asleep: false });
  return b;
}

/** Advance one step. groundAt(x, z) gives the ground height under the prop. */
export function stepBody(b, dt, groundAt) {
  if (!b.knocked || b.asleep || !(dt > 0)) return b;
  b.vy -= GRAVITY * dt;
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  integrate(b.q, b.wx, b.wy, b.wz, dt);

  const ground = groundAt(b.x, b.z);
  const low = b.y + lowestOffset(b);
  b.contact = low <= ground + 0.01;
  if (low < ground) {
    b.y += ground - low;
    if (b.vy < 0) b.vy = b.vy < -1.5 ? -b.vy * 0.35 : 0;
    // Sliding friction (a steady drag) plus a little rolling loss.
    const hs = Math.hypot(b.vx, b.vz);
    if (hs > 0) {
      const k = Math.max(0, hs - 0.55 * GRAVITY * dt) / hs;
      b.vx *= k; b.vz *= k;
    }
    const spin = Math.exp(-4 * dt);
    b.wx *= spin; b.wy *= spin; b.wz *= spin;
    settle(b, dt);
  }
  const moving = Math.hypot(b.vx, b.vy, b.vz) + Math.hypot(b.wx, b.wy, b.wz);
  b.still = b.contact && moving < 0.15 ? b.still + dt : 0;
  if (b.still > 0.3) Object.assign(b, { vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, asleep: true });
  return b;
}

const ALL_AXES = [0, 1, 2];

/** On the ground, roll towards the nearest flat face so nothing balances on a corner. */
function settle(b, dt) {
  const up = upRow(b.q);
  // Tall bodies (breakaway.js) list only the faces they may lie on, so they never end on an end.
  const axes = b.lieAxes ?? ALL_AXES;
  let i = axes[0];
  for (const k of axes) if (Math.abs(up[k]) > Math.abs(up[i])) i = k;
  // World direction of local axis i (column i of the rotation matrix), flipped to point up.
  const [x, y, z, w] = b.q;
  const cols = [
    [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)],
    [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)],
    [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)],
  ];
  const s = cols[i][1] >= 0 ? 1 : -1;
  const ax = cols[i][0] * s, az = cols[i][2] * s;
  // a x up = (-az, 0, ax) turns a towards up.
  const k = 60 * dt;
  b.wx += -az * k; b.wz += ax * k;
  const damp = Math.exp(-6 * dt);
  b.wx *= damp; b.wz *= damp;
}

function integrate(q, wx, wy, wz, dt) {
  const [x, y, z, w] = q;
  const h = dt * 0.5;
  q[0] = x + h * (wx * w + wy * z - wz * y);
  q[1] = y + h * (wy * w + wz * x - wx * z);
  q[2] = z + h * (wz * w + wx * y - wy * x);
  q[3] = w + h * (-wx * x - wy * y - wz * z);
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l;
}

export function isResting(b) {
  return b.knocked && b.contact && Math.hypot(b.vx, b.vz) < 0.05 && Math.hypot(b.wx, b.wy, b.wz) < 0.05;
}

/** Back to its spot 20 seconds after the last knock, but only while nobody is looking. */
export function shouldReset(b, now, visible) {
  return b.knocked && now - b.knockedAt >= 20 && !visible;
}
