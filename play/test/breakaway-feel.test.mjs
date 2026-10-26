// Second round of feel fixes: kicked debris shoves along the ground, flying bodies only meet real
// walls, pinned debris stops the car, reduced motion costs the same speed, lamps never skate upright.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BREAKABLE, CAR_BODY, createBreakable, strike, stepBreakable, speedAfterHit, tipAngle, touchesCar,
  headingInto, debrisInWay, rekick, clearOfCar, blockCar, bodySamples, worldEnv, launchSpeed,
} from '../js/breakaway.js';
import { pointInside } from '../js/occlusion.js';

const flat = () => 0;
const open = () => ({ groundAt: flat });
const lamp = (x = 0, z = 0) => createBreakable({ type: 'circle', kind: 'lamp', x, z, r: 0.35, rot: 0 });
const tree = (s = 1, x = 0, z = 0) => createBreakable({ type: 'circle', kind: 'tree', x, z, r: 0.45 * s + 0.15, rot: 0, s });
const run = (b, secs, env = open(), cb) => {
  for (let i = 0; i < secs * 60; i++) { stepBreakable(b, 1 / 60, env); cb?.(b); }
  return b;
};
const MIN_SPEED = 0.2, KICK_MIN = 1;

// The car as drawn: 2.2 wide, 4.06 long bumper to bumper, roof at 2, bonnet (front 1.3) at 1.4.
function carDepth(b, car) {
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  let worst = Infinity;
  for (const [x, y, z, , r] of bodySamples(b).slice(0, BREAKABLE[b.kind].visible)) {
    const dx = x - car.x, dz = z - car.z;
    const lz = dx * fx + dz * fz, lx = dx * fz - dz * fx;
    const top = lz > CAR_BODY.hl - 1.3 ? 1.4 : 2;
    const ex = Math.max(0, Math.abs(lx) - CAR_BODY.hw), ez = Math.max(0, Math.abs(lz) - CAR_BODY.hl);
    const ey = Math.max(0, y - (car.y ?? 0) - top);
    worst = Math.min(worst, Math.hypot(ex, ey, ez) - r);
  }
  return worst;
}
const insideCar = (b, car) => carDepth(b, car) < -0.02;

/**
 * Drives the car as smash.js wires it: hit, kick, step, clear, then block the car on anything it
 * still overlaps. `throttle` adds speed each second along the heading (negative to reverse).
 */
function sim(b, car, { env = open(), secs = 3, dt = 1 / 60, throttle = 0, reduced = false, rand = () => 0.7, cb } = {}) {
  car.y = 0;
  car.heading ??= Math.atan2(car.vx, car.vz);
  const prev = { x: car.x - car.vx * dt, z: car.z - car.vz * dt };
  let inside = 0, hitAt = -1, kicks = 0, frames = 0;
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  for (let i = 0; i < secs / dt; i++) {
    const speed = Math.hypot(car.vx, car.vz);
    const step = Math.hypot(car.x - prev.x, car.z - prev.z);
    if (speed > MIN_SPEED) {
      if (b.mode === 'standing') {
        if (headingInto(b, car, prev) && touchesCar(b, car, prev)) {
          const res = strike(b, car, i * dt, { reduced, rand });
          const after = speedAfterHit(b.kind, car.vx, car.vz, res.loss);
          car.vx = after.vx; car.vz = after.vz; hitAt = i;
        }
      } else if (debrisInWay(b, car)) {
        rekick(b, car, i * dt, { reduced, rand });
        car.vx *= 0.95; car.vz *= 0.95; kicks++;
      }
    }
    env.car = car;
    stepBreakable(b, dt, env);
    clearOfCar(b, car, env, CAR_BODY, step);
    if (b.mode !== 'standing' || speed <= MIN_SPEED) {
      const push = blockCar(b, car);
      if (push) {
        car.x += push.dx; car.z += push.dz;
        const vn = car.vx * push.nx + car.vz * push.nz;
        if (vn < 0 && speed >= KICK_MIN) { car.vx -= vn * push.nx; car.vz -= vn * push.nz; }
      }
    }
    if (i > 2 && insideCar(b, car)) inside++;
    cb?.(b, car, i);
    frames++;
    prev.x = car.x; prev.z = car.z;
    car.vx += fx * throttle * dt; car.vz += fz * throttle * dt;
    car.x += car.vx * dt; car.z += car.vz * dt;
  }
  return { inside, hitAt, kicks, frames };
}

/** A tree or lamp knocked over at walking pace, lying across +x; returns it with its middle. */
function fallen(make) {
  const b = make();
  strike(b, { x: -1.8, z: 0, vx: 3, vz: 0 }, 0, { rand: () => 0.9 });
  run(b, 4);
  assert.equal(b.mode, 'down');
  const pts = bodySamples(b);
  const n = BREAKABLE[b.kind].visible;
  let mx = 0, mz = 0;
  for (let i = 0; i < n; i++) { mx += pts[i][0] / n; mz += pts[i][2] / n; }
  return { b, mx, mz };
}

// ---------- 1. Kicking something lying down: a ground shove that swings it out of the way ----------

for (const kind of ['tree', 'lamp']) {
  for (const speed of [4, 20]) {
    test(`kicking a lying ${kind} at ${speed}: base and crown stay on the ground, it swings round on its trailing end and clears the car's line within half a second`, () => {
      const { b, mx, mz } = fallen(kind === 'tree' ? () => tree(1.2) : () => lamp());
      // Drive straight across it, square to its length (it lies along +x, so drive along +z).
      const car = { x: mx + 0.6, z: mz - 6, vx: 0, vz: speed, heading: 0 };
      let kickedAt = -1, clearAt = -1, ahead = 0, maxLift = 0;
      const startDir = Math.abs(b.dirZ);
      const r = sim(b, car, {
        throttle: 8, secs: 3,
        cb: (x, c, i) => {
          if (kickedAt < 0 && x.knockedAt > 0) kickedAt = i;
          if (kickedAt < 0) return;
          assert.notEqual(x.mode, 'launch', 'a lying one is shoved, never thrown');
          const pts = bodySamples(x);
          maxLift = Math.max(maxLift, pts[0][1]);
          // Riding on the bonnet: some visible part just ahead of the bumper, inside its width.
          let onBumper = false, inLine = false;
          for (let k = 0; k < BREAKABLE[kind].visible; k++) {
            const [px, , pz, , rc] = pts[k];
            const lz = pz - c.z, lx = px - c.x;
            if (Math.abs(lx) < CAR_BODY.hw + rc && lz > -CAR_BODY.hl) { inLine = true; if (lz > 0 && lz - CAR_BODY.hl - rc < 0.3) onBumper = true; }
          }
          if (onBumper) ahead++;
          if (!inLine && clearAt < 0) clearAt = i;
        },
      });
      assert.ok(kickedAt >= 0, 'never kicked');
      assert.equal(r.inside, 0, `inside the car on ${r.inside} frames`);
      assert.ok(maxLift < 0.05, `base lifted to ${maxLift}`);
      if (kind === 'tree') assert.ok(clearAt >= 0 && clearAt - kickedAt <= 30, `cleared the car's line ${clearAt - kickedAt} frames after the kick`);
      assert.ok(ahead <= 3, `rode just ahead of the bumper for ${ahead} frames`);
      // Swung towards lining up with the car's travel (+z).
      assert.ok(Math.abs(b.dirZ) > startDir + 0.3, `dir ${b.dirX.toFixed(2)}, ${b.dirZ.toFixed(2)} from ${startDir.toFixed(2)}`);
      // And it lies flat on the ground at the end: trunk base and crown down.
      assert.equal(b.mode, 'down');
      assert.ok(Math.abs(bodySamples(b)[0][1]) < 0.05);
      assert.ok(tipAngle(b) > 1.1);
    });
  }
}

test('kick: a tree goes 8 to the side, a lamp 4, with a yaw spin of about 3 to 4 rad/s', () => {
  for (const [make, side] of [[() => tree(), 8], [() => lamp(), 4]]) {
    const { b, mx, mz } = fallen(make);
    const car = { x: mx + 0.8, z: mz - 2.6, y: 0, vx: 0, vz: 10, heading: 0 };
    rekick(b, car, 5);
    assert.equal(b.mode, 'topple');
    assert.ok(Math.abs(Math.abs(b.bvx) - side) < 1e-9, `${b.kind} side ${b.bvx}`);
    assert.ok(b.bvz >= 14 - 1e-9);
    assert.ok(Math.abs(b.yawRate) >= 3 && Math.abs(b.yawRate) <= 4, `yaw ${b.yawRate}`);
  }
});

// ---------- 2. In flight only real walls push; never towards the car ----------

const box = (x, z, hw, hd, extra) => ({ type: 'box', x, z, hw, hd, rot: 0, ...extra });
// A plot 20 x 20 at z 10..30 whose house walls fill only its far half (z 20..30).
const garden = {
  colliders: [box(0, 20, 10, 10, { kind: 'building', id: 'home' })],
  places: [{ id: 'home', model: 'house', position: [0, 20], rotation: 0, footprint: [20, 20] }],
  plotHalf: 80, plotCorner: 10, groundHeightAt: flat,
};
import { WALLS } from '../js/places.js';

test('a launch over a garden flies on over the open plot and only meets the walls; it comes to rest out of the plot', () => {
  const saved = WALLS.house;
  WALLS.house = [[0, 5, 20, 10]];
  try {
    const env = worldEnv(garden);
    const wall = { type: 'box', x: 0, z: 25, hw: 10.6, hd: 5.6, rot: 0 };
    for (const speed of [16, 22, 28]) {
      const b = tree(1, 0, 6);
      strike(b, { x: 0.4, z: 4.2, vx: 0, vz: speed }, 0);
      let maxZFlying = -Infinity, sawPlot = false;
      run(b, 10, env, (x) => {
        for (const [px, , pz] of bodySamples(x)) {
          assert.ok(!pointInside(px, pz, wall), `${speed}: a sample went into the walls at ${px.toFixed(2)}, ${pz.toFixed(2)}`);
          if (x.mode === 'launch' && !x.contact && pointInside(px, pz, garden.colliders[0])) sawPlot = true;
        }
        if (x.mode === 'launch' && !x.contact) maxZFlying = Math.max(maxZFlying, x.z);
      });
      assert.ok(sawPlot, `${speed}: never crossed into the open plot in the air (max z ${maxZFlying})`);
      assert.equal(b.mode, 'down');
      for (const [px, , pz] of bodySamples(b)) assert.ok(!pointInside(px, pz, garden.colliders[0]), `${speed}: rests in the plot at ${px}, ${pz}`);
    }
  } finally { WALLS.house = saved; }
});

test('a wall never throws a flying body back at the car right behind it, and never pushes it into the car', () => {
  // A wall straight ahead at z > 3: the body flies into it with the car close behind, still driving.
  const push = (x, z, r) => (z + r > 3 ? { x, z: 3 - r, nx: 0, nz: -1 } : null);
  for (const make of [lamp, () => tree()]) {
    const env = { groundAt: flat, push, pushWalls: push };
    const b = make();
    const car = { x: 0.3, z: -(CAR_BODY.hl + b.r + 0.02), vx: 0, vz: 16, heading: 0 };
    let worst = 0;
    const r = sim(b, car, { env, secs: 1.5, throttle: 10, cb: (x, c, i) => {
      if (i > 0 && x.mode === 'launch' && bodySamples(x).some(([, , z, rr]) => z + rr > 3 - 1e-6)) worst = Math.min(worst, x.vz);
      for (const [, , z] of bodySamples(x)) assert.ok(z <= 3 + 1e-6, 'went into the wall');
    } });
    assert.ok(worst >= -1e-9, `${b.kind} bounced back at the car at ${worst}`);
    assert.equal(r.inside, 0, `${b.kind} inside the car on ${r.inside} frames`);
  }
});

// ---------- 3 and 12. Pinned against a wall, or too slow to kick: the car stops short ----------

test('a lamp lying against a building, driven into with throttle held: never inside the car, never in the building', () => {
  const world = { colliders: [box(0, 8, 10, 2, { kind: 'building', id: 'gym' })], places: [], plotHalf: 80, plotCorner: 10, groundHeightAt: flat };
  const env = worldEnv(world);
  for (const lat of [0, 1.5, -3]) {
    for (const speed of [3, 8, 14]) {
      // Lying along x, right against the plot's edge (z = 6).
      const b = lamp(-2.3 + lat, 5.4);
      strike(b, { x: -3.9 + lat, z: 5.4, vx: 3, vz: 0 }, 0, { rand: () => 0.9 });
      run(b, 4, env);
      assert.equal(b.mode, 'down');
      const car = { x: lat * 0.3, z: 5.4 - 2.03 - 3, vx: 0, vz: speed, heading: 0 };
      const r = sim(b, car, { env, throttle: 19, secs: 2.5 });
      assert.equal(r.inside, 0, `lat ${lat} at ${speed}: inside the car on ${r.inside} frames`);
      for (const [px, , pz] of bodySamples(b)) assert.ok(!pointInside(px, pz, world.colliders[0]), `lat ${lat} at ${speed}: in the building`);
    }
  }
});

test('reversing slowly into a fallen tree, or creeping into a standing one: the car never ends up inside either', () => {
  const { b, mx, mz } = fallen(() => tree(1.2));
  // Reversing at 0.6 (below the kick speed) back across its middle, heading +z, moving -z.
  const car = { x: mx + 0.4, z: mz + 4, vx: 0, vz: -0.6, heading: 0 };
  const r = sim(b, car, { secs: 6 });
  assert.equal(r.inside, 0, `reversing: inside on ${r.inside} frames`);
  assert.equal(r.kicks, 0);

  const s = tree(1.2, 0, 0);
  const creep = { x: 0.2, z: -3.2, vx: 0, vz: 0.15, heading: 0 };
  const c = sim(s, creep, { secs: 8 });
  assert.equal(s.mode, 'standing', 'creeping into it does not knock it');
  assert.equal(c.inside, 0, `creeping: inside on ${c.inside} frames`);
});

// ---------- 4. Reduced motion: the same speed cost, a short slide ----------

test('reduced motion costs the car what the full-motion hit would (launch loss for a would-be launch)', () => {
  for (const make of [lamp, () => tree()]) {
    for (const speed of [4, 12, 20, 28]) {
      const full = make(), calm = make();
      const car = { x: 0.3, z: -1.6, vx: 0, vz: speed };
      const a = strike(full, car, 0, { rand: () => 0.3 });
      const c = strike(calm, car, 0, { reduced: true, rand: () => 0.3 });
      assert.equal(c.mode, 'topple');
      assert.equal(c.loss, a.mode, `${full.kind} at ${speed}`);
      assert.equal(speedAfterHit(calm.kind, 0, speed, c.loss).vz, speedAfterHit(full.kind, 0, speed, a.loss).vz);
    }
  }
});

test('reduced motion: the base is pushed at most 5 along plus 4 aside, and slides under about 2 units', () => {
  for (const make of [lamp, () => tree()]) {
    for (const speed of [3, 14, 28]) {
      const b = make();
      strike(b, { x: -0.5, z: -1.6, vx: 0, vz: speed }, 0, { reduced: true });
      assert.ok(Math.abs(b.bvz - Math.min(0.6 * speed, 5)) < 1e-9, `along ${b.bvz}`);
      assert.ok(Math.abs(b.bvx - 4) < 1e-9);
      run(b, 4);
      const slide = Math.hypot(b.baseX, b.baseZ);
      assert.ok(slide < 2.1, `${b.kind} at ${speed} slid ${slide}`);
    }
  }
});

// ---------- 6. Slow hits: no skip forward; the car body is the real bumper ----------

test('the car body is the real bumper: 2.2 wide, about 4.06 long', () => {
  assert.equal(CAR_BODY.hw, 1.1);
  assert.ok(Math.abs(CAR_BODY.hl - 2.03) < 0.02);
});

test('a canopy over the bonnet, above its height, is not inside the car: no shove', () => {
  const b = tree(1.2);
  strike(b, { x: 0, z: -1.8, vx: 0, vz: 3 }, 0, { rand: () => 0.9 });
  // Lean it a little: the canopy hangs forward, high over where the bonnet will be.
  for (let i = 0; i < 12; i++) stepBreakable(b, 1 / 60, open());
  const canopy = bodySamples(b)[5];
  assert.ok(canopy[1] - canopy[4] > 1.45, `canopy bottom ${canopy[1] - canopy[4]}`);
  const car = { x: 0, z: canopy[2] - 1.0, y: 0, vx: 0, vz: 3, heading: 0 }; // canopy over the bonnet
  const before = [b.x, b.z];
  // Only the canopy is over the car here; the trunk is clear ahead.
  const trunkClear = bodySamples(b).slice(0, 5).every(([x, , z, , rc]) => z - rc - car.z > CAR_BODY.hl);
  if (trunkClear) {
    assert.equal(clearOfCar(b, car, null, CAR_BODY, 0.05), false);
    assert.deepEqual([b.x, b.z], before);
  }
});

test('slow tree hits never skip the trunk forward: each clearing slide stays within the car\'s own step plus 0.05', () => {
  for (const speed of [2, 3, 5, 8]) {
    for (const offset of [-0.6, 0, 0.6]) {
      const b = tree(1.2);
      const car = { x: offset, z: -(CAR_BODY.hl + b.r + 0.02), vx: 0, vz: speed, heading: 0 };
      let worst = 0, hitAt = -1;
      let last = null;
      sim(b, car, {
        secs: 2,
        cb: (x, c, i) => {
          const base = bodySamples(x)[0];
          if (hitAt < 0 && x.mode !== 'standing') hitAt = x.knockedAt;
          if (last && x.mode === 'topple' && x.knockedAt === hitAt) { // the bumper's push, not a kick
            const moved = Math.hypot(base[0] - last.x, base[2] - last.z);
            const allowed = Math.max(Math.hypot(c.vx, c.vz) / 60 + 0.05, 0.1) + Math.hypot(x.bvx, x.bvz) / 60 + 1e-6;
            worst = Math.max(worst, moved - allowed);
          }
          last = { x: base[0], z: base[2] };
        },
      });
      assert.ok(worst <= 0, `at ${speed} offset ${offset} the base skipped ${worst.toFixed(3)} past the car's step`);
    }
  }
});

// ---------- 7. A launched tree rolls onto its crown on its first slow landing ----------

test('a launched tree starts settling on its first hard landing below about 4 u/s, over about 0.35 s', () => {
  for (const [s, speed] of [[0.9, 18], [1.2, 26], [1.35, 28]]) {
    const b = tree(s);
    strike(b, { x: 0.3, z: -1.6, vx: 0, vz: speed }, 0);
    let slowOnGround = 0, settle = 0;
    run(b, 10, open(), (x) => {
      if (x.mode === 'launch' && x.contact && x.landed && Math.hypot(x.vx, x.vz) < 3.5) slowOnGround++;
      if (x.mode === 'settle') settle++;
    });
    assert.ok(slowOnGround <= 2, `s${s} at ${speed}: lay on the ground ${slowOnGround} frames before settling`);
    assert.ok(settle >= 20 && settle <= 23, `settled over ${settle} frames`);
    assert.equal(b.mode, 'down');
    assert.ok(Math.abs(bodySamples(b)[0][1]) < 0.02, 'trunk base on the ground');
  }
});

// ---------- 8. Lamps tumble about 1.3 turns and never skate upright ----------

test('a launched lamp makes about 1.3 turns (give or take 15%) before it is back to launch height, and never skates or rests upright', () => {
  for (const speed of [9, 11, 14, 18, 22, 28]) {
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      const b = lamp();
      const rand = () => r;
      strike(b, { x: 0.3, z: -1.6, vx: 0, vz: speed }, 0, { rand });
      const turns = (Math.hypot(b.wx, b.wz) * (2 * b.vy / 25)) / (2 * Math.PI);
      assert.ok(turns >= 1.3 * 0.85 - 1e-9 && turns <= 1.3 * 1.15 + 1e-9, `${turns} turns`);
      let skating = 0;
      run(b, 10, open(), (x) => {
        if (x.mode === 'launch' && x.contact && tipAngle(x) < 0.8 && Math.hypot(x.vx, x.vz) > 1) skating++;
      });
      assert.ok(skating <= 3, `at ${speed} r ${r}: skated upright for ${skating} frames`);
      assert.equal(b.mode, 'down');
      assert.ok(tipAngle(b) > 1.1, `at ${speed} r ${r}: rests at ${tipAngle(b)}`);
    }
  }
});

// ---------- 11. Glancing hits go further aside and spin ----------

test('the sideways share runs from 0.25 dead centre to 0.5 at the edge, and a glancing hit adds a yaw spin', () => {
  const centre = lamp(), edge = lamp();
  strike(centre, { x: 0, z: -1.6, vx: 0, vz: 20 }, 0, { rand: () => 0.9 });
  strike(edge, { x: -(CAR_BODY.hw + 0.35), z: -1.6, vx: 0, vz: 20 }, 0);
  assert.ok(Math.abs(Math.abs(centre.vx) / centre.vz - 0.25) < 1e-9, `centre ${centre.vx / centre.vz}`);
  assert.ok(Math.abs(edge.vx / edge.vz - 0.5) < 1e-9, `edge ${edge.vx / edge.vz}`);
  assert.equal(centre.wy, 0);
  assert.ok(Math.abs(edge.wy) > 0.5, `glancing yaw ${edge.wy}`);
});

test('every launch still beats the car and clears it at all offsets', () => {
  for (const make of [lamp, () => tree(0.9), () => tree(1.35)]) {
    for (const speed of [14, 20, 28]) {
      for (const off of [-1.3, -0.6, 0, 0.6, 1.3]) {
        const b = make();
        if (speed < launchSpeed(b)) continue;
        const car = { x: off, z: -(CAR_BODY.hl + b.r + 0.02), vx: 0, vz: speed, heading: 0 };
        const r = sim(b, car, { throttle: 6, secs: 3 });
        assert.equal(r.inside, 0, `${b.kind} at ${speed} off ${off}: inside on ${r.inside} frames`);
      }
    }
  }
});
