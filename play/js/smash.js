// Breakaway lamp posts and in-town trees: drive into one and it topples or flies. The maths
// (hit filter, launch, kick-again, keeping clear of the car and buildings, where debris is solid
// to the car, reset rule) is in breakaway.js; this file runs it each frame, moves the instances
// that draw each object, dims a knocked lamp's head, and puts everything back out of view 20
// seconds later.
//
// Fires on `events`: smash { kind, strength, mode } (mode 'topple', 'launch' or 'kick').
import * as THREE from 'three';
import {
  createBreakable, strike, stepBreakable, speedAfterHit, canRestore, restoreBreakable, touchesCar,
  headingInto, debrisInWay, rekick, clearOfCar, blockCar, worldEnv, KICK_MIN, CAR_BODY,
} from './breakaway.js';

const MIN_SPEED = 0.2;       // slower than this, the car is resting against it, not hitting it
const TELEPORT = 5;          // a car that moved further than this in a frame was reset or travelled
const FLICKER = 0.36;        // seconds a knocked lamp flickers before it goes out
const KICK_SOUND_GAP = 0.3;  // seconds between kick sounds from one body (and after its strike)
// The dead head is cool grey, so it reads as unlit glass rather than a dirty bulb.
const LIT = new THREE.Color('#ffffff'), DIM = new THREE.Color('#77808a');

const P = new THREE.Matrix4(), OUT = new THREE.Matrix4(), T = new THREE.Matrix4();
const POS = new THREE.Vector3(), QUAT = new THREE.Quaternion(), ONE = new THREE.Vector3(1, 1, 1);

export function createSmash({ camera, world, car, events, chase, fader, occluders = [], reducedMotion = false }) {
  const emit = (type, detail) => events.dispatchEvent(new CustomEvent(type, { detail }));
  const byKey = new Map(occluders.map((o) => [o.key, o]));

  const bodies = world.breakables.map((src) => {
    const b = createBreakable(src);
    // Per part: K = T(-offset) R_y(-rot) T(-home) M0, so the drawn matrix is T(centre) R(q) K.
    const [ox, oy, oz] = b.offset;
    const toLocal = new THREE.Matrix4().makeTranslation(-ox, -oy, -oz)
      .multiply(T.makeRotationY(-b.home.rot))
      .multiply(new THREE.Matrix4().makeTranslation(-b.home.x, 0, -b.home.z));
    b.parts = src.parts.map(({ mesh, index, light }) => {
      const m0 = new THREE.Matrix4();
      mesh.getMatrixAt(index, m0);
      return { mesh, index, light, home: m0, k: toLocal.clone().multiply(m0) };
    });
    b.occluder = src.kind === 'tree' ? byKey.get(`t:${src.tree}`) ?? null : null;
    b.key = b.occluder?.key ?? null;
    return b;
  });

  // Real buildings catch a falling top and push bodies out; the plot edge keeps them in. With the
  // car in it, a wall never throws a body back at the car.
  const env = worldEnv(world);

  const moving = new Set();     // knocked bodies whose pose changes (flying, falling, flickering)
  const knocked = new Set();    // every body away from home
  const dirtyMeshes = new Set();
  const prev = { x: car.x, z: car.z };
  const carNow = { x: 0, z: 0, y: 0, vx: 0, vz: 0, heading: 0 };
  env.car = carNow;
  const syncCar = () => {
    carNow.x = car.x; carNow.z = car.z; carNow.y = car.y; carNow.vx = car.vx; carNow.vz = car.vz; carNow.heading = car.heading;
  };
  let clock = 0;

  const frustum = new THREE.Frustum(), sphere = new THREE.Sphere(), M = new THREE.Matrix4();
  const inView = (x, y, z, r) => frustum.intersectsSphere(sphere.set(POS.set(x, y, z), r));

  function draw(b) {
    QUAT.set(b.q[0], b.q[1], b.q[2], b.q[3]);
    P.compose(POS.set(b.x, b.y, b.z), QUAT, ONE);
    for (const part of b.parts) {
      part.mesh.setMatrixAt(part.index, OUT.multiplyMatrices(P, part.k));
      dirtyMeshes.add(part.mesh);
    }
  }

  function setLight(b, on) {
    for (const part of b.parts) {
      if (!part.light) continue;
      part.mesh.setColorAt(part.index, on ? LIT : DIM);
      part.mesh.instanceColor.needsUpdate = true;
    }
  }

  function hit(b) {
    if (b.key) fader.release(b.key); // a faded tree goes back to its own instance first
    if (b.occluder) b.occluder.off = true;
    const speed = Math.hypot(car.vx, car.vz);
    const dx = car.vx / speed, dz = car.vz / speed;
    const { mode, loss } = strike(b, carNow, clock, { reduced: reducedMotion });
    // Reduced motion pays what the full-motion hit would have: the same speed, a calmer fall.
    const after = speedAfterHit(b.kind, car.vx, car.vz, loss);
    b.struckAt = clock;
    car.vx = after.vx; car.vz = after.vz;
    // The view lurches towards the car's travel with the knock (none under reduced motion).
    chase.nudge(Math.min(speed, 20) * (b.kind === 'tree' ? 0.55 : 0.3), dx, dz);
    if (b.kind === 'lamp' && reducedMotion) setLight(b, false);
    knocked.add(b); moving.add(b);
    emit('smash', { kind: b.kind, strength: speed, mode });
  }

  /** The car drove into one already knocked: send it on again rather than through the car. */
  function kick(b) {
    const speed = Math.hypot(car.vx, car.vz);
    rekick(b, carNow, clock, { reduced: reducedMotion });
    car.vx *= 0.95; car.vz *= 0.95;
    moving.add(b);
    // No kick sound on the heels of its own strike (or of another kick): one knock, one sound.
    const last = Math.max(b.kickSound ?? -Infinity, b.struckAt ?? -Infinity);
    if (!(clock - last < KICK_SOUND_GAP)) {
      b.kickSound = clock;
      emit('smash', { kind: b.kind, strength: speed * 0.5, mode: 'kick' });
    }
  }

  /**
   * Where a body is solid to the car (debris pinned against a wall, one too slow to kick or hit):
   * back the car out of it. Above the kick speed, also stop its motion into it.
   */
  function block(b, speed) {
    const push = blockCar(b, carNow);
    if (!push) return;
    car.x += push.dx; car.z += push.dz;
    if (speed >= KICK_MIN) {
      const vn = car.vx * push.nx + car.vz * push.nz;
      if (vn < 0) { car.vx -= vn * push.nx; car.vz -= vn * push.nz; }
    }
    car.syncObject();
    syncCar();
  }

  const reach = CAR_BODY.hl + 6;

  return {
    bodies,
    /** Per frame, after the car has moved. `paused` while a panel or the map is open. */
    update(dt, paused) {
      if (paused) { prev.x = car.x; prev.z = car.z; return; }
      clock += dt;
      syncCar();
      if (Math.hypot(car.x - prev.x, car.z - prev.z) > TELEPORT) { prev.x = car.x; prev.z = car.z; }
      const step = Math.hypot(car.x - prev.x, car.z - prev.z); // how far the car moved this frame
      const speed = Math.hypot(car.vx, car.vz);
      if (speed > MIN_SPEED) {
        const minX = Math.min(prev.x, car.x) - 3, maxX = Math.max(prev.x, car.x) + 3;
        const minZ = Math.min(prev.z, car.z) - 3, maxZ = Math.max(prev.z, car.z) + 3;
        for (const b of bodies) {
          if (b.mode !== 'standing' || b.home.x < minX || b.home.x > maxX || b.home.z < minZ || b.home.z > maxZ) continue;
          // Only when the car is heading into it, so pulling away from one never knocks it.
          if (headingInto(b, carNow, prev) && touchesCar(b, carNow, prev)) {
            hit(b);
            carNow.vx = car.vx; carNow.vz = car.vz;
          }
        }
        // Driving into one already down (or catching one it knocked): kick it on again.
        for (const b of knocked) {
          if (b.knockedAt === clock || Math.abs(b.x - car.x) > 8 || Math.abs(b.z - car.z) > 8) continue;
          if (debrisInWay(b, carNow)) { kick(b); carNow.vx = car.vx; carNow.vz = car.vz; }
        }
      }
      prev.x = car.x; prev.z = car.z;

      for (const b of moving) {
        stepBreakable(b, dt, env);
        if (b.kind === 'lamp' && !b.lightOff) {
          const t = clock - b.knockedAt;
          if (t >= FLICKER || reducedMotion) { b.lightOff = true; setLight(b, false); }
          else setLight(b, Math.floor(t / 0.06) % 3 !== 1);
        }
      }
      // Never drawn inside the car: anything knocked that it is sitting in gets slid on ahead
      // (or along a wall it is pinned against); what still can't clear stops the car short.
      for (const b of knocked) {
        if (Math.abs(b.x - car.x) > 8 || Math.abs(b.z - car.z) > 8) continue;
        if (clearOfCar(b, carNow, env, CAR_BODY, step)) moving.add(b);
        block(b, speed);
      }
      // Creeping into a standing one too slowly to knock it: it is solid.
      if (speed <= MIN_SPEED) {
        for (const b of bodies) {
          if (b.mode !== 'standing' || Math.abs(b.home.x - car.x) > reach || Math.abs(b.home.z - car.z) > reach) continue;
          block(b, speed);
        }
      }
      for (const b of moving) {
        draw(b);
        if (b.mode === 'down' && (b.kind !== 'lamp' || b.lightOff)) moving.delete(b);
      }

      if (knocked.size) {
        camera.updateMatrixWorld();
        frustum.setFromProjectionMatrix(M.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
        for (const b of knocked) {
          const r = b.height * 0.6;
          const visible = inView(b.x, b.y, b.z, r) || inView(b.home.x, b.height / 2, b.home.z, r);
          if (!canRestore(b, clock, visible, car.x, car.z)) continue;
          restoreBreakable(b);
          for (const part of b.parts) { part.mesh.setMatrixAt(part.index, part.home); dirtyMeshes.add(part.mesh); }
          if (b.kind === 'lamp') setLight(b, true);
          if (b.occluder) b.occluder.off = false;
          knocked.delete(b); moving.delete(b);
        }
      }

      for (const m of dirtyMeshes) m.instanceMatrix.needsUpdate = true;
      dirtyMeshes.clear();
    },
    /** For checks: how many are away from home and how many are still moving. */
    get knocked() { return knocked.size; },
    get moving() { return moving.size; },
    /** For checks: the clock the reset rule runs on (seconds since start, paused time excluded). */
    get clock() { return clock; },
    set clock(t) { clock = t; },
  };
}
