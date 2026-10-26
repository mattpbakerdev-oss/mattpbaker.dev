// Pure maths for the speedometer: car speed to mph, mph to a needle angle, and the easing that
// keeps the needle steady. No three.js, so node can test it.

/** 1 world unit a second is 2.237 mph (1 unit = 1 metre). Top speed, 28, reads about 63. */
export const MPH_PER_UNIT = 2.237;
export const DIAL_MAX_MPH = 70;
const SWEEP = 120; // degrees either side of straight up

/** Speed in mph from the car's signed speed in units a second. Reversing reads positive. */
export function toMph(speed) {
  return Math.abs(speed) * MPH_PER_UNIT;
}

/** Needle angle in degrees: -120 at 0 mph, 0 at half the dial, +120 at DIAL_MAX_MPH. Clamped. */
export function needleAngle(mph) {
  const t = Number.isFinite(mph) ? Math.min(1, Math.max(0, mph / DIAL_MAX_MPH)) : 0;
  return -SWEEP + t * SWEEP * 2;
}

/**
 * Frame-rate independent ease from `current` towards `target` (exponential, never overshoots).
 * Within `snap` of the target it lands exactly, so the readout stops ticking.
 */
export function easeToward(current, target, dt, rate = 7, snap = 0.05) {
  if (!(dt > 0)) return current;
  const next = current + (target - current) * (1 - Math.exp(-rate * dt));
  return Math.abs(target - next) < snap ? target : next;
}
