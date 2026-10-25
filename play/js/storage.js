// Safe localStorage. Merely reading `localStorage` throws a SecurityError when the browser blocks
// site data, so every access in the game goes through these three helpers. No three.js.

/** The page's localStorage, or null when it is missing or blocked. */
export function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Read a value; null when it is missing or storage is unavailable. */
export function storeGet(key, storage = safeStorage()) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Write a value; returns whether it was saved (private mode or a full quota just says no). */
export function storeSet(key, value, storage = safeStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
