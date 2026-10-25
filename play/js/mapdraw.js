// Top-down drawing of Mattsville on a 2D canvas, shared by the minimap and the map dialog.
// World +x is east (right), +z is south (down), so the map is north-up with y = z.
import { ROADS, PLAZA, FOUNTAIN, RAMPS, PARK, PLOT_HALF } from './layout.js';
import { footprintRect, ringCentre } from './places.js';
import { rampFootprint } from './physics.js';

const INK = '#F5F1EE';
const AMBER = '#E0A94A';
export const MODEL_COLOUR = {
  gym: '#e8735a', condo: '#5bb5a2', studio: '#8f7ad8', house: '#f3e7d3', 'post-office': '#f2c14e', site: '#8a7a6e',
};

const HALF = PLOT_HALF + 2;
// Matt's house and the post office sit side by side; one label goes underneath.
const LABEL_BELOW = new Set(['Matt’s house']);

/** World to canvas pixels for a square canvas `size` px wide with `pad` px of margin. */
export function projector(size, pad) {
  const s = (size - pad * 2) / (HALF * 2);
  return { s, x: (wx) => pad + (wx + HALF) * s, y: (wz) => pad + (wz + HALF) * s };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

/** The parts that never change: ground, park, roads, square, ramps and buildings. */
export function drawStatic(ctx, size, { pad, places, detail = true }) {
  const P = projector(size, pad);
  ctx.clearRect(0, 0, size, size);
  // Town plot.
  ctx.fillStyle = '#2a2321';
  roundRect(ctx, P.x(-PLOT_HALF), P.y(-PLOT_HALF), PLOT_HALF * 2 * P.s, PLOT_HALF * 2 * P.s, 14 * P.s);
  ctx.fill();
  ctx.fillStyle = '#2f2a24';
  roundRect(ctx, P.x(PARK.x - PARK.w / 2), P.y(PARK.z - PARK.d / 2), PARK.w * P.s, PARK.d * P.s, 6 * P.s);
  ctx.fill();
  // Roads.
  ctx.fillStyle = '#4a403e';
  for (const r of ROADS) ctx.fillRect(P.x(r.x - r.w / 2), P.y(r.z - r.d / 2), r.w * P.s, r.d * P.s);
  ctx.beginPath();
  ctx.arc(P.x(PLAZA.x), P.y(PLAZA.z), PLAZA.r * P.s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5b504c';
  ctx.beginPath();
  ctx.arc(P.x(FOUNTAIN.x), P.y(FOUNTAIN.z), FOUNTAIN.r * P.s, 0, Math.PI * 2);
  ctx.fill();
  if (detail) {
    ctx.fillStyle = '#6a5d58';
    for (const ramp of RAMPS) {
      const f = rampFootprint(ramp);
      ctx.fillRect(P.x(f.x - f.w / 2), P.y(f.z - f.d / 2), f.w * P.s, f.d * P.s);
    }
  }
  // Buildings in their own colours.
  for (const place of places) {
    const r = footprintRect(place);
    ctx.fillStyle = MODEL_COLOUR[place.model] ?? '#8a7a6e';
    ctx.globalAlpha = place.kind === 'soon' ? 0.7 : 0.92;
    roundRect(ctx, P.x(r.x - r.w / 2), P.y(r.z - r.d / 2), r.w * P.s, r.d * P.s, 2.2 * P.s);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

/** Ring dots (amber until visited), then the car as an arrow pointing where it faces. */
export function drawDynamic(ctx, size, { pad, places, visited, car, dot = 4 }) {
  const P = projector(size, pad);
  for (const place of places) {
    const [cx, cz] = ringCentre(place);
    const seen = visited.has(place.id);
    ctx.beginPath();
    ctx.arc(P.x(cx), P.y(cz), dot, 0, Math.PI * 2);
    ctx.fillStyle = seen ? '#6f6664' : AMBER;
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, dot * 0.4);
    ctx.strokeStyle = '#1C1717';
    ctx.stroke();
  }
  if (!car) return;
  const x = P.x(car.x), y = P.y(car.z);
  const fx = Math.sin(car.heading), fy = Math.cos(car.heading);
  const len = dot * 2.6, wid = dot * 1.6;
  ctx.beginPath();
  ctx.moveTo(x + fx * len, y + fy * len);
  ctx.lineTo(x - fx * len * 0.6 + fy * wid, y - fy * len * 0.6 - fx * wid);
  ctx.lineTo(x - fx * len * 0.25, y - fy * len * 0.25);
  ctx.lineTo(x - fx * len * 0.6 - fy * wid, y - fy * len * 0.6 + fx * wid);
  ctx.closePath();
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#1C1717';
  ctx.stroke();
}

/** Place names for the big map. The three building sites share one label. */
export function drawLabels(ctx, size, { pad, places, font = 13 }) {
  const P = projector(size, pad);
  const groups = new Map();
  for (const place of places) {
    const key = place.kind === 'soon' ? 'Building sites' : place.title;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(footprintRect(place));
  }
  ctx.font = `600 ${font}px Onest, "Segoe UI", Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [label, rects] of groups) {
    const minZ = Math.min(...rects.map((r) => r.z - r.d / 2));
    const x = P.x(rects.reduce((a, r) => a + r.x, 0) / rects.length);
    // Sit the label just above the building, or below it where a neighbour's label would clash.
    const below = LABEL_BELOW.has(label);
    let y = below ? P.y(Math.max(...rects.map((r) => r.z + r.d / 2))) + font * 1.1 : P.y(minZ) - font * 1.1;
    if (y < pad + font) y = P.y(Math.max(...rects.map((r) => r.z + r.d / 2))) + font * 1.1;
    const w = ctx.measureText(label).width + font * 1.1;
    const h = font * 1.75;
    const lx = Math.max(pad + w / 2, Math.min(size - pad - w / 2, x));
    ctx.fillStyle = 'rgba(28,23,23,0.92)';
    roundRect(ctx, lx - w / 2, y - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(245,241,238,0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.fillText(label, lx, y + 0.5);
  }
}

/** Which place a tap on the map lands on, if any (within `slop` world units of its plot). */
export function placeAtMapPoint(px, py, size, pad, places, slop = 6) {
  const P = projector(size, pad);
  const wx = (px - pad) / P.s - HALF, wz = (py - pad) / P.s - HALF;
  let best = null, bestD = slop;
  for (const place of places) {
    const r = footprintRect(place);
    const dx = Math.max(0, Math.abs(wx - r.x) - r.w / 2), dz = Math.max(0, Math.abs(wz - r.z) - r.d / 2);
    const d = Math.hypot(dx, dz);
    if (d < bestD || (d === 0 && bestD === 0)) { best = place; bestD = d; }
  }
  return best;
}
