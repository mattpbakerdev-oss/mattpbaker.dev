// Pure logic for the townsfolk: walking a short loop on the pavement, hopping clear when the
// car hits them (never harmed, never knocked over), and turning to look at a horn. No three.js.

const GRAVITY = 25;
const HOP_UP = 5.5;
const HOP_SIDE = 3.2;
const RETURN_SPEED = 1.6;
const TURN_RATE = 8;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Paths sit on the pavement (about 6.5 off the road centreline) between lamp posts.
// look: shirt, trousers, skin, hair.
export const TOWNSFOLK = [
  { id: 'gym-goer', line: 'Have you seen the gym? The phone won’t let me in until I do push-ups.',
    path: [[21, -6.6], [29.5, -6.6]], look: ['#e8735a', '#3d4a6b', '#e9b48f', '#3a2a22'] },
  { id: 'renter', line: 'I rented a flat in Bangkok. The listing scored 98.',
    path: [[-6.6, -53], [-6.6, -45]], look: ['#5bb5a2', '#2c2526', '#c98e6a', '#1f1a18'] },
  { id: 'film-fan', line: 'They filmed a video here. Captions and everything.',
    path: [[-63.6, 44], [-63.6, 49.5]], look: ['#8f7ad8', '#5a4a3a', '#f1c9a5', '#c99a30'] },
  { id: 'friend', line: 'Matt’s looking for a product role, you know. Just saying.',
    path: [[51.5, 6.6], [58.5, 6.6]], look: ['#f2c14e', '#3a6b5a', '#8d5a3c', '#2a1f1a'] },
];

export function loopLength(path) {
  let len = 0;
  for (let i = 0; i < path.length; i++) {
    const [ax, az] = path[i], [bx, bz] = path[(i + 1) % path.length];
    len += Math.hypot(bx - ax, bz - az);
  }
  return len;
}

/** Point and walking direction at distance s round a closed loop (two points: there and back). */
export function pointOnLoop(path, s) {
  const total = loopLength(path);
  let d = ((s % total) + total) % total;
  for (let i = 0; i < path.length; i++) {
    const [ax, az] = path[i], [bx, bz] = path[(i + 1) % path.length];
    const len = Math.hypot(bx - ax, bz - az);
    if (d <= len || i === path.length - 1) {
      const t = len ? Math.min(1, d / len) : 0;
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx: len ? (bx - ax) / len : 0, dz: len ? (bz - az) / len : 1 };
    }
    d -= len;
  }
  return { x: path[0][0], z: path[0][1], dx: 0, dz: 1 };
}

export function createWalker({ path, speed = 1.1, s = 0, reducedMotion = false, line = '' }) {
  const p = pointOnLoop(path, s);
  return {
    path, speed, s, line, reducedMotion,
    x: p.x, z: p.z, y: 0, vy: 0, ox: 0, oz: 0, hvx: 0, hvz: 0,
    heading: Math.atan2(p.dx, p.dz), hopping: false, hopTime: 0,
    cooldown: 0, saying: null, sayTimer: 0, lookTimer: 0, stride: 0,
  };
}

/** The car { x, z, vx, vz } ran into them: leap aside, away from the car's path, and say so. */
export function hitWalker(w, car) {
  if (w.cooldown > 0) return false;
  let ax = w.x - car.x, az = w.z - car.z;
  const al = Math.hypot(ax, az) || 1;
  ax /= al; az /= al;
  const sp = Math.hypot(car.vx, car.vz);
  const dx = sp > 0.1 ? car.vx / sp : -ax, dz = sp > 0.1 ? car.vz / sp : -az;
  let px = -dz, pz = dx; // across the car's path, towards the side they are already on
  if (px * ax + pz * az < 0) { px = -px; pz = -pz; }
  w.hvx = px * HOP_SIDE + ax;
  w.hvz = pz * HOP_SIDE + az;
  w.vy = w.reducedMotion ? 0 : HOP_UP;
  w.hopping = true;
  w.hopTime = 0;
  w.cooldown = 1.2;
  w.saying = 'Oi!';
  w.sayTimer = 1.6;
  w.lookTimer = 0;
  return true;
}

/** Someone honked: stop and look at the car for a moment. */
export function hornWalker(w, seconds = 2.2) {
  if (!w.hopping) w.lookTimer = seconds;
}

export function stepWalker(w, dt, car) {
  w.cooldown = Math.max(0, w.cooldown - dt);
  if (w.sayTimer > 0 && (w.sayTimer -= dt) <= 0) { w.saying = null; w.sayTimer = 0; }
  let target = w.heading;

  if (w.hopping) {
    w.hopTime += dt;
    w.ox += w.hvx * dt; w.oz += w.hvz * dt;
    if (w.reducedMotion) {
      if (w.hopTime > 0.45) w.hopping = false;
    } else {
      w.vy -= GRAVITY * dt;
      w.y += w.vy * dt;
      if (w.y <= 0 && w.vy < 0) { w.y = 0; w.vy = 0; w.hopping = false; }
    }
  } else {
    // Shuffle back onto the pavement line while carrying on.
    const off = Math.hypot(w.ox, w.oz);
    if (off > 0) {
      const k = Math.max(0, off - RETURN_SPEED * dt) / off;
      w.ox *= k; w.oz *= k;
    }
    if (w.lookTimer > 0 && car) {
      w.lookTimer = Math.max(0, w.lookTimer - dt);
      target = Math.atan2(car.x - w.x, car.z - w.z);
    } else {
      w.lookTimer = 0;
      w.s += w.speed * dt;
      w.stride += w.speed * dt;
      const p = pointOnLoop(w.path, w.s);
      target = Math.atan2(p.dx, p.dz);
    }
  }
  const p = pointOnLoop(w.path, w.s);
  w.x = p.x + w.ox; w.z = p.z + w.oz;
  w.heading = wrap(w.heading + wrap(target - w.heading) * (1 - Math.exp(-TURN_RATE * dt)));
  return w;
}
