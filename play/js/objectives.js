// The to-do list in the HUD: four stops, ticked off from the set of visited places.
// No three.js, so node can test it.

export const OBJECTIVES = [
  { id: 'up-lock', label: 'Visit Up Lock' },
  { id: 'listing-check', label: 'Visit Listing Check' },
  { id: 'ugc-pipeline', label: 'Visit the UGC studio' },
  { id: 'post-office', label: 'Say hello at the post office' },
];

/** Progress through the list for a set (or any iterable) of visited place ids. */
export function objectiveProgress(visited) {
  const seen = visited instanceof Set ? visited : new Set(visited);
  const items = OBJECTIVES.map((o) => ({ ...o, done: seen.has(o.id) }));
  const done = items.filter((i) => i.done).length;
  return { items, done, total: items.length, complete: done === items.length };
}

/** The optional fifth row: the collectibles. Not part of the four stops or their count. */
export function extrasRow(found, total) {
  return { label: 'Find the hidden extras', count: `${found}/${total}`, done: total > 0 && found >= total };
}
