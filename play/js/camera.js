// Smooth chase camera: behind and above the car, pulling back a little with speed. When a
// building or tree sits between the car and the camera it keeps the lens out of it: first it
// swings up to 25 degrees round the car to the clearer side (buildings only), then slides in,
// never closer than MIN_DIST and only lifting a little, so the view stays on the road. Parked in
// a place's ring, it eases back and up so the roof prop is in frame. Maths in camrig.js.
import * as THREE from 'three';
import { wrapAngle } from './physics.js';
import { chaseOffset, reach, pickSwing, parkedLook, parkTarget, TUCK_LIFT } from './camrig.js';

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
  let swing = 0;           // smoothed sideways swing round the car, radians
  let swingTarget = 0;
  let park = 0;            // 0..1, parked framing
  let focus = null;        // the place whose ring the car is in

  const target = () => {
    const { dist, height } = chaseOffset(car.speed);
    const view = parkedLook(car, focus, park);
    const back = dist + view.extra;
    const bearing = heading + Math.PI + swing;
    desired.set(car.x + Math.sin(bearing) * back, car.y + height + view.extra * 0.35, car.z + Math.cos(bearing) * back);
    // Look just ahead of the car (not round the swing), so a swing never twists the view.
    desiredLook.set(view.x, view.y, view.z);
  };

  const api = {
    /** Jump straight to the resting spot, e.g. after a reset or fast travel. */
    snap() {
      heading = car.heading;
      swing = swingTarget = 0;
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
      // Building behind? Swing round to the clearer side before pulling in.
      const { dist } = chaseOffset(car.speed);
      swingTarget = pickSwing(car.x, car.z, heading + Math.PI, dist, occluders, swingTarget);
      swing += (swingTarget - swing) * (1 - Math.exp(-3 * dt));
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
      const { hard, soft } = len > 0.01 ? reach(car.x, car.z, Math.atan2(ox, oz), len, occluders) : { hard: Infinity, soft: Infinity };
      // Ease in as geometry approaches, ease back out slowly once it's gone, never past `hard`.
      const want = Math.min(soft, len + 4);
      if (!dt || !Number.isFinite(clip)) clip = want;
      else clip += (want - clip) * (1 - Math.exp(-(want < clip ? 8 : 2.5) * dt));
      const d = Math.min(len, clip, hard);
      if (d < len) {
        camera.position.x = car.x + (ox / len) * d;
        camera.position.z = car.z + (oz / len) * d;
      }
      const tuck = len > 0 ? 1 - d / len : 0;
      pulled += (tuck - pulled) * (dt ? 1 - Math.exp(-5 * dt) : 1);
      camera.position.y += Math.min(1, pulled * 1.6) * TUCK_LIFT; // a little higher when tucked in
      camera.position.y = Math.max(camera.position.y, car.world.groundHeightAt(camera.position.x, camera.position.z) + 1);
      camera.lookAt(look);
    },
    /** For checks: the current swing (radians) and parked framing amount. */
    get swing() { return swing; },
    get park() { return park; },
  };
  return api;
}
