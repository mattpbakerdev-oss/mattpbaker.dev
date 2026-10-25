// Pure 2D (x, z) checks for the chase camera: what stands between it and the car (so it can be
// faded) and how far it may sit from the car. No three.js.

/** Fraction 0..1 along a -> b where the segment first enters any shape (1 if it never does). */
export function segmentHit(ax, az, bx, bz, shapes) {
  return firstHit(ax, az, bx, bz, shapes).t;
}

/** Like segmentHit, but also says which shape was hit: { t, shape } (shape null if none). */
export function firstHit(ax, az, bx, bz, shapes) {
  let best = 1, hit = null;
  const dx = bx - ax, dz = bz - az;
  for (const s of shapes) {
    const t = s.type === 'circle' ? circleHit(ax, az, dx, dz, s) : boxHit(ax, az, dx, dz, s);
    if (t !== null && t < best) { best = t; hit = s; }
  }
  return { t: best, shape: hit };
}

function circleHit(ax, az, dx, dz, c) {
  const fx = ax - c.x, fz = az - c.z;
  const cc = fx * fx + fz * fz - c.r * c.r;
  if (cc <= 0) return null; // starts inside: ignore rather than collapse onto the car
  const a = dx * dx + dz * dz;
  if (a < 1e-12) return null;
  const b = 2 * (fx * dx + fz * dz);
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

function boxHit(ax, az, dx, dz, box) {
  // Into the box's own frame (same rotation convention as physics.js).
  const cos = Math.cos(box.rot || 0), sin = Math.sin(box.rot || 0);
  const wx = ax - box.x, wz = az - box.z;
  const ox = wx * cos - wz * sin, oz = wx * sin + wz * cos;
  const vx = dx * cos - dz * sin, vz = dx * sin + dz * cos;
  if (Math.abs(ox) < box.hw && Math.abs(oz) < box.hd) return null;
  let t0 = 0, t1 = 1;
  for (const [o, v, h] of [[ox, vx, box.hw], [oz, vz, box.hd]]) {
    if (Math.abs(v) < 1e-12) { if (Math.abs(o) > h) return null; continue; }
    let ta = (-h - o) / v, tb = (h - o) / v;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return t0;
}

function inside(x, z, s) {
  if (s.type === 'circle') return (x - s.x) ** 2 + (z - s.z) ** 2 < s.r * s.r;
  const cos = Math.cos(s.rot || 0), sin = Math.sin(s.rot || 0);
  const wx = x - s.x, wz = z - s.z;
  return Math.abs(wx * cos - wz * sin) < s.hw && Math.abs(wx * sin + wz * cos) < s.hd;
}

/** True when the point (x, z) is inside the shape. */
export const pointInside = inside;

/** Does a -> b start in the shape, or enter it before fraction `maxT` (or end in it, if `ends`)? */
function touches(ax, az, bx, bz, s, maxT = 1, ends = true) {
  if (inside(ax, az, s) || (ends && inside(bx, bz, s))) return true;
  const dx = bx - ax, dz = bz - az;
  const t = s.type === 'circle' ? circleHit(ax, az, dx, dz, s) : boxHit(ax, az, dx, dz, s);
  return t !== null && t < maxT;
}

/**
 * Fills `out` with the shapes that hide the car from a camera at (cx, cz): any shape crossed by
 * the line to the car's centre or that the camera is in, plus anything crossing the lines to
 * points `half` either side of the car well before it gets there (so a wall the car is merely
 * driving beside doesn't fade).
 * Returns `out` (cleared first) so the caller can reuse one array every frame.
 */
export function blockers(cx, cz, carX, carZ, shapes, half, out = []) {
  out.length = 0;
  const dx = carX - cx, dz = carZ - cz;
  const len = Math.hypot(dx, dz) || 1;
  const px = (-dz / len) * half, pz = (dx / len) * half; // sideways, across the view
  for (const s of shapes) {
    if (touches(cx, cz, carX, carZ, s) ||
      touches(cx, cz, carX + px, carZ + pz, s, 0.85, false) || touches(cx, cz, carX - px, carZ - pz, s, 0.85, false)) out.push(s);
  }
  return out;
}

/**
 * The colliders tall enough to hide the car: buildings (not the low building-site fences) and
 * trees, whose canopy is far wider than the trunk collider. Padded so the lens stays clear.
 * `key` names the mesh to fade: `b:<place id>` or `t:<tree index>`.
 */
export function cameraOccluders(colliders, pad = 0.5) {
  const out = [];
  for (const c of colliders) {
    if (c.kind === 'building' && !String(c.id ?? '').startsWith('site')) {
      out.push({ type: 'box', x: c.x, z: c.z, hw: c.hw + pad, hd: c.hd + pad, rot: c.rot, kind: 'building', key: `b:${c.id}` });
    } else if (c.kind === 'tree') {
      const scale = (c.r - 0.15) / 0.45; // world.js: r = 0.45 * scale + 0.15
      out.push({ type: 'circle', x: c.x, z: c.z, r: 1.6 * scale + pad * 0.4, kind: 'tree', key: `t:${c.tree}` });
    }
  }
  return out;
}
