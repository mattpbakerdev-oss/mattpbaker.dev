// Smooth chase camera: behind and above the car, pulling back a little with speed. It stays at
// that resting spot even near walls: whatever building or tree stands between it and the car is
// faded (fader.js; `blocking` lists them each frame). Only when the resting spot would be inside
// a building does it ease in towards the wall, never closer than MIN_DIST and lifting only a
// little, so the car always reads from behind. Parked in a place's ring, it eases back and up so
// the roof prop is in frame. Maths in camrig.js and occlusion.js.
import * as THREE from 'three';
import { wrapAngle } from './physics.js';
import { chaseOffset, chaseLimit, parkedLook, parkTarget, TUCK_LIFT } from './camrig.js';
import { blockers } from './occlusion.js';

const CAR_HALF_WIDTH = 1.2; // rays go to the car's centre and this far either side of it

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
  const blocking = [];     // occluders between the camera and the car this frame
  let park = 0;            // 0..1, parked framing
  let focus = null;        // the place whose ring the car is in

  const target = () => {
    const { dist, height } = chaseOffset(car.speed);
    const view = parkedLook(car, focus, park);
    const back = dist + view.extra;
    const bearing = heading + Math.PI;
    desired.set(car.x + Math.sin(bearing) * back, car.y + height + view.extra * 0.35, car.z + Math.cos(bearing) * back);
    desiredLook.set(view.x, view.y, view.z);
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
    /** The place whose ring the car is in (or null); parked there, the camera frames it. */
    setFocus(place) { focus = place ?? null; },
    /** A small knock away from whatever the car hit. Skipped with reduced motion. */
    nudge(strength, nx = 0, nz = 0) {
      if (reducedMotion) return;
      const k = Math.min(strength, 20) * 0.05;
      shakeVel.x += nx * k * 6; shakeVel.z += nz * k * 6; shakeVel.y += k * 3;
    },
    update(dt) {
      // Follow the car's heading with a lag so turns swing the view gently.
      heading += wrapAngle(car.heading - heading) * (1 - Math.exp(-4 * dt));
      park += (parkTarget(focus, car) - park) * (1 - Math.exp(-2.2 * dt));
      if (park < 0.001) park = 0;
      target();
      pos.lerp(desired, 1 - Math.exp(-5 * dt));
      look.lerp(desiredLook, 1 - Math.exp(-6 * dt));
      shakeVel.addScaledVector(shake, -260 * dt).multiplyScalar(Math.exp(-14 * dt));
      shake.addScaledVector(shakeVel, dt);
      api.apply(dt);
    },
    apply(dt = 0) {
      camera.position.copy(pos).add(shake);
      const ox = camera.position.x - car.x, oz = camera.position.z - car.z;
      const len = Math.hypot(ox, oz);
      const limit = len > 0.01 ? chaseLimit(car.x, car.z, Math.atan2(ox, oz), len, occluders) : Infinity;
      // Ease in when the resting spot is inside a building, ease back out slowly once it's clear.
      const want = Math.min(limit, len + 4);
      if (!dt || !Number.isFinite(clip)) clip = want;
      else clip += (want - clip) * (1 - Math.exp(-(want < clip ? 6 : 2.5) * dt));
      const d = Math.min(len, clip);
      if (d < len) {
        camera.position.x = car.x + (ox / len) * d;
        camera.position.z = car.z + (oz / len) * d;
      }
      const tuck = len > 0 ? 1 - d / len : 0;
      pulled += (tuck - pulled) * (dt ? 1 - Math.exp(-5 * dt) : 1);
      camera.position.y += Math.min(1, pulled * 3) * TUCK_LIFT; // a little higher when pulled in
      camera.position.y = Math.max(camera.position.y, car.world.groundHeightAt(camera.position.x, camera.position.z) + 1);
      blockers(camera.position.x, camera.position.z, car.x, car.z, occluders, CAR_HALF_WIDTH, blocking);
      camera.lookAt(look);
    },
    /** The buildings and trees hiding the car this frame (occluder shapes with a `key`). */
    get blocking() { return blocking; },
    /** For checks: the parked framing amount. */
    get park() { return park; },
  };
  return api;
}
