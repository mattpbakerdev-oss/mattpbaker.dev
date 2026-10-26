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

/**
 * Tracks what the speedometer last showed and reports only what changed: the needle angle
 * rounded to half a degree, and the whole-number mph. A field is null when it needs no write.
 * Returns the same object every call, so the render loop allocates nothing.
 */
export function createReadout() {
  let lastAngle = NaN, lastNum = NaN;
  const out = { angle: null, num: null };
  return {
    step(mph) {
      const angle = Math.round(needleAngle(mph) * 2) / 2;
      const num = Math.round(mph);
      out.angle = angle === lastAngle ? null : (lastAngle = angle);
      out.num = num === lastNum ? null : (lastNum = num);
      return out;
    },
  };
}
