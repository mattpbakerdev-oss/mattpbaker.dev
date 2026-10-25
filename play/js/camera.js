// Smooth chase camera: behind and above the car, pulling back a little with speed.
import * as THREE from 'three';

export function createChaseCamera(camera, car, { reducedMotion = false } = {}) {
  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const desiredLook = new THREE.Vector3();
  const shake = new THREE.Vector3();
  const shakeVel = new THREE.Vector3();
  let heading = car.heading;

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
      api.apply();
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
      api.apply();
    },
    apply() {
      camera.position.copy(pos).add(shake);
      camera.position.y = Math.max(camera.position.y, car.world.groundHeightAt(camera.position.x, camera.position.z) + 1);
      camera.lookAt(look);
    },
  };
  return api;
}
