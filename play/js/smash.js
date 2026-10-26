// Breakaway lamp posts and in-town trees: drive into one and it topples or flies. The maths is
// in breakaway.js; this file hit-tests the car, moves the instances that draw each object, dims
// a knocked lamp's head, and puts everything back out of view 20 seconds later.
//
// Fires on `events`: smash { kind, strength, mode }.
import * as THREE from 'three';
import { createBreakable, strike, stepBreakable, speedAfterHit, canRestore, restoreBreakable, touchesCar } from './breakaway.js';
import { circleVsCircle, circleVsBox, clampToPlot, plotDistance } from './physics.js';
import { pointInside } from './occlusion.js';

const CAR_R = 1.35;
const MIN_SPEED = 0.2;       // slower than this, the car is resting against it, not hitting it
const TELEPORT = 5;          // a car that moved further than this in a frame was reset or travelled
const FLICKER = 0.36;        // seconds a knocked lamp flickers before it goes out
const LIT = new THREE.Color('#ffffff'), DIM = new THREE.Color('#4a4038');

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

  // Keeping flying things out of buildings and inside the plot, without allocating per frame.
  const solid = world.colliders;
  const solidAt = (x, z) => {
    if (plotDistance(x, z, world.plotHalf, world.plotCorner) > 0) return true;
    for (const c of solid) if (c.kind !== 'extra-sign' && pointInside(x, z, c)) return true;
    return false;
  };
  const push = (x, z, r) => {
    for (const c of solid) {
      const reach = r + (c.type === 'circle' ? c.r : Math.hypot(c.hw, c.hd));
      if (Math.abs(x - c.x) > reach || Math.abs(z - c.z) > reach) continue;
      const hit = c.type === 'circle' ? circleVsCircle(x, z, r, c.x, c.z, c.r) : circleVsBox(x, z, r, c);
      if (hit) return { x: x + hit.nx * hit.depth, z: z + hit.nz * hit.depth, nx: hit.nx, nz: hit.nz };
    }
    if (plotDistance(x, z, world.plotHalf, world.plotCorner) <= -r) return null;
    const edge = clampToPlot(x, z, r, world.plotHalf, world.plotCorner);
    return edge.hit ? edge : null;
  };
  const env = { groundAt: world.groundHeightAt, solidAt, push };

  const moving = new Set();     // knocked bodies whose pose changes (flying, falling, flickering)
  const knocked = new Set();    // every body away from home
  const dirtyMeshes = new Set();
  const prev = { x: car.x, z: car.z };
  const carNow = { x: 0, z: 0, y: 0 };
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
    const { mode } = strike(b, car, clock, { reduced: reducedMotion });
    const after = speedAfterHit(b.kind, car.vx, car.vz);
    car.vx = after.vx; car.vz = after.vz;
    chase.nudge(Math.min(speed, 20) * (b.kind === 'tree' ? 0.55 : 0.3), -dx, -dz); // none under reduced motion
    if (b.kind === 'lamp' && reducedMotion) setLight(b, false);
    knocked.add(b); moving.add(b);
    emit('smash', { kind: b.kind, strength: speed, mode });
  }

  return {
    bodies,
    /** Per frame, after the car has moved. `paused` while a panel or the map is open. */
    update(dt, paused) {
      if (paused) { prev.x = car.x; prev.z = car.z; return; }
      clock += dt;
      carNow.x = car.x; carNow.z = car.z; carNow.y = car.y;
      if (Math.hypot(car.x - prev.x, car.z - prev.z) > TELEPORT) { prev.x = car.x; prev.z = car.z; }
      const speed = Math.hypot(car.vx, car.vz);
      if (speed > MIN_SPEED) {
        const minX = Math.min(prev.x, car.x) - 3, maxX = Math.max(prev.x, car.x) + 3;
        const minZ = Math.min(prev.z, car.z) - 3, maxZ = Math.max(prev.z, car.z) + 3;
        for (const b of bodies) {
          if (b.home.x < minX || b.home.x > maxX || b.home.z < minZ || b.home.z > maxZ) continue;
          // Only when the car is heading into it, so pulling away from one never knocks it.
          if ((b.home.x - car.x) * car.vx + (b.home.z - car.z) * car.vz <= 0 && Math.hypot(b.home.x - car.x, b.home.z - car.z) > CAR_R) continue;
          if (touchesCar(b, carNow, prev, CAR_R)) hit(b);
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
