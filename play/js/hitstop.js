// A hit-stop: on a phone, a fast hit slows the game for about three frames so the impact reads
// on a small screen before the object is gone. Pure, so node can test it; main.js scales its
// frame time through step().

const HOLD = 0.05;   // seconds of real time (three frames at 60 fps)
const SCALE = 0.2;   // how fast the game runs during it
const FAST = 14;     // car speed (units a second) that counts as a fast hit

/** { trigger(), step(dt) => dt scaled for this frame }. */
export function createHitStop({ hold = HOLD, scale = SCALE } = {}) {
  let left = 0;
  return {
    trigger() { left = hold; },
    step(dt) {
      if (left <= 1e-9) return dt; // a rounding sliver is not another slowed frame
      const slow = Math.min(dt, left);
      left -= slow;
      return slow * scale + (dt - slow);
    },
  };
}

/**
 * Should this smash { mode, strength } stop time? Only a launch at speed, on a coarse-pointer
 * narrow screen (a phone), and never under reduced motion. Desktop has the room to read it.
 */
export function wantsHitStop({ mode, strength }, { coarse, narrow, reduced }) {
  return !reduced && coarse && narrow && mode === 'launch' && strength >= FAST;
}
