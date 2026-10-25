// Pure rule for the phone bottom sheet: does a downward drag close it? No three.js.

export const FLICK = 0.11;   // px per ms: a flick at least this fast closes the sheet
const FAR = 110;             // px: a drag this long closes it at any speed
const MIN_FLICK = 20;        // px: anything shorter is a wobble, not a flick

/** dy: how far the sheet was pulled down (px); ms: how long the drag took. */
export function shouldDismiss(dy, ms) {
  if (dy > FAR) return true;
  return dy > MIN_FLICK && dy / Math.max(1, ms) > FLICK;
}
