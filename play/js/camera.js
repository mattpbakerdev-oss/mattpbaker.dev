// Smooth chase camera: behind and above the car, pulling back a little with speed. When a
// building or tree sits between the car and the camera, the camera slides in towards the car
// (2D test against the colliders in occlusion.js) so it never sits inside or behind them.
import * as THREE from 'three';
import { segmentHit } from './occlusion.js';

const MIN_DIST = 2.6;   // never closer to the car than this
const LOOKAHEAD = 3;    // start easing in this far before the geometry
const CLEAR = 0.6;      // gap kept between the lens and the geometry

export function createChaseCamera(camera, car, { reducedMotion = false, occluders = [] } = {}) {
  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const desiredLook = new THREE.Vector3();
  const shake = new THREE.Vector3();
  const shakeVel = new THREE.Vector3();
  let heading = car.heading;
  let clip = Infinity;     // smoothed distance limit from the car
  let pulled = 0;          // 0..1, how far the camera has been pulled in (lifts it a little)

  /** How far behind the car (horizontally) the camera may sit along its current bearing. */
  function limits(ox, oz, len) {
    if (!occluders.length || len < 0.01) return { hard: Infinity, soft: Infinity };
    const ux = ox / len, uz = oz / len, reach = len + LOOKAHEAD;
    const t = segmentHit(car.x, car.z, car.x + ux * reach, car.z + uz * reach, occluders);
    if (t >= 1) return { hard: Infinity, soft: Infinity };
    const hit = t * reach;
    return { hard: Math.max(MIN_DIST, hit - CLEAR), soft: Math.max(MIN_DIST, hit - LOOKAHEAD) };
  }

  const target = () => {
    const speed = Math.abs(car.speed);
    const dist = 8.5 + speed * 0.13;
    const height = 3.6 + speed * 0.035;
    const fx = Math.sin(heading), fz = Math.cos(heading);
    desired.set(car.x - fx * dist, car.y + height, car.z - fz * dist);
    desiredLook.set(car.x + fx * 4, car.y + 1.3, car.z + fz * 4);
  };

  const api = {
    /** Jump straight to the resting spot, e.g. after a reset or fast travel. */
    snap() {
      heading = car.heading;
      target();
      pos.copy(desired);
      look.copy(desiredLook);
      shake.set(0, 0, 0); shakeVel.set(0, 0, 0);
      clip = Infinity;
      api.apply(0);
    },
    /** A small knock away from whatever the car hit. Skipped with reduced motion. */
    nudge(strength, nx = 0, nz = 0) {
      if (reducedMotion) return;
      const k = Math.min(strength, 20) * 0.05;
      shakeVel.x += nx * k * 6; shakeVel.z += nz * k * 6; shakeVel.y += k * 3;
    },
    update(dt) {
      // Follow the car's heading with a lag so turns swing the view gently.
      const diff = Math.atan2(Math.sin(car.heading - heading), Math.cos(car.heading - heading));
      heading += diff * (1 - Math.exp(-4 * dt));
      target();
      pos.lerp(desired, 1 - Math.exp(-5 * dt));
      look.lerp(desiredLook, 1 - Math.exp(-9 * dt));
      shakeVel.addScaledVector(shake, -260 * dt).multiplyScalar(Math.exp(-14 * dt));
      shake.addScaledVector(shakeVel, dt);
      api.apply(dt);
    },
    apply(dt = 0) {
      camera.position.copy(pos).add(shake);
      const ox = camera.position.x - car.x, oz = camera.position.z - car.z;
      const len = Math.hypot(ox, oz);
      const { hard, soft } = limits(ox, oz, len);
      // Ease in as geometry approaches, ease back out slowly once it's gone, never past `hard`.
      const want = Math.min(soft, len + 4);
      if (!dt || !Number.isFinite(clip)) clip = want;
      else clip += (want - clip) * (1 - Math.exp(-(want < clip ? 10 : 2.5) * dt));
      const d = Math.min(len, clip, hard);
      if (d < len) {
        camera.position.x = car.x + (ox / len) * d;
        camera.position.z = car.z + (oz / len) * d;
      }
      const tuck = len > 0 ? 1 - d / len : 0;
      pulled += (tuck - pulled) * (dt ? 1 - Math.exp(-6 * dt) : 1);
      camera.position.y += pulled * 2.6; // look down over the car when tucked in
      camera.position.y = Math.max(camera.position.y, car.world.groundHeightAt(camera.position.x, camera.position.z) + 1);
      camera.lookAt(look);
    },
  };
  return api;
}
