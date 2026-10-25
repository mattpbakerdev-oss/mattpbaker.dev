// The car: a chunky low-poly model and a hand-written arcade model. Heading 0 faces +z;
// forward is (sin h, cos h), right is (-cos h, sin h). Steer +1 turns right.
import * as THREE from 'three';
import { mergeColoured, box, COLOURS } from './world.js';
import { resolveCollisions, clampToPlot, nearestRoadPoint } from './physics.js';

export const TUNING = {
  maxForward: 28, maxReverse: 10,
  accel: 19, reverseAccel: 12, brake: 40, coast: 5,
  throttleEase: 5,                     // how fast the pedal reaches its target (per second)
  wheelbase: 2.6, steerLow: 0.55, steerHigh: 0.19, steerRate: 7,
  gripLow: 14, gripDrift: 4.2, gripHandbrake: 2.2,
  gravity: 30, launchBoost: 1.5, launchLift: 2, step: 0.45, radius: 1.35, restitution: 0.35,
};

const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function buildModel() {
  const root = new THREE.Group();
  const body = new THREE.Group(); // rolls, pitches and squashes over the wheels
  body.position.y = 0.45;
  root.add(body);

  const glass = '#2e3a46';
  const geo = mergeColoured([
    { geo: box(2.1, 0.62, 3.7, 0, 0.42, 0), color: COLOURS.coral },          // chassis
    { geo: box(2.0, 0.22, 1.3, 0, 0.82, 1.15), color: COLOURS.coral },       // bonnet bulge
    { geo: box(1.72, 0.66, 1.8, 0, 1.06, -0.3), color: glass },              // cabin glass
    { geo: box(1.86, 0.14, 1.96, 0, 1.45, -0.3), color: COLOURS.cream },     // roof
    { geo: box(0.14, 0.62, 0.16, 0.8, 1.06, 0.55), color: COLOURS.cream },   // pillars
    { geo: box(0.14, 0.62, 0.16, -0.8, 1.06, 0.55), color: COLOURS.cream },
    { geo: box(2.2, 0.26, 0.3, 0, 0.26, 1.88), color: COLOURS.cream },       // bumpers
    { geo: box(2.2, 0.26, 0.3, 0, 0.26, -1.88), color: COLOURS.cream },
    { geo: box(0.46, 0.2, 0.08, 0.66, 0.56, 1.86), color: '#fff6d8' },       // headlights
    { geo: box(0.46, 0.2, 0.08, -0.66, 0.56, 1.86), color: '#fff6d8' },
    { geo: box(0.4, 0.18, 0.08, 0.7, 0.56, -1.86), color: '#c8423b' },       // tail lights
    { geo: box(0.4, 0.18, 0.08, -0.7, 0.56, -1.86), color: '#c8423b' },
  ]);
  const shell = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  shell.castShadow = true;
  body.add(shell);

  const wheelGeo = mergeColoured([
    { geo: new THREE.CylinderGeometry(0.5, 0.5, 0.46, 10), color: '#242022' },
    { geo: new THREE.CylinderGeometry(0.24, 0.24, 0.48, 8), color: COLOURS.cream },
  ]).rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const wheels = [];
  for (const [x, z, front] of [[0.98, 1.2, true], [-0.98, 1.2, true], [0.98, -1.2, false], [-0.98, -1.2, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.5, z);
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.castShadow = true;
    pivot.add(wheel);
    root.add(pivot);
    wheels.push({ pivot, wheel, front });
  }
  return { root, body, wheels };
}

export class Car {
  constructor(world) {
    this.world = world;
    const { root, body, wheels } = buildModel();
    this.object = root;
    this.body = body;
    this.wheels = wheels;
    this.onBump = null;   // (strength, nx, nz) => void
    this.onLand = null;   // (impact) => void
    this.frozen = false;  // stops the car, e.g. while a panel is open
    this.place(world.start.x, world.start.z, world.start.heading);
  }

  /** Drop the car at a spot, at rest. Used by reset and fast travel. */
  place(x, z, heading) {
    Object.assign(this, { x, z, heading, vx: 0, vz: 0, y: this.world.groundHeightAt(x, z), vy: 0, grounded: true });
    Object.assign(this, { pedal: 0, steerAngle: 0, roll: 0, pitch: 0, squash: 0, squashVel: 0, spin: 0, bumpCooldown: 0 });
    this.syncObject();
  }

  /** R: back on the nearest road, upright, pointing along it, clear of anything solid. */
  reset() {
    let p = nearestRoadPoint(this.x, this.z, this.world.roads, this.heading);
    let { x, z } = p;
    // Off a ramp if we landed on one.
    for (let i = 0; i < 4 && this.world.groundHeightAt(x, z) > 0; i++) {
      x -= Math.sin(p.heading) * 6; z -= Math.cos(p.heading) * 6;
    }
    const out = resolveCollisions(x, z, TUNING.radius + 0.3, this.world.colliders, 6);
    this.place(out.x, out.z, p.heading);
  }

  get speed() { return this.vx * Math.sin(this.heading) + this.vz * Math.cos(this.heading); }
  get position() { return this.object.position; }

  update(dt, input) {
    if (!(dt > 0)) return;
    const T = TUNING;
    const throttle = this.frozen ? 0 : input.throttle;
    const steer = this.frozen ? 0 : input.steer;
    const braking = this.frozen || input.brake;

    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const rx = -fz, rz = fx;
    let vf = this.vx * fx + this.vz * fz;
    let vl = this.vx * rx + this.vz * rz;
    const ratio = clamp(Math.abs(vf) / T.maxForward, 0, 1);

    // Pedal eases towards the input so pulling away feels weighty, not instant.
    this.pedal += (throttle - this.pedal) * damp(T.throttleEase, dt);
    let accel = 0;
    if (this.grounded) {
      if (braking) {
        accel = -Math.sign(vf) * Math.min(T.brake, Math.abs(vf) / dt);
      } else if (throttle > 0 && vf >= -0.5) {
        accel = T.accel * this.pedal * (1 - ratio * ratio);
      } else if (throttle < 0 && vf <= 0.5) {
        const r = clamp(-vf / T.maxReverse, 0, 1);
        accel = T.reverseAccel * this.pedal * (1 - r * r);
      } else if (throttle !== 0) {
        accel = -Math.sign(vf) * T.brake * 0.8; // pressing against the motion brakes first
      } else {
        accel = -Math.sign(vf) * Math.min(T.coast, Math.abs(vf) / dt);
      }
      vf += accel * dt;

      // High grip, loosening a little at speed while steering hard, and a lot on the handbrake.
      const drift = ratio * Math.abs(this.steerAngle) / T.steerLow;
      const grip = braking && ratio > 0.3 ? T.gripHandbrake : T.gripLow + (T.gripDrift - T.gripLow) * clamp(drift, 0, 1);
      vl *= Math.exp(-grip * dt);
    }

    // Steering lock shrinks as speed rises; yaw follows a simple bicycle model.
    const lock = T.steerLow + (T.steerHigh - T.steerLow) * ratio;
    this.steerAngle += (steer * lock - this.steerAngle) * damp(T.steerRate, dt);
    const control = this.grounded ? 1 : 0.25;
    const yawRate = (vf / T.wheelbase) * Math.tan(this.steerAngle) * control;
    this.heading -= yawRate * dt;

    const nfx = Math.sin(this.heading), nfz = Math.cos(this.heading);
    this.vx = nfx * vf + -nfz * vl;
    this.vz = nfz * vf + nfx * vl;

    this.move(dt);
    this.animate(dt, accel, vf, yawRate);
    this.syncObject();
  }

  move(dt) {
    const T = TUNING;
    const ox = this.x, oz = this.z;
    let nx = ox + this.vx * dt, nz = oz + this.vz * dt;

    const { x, z, hits } = resolveCollisions(nx, nz, T.radius, this.world.colliders);
    nx = x; nz = z;
    const normals = hits.map((h) => [h.nx, h.nz]);
    const edge = clampToPlot(nx, nz, T.radius, this.world.plotHalf);
    if (edge.hit) { nx = edge.x; nz = edge.z; normals.push([edge.nx, edge.nz]); }

    // A ramp's side or tall end is a wall: too big a step up means we stay put and bounce.
    let ground = this.world.groundHeightAt(nx, nz);
    if (ground - this.y > T.step) {
      const len = Math.hypot(this.vx, this.vz) || 1;
      normals.push([-this.vx / len, -this.vz / len]);
      nx = ox; nz = oz;
      ground = this.world.groundHeightAt(nx, nz);
    }
    this.x = nx; this.z = nz;
    for (const [px, pz] of normals) this.bounce(px, pz);

    if (this.grounded) {
      if (ground >= this.y - 0.02) {
        // Climbing or flat: the climb rate becomes the launch speed when the ground drops away.
        this.vy = (ground - this.y) / dt;
        this.y = ground;
      } else {
        this.grounded = false;
        // Leaving a ramp lip: exaggerate the launch so jumps feel like jumps.
        if (this.vy > 1) this.vy = this.vy * T.launchBoost + T.launchLift;
      }
    }
    if (!this.grounded) {
      this.vy -= T.gravity * dt;
      this.y += this.vy * dt;
      if (this.y <= ground) {
        const impact = -this.vy;
        this.y = ground;
        this.vy = 0;
        this.grounded = true;
        this.squashVel += Math.min(impact, 20) * 0.06;
        if (impact > 3) this.onLand?.(impact);
      }
    }
    this.bumpCooldown = Math.max(0, this.bumpCooldown - dt);
  }

  bounce(nx, nz) {
    const vn = this.vx * nx + this.vz * nz;
    if (vn >= 0) return;
    const e = TUNING.restitution;
    this.vx -= (1 + e) * vn * nx;
    this.vz -= (1 + e) * vn * nz;
    this.vx *= 0.85; this.vz *= 0.85; // scrub some speed so walls feel solid
    if (-vn > 2.5 && this.bumpCooldown === 0) {
      this.bumpCooldown = 0.2;
      this.onBump?.(-vn, nx, nz);
    }
  }

  animate(dt, accel, vf, yawRate) {
    // Lean into the turn, nose dips under braking and lifts under power, nose follows the arc in the air.
    const targetRoll = clamp(vf * yawRate * 0.004, -0.09, 0.09);
    const targetPitch = this.grounded ? clamp(-accel * 0.0035, -0.05, 0.09) : clamp(-this.vy * 0.025, -0.3, 0.3);
    this.roll += (targetRoll - this.roll) * damp(8, dt);
    this.pitch += (targetPitch - this.pitch) * damp(this.grounded ? 8 : 3, dt);

    // Springy suspension squash after landings.
    this.squashVel += (-180 * this.squash - 11 * this.squashVel) * dt;
    this.squash = clamp(this.squash + this.squashVel * dt, -0.15, 0.3);

    this.spin += (vf * dt) / 0.5;
  }

  syncObject() {
    const o = this.object;
    o.position.set(this.x, this.y, this.z);
    o.rotation.y = this.heading;
    this.body.rotation.set(this.pitch, 0, this.roll);
    this.body.scale.set(1 + this.squash * 0.4, 1 - this.squash, 1 + this.squash * 0.4);
    this.body.position.y = 0.45 - this.squash * 0.3;
    for (const w of this.wheels) {
      w.wheel.rotation.x = this.spin;
      // Steering right (positive angle) turns the wheels towards -x, a negative yaw.
      w.pivot.rotation.y = w.front ? -this.steerAngle : 0;
    }
  }
}
