import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineTone, loadSoundSettings, saveSoundSettings, SOUND_KEY } from '../js/audio.js';

const memory = (init = {}) => {
  const data = { ...init };
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, data };
};

test('engine pitch rises with speed and idles when still', () => {
  const idle = engineTone(0), mid = engineTone(14), top = engineTone(28);
  assert.ok(idle.freq > 30 && idle.freq < 70);
  assert.ok(mid.freq > idle.freq && top.freq > mid.freq);
  assert.ok(top.gain > idle.gain);
  assert.equal(engineTone(-10).freq, engineTone(10).freq);
});

test('sound settings default to effects on, music off', () => {
  assert.deepEqual(loadSoundSettings(memory()), { effects: true, music: false });
  assert.deepEqual(loadSoundSettings(null), { effects: true, music: false });
  assert.deepEqual(loadSoundSettings({ getItem() { throw new Error('x'); } }), { effects: true, music: false });
});

test('sound settings round-trip and ignore junk', () => {
  const s = memory();
  saveSoundSettings(s, { effects: false, music: true });
  assert.deepEqual(loadSoundSettings(s), { effects: false, music: true });
  assert.deepEqual(loadSoundSettings(memory({ [SOUND_KEY]: '{bad' })), { effects: true, music: false });
  assert.doesNotThrow(() => saveSoundSettings({ setItem() { throw new Error('x'); } }, { effects: true, music: true }));
});
