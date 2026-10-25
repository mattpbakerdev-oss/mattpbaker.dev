import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PLACES, KINDS, RING_RADIUS, ringCentre, footprintRect } from '../js/places.js';
import { PLOT_HALF, ROADS, PLAZA, RAMPS, START } from '../js/layout.js';
import { circleOverlapsRect, rectsOverlap, rampFootprint } from '../js/physics.js';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const nonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const nonEmptyArray = (v) => Array.isArray(v) && v.length > 0;

const REQUIRED = {
  project: ['title', 'tagline', 'body', 'stats', 'media', 'tech', 'links'],
  about: ['title', 'body', 'links'],
  contact: ['title', 'body', 'links'],
  soon: [],
};

test('there is one entry for each place in the spec', () => {
  const ids = PLACES.map((p) => p.id);
  for (const id of ['up-lock', 'listing-check', 'ugc-pipeline', 'house', 'post-office']) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
  assert.equal(PLACES.filter((p) => p.kind === 'soon').length, 3);
});

test('ids are unique', () => {
  const ids = PLACES.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

for (const place of PLACES) {
  test(`${place.id}: has the fields its kind needs`, () => {
    assert.ok(KINDS.includes(place.kind), `unknown kind ${place.kind}`);
    assert.ok(nonEmptyString(place.model), 'model');
    assert.ok(Array.isArray(place.position) && place.position.length === 2, 'position');
    assert.ok(place.position.every(Number.isFinite), 'position numbers');
    assert.ok(Number.isFinite(place.rotation), 'rotation');
    assert.ok(Array.isArray(place.footprint) && place.footprint.every((n) => n > 0), 'footprint');
    for (const field of REQUIRED[place.kind]) {
      const v = place[field];
      assert.ok(nonEmptyString(v) || nonEmptyArray(v), `${field} is missing or empty`);
    }
    if (place.body) assert.ok(place.body.every(nonEmptyString), 'body paragraphs');
    for (const s of place.stats ?? []) assert.ok(nonEmptyString(s.value) && nonEmptyString(s.label), 'stat');
    for (const l of place.links ?? []) assert.ok(nonEmptyString(l.label) && nonEmptyString(l.href), 'link');
    for (const m of place.media ?? []) {
      assert.ok(['image', 'video', 'youtube'].includes(m.type), `media type ${m.type}`);
      if (m.type === 'image') assert.ok(nonEmptyString(m.src) && nonEmptyString(m.alt), 'image src and alt');
      if (m.type === 'video') assert.ok(nonEmptyString(m.src) && nonEmptyString(m.poster), 'video src and poster');
      if (m.type === 'youtube') assert.ok(/^[\w-]{11}$/.test(m.id) && nonEmptyString(m.alt), 'youtube id and alt');
    }
  });

  test(`${place.id}: local media and links exist in the repo`, () => {
    const paths = [];
    for (const m of place.media ?? []) paths.push(m.src, m.poster);
    for (const l of place.links ?? []) paths.push(l.href);
    for (const p of paths) {
      if (typeof p !== 'string' || !p.startsWith('/')) continue;
      const file = p.endsWith('/') ? `${p}index.html` : /\.\w+$/.test(p) ? p : `${p}/index.html`;
      assert.ok(existsSync(repoRoot + file.slice(1)), `${p} not found`);
    }
  });

  test(`${place.id}: building and ring sit on the plot`, () => {
    const rect = footprintRect(place);
    const [cx, cz] = ringCentre(place);
    const inside = (x, z, m) => Math.abs(x) <= PLOT_HALF - m && Math.abs(z) <= PLOT_HALF - m;
    assert.ok(inside(rect.x, rect.z, Math.max(rect.w, rect.d) / 2), 'building off the plot');
    assert.ok(inside(cx, cz, RING_RADIUS), 'ring off the plot');
  });

  test(`${place.id}: building and ring stay off the roads, the square and the ramps, ring beside a road`, () => {
    const rect = footprintRect(place);
    const [cx, cz] = ringCentre(place);
    for (const road of ROADS) {
      assert.ok(!rectsOverlap(rect, road), 'building on a road');
      assert.ok(!circleOverlapsRect(cx, cz, RING_RADIUS, road), 'ring on a road');
    }
    assert.ok(Math.hypot(cx - PLAZA.x, cz - PLAZA.z) > PLAZA.r + RING_RADIUS, 'ring in the square');
    for (const ramp of RAMPS) {
      assert.ok(!rectsOverlap(rect, rampFootprint(ramp)), 'building on a ramp');
      assert.ok(!circleOverlapsRect(cx, cz, RING_RADIUS + 2, rampFootprint(ramp)), 'ring by a ramp');
    }
    const nearRoad = ROADS.some((road) => circleOverlapsRect(cx, cz, RING_RADIUS + 1.5, road));
    assert.ok(nearRoad, 'ring is not beside any road');
  });

  test(`${place.id}: the door faces the road`, () => {
    // Step out from the ring along the door direction; we should hit road quickly.
    const [cx, cz] = ringCentre(place);
    const fx = Math.sin(place.rotation), fz = Math.cos(place.rotation);
    const onRoad = ROADS.some((r) => Math.abs(cx + fx * 6 - r.x) <= r.w / 2 && Math.abs(cz + fz * 6 - r.z) <= r.d / 2);
    assert.ok(onRoad, 'six units out of the door is not road');
  });
}

test('no two rings overlap, and no two buildings overlap', () => {
  for (let i = 0; i < PLACES.length; i++) {
    for (let j = i + 1; j < PLACES.length; j++) {
      const [ax, az] = ringCentre(PLACES[i]);
      const [bx, bz] = ringCentre(PLACES[j]);
      assert.ok(Math.hypot(ax - bx, az - bz) > RING_RADIUS * 2 + 2, `${PLACES[i].id} and ${PLACES[j].id} rings`);
      assert.ok(!rectsOverlap(footprintRect(PLACES[i]), footprintRect(PLACES[j])), `${PLACES[i].id} and ${PLACES[j].id} buildings`);
    }
  }
});

test('the start point is in the centre square, on the plot', () => {
  assert.ok(Math.hypot(START.x - PLAZA.x, START.z - PLAZA.z) < PLAZA.r);
});

test('copy has no em dashes', () => {
  const text = JSON.stringify(PLACES);
  assert.ok(!text.includes('—'), 'em dash found');
});
