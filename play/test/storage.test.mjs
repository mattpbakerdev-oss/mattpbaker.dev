import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeStorage, storeGet, storeSet } from '../js/storage.js';
import { loadSoundSettings, createAudio } from '../js/audio.js';
import { loadFound } from '../js/collect.js';

const memory = () => {
  const data = {};
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, data };
};

/** Run fn with globalThis.localStorage replaced by a getter (or value), then restore it. */
function withStorage(descriptor, fn) {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, ...descriptor });
  try { return fn(); } finally {
    if (before) Object.defineProperty(globalThis, 'localStorage', before);
    else delete globalThis.localStorage;
  }
}
const blocked = { get() { throw new Error('SecurityError: access denied'); } };

test('safeStorage returns null when touching localStorage itself throws', () => {
  withStorage(blocked, () => {
    assert.equal(safeStorage(), null);
    assert.equal(storeGet('x'), null);
    assert.equal(storeSet('x', '1'), false);
  });
});

test('storeGet and storeSet round-trip through working storage', () => {
  const s = memory();
  withStorage({ value: s }, () => {
    assert.equal(safeStorage(), s);
    assert.equal(storeSet('k', 'v'), true);
    assert.equal(storeGet('k'), 'v');
    assert.equal(storeGet('missing'), null);
  });
});

test('storeGet and storeSet swallow errors from the storage methods', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  withStorage({ value: broken }, () => {
    assert.equal(storeGet('k'), null);
    assert.equal(storeSet('k', 'v'), false);
  });
});

test('settings and collectibles load defaults when storage is blocked', () => {
  withStorage(blocked, () => {
    assert.deepEqual(loadSoundSettings(safeStorage()), { effects: true, music: false });
    assert.equal(loadFound(safeStorage()).size, 0);
  });
});

test('createAudio boots when localStorage access throws (site data blocked)', () => {
  const saved = { window: globalThis.window, document: globalThis.document };
  const listen = { addEventListener() {}, removeEventListener() {} };
  globalThis.window = listen;
  globalThis.document = { ...listen, hidden: false };
  try {
    withStorage(blocked, () => {
      const audio = createAudio({ events: new EventTarget(), car: { speed: 0 }, ui: { setSound() {} } });
      assert.deepEqual(audio.settings, { effects: true, music: false });
    });
  } finally {
    globalThis.window = saved.window;
    globalThis.document = saved.document;
  }
});
