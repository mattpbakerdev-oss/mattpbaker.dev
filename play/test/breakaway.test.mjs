import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BREAKABLE, launchSpeed, createBreakable, strike, stepBreakable, speedAfterHit,
  canRestore, restoreBreakable, splitColliders, clearanceColliders, tipAngle, touchesCar,
  headingInto, debrisInWay, rekick, clearOfCar, blockCar, bodySamples, worldEnv, CAR_BODY,
} from '../js/breakaway.js';
import { blockers, pointInside } from '../js/occlusion.js';

const flat = () => 0;
const open = { groundAt: flat };
const lamp = () => createBreakable({ type: 'circle', kind: 'lamp', x: 0, z: 0, r: 0.35, rot: 0 });
const tree = (s = 1) => createBreakable({ type: 'circle', kind: 'tree', x: 0, z: 0, r: 0.45 * s + 0.15, rot: 0, s });
const carAt = (speed, z = -1.5) => ({ x: 0, z, vx: 0, vz: speed });
const run = (b, secs, env = open, cb) => {
  for (let i = 0; i < secs * 60; i++) { stepBreakable(b, 1 / 60, env); cb?.(b); }
  return b;
};

test('lamp posts are lighter than trees and launch at a lower speed', () => {
  assert.ok(BREAKABLE.lamp.mass < BREAKABLE.tree.mass);
  assert.ok(launchSpeed(lamp()) < launchSpeed(tree()));
  assert.ok(launchSpeed(tree()) < 28, 'top speed must launch a tree');
});

test('a walking-pace tap topples it from the base: the base stays put, nothing leaves the ground', () => {
  for (const b of [lamp(), tree()]) {
    assert.equal(strike(b, carAt(1.5), 0).mode, 'topple');
    let maxBase = 0;
    run(b, 3, open, (x) => { maxBase = Math.max(maxBase, Math.hypot(x.baseX, x.baseZ)); });
    assert.ok(maxBase < 0.5, `${b.kind} base slid ${maxBase}`);
    assert.equal(b.mode, 'down');
    assert.ok(tipAngle(b) > 1.1, `${b.kind} only tipped ${tipAngle(b)}`);
  }
});

test('a topple falls the way the car was going, turned a little to one side', () => {
  const b = lamp();
  strike(b, { x: -1.5, z: 0, vx: 2, vz: 0 }, 0, { rand: () => 0.9 });
  run(b, 3);
  assert.ok(b.x > 1.5, `centre ended at x ${b.x}`);
  assert.ok(Math.abs(b.z) < 2.5);
});

test('top speed launches it into the air, spinning, well down the road', () => {
  const b = lamp();
  assert.equal(strike(b, carAt(28), 0).mode, 'launch');
  let maxY = 0, turned = 0, prev = tipAngle(b);
  run(b, 1.2, open, (x) => { maxY = Math.max(maxY, x.y); const a = tipAngle(x); turned += Math.abs(a - prev); prev = a; });
  assert.ok(maxY > 4, `apex ${maxY}`);
  assert.ok(turned > Math.PI, `only turned ${turned}`);
  run(b, 8);
  assert.ok(b.z > 10, `landed at z ${b.z}`);
  assert.equal(b.mode, 'down');
});

test('a launched object lands, bounces lower, settles lying down and never sinks', () => {
  const b = tree(1.2);
  strike(b, carAt(26), 0);
  run(b, 10, open, (x) => {
    if (x.mode === 'launch') assert.ok(x.y + x.low > -0.05, `sank to ${x.y + x.low}`);
  });
  assert.equal(b.mode, 'down');
  assert.ok(Math.abs(tipAngle(b) - Math.PI / 2) < 0.45, `not lying on its side: ${tipAngle(b)}`);
});

test('a launched object never comes to rest stood on its end, even dropped upside down', () => {
  for (const speed of [16, 20, 24, 28]) {
    for (const b of [lamp(), tree(0.9), tree(1.35)]) {
      strike(b, carAt(speed), 0);
      run(b, 12);
      assert.equal(b.mode, 'down');
      assert.ok(Math.abs(tipAngle(b) - Math.PI / 2) < 0.45, `${b.kind} at ${speed}: tip ${tipAngle(b)}`);
    }
  }
  const b = tree();
  strike(b, carAt(20), 0);
  b.q = [1, 0, 0, 0]; b.y = 4; b.vx = b.vz = b.wx = b.wz = 0; b.vy = 0;
  run(b, 12);
  assert.ok(Math.abs(tipAngle(b) - Math.PI / 2) < 0.45, `upside-down drop: tip ${tipAngle(b)}`);
});

test('faster hits fly further and higher; lamps further than trees', () => {
  const reach = (b, v) => { strike(b, carAt(v), 0); let top = 0; run(b, 8, open, (x) => { top = Math.max(top, x.y); }); return { z: b.z, top }; };
  const slow = reach(lamp(), 14), fast = reach(lamp(), 28);
  assert.ok(fast.z > slow.z && fast.top > slow.top);
  assert.ok(reach(lamp(), 28).z > reach(tree(), 28).z);
});

test('a falling tree stops against a building rather than through it', () => {
  const b = tree();
  strike(b, carAt(2), 0);
  // A wall 2 units ahead of the trunk.
  const solidAt = (x, z) => z > 2;
  run(b, 4, { groundAt: flat, solidAt });
  assert.equal(b.mode, 'down');
  assert.ok(tipAngle(b) < 1.0, `leaned ${tipAngle(b)} into the wall`);
});

test('a launched object is pushed back out of buildings along its whole length, not just its centre', () => {
  for (const b of [lamp(), tree()]) {
    strike(b, carAt(28), 0, { rand: () => 0.9 });
    // A wall across the road 6 units ahead: z > 6 is inside.
    const push = (x, z, r) => (z + r > 6 ? { x, z: 6 - r, nx: 0, nz: -1 } : null);
    run(b, 6, { groundAt: flat, push }, (x) => {
      for (const [, , sz] of bodySamples(x)) assert.ok(sz <= 6 + 1e-6, `${x.kind} ${x.mode}: a sample went through to z ${sz}`);
    });
  }
});

test('the car keeps going: about 10% off for a launched lamp post, 30% for a launched tree', () => {
  const l = speedAfterHit('lamp', 0, 20), t = speedAfterHit('tree', 0, 20);
  assert.ok(Math.abs(Math.hypot(l.vx, l.vz) - 18) < 0.5);
  assert.ok(Math.abs(Math.hypot(t.vx, t.vz) - 14) < 0.5);
  assert.ok(t.vz > 0, 'no reversal');
});

test('a topple slows the car hard so it does not roll into what it knocked: 35% lamp, 60% tree', () => {
  const l = speedAfterHit('lamp', 0, 6, 'topple'), t = speedAfterHit('tree', 0, 10, 'topple');
  assert.ok(Math.abs(l.vz - 6 * 0.65) < 1e-9);
  assert.ok(Math.abs(t.vz - 10 * 0.4) < 1e-9);
});

test('touchesCar: the car body touching or sweeping through the spot hits, one passing by does not', () => {
  const b = lamp();
  assert.ok(touchesCar(b, { x: 0, z: -1.5, y: 0 }, { x: 0, z: -3 }));
  assert.ok(touchesCar(b, { x: 0, z: 2.5, y: 0 }, { x: 0, z: -2.5 }), 'swept through in one frame');
  assert.ok(!touchesCar(b, { x: 3, z: 0, y: 0 }, { x: 3, z: -1 }));
  assert.ok(!touchesCar(b, { x: 0, z: -1.5, y: 6 }, { x: 0, z: -3 }), 'flying over');
  strike(b, carAt(5), 0);
  assert.ok(!touchesCar(b, { x: 0, z: -1.5, y: 0 }, { x: 0, z: -3 }), 'already knocked');
});

test('reset waits 20 seconds, for both spots to be off screen, and for the car to be clear', () => {
  const b = lamp();
  assert.equal(canRestore(b, 100, false, 50, 50), false, 'never knocked');
  strike(b, carAt(5), 10);
  run(b, 3);
  assert.equal(canRestore(b, 25, false, 50, 50), false, 'too soon');
  assert.equal(canRestore(b, 31, true, 50, 50), false, 'in view');
  assert.equal(canRestore(b, 31, false, 1, 1), false, 'car on the spot');
  assert.equal(canRestore(b, 31, false, 50, 50), true);
  restoreBreakable(b);
  assert.equal(b.mode, 'standing');
  assert.equal(b.baseX, 0); assert.equal(b.baseZ, 0);
  assert.equal(b.source.down, false);
  assert.ok(tipAngle(b) < 1e-6);
});

test('the solid set drops in-plot trees and lamp posts but keeps buildings and everything else', () => {
  const all = [
    { type: 'box', kind: 'building', id: 'gym', x: 0, z: 0, hw: 5, hd: 5 },
    { type: 'circle', kind: 'fountain', x: 0, z: 0, r: 4 },
    { type: 'box', kind: 'bench', x: 0, z: 0, hw: 1, hd: 0.4 },
    { type: 'circle', kind: 'lamp', x: 9, z: 0, r: 0.35 },
    { type: 'circle', kind: 'tree', x: 20, z: 0, r: 0.6, tree: 0 },
  ];
  const { solid, breakable } = splitColliders(all);
  assert.deepEqual(solid.map((c) => c.kind), ['building', 'fountain', 'bench']);
  assert.deepEqual(breakable.map((c) => c.kind), ['lamp', 'tree']);
});

test('placement still steers round standing trees and posts, but not knocked ones', () => {
  const solid = [{ type: 'box', kind: 'building', x: 0, z: 0, hw: 5, hd: 5 }];
  const b = lamp();
  assert.equal(clearanceColliders(solid, [b]).length, 2);
  strike(b, carAt(5), 0);
  assert.equal(clearanceColliders(solid, [b]).length, 1);
});

test('the camera stops fading a tree once it is knocked (occluder switched off)', () => {
  const shape = { type: 'circle', x: 0, z: 5, r: 2, kind: 'tree', key: 't:0' };
  assert.equal(blockers(0, 0, 0, 10, [shape], 1).length, 1);
  shape.off = true;
  assert.equal(blockers(0, 0, 0, 10, [shape], 1).length, 0);
});

// ---------- Launch numbers: always out ahead of the car, off to one side, never inside it ----------

const hitFrom = (b, speed, dx = 0.4) => ({ x: b.home.x + dx, z: b.home.z - 1.6, vx: 0, vz: speed });

test('a launch always beats the car: forward speed above the car speed after the hit, by 9 (lamp) or 7 (tree)', () => {
  for (const make of [lamp, () => tree(0.9), () => tree(1.35)]) {
    for (const speed of [9, 14, 16, 20, 24, 28]) {
      const b = make();
      if (speed < launchSpeed(b)) continue;
      const car = hitFrom(b, speed);
      assert.equal(strike(b, car, 0).mode, 'launch');
      const after = speedAfterHit(b.kind, car.vx, car.vz).vz;
      const extra = Math.min(b.kind === 'lamp' ? 9 : 7, 38 - after);
      assert.ok(b.vz >= after + extra - 1e-9, `${b.kind} at ${speed}: forward ${b.vz} vs car ${after}`);
      assert.ok(b.vz <= 38 + 1e-9, 'capped at 38');
    }
  }
});

test('a launch goes sideways at 0.25 to 0.5 of its forward speed (by how far off centre), to the side of the car it was on', () => {
  const share = 0.25 + 0.25 * (0.5 / (CAR_BODY.hw + 0.35));
  const right = lamp();
  strike(right, { x: -0.5, z: -1.6, vx: 0, vz: 20 }, 0); // lamp sits to the car's +x side
  assert.ok(Math.abs(right.vx - share * right.vz) < 1e-9, `lateral ${right.vx} vs ${right.vz}`);
  const left = lamp();
  strike(left, { x: 0.5, z: -1.6, vx: 0, vz: 20 }, 0);
  assert.ok(Math.abs(left.vx + share * left.vz) < 1e-9);
  // Dead centre: a coin toss.
  const a = lamp(), c = lamp();
  strike(a, { x: 0, z: -1.6, vx: 0, vz: 20 }, 0, { rand: () => 0.1 });
  strike(c, { x: 0, z: -1.6, vx: 0, vz: 20 }, 0, { rand: () => 0.9 });
  assert.ok(Math.sign(a.vx) !== Math.sign(c.vx) && a.vx !== 0 && c.vx !== 0);
});

test('a launch lifts by (5.5 + 0.3 per unit over launch speed) * sqrt(k) and tumbles end over end along its flight line', () => {
  for (const b of [lamp(), tree()]) {
    const speed = 24;
    strike(b, hitFrom(b, speed, 0), 0, { rand: () => 0.5 });
    const k = Math.sqrt(2 / b.mass);
    assert.ok(Math.abs(b.vy - (5.5 + (speed - launchSpeed(b)) * 0.3) * Math.sqrt(k)) < 1e-9);
    assert.ok(Math.abs(b.wx * b.vx + b.wz * b.vz) < 1e-9, 'spin axis square to the flight line');
    assert.equal(b.wy, 0, 'no yaw from a dead-centre hit');
    // The top tips away from the car: w = (h.z, 0, -h.x) * spin.
    assert.ok(b.wx > 0);
    const spin = Math.hypot(b.wx, b.wz);
    // A lamp: 1.3 turns by the time it is back down to launch height (2 vy / g); a tree: 2.5 + 0.28 v.
    if (b.kind === 'lamp') assert.ok(Math.abs(spin * (2 * b.vy / 25) - 1.3 * 2 * Math.PI) < 1e-6, `lamp spin ${spin}`);
    else assert.ok(Math.abs(spin - (2.5 + speed * 0.28) * k) < 1e-9);
  }
});

// The car's body as drawn: 2.2 wide, 4.06 bumper to bumper, roof at 2.0 but the front 1.3 only
// bonnet high (1.4), centred on the car.
function insideCar(b, car) {
  const hd = Math.hypot(car.vx, car.vz) > 0.01 ? Math.atan2(car.vx, car.vz) : 0;
  const s = Math.sin(hd), c = Math.cos(hd);
  let worst = Infinity;
  for (const [x, y, z, , r] of bodySamples(b).slice(0, BREAKABLE[b.kind].visible)) {
    const dx = x - car.x, dz = z - car.z;
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    const top = lz > CAR_BODY.hl - 1.3 ? 1.4 : 2;
    const ex = Math.max(0, Math.abs(lx) - CAR_BODY.hw), ez = Math.max(0, Math.abs(lz) - CAR_BODY.hl), ey = Math.max(0, y - top);
    worst = Math.min(worst, Math.hypot(ex, ey, ez) - r);
  }
  return worst < -0.02;
}

/** Drives the car straight through one, the way smash.js wires it, and counts frames inside the car. */
function drive(b, speed, { reduced = false, dt = 1 / 60, offset = 0, accel = 0, secs = 4, rand = () => 0.7 } = {}) {
  const car = { x: b.home.x + offset, z: b.home.z - (CAR_BODY.hl + b.r + 0.02), y: 0, vx: 0, vz: speed };
  const prev = { x: car.x, z: car.z - speed * dt };
  let frames = 0, inside = 0, hitAt = -1, kicks = 0, launched = false;
  for (let i = 0; i < secs / dt; i++) {
    if (b.mode === 'standing') {
      if (headingInto(b, car, prev) && touchesCar(b, car, prev)) {
        const { mode } = strike(b, car, i * dt, { reduced, rand });
        const after = speedAfterHit(b.kind, car.vx, car.vz, mode);
        car.vx = after.vx; car.vz = after.vz; hitAt = i;
      }
    } else if (debrisInWay(b, car)) {
      rekick(b, car, i * dt, { reduced, rand });
      car.vx *= 0.95; car.vz *= 0.95; kicks++;
    }
    stepBreakable(b, dt, open);
    clearOfCar(b, car, null, CAR_BODY, Math.hypot(car.x - prev.x, car.z - prev.z));
    if (b.mode !== 'standing') {
      const push = blockCar(b, car);
      if (push) {
        car.x += push.dx; car.z += push.dz;
        const vn = car.vx * push.nx + car.vz * push.nz;
        if (vn < 0) { car.vx -= vn * push.nx; car.vz -= vn * push.nz; }
      }
    }
    if (b.mode === 'launch') launched = true;
    if (hitAt >= 0 && i - hitAt > 2 && insideCar(b, car)) inside++;
    if (hitAt >= 0) frames++;
    prev.x = car.x; prev.z = car.z;
    car.vz += accel * dt;
    car.x += car.vx * dt; car.z += car.vz * dt;
  }
  return { inside, frames, hitAt, kicks, launched };
}

test('nothing sits inside the car after the first two frames: lamp and tree, slow and fast, both frame rates', () => {
  for (const make of [lamp, () => tree(0.9), tree, () => tree(1.35)]) {
    for (const speed of [3, 6, 10, 14, 20, 28]) {
      for (const offset of [-0.9, -0.3, 0, 0.3, 0.9]) {
        for (const dt of [1 / 60, 1 / 20]) {
          const b = make();
          const r = drive(b, speed, { offset, dt, accel: speed > 10 ? 4 : 0 });
          assert.ok(r.hitAt >= 0, `${b.kind} at ${speed} never hit`);
          assert.equal(r.inside, 0, `${b.kind} s${b.s} at ${speed} offset ${offset} dt ${dt.toFixed(3)}: inside the car on ${r.inside} frames`);
        }
      }
    }
  }
});

test('reduced motion never launches: it topples, turned 55 degrees to the glancing side, base pushed sideways, no spin', () => {
  for (const make of [lamp, tree]) {
    const b = make();
    const car = { x: -0.5, z: -1.6, vx: 0, vz: 28 };
    assert.equal(strike(b, car, 0, { reduced: true }).mode, 'topple');
    const ang = Math.atan2(b.dirX, b.dirZ);
    assert.ok(Math.abs(ang - (55 * Math.PI) / 180) < 1e-6, `fall turned ${(ang * 180) / Math.PI} degrees`);
    assert.ok(Math.abs(b.bvx - 4) < 1e-9, `sideways shove ${b.bvx}`);
    assert.ok(Math.abs(b.bvz - 5) < 1e-9, 'along the car capped at 5');
    let maxY = 0;
    run(b, 4, open, (x) => { assert.notEqual(x.mode, 'launch'); maxY = Math.max(maxY, x.y + x.low); });
    assert.ok(maxY < 0.05, `left the ground: ${maxY}`);
    assert.equal(b.mode, 'down');
    assert.equal(b.wx + b.wy + b.wz, 0);
  }
});

test('reduced motion: nothing sits inside the car after the first two frames, and nothing ever flies', () => {
  for (const make of [lamp, tree]) {
    for (const speed of [3, 6, 14, 28]) {
      for (const offset of [-0.6, 0, 0.6]) {
        const b = make();
        const r = drive(b, speed, { reduced: true, offset });
        assert.equal(r.launched, false, `${b.kind} at ${speed} launched under reduced motion`);
        assert.equal(r.inside, 0, `${b.kind} at ${speed} offset ${offset}: inside on ${r.inside} frames`);
      }
    }
  }
});

test('a normal topple falls 35% toward the glancing side and the base takes 0.6 of the car velocity', () => {
  const b = lamp();
  strike(b, { x: -0.5, z: -1.6, vx: 0, vz: 4 }, 0);
  assert.equal(b.mode, 'topple');
  const l = Math.hypot(0.35, 0.65);
  assert.ok(Math.abs(b.dirX - 0.35 / l) < 1e-9 && Math.abs(b.dirZ - 0.65 / l) < 1e-9, `dir ${b.dirX}, ${b.dirZ}`);
  assert.ok(Math.abs(b.bvz - 4 * 0.6) < 1e-9 && b.bvx === 0);
});

test('a launched tree settles over about a third of a second into the toppled pose: trunk base and canopy both on the ground', () => {
  for (const s of [0.9, 1.2]) {
    const b = tree(s);
    strike(b, carAt(26), 0);
    let settleFrames = 0;
    run(b, 10, open, (x) => { if (x.mode === 'settle') settleFrames++; });
    assert.equal(b.mode, 'down');
    assert.ok(settleFrames >= 20 && settleFrames <= 23, `settled over ${settleFrames} frames`);
    assert.ok(Math.abs(b.theta - BREAKABLE.tree.rest) < 1e-9);
    // Trunk base on the ground.
    const base = bodySamples(b)[0];
    assert.ok(Math.abs(base[1]) < 0.02, `trunk base at height ${base[1]}`);
    // The canopy (a round crown, faces about 1.27 s from its centre) rests on the ground.
    const crown = bodySamples(b)[5][1] - 1.27 * s;
    assert.ok(crown > -0.3 && crown < 0.1, `canopy bottom at ${crown}`);
  }
});

test('across a ramp edge a launched tree stays as it landed, rather than settling into air', () => {
  // Where the same throw would first start to settle, put a ramp's top edge (2 high) under its crown.
  const flatRun = tree();
  strike(flatRun, carAt(26), 0, { rand: () => 0.9 });
  let at = null;
  run(flatRun, 10, open, (x) => { if (x.mode === 'settle' && !at) at = { x: x.baseX, z: x.baseZ, dx: x.dirX, dz: x.dirZ }; });
  const reach = flatRun.height * Math.sin(BREAKABLE.tree.rest);
  const cx = at.x + at.dx * reach, cz = at.z + at.dz * reach;
  const ramp = (x, z) => (Math.hypot(x - cx, z - cz) < 0.6 ? 2 : 0);
  const b = tree();
  strike(b, carAt(26), 0, { rand: () => 0.9 });
  run(b, 10, { groundAt: ramp }, (x) => {
    if (x.mode !== 'settle' || x.settleT > 0.02) return;
    // Whenever it does start to settle, trunk to crown is flat ground.
    const g0 = ramp(x.baseX, x.baseZ), g1 = ramp(x.baseX + x.dirX * reach, x.baseZ + x.dirZ * reach);
    assert.ok(Math.abs(g1 - g0) <= 0.2, 'settled with its crown over the ramp edge');
  });
  assert.ok(b.mode === 'down' || b.mode === 'topple');
});

test('the settle eases from the landed pose: no jump on its first frame', () => {
  const b = tree();
  strike(b, carAt(26), 0);
  let last = null, jump = 0;
  run(b, 10, open, (x) => {
    if (last && (x.mode === 'settle' || last.mode === 'settle')) jump = Math.max(jump, Math.hypot(x.x - last.x, x.y - last.y, x.z - last.z));
    last = { mode: x.mode, x: x.x, y: x.y, z: x.z };
  });
  assert.ok(jump < 0.4, `jumped ${jump} in one frame`);
});

test('a launched lamp slides a short way once it has landed', () => {
  const b = lamp();
  strike(b, { x: -0.5, z: -1.6, vx: 0, vz: 28 }, 0);
  let landedAt = null;
  run(b, 10, open, (x) => { if (x.landed === 1 && !landedAt) landedAt = { x: x.x, z: x.z }; });
  const slide = Math.hypot(b.x - landedAt.x, b.z - landedAt.z);
  // A box would slide about 8.4 here; a pole drags and digs in, so about half that.
  assert.ok(slide < 5, `slid ${slide} after the first landing`);
});

// ---------- Hit filter (smash.js uses these) ----------

test('headingInto: a fast glancing sweep that ends past the object still counts', () => {
  const b = lamp();
  // A long frame at speed: this one jumps 6 units, its side passing just by the post.
  const prev = { x: 1.3, z: -3 }, car = { x: 1.3, z: 3, vx: 0, vz: 28 };
  assert.ok(touchesCar(b, car, prev));
  assert.ok(headingInto(b, car, prev), 'a sweep that touches it is heading into it');
  // Pulling away from one behind the car never knocks it.
  assert.ok(!headingInto(b, { x: 0, z: 2.5, vx: 0, vz: 5 }, { x: 0, z: 2.4 }));
  // Overlapping it while reversing away still knocks it (it was touching).
  assert.ok(headingInto(b, { x: 0, z: 1.2, vx: 0, vz: 3 }, { x: 0, z: 1.15 }));
  // Straight at it, short of it this frame.
  assert.ok(headingInto(b, { x: 0, z: -1.6, vx: 0, vz: 6 }, { x: 0, z: -1.7 }));
});

test('debrisInWay: the car driving into a fallen one, or catching a slow one, gets it; passing or pulling away does not', () => {
  const b = lamp();
  strike(b, { x: 0, z: -1.6, vx: 0, vz: 3 }, 0, { rand: () => 0.9 });
  run(b, 3);
  assert.equal(b.mode, 'down');
  const [cx, , cz] = bodySamples(b)[1]; // middle of the pole
  assert.ok(debrisInWay(b, { x: cx, z: cz - 1.5, y: 0, vx: 0, vz: 5 }), 'driving into it');
  assert.ok(!debrisInWay(b, { x: cx, z: cz + 4.5, y: 0, vx: 0, vz: 5 }), 'pulling away');
  assert.ok(!debrisInWay(b, { x: cx + 6, z: cz, y: 0, vx: 0, vz: 5 }), 'well to one side');
  assert.ok(!debrisInWay(b, { x: cx, z: cz - 1.5, y: 0, vx: 0, vz: 0.5 }), 'creeping');
  const flying = lamp();
  strike(flying, carAt(28), 0);
  assert.ok(!debrisInWay(flying, { x: 0, z: -1.6, y: 0, vx: 0, vz: 25 }), 'a fresh launch is already outrunning the car');
  assert.ok(!debrisInWay(lamp(), { x: 0, z: -1.6, y: 0, vx: 0, vz: 5 }), 'standing ones are the hit test\'s job');
});

test('rekick: one lying down is shoved along the ground ahead of the car and off to the side, never thrown', () => {
  const b = lamp();
  strike(b, { x: 0, z: -1.6, vx: 0, vz: 3 }, 0, { rand: () => 0.9 });
  run(b, 3);
  // The car comes up on its -x side, so it goes off to +x.
  const car = { x: Math.min(...bodySamples(b).map((p) => p[0])) - 0.5, z: b.z - 1.5, y: 0, vx: 0, vz: 10 };
  rekick(b, car, 5);
  assert.equal(b.mode, 'topple');
  assert.ok(b.bvz >= 14 - 1e-9, `forward ${b.bvz}`);
  assert.ok(Math.abs(b.bvx - 4) < 1e-9, `sideways ${b.bvx}`);
  assert.equal(b.knockedAt, 5);
  run(b, 3, open, (x) => { assert.notEqual(x.mode, 'launch'); assert.ok(Math.abs(bodySamples(x)[0][1]) < 0.05, 'base left the ground'); });

  // One still flying slower than the car is sent on, with no lift.
  const f = lamp();
  strike(f, carAt(14), 0, { rand: () => 0.9 });
  run(f, 0.2);
  const vy = f.vy;
  rekick(f, { x: f.x - 0.5, z: f.z - 2.5, y: 0, vx: 0, vz: 20 }, 5);
  assert.equal(f.mode, 'launch');
  assert.ok(f.vz >= 24 - 1e-9 && f.vy === Math.max(vy, 0));

  const r = lamp();
  strike(r, { x: 0, z: -1.6, vx: 0, vz: 3 }, 0, { reduced: true, rand: () => 0.9 });
  run(r, 3);
  rekick(r, { x: Math.min(...bodySamples(r).map((p) => p[0])) - 0.5, z: r.z - 1.5, y: 0, vx: 0, vz: 10 }, 5, { reduced: true });
  assert.equal(r.mode, 'topple');
  assert.ok(r.bvz >= 14 - 1e-9 && Math.abs(r.bvx - 4) < 1e-9);
  assert.equal(r.yawRate, 0, 'no swing under reduced motion');
  run(r, 3, open, (x) => assert.notEqual(x.mode, 'launch'));
});

test('clearOfCar: a part inside the car body slides the whole thing on ahead of the bumper', () => {
  const b = lamp();
  strike(b, { x: 0, z: -2.3, vx: 0, vz: 28 }, 0, { rand: () => 0.9 });
  const car = { x: 0, z: -1.08, y: 0, vx: 0, vz: 25 }; // bumper at z 0.95, past the pole's base
  const before = b.z;
  assert.ok(clearOfCar(b, car));
  assert.ok(b.z > before && b.z - before <= 0.45 + 1e-9, 'a shove, not a jump');
  // A falling one moves no more than just over the car's own step.
  const t = lamp();
  strike(t, { x: 0, z: -2.5, vx: 0, vz: 4 }, 0, { rand: () => 0.9 });
  for (let i = 0; i < 6; i++) stepBreakable(t, 1 / 60, open);
  const tz = t.baseZ;
  assert.ok(clearOfCar(t, { x: 0, z: t.baseZ - 1.9, y: 0, vx: 0, vz: 4 }, null, CAR_BODY, 4 / 60));
  assert.ok(t.baseZ - tz <= Math.max(4 / 60 + 0.05, 0.1) + 1e-9, `slid ${t.baseZ - tz}`);
  for (let i = 0; i < 5; i++) clearOfCar(b, car);
  const [, , baseZ, , r] = bodySamples(b)[0];
  assert.ok(baseZ - r >= 0.95 - 1e-9, `base still at ${baseZ}`);
  assert.equal(clearOfCar(b, car), false, 'already clear');
  assert.equal(clearOfCar(b, { x: 6, z: -1, y: 0, vx: 0, vz: 25 }), false, 'off to one side');
});

// ---------- World env: what catches a falling top, what pushes a body out ----------

const box = (x, z, hw, hd, extra) => ({ type: 'box', x, z, hw, hd, rot: 0, ...extra });
const miniWorld = {
  colliders: [
    box(0, 20, 5, 5, { kind: 'building', id: 'gym' }),
    box(0, -20, 5, 5, { kind: 'building', id: 'site-1' }),
    box(10, 0, 1.05, 0.45, { kind: 'bench' }),
    { type: 'circle', kind: 'fountain', x: -10, z: 0, r: 4.5 },
    box(20, 0, 3.9, 0.3, { kind: 'sign' }),
  ],
  plotHalf: 40, plotCorner: 10, groundHeightAt: () => 0,
};

test('worldEnv: only real buildings catch a falling top; benches, fountain, signs, sites and the plot edge do not', () => {
  const env = worldEnv(miniWorld);
  assert.ok(env.solidAt(0, 20));
  assert.ok(!env.solidAt(0, -20), 'building site');
  assert.ok(!env.solidAt(10, 0), 'bench');
  assert.ok(!env.solidAt(-10, 0), 'fountain');
  assert.ok(!env.solidAt(20, 0), 'sign');
  assert.ok(!env.solidAt(45, 0), 'past the plot edge');
  assert.ok(env.push(0, 15.5, 1), 'pushed out of a building');
  assert.ok(env.push(39.5, 0, 1), 'pushed back inside the plot');
  assert.equal(env.push(10, 0, 1), null, 'benches do not push');
});

test('worldEnv: a falling top catches on a building\'s walls, not on its open forecourt or garden', () => {
  // A plot 10 x 9 with the house's walls 6.5 x 5.3 in one corner of it (local -x, -z).
  const world = {
    colliders: [box(0, 0, 5, 4.5, { kind: 'building', id: 'home' })],
    places: [{ id: 'home', model: 'house', position: [0, 0], rotation: 0, footprint: [10, 9] }],
    plotHalf: 40, plotCorner: 10, groundHeightAt: () => 0,
  };
  const env = worldEnv(world);
  assert.ok(env.solidAt(-2, -2), 'inside the walls');
  assert.ok(env.solidAt(-4.9, -2), 'in the plot, just off the wall');
  assert.ok(!env.solidAt(4.5, 3.5), 'out on the garden');
  assert.ok(env.push(4.5, 3.5, 0.3), 'but a body still cannot rest on the plot');
  // A lamp toppling into the garden lies flat, slid clear of the plot, never leaning on air.
  const b = createBreakable({ type: 'circle', kind: 'lamp', x: 7, z: 3, r: 0.35, rot: 0 });
  strike(b, { x: 8.6, z: 3, vx: -3, vz: 0 }, 0, { rand: () => 0.9 });
  run(b, 4, env);
  assert.equal(b.mode, 'down');
  assert.ok(tipAngle(b) > 1.1, `leans at ${tipAngle(b)} on the garden`);
  for (const [x, , z] of bodySamples(b)) assert.ok(!pointInside(x, z, world.colliders[0]), `rests in the plot at ${x}, ${z}`);
  // One toppling at the wall leans on it, its top at the wall.
  const w = createBreakable({ type: 'circle', kind: 'tree', x: -2, z: -7, r: 0.6, rot: 0, s: 1 });
  strike(w, { x: -2, z: -8.6, vx: 0, vz: 2 }, 0, { rand: () => 0.9 });
  run(w, 4, env);
  assert.ok(tipAngle(w) < 1.1, `did not lean: ${tipAngle(w)}`);
});

test('a topple onto a bench or over the plot edge lies flat, never leaning on air, and stays inside the plot', () => {
  const env = worldEnv(miniWorld);
  const cases = [
    { make: () => createBreakable({ type: 'circle', kind: 'lamp', x: 10, z: -3, r: 0.35, rot: 0 }), car: { x: 10, z: -4.6, vx: 0, vz: 4 } },
    { make: () => createBreakable({ type: 'circle', kind: 'tree', x: -10, z: -6, r: 0.6, rot: 0, s: 1 }), car: { x: -10, z: -7.6, vx: 0, vz: 4 } },
    { make: () => createBreakable({ type: 'circle', kind: 'tree', x: 37, z: 0, r: 0.6, rot: 0, s: 1.2 }), car: { x: 35.4, z: 0, vx: 4, vz: 0 } },
    { make: () => createBreakable({ type: 'circle', kind: 'lamp', x: 0, z: 37.5, r: 0.35, rot: 0 }), car: { x: 0, z: 35.9, vx: 0, vz: 4 } },
  ];
  for (const { make, car } of cases) {
    const b = make();
    strike(b, car, 0, { rand: () => 0.9 });
    run(b, 4, env);
    assert.equal(b.mode, 'down');
    assert.ok(tipAngle(b) > 1.1, `${b.kind} at ${b.home.x},${b.home.z} leans at ${tipAngle(b)}`);
    for (const [x, , z] of bodySamples(b)) assert.ok(plotDistanceOf(x, z) <= 1e-6, `${b.kind} sample outside the plot at ${x},${z}`);
  }
});

import { plotDistance } from '../js/physics.js';
const plotDistanceOf = (x, z) => plotDistance(x, z, miniWorld.plotHalf, miniWorld.plotCorner);
