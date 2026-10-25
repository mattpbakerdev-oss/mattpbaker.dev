// Pure 2D (x, z) geometry for the arcade car. No three.js, so node can test it.
//
// Rotation convention matches three.js rotation.y: a local point (lx, lz) sits in the world at
// (lx cos r + lz sin r, -lx sin r + lz cos r). Heading 0 faces +z.

/** Circle A against circle B. Returns the push for A ({ nx, nz } unit, depth) or null. */
export function circleVsCircle(ax, az, ar, bx, bz, br) {
  const dx = ax - bx, dz = az - bz;
  const dist = Math.hypot(dx, dz);
  const depth = ar + br - dist;
  if (depth <= 0) return null;
  if (dist < 1e-9) return { nx: 1, nz: 0, depth };
  return { nx: dx / dist, nz: dz / dist, depth };
}

/** Circle against a box { x, z, hw, hd, rot } (half sizes along its local x and z). */
export function circleVsBox(cx, cz, r, box) {
  const cos = Math.cos(box.rot || 0), sin = Math.sin(box.rot || 0);
  const wx = cx - box.x, wz = cz - box.z;
  const lx = wx * cos - wz * sin;
  const lz = wx * sin + wz * cos;

  let nlx, nlz, depth;
  if (Math.abs(lx) <= box.hw && Math.abs(lz) <= box.hd) {
    // Centre is inside: leave through the nearest face.
    const ex = box.hw - Math.abs(lx), ez = box.hd - Math.abs(lz);
    if (ex < ez) { nlx = lx >= 0 ? 1 : -1; nlz = 0; depth = ex + r; }
    else { nlx = 0; nlz = lz >= 0 ? 1 : -1; depth = ez + r; }
  } else {
    const px = Math.max(-box.hw, Math.min(box.hw, lx));
    const pz = Math.max(-box.hd, Math.min(box.hd, lz));
    const dx = lx - px, dz = lz - pz;
    const dist = Math.hypot(dx, dz);
    if (dist >= r) return null;
    nlx = dx / dist; nlz = dz / dist; depth = r - dist;
  }
  return { nx: nlx * cos + nlz * sin, nz: -nlx * sin + nlz * cos, depth };
}

function collide(x, z, r, c) {
  return c.type === 'circle' ? circleVsCircle(x, z, r, c.x, c.z, c.r) : circleVsBox(x, z, r, c);
}

/**
 * Push a circle out of every collider. Colliders are { type: 'circle', x, z, r } or
 * { type: 'box', x, z, hw, hd, rot }. A few passes settle corners between two colliders.
 */
export function resolveCollisions(x, z, r, colliders, passes = 3) {
  const hits = [];
  for (let pass = 0; pass < passes; pass++) {
    let moved = false;
    for (const c of colliders) {
      // Cheap reject before the exact test.
      const reach = r + (c.type === 'circle' ? c.r : Math.hypot(c.hw, c.hd));
      if (Math.abs(x - c.x) > reach || Math.abs(z - c.z) > reach) continue;
      const hit = collide(x, z, r, c);
      if (!hit) continue;
      x += hit.nx * hit.depth;
      z += hit.nz * hit.depth;
      moved = true;
      if (!hits.some((h) => h.collider === c)) hits.push({ ...hit, collider: c });
    }
    if (!moved) break;
  }
  return { x, z, hits };
}

/** Ramp { x, z, width, length, height, heading }: climbs along its heading. Null when off it. */
export function rampHeightAt(ramp, x, z) {
  const fx = Math.sin(ramp.heading), fz = Math.cos(ramp.heading);
  const dx = x - ramp.x, dz = z - ramp.z;
  const along = dx * fx + dz * fz;
  const across = dx * fz - dz * fx;
  if (Math.abs(along) > ramp.length / 2 || Math.abs(across) > ramp.width / 2) return null;
  return (ramp.height * (along + ramp.length / 2)) / ramp.length;
}

export function groundHeight(x, z, ramps) {
  let h = 0;
  for (const ramp of ramps) {
    const rh = rampHeightAt(ramp, x, z);
    if (rh !== null && rh > h) h = rh;
  }
  return h;
}

/** Axis-aligned bounding rect { x, z, w, d } of a ramp, for layout checks. */
export function rampFootprint(ramp) {
  const c = Math.abs(Math.cos(ramp.heading)), s = Math.abs(Math.sin(ramp.heading));
  return { x: ramp.x, z: ramp.z, w: ramp.width * c + ramp.length * s, d: ramp.width * s + ramp.length * c };
}

/** Keep a circle inside the square plot (half size `half`). Normal points back inwards. */
export function clampToPlot(x, z, r, half) {
  const lim = half - r;
  let nx = 0, nz = 0, hit = false;
  if (x > lim) { x = lim; nx = -1; hit = true; } else if (x < -lim) { x = -lim; nx = 1; hit = true; }
  if (z > lim) { z = lim; nz = -1; hit = true; } else if (z < -lim) { z = -lim; nz = 1; hit = true; }
  if (nx && nz) { nx *= Math.SQRT1_2; nz *= Math.SQRT1_2; }
  return { x, z, hit, nx, nz };
}

/**
 * Nearest point on any road centreline. Roads are axis-aligned rects { x, z, w, d } running
 * along their longer side. Heading points along the road, picking the direction nearer `prefer`.
 */
export function nearestRoadPoint(x, z, roads, prefer = 0) {
  let best = null;
  for (const road of roads) {
    const alongX = road.w >= road.d;
    const half = (alongX ? road.w : road.d) / 2;
    const px = alongX ? Math.max(road.x - half, Math.min(road.x + half, x)) : road.x;
    const pz = alongX ? road.z : Math.max(road.z - half, Math.min(road.z + half, z));
    const dist = Math.hypot(x - px, z - pz);
    if (!best || dist < best.dist) {
      const options = alongX ? [Math.PI / 2, -Math.PI / 2] : [0, Math.PI];
      const diff = (h) => Math.abs(Math.atan2(Math.sin(h - prefer), Math.cos(h - prefer)));
      const heading = diff(options[0]) <= diff(options[1]) ? options[0] : options[1];
      best = { x: px, z: pz, heading, dist };
    }
  }
  return best;
}

export function circleOverlapsRect(cx, cz, r, rect) {
  const px = Math.max(rect.x - rect.w / 2, Math.min(rect.x + rect.w / 2, cx));
  const pz = Math.max(rect.z - rect.d / 2, Math.min(rect.z + rect.d / 2, cz));
  return Math.hypot(cx - px, cz - pz) < r;
}

export function rectsOverlap(a, b) {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.z - b.z) < (a.d + b.d) / 2;
}

export function pointInRect(x, z, rect, shrink = 0) {
  return Math.abs(x - rect.x) < rect.w / 2 - shrink && Math.abs(z - rect.z) < rect.d / 2 - shrink;
}
