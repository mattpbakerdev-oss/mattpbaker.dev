// Father Christmas Video: the grotto that took the first building site's plot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PLACES, WALLS, footprintRect } from '../js/places.js';
import { scatter } from '../js/spots.js';
import { circleOverlapsRect } from '../js/physics.js';
import { createArrivals, arrivalKey } from '../js/arrival.js';
import { OBJECTIVES } from '../js/objectives.js';
import { FRAME_HEIGHT } from '../js/camrig.js';
import { MODEL_COLOUR } from '../js/mapdraw.js';
import { ringCentre } from '../js/places.js';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const grotto = PLACES.find((p) => p.id === 'father-christmas-video');

test('Father Christmas Video is a project on the old first building site\'s plot', () => {
  assert.ok(grotto, 'place missing');
  assert.equal(grotto.kind, 'project');
  assert.equal(grotto.model, 'grotto');
  assert.deepEqual(grotto.position, [-45, 89.5]);
  assert.equal(grotto.rotation, Math.PI);
  assert.deepEqual(grotto.footprint, [18, 14]);
  assert.equal(grotto.title, 'Father Christmas Video');
});

test('two building sites remain, keeping their own ids and plots', () => {
  const sites = PLACES.filter((p) => p.kind === 'soon');
  assert.deepEqual(sites.map((p) => p.id), ['site-2', 'site-3']);
  assert.deepEqual(sites.map((p) => p.position), [[-20, 89.5], [5, 89.5]]);
  assert.ok(!PLACES.some((p) => p.id === 'site-1'));
});

test('the private repo gets no GitHub or live link; the panel says when it launches instead', () => {
  assert.deepEqual(grotto.links, []);
  assert.ok(typeof grotto.status === 'string' && grotto.status.length > 0, 'status line');
  assert.ok(!JSON.stringify(grotto).includes('github.com'));
});

test('copy states only facts from the project docs', () => {
  assert.deepEqual(grotto.stats.map((s) => s.value), ['555', '£7']);
  assert.deepEqual(grotto.tech, ['Next.js', 'Claude', 'ElevenLabs', 'fal', 'Stripe']);
  const text = [grotto.tagline, ...grotto.body].join(' ');
  assert.ok(/mock mode/.test(text) && /isn.t live yet/.test(text), 'states it is a prototype, not live');
  assert.ok(!/[—–]/.test(text), 'no em or en dashes');
});

test('the sample video has captions and sound, and its poster is the optimised still', () => {
  assert.equal(grotto.media.length, 1);
  const [video] = grotto.media;
  assert.equal(video.type, 'video');
  assert.equal(video.sound, true, 'a voiced sample starts with sound on');
  assert.match(video.poster, /\.jpg$/);
  assert.ok(statSync(repoRoot + video.poster.slice(1)).size < 150 * 1024, 'poster under 150 KB');
  assert.ok(video.alt.split(' ').length >= 6, 'label describes the video');
  for (const p of [video.src, video.captions]) statSync(repoRoot + p.slice(1));
});

test('the grotto has solid walls, and they sit inside its plot', () => {
  const walls = WALLS.grotto;
  assert.ok(Array.isArray(walls) && walls.length > 0);
  const [w, d] = grotto.footprint;
  for (const [x, z, ww, dd] of walls) {
    assert.ok(Math.abs(x) + ww / 2 <= w / 2 - 0.5, `wall x ${x} w ${ww}`);
    assert.ok(Math.abs(z) + dd / 2 <= d / 2 - 0.5, `wall z ${z} d ${dd}`);
  }
});

test('no tree or lamp post spawns on the grotto\'s plot', () => {
  const rect = footprintRect(grotto);
  for (const s of scatter().breakables) assert.ok(!circleOverlapsRect(s.x, s.z, s.r + 1, rect), `${s.kind} at ${s.x}, ${s.z}`);
});

test('the scatter elsewhere is exactly what it was with the building site there', () => {
  const s = scatter();
  const hash = createHash('sha256').update(JSON.stringify({ b: s.breakables, p: s.patches, r: s.rand() })).digest('hex');
  assert.equal(hash, '344ac7c38f9ea717780f8f55134c5e53f67fc9bad398dffe8489402648fbc05b');
});

test('the grotto gets its own arrival banner; the two sites still share one', () => {
  assert.equal(arrivalKey(grotto), 'father-christmas-video');
  const [gx, gz] = ringCentre(grotto);
  assert.equal(createArrivals(PLACES).update(gx, gz)?.id, 'father-christmas-video');
  const a = createArrivals(PLACES);
  const [x2, z] = ringCentre(PLACES.find((p) => p.id === 'site-2'));
  const [x3] = ringCentre(PLACES.find((p) => p.id === 'site-3'));
  const fired = [];
  for (let x = x2; x <= x3; x += 0.5) { const p = a.update(x, z); if (p) fired.push(p.kind); }
  assert.deepEqual(fired, ['soon']);
});

test('the to-do list keeps its four stops (the grotto is not on it)', () => {
  assert.equal(OBJECTIVES.length, 4);
  assert.ok(!OBJECTIVES.some((o) => o.id === grotto.id));
});

test('every model has a camera frame height and a map colour', () => {
  for (const p of PLACES) {
    assert.ok(Number.isFinite(FRAME_HEIGHT[p.model]), `${p.model} frame height`);
    assert.ok(MODEL_COLOUR[p.model], `${p.model} map colour`);
  }
});
