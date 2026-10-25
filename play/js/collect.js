// Pure data and logic for the four hidden collectibles. No three.js, so node can test it.
// Storage is passed in (localStorage in the browser) and every call is wrapped, so private
// browsing or a full quota never breaks the game.

export const FOUND_KEY = 'mattsville.found';
const CAR_HEIGHT = 1.9;   // the car's body spans y .. y + CAR_HEIGHT
const REACH = 1.9;        // car radius plus the collectible's own size

// y is the collectible's centre. The film reel floats past the lip of the high-street ramp
// (which climbs north to 2 units at z = -30), so only a car in the air can reach it.
export const COLLECTIBLES = [
  { id: 'dumbbell', title: 'Golden dumbbell', text: 'Up Lock would accept this as one rep.', x: 40, y: 1, z: -28.5 },
  { id: 'reel', title: 'Film reel', text: 'Cut from the transcript, never the script.', x: 0, y: 3.2, z: -35 },
  { id: 'cap', title: 'Graduation cap', text: 'First Class, UWE Bristol, 2026.', x: 22, y: 1, z: 52 },
  { id: 'tuktuk', title: 'Mini tuk-tuk', text: 'Bangkok, next.', x: -20, y: 1, z: 99.5 },
];
const IDS = new Set(COLLECTIBLES.map((c) => c.id));

/** Ids of collectibles the car (base at pos.y) is touching this frame and hasn't found yet. */
export function findPickups(pos, items, found) {
  const out = [];
  for (const c of items) {
    if (found.has(c.id)) continue;
    if (Math.hypot(pos.x - c.x, pos.z - c.z) > REACH) continue;
    if (c.y - 0.5 < pos.y + CAR_HEIGHT && c.y + 0.5 > pos.y) out.push(c.id);
  }
  return out;
}

export function loadFound(storage) {
  try {
    const list = JSON.parse(storage?.getItem(FOUND_KEY) ?? '[]');
    return new Set(Array.isArray(list) ? list.filter((id) => IDS.has(id)) : []);
  } catch {
    return new Set();
  }
}

export function saveFound(storage, found) {
  try { storage?.setItem(FOUND_KEY, JSON.stringify([...found])); } catch { /* private mode: fine */ }
}
