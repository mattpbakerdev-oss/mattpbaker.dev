// Top-down drawing of Mattsville on a 2D canvas, shared by the minimap and the map dialog.
// World +x is east (right), +z is south (down), so the map is north-up with y = z.
import { ROADS, PLAZA, FOUNTAIN, RAMPS, PARK, PLOT_HALF, PLOT_CORNER } from './layout.js';
import { footprintRect, ringCentre } from './places.js';
import { rampFootprint } from './physics.js';

// Cartoon paper map: the town's own palette (world.js and models.js) with thick ink outlines.
const INK = '#1E1424', CREAM = '#FFF4DC', YELLOW = '#FFD23F', GREEN = '#4CC26B';
const PAPER = '#f6e7c4', GRASS = '#86c46a', LAWN = '#9bd37c', ROAD = '#5a5157', STONE = '#ead9bd', WATER = '#3FB6FF', RAMP = '#cdb48a'; // ramps: muted tan, so yellow stays for pins and labels
// Pin icons, drawn on a 16 px grid (SVG path data, so Path2D can stroke them).
const PIN_ICON = {
  // An app tile (a phone), so project pins never read as the collectible star.
  project: 'M5.4 2.4h5.2a1.4 1.4 0 011.4 1.4v8.4a1.4 1.4 0 01-1.4 1.4H5.4A1.4 1.4 0 014 12.2V3.8a1.4 1.4 0 011.4-1.4z M7 11.2h2',
  about: 'M3 7.5L8 3.2l5 4.3V13H3z M6.6 13V9.6h2.8V13',
  contact: 'M2.8 4.6h10.4v7.2H2.8z M3 5l5 3.8L13 5',
  soon: 'M8 2.8l4.6 9.6H3.4z M5.6 9.2h4.8',
};
const TICK = 'M4.2 8.4l2.6 2.6 5-5.6';
export const MODEL_COLOUR = {
  gym: '#e8735a', condo: '#5bb5a2', studio: '#8f7ad8', house: '#f3e7d3', 'post-office': '#f2c14e', site: '#b88a5a', grotto: '#1f6f4f',
};

const HALF = PLOT_HALF + 2;
// Matt's house and the post office sit side by side: the house label goes underneath and the
// post office's to the right of its building, so neither runs into the other or the Up Lock pin.
// Father Christmas Video sits beside the building sites at the bottom edge: its long label goes
// above it and the sites' label to the right of the last site, so the two never meet.
const LABEL_BELOW = new Set(['Matt’s house']);
const LABEL_RIGHT = new Set(['Post office', 'Building sites']);

/** World to canvas pixels for a square canvas `size` px wide with `pad` px of margin. */
export function projector(size, pad) {
  const s = (size - pad * 2) / (HALF * 2);
  return { s, x: (wx) => pad + (wx + HALF) * s, y: (wz) => pad + (wz + HALF) * s };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

/** The parts that never change: card, ground, park, roads, square, ramps and buildings. */
export function drawStatic(ctx, size, { pad, places, detail = true }) {
  const P = projector(size, pad);
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, size, size);
  const outline = detail ? 2.5 : 1.6;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  // Town plot, with the same rounded corners as the boundary.
  ctx.fillStyle = GRASS;
  roundRect(ctx, P.x(-PLOT_HALF), P.y(-PLOT_HALF), PLOT_HALF * 2 * P.s, PLOT_HALF * 2 * P.s, PLOT_CORNER * P.s);
  ctx.fill();
  ctx.lineWidth = outline;
  ctx.stroke();
  ctx.fillStyle = LAWN;
  roundRect(ctx, P.x(PARK.x - PARK.w / 2), P.y(PARK.z - PARK.d / 2), PARK.w * P.s, PARK.d * P.s, 6 * P.s);
  ctx.fill();
  // Roads, then the paved square and the fountain on top.
  // Roads: an ink casing under the tarmac, so every road has a thick outline.
  const grow = outline;
  ctx.fillStyle = INK;
  for (const r of ROADS) ctx.fillRect(P.x(r.x - r.w / 2) - grow, P.y(r.z - r.d / 2) - grow, r.w * P.s + grow * 2, r.d * P.s + grow * 2);
  ctx.fillStyle = ROAD;
  for (const r of ROADS) ctx.fillRect(P.x(r.x - r.w / 2), P.y(r.z - r.d / 2), r.w * P.s, r.d * P.s);
  ctx.fillStyle = STONE;
  ctx.beginPath();
  ctx.arc(P.x(PLAZA.x), P.y(PLAZA.z), PLAZA.r * P.s, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = WATER;
  ctx.beginPath();
  ctx.arc(P.x(FOUNTAIN.x), P.y(FOUNTAIN.z), FOUNTAIN.r * P.s, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (detail) {
    ctx.fillStyle = RAMP;
    for (const ramp of RAMPS) {
      const f = rampFootprint(ramp);
      ctx.fillRect(P.x(f.x - f.w / 2), P.y(f.z - f.d / 2), f.w * P.s, f.d * P.s);
      ctx.strokeRect(P.x(f.x - f.w / 2), P.y(f.z - f.d / 2), f.w * P.s, f.d * P.s);
    }
  }
  // Buildings in their own colours, outlined in ink.
  ctx.lineWidth = outline;
  ctx.strokeStyle = INK;
  for (const place of places) {
    const r = footprintRect(place);
    ctx.fillStyle = MODEL_COLOUR[place.model] ?? '#b88a5a';
    roundRect(ctx, P.x(r.x - r.w / 2), P.y(r.z - r.d / 2), r.w * P.s, r.d * P.s, 2.2 * P.s);
    ctx.fill();
    ctx.stroke();
  }
}

const paths = new Map();
const path = (d) => { if (!paths.has(d)) paths.set(d, new Path2D(d)); return paths.get(d); };

/** Draw a 16 px icon path centred on (x, y) at `scale`, stroked in ink. */
function icon(ctx, d, x, y, scale, width = 1.9) {
  ctx.save();
  ctx.translate(x - 8 * scale, y - 8 * scale);
  ctx.scale(scale, scale);
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.stroke(path(d));
  ctx.restore();
}

/**
 * Pins for every place (a round badge in the building's colour with its kind's icon, or a green
 * tick once visited), then the car as an arrow badge pointing where it faces. Below `dot` 5 the
 * pins are plain dots, for the minimap.
 */
export function drawDynamic(ctx, size, { pad, places, visited, car, dot = 4 }) {
  const P = projector(size, pad);
  const big = dot >= 5;
  for (const place of places) {
    const [cx, cz] = ringCentre(place);
    const seen = visited.has(place.id);
    const x = P.x(cx), y = P.y(cz), r = big ? dot * 2.1 : dot;
    if (big) { // hard shadow
      ctx.beginPath();
      ctx.arc(x + 2, y + 2, r, 0, Math.PI * 2);
      ctx.fillStyle = INK;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = seen ? GREEN : big ? (MODEL_COLOUR[place.model] ?? YELLOW) : YELLOW;
    ctx.fill();
    ctx.lineWidth = big ? 2.5 : 1.8;
    ctx.strokeStyle = INK;
    ctx.stroke();
    if (big) icon(ctx, seen ? TICK : PIN_ICON[place.kind] ?? PIN_ICON.project, x, y, (r * 1.2) / 16, seen ? 2.6 : 1.9);
  }
  if (car) drawCar(ctx, size, { pad, car, dot });
}

/** The car as an orange arrow badge pointing where it faces. */
export function drawCar(ctx, size, { pad, car, dot = 4 }) {
  if (!car) return;
  const P = projector(size, pad);
  const x = P.x(car.x), y = P.y(car.z);
  const fx = Math.sin(car.heading), fy = Math.cos(car.heading);
  const len = dot * 2.6, wid = dot * 1.7;
  const arrow = (ox, oy) => {
    ctx.beginPath();
    ctx.moveTo(ox + x + fx * len, oy + y + fy * len);
    ctx.lineTo(ox + x - fx * len * 0.7 + fy * wid, oy + y - fy * len * 0.7 - fx * wid);
    ctx.lineTo(ox + x - fx * len * 0.3, oy + y - fy * len * 0.3);
    ctx.lineTo(ox + x - fx * len * 0.7 - fy * wid, oy + y - fy * len * 0.7 + fx * wid);
    ctx.closePath();
  };
  ctx.lineJoin = 'round';
  arrow(1.5, 1.5);
  ctx.fillStyle = INK;
  ctx.fill();
  arrow(0, 0);
  ctx.fillStyle = '#FF8A1E';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

/** Place names for the big map. The building sites share one label. */
export function drawLabels(ctx, size, { pad, places, font = 13 }) {
  const P = projector(size, pad);
  const groups = new Map();
  for (const place of places) {
    const key = place.kind === 'soon' ? 'Building sites' : place.title;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(footprintRect(place));
  }
  ctx.font = `400 ${font}px "Lilita One", "Arial Rounded MT Bold", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [label, rects] of groups) {
    const minZ = Math.min(...rects.map((r) => r.z - r.d / 2));
    const x = P.x(rects.reduce((a, r) => a + r.x, 0) / rects.length);
    // Sit the label just above the building, or below it where a neighbour's label would clash.
    const below = LABEL_BELOW.has(label);
    const w = ctx.measureText(label).width + font * 1.1;
    const h = font * 1.75;
    let y = below ? P.y(Math.max(...rects.map((r) => r.z + r.d / 2))) + font * 1.2 : P.y(minZ) - font * 1.2;
    if (y < pad + font) y = P.y(Math.max(...rects.map((r) => r.z + r.d / 2))) + font * 1.2;
    if (y > size - pad - h / 2) y = P.y(minZ) - font * 1.2; // no room underneath: above it instead
    let cx = x;
    if (LABEL_RIGHT.has(label)) { // beside the building, level with its middle
      const r = rects.reduce((a, b) => (b.x > a.x ? b : a)); // the furthest right of the group
      cx = P.x(r.x + r.w / 2) + font * 0.5 + w / 2;
      y = P.y(r.z);
    }
    const lx = Math.max(pad + w / 2, Math.min(size - pad - w / 2, cx));
    ctx.fillStyle = INK;
    roundRect(ctx, lx - w / 2 + 2, y - h / 2 + 2, w, h, 7);
    ctx.fill();
    ctx.fillStyle = CREAM;
    roundRect(ctx, lx - w / 2, y - h / 2, w, h, 7);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.fillText(label, lx, y + 1);
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
