// Every lamp post and tree in the real town, hit from twelve directions at a range of speeds and
// two frame rates: nothing ends inside a building or outside the plot, and nothing leans on air.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBreakable, strike, stepBreakable, bodySamples, worldEnv, tipAngle } from '../js/breakaway.js';
import { PLACES, WALLS } from '../js/places.js';
import { scatter } from '../js/spots.js';
import { PLOT_HALF, PLOT_CORNER, RAMPS } from '../js/layout.js';
import { plotDistance, groundHeight } from '../js/physics.js';
import { pointInside } from '../js/occlusion.js';

// The same seeded placement the game draws (spots.js), so a layout change can't leave this stale;
// buildings come live from places.js.
const sources = scatter().breakables;
const colliders = PLACES.map((p) => ({ type: 'box', x: p.position[0], z: p.position[1], hw: p.footprint[0] / 2, hd: p.footprint[1] / 2, rot: p.rotation, kind: 'building', id: p.id }));
const world = { colliders, places: PLACES, plotHalf: PLOT_HALF, plotCorner: PLOT_CORNER, groundHeightAt: (x, z) => groundHeight(x, z, RAMPS) };
const buildings = colliders.filter((c) => !c.id.startsWith('site'));
// The real walls inside each plot (forecourts and gardens are open ground), grown by 0.6.
const walls = buildings.flatMap((c) => {
  const p = PLACES.find((q) => q.id === c.id), cos = Math.cos(p.rotation), sin = Math.sin(p.rotation);
  return (WALLS[p.model] ?? []).map(([lx, lz, w, d]) => ({ type: 'box', x: c.x + lx * cos + lz * sin, z: c.z - lx * sin + lz * cos, hw: w / 2 + 0.6, hd: d / 2 + 0.6, rot: p.rotation }));
});

// At rest nothing is in a building's plot; moving (in the air, or sliding off a garden) only
// its real walls count. Never outside the town.
function check(b, tag, issues, moving = false) {
  for (const [x, , z] of bodySamples(b)) {
    if (moving) { if (walls.some((w) => pointInside(x, z, shrink(w)))) { issues.push(`${tag}: inside a wall`); return; } }
    else for (const c of buildings) if (pointInside(x, z, c)) { issues.push(`${tag}: inside ${c.id}`); return; }
    if (plotDistance(x, z, PLOT_HALF, PLOT_CORNER) > 1e-6) { issues.push(`${tag}: outside the plot`); return; }
  }
}
// The real walls, without the 0.6 margin a falling top catches on.
const shrink = (w) => ({ ...w, hw: w.hw - 0.6, hd: w.hd - 0.6 });

test('fuzz: no breakable flies into a wall or rests in a building\'s plot, none leaves the town, and none leans on air', () => {
  assert.ok(sources.length > 200, `only ${sources.length} breakables placed`);
  const env = worldEnv(world);
  const issues = [];
  let runs = 0;
  for (const src of sources) {
    for (let d = 0; d < 12; d++) {
      const a = (d * Math.PI) / 6;
      for (const speed of [3, 7, 14, 20, 28]) {
        for (const dt of [1 / 60, 1 / 20]) {
          const b = createBreakable({ ...src, type: 'circle' });
          const car = { x: src.x - Math.sin(a) * 1.6, z: src.z - Math.cos(a) * 1.6, vx: Math.sin(a) * speed, vz: Math.cos(a) * speed };
          strike(b, car, 0, { rand: () => (d % 2 ? 0.2 : 0.8) });
          const tag = `${src.kind}#${src.lamp ?? src.tree} ${d * 30}deg v${speed} ${dt > 0.02 ? '20fps' : '60fps'}`;
          let steps = 0, mid = 0;
          while (b.mode !== 'down' && steps < 20 / dt) {
            stepBreakable(b, dt, env);
            if (b.mode !== 'down' && mid++ % 4 === 0) check(b, tag + ' moving', issues, true);
            steps++;
          }
          runs++;
          assert.equal(b.mode, 'down', `${tag} never settled`);
          check(b, tag, issues);
          // Resting tipped short of flat only where it meets a real wall: somewhere along its fall
          // line, out to its top plus a canopy's or head's reach, is a wall.
          if (tipAngle(b) < 1.1) {
            const top = b.height * Math.sin(b.theta) + 1.2;
            let onWall = false;
            for (let t = 0.5; t <= top && !onWall; t += 0.1) {
              const x = b.baseX + b.dirX * t, z = b.baseZ + b.dirZ * t;
              onWall = walls.some((w) => pointInside(x, z, w));
            }
            if (!onWall) issues.push(`${tag}: leans at ${tipAngle(b).toFixed(2)} on nothing`);
          }
        }
      }
    }
  }
  assert.ok(runs > 20000);
  assert.deepEqual(issues.slice(0, 20), [], `${issues.length} problems`);
});
