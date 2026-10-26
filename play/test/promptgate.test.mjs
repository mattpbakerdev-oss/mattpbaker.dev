import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPromptGate } from '../js/promptgate.js';

// A fake clock so the 160ms exit can be stepped by hand.
function rig(delay = 160) {
  const log = [];
  let now = 0, timers = [];
  const gate = createPromptGate({
    delay,
    schedule: (fn, ms) => { const t = { at: now + ms, fn }; timers.push(t); return t; },
    cancel: (t) => { timers = timers.filter((x) => x !== t); },
    show: (place, fromHidden) => log.push(`show ${place} ${fromHidden ? 'fresh' : 'again'}`),
    leave: () => log.push('leave'),
    gone: () => log.push('gone'),
  });
  const tick = (ms) => {
    now += ms;
    for (const t of timers.filter((x) => x.at <= now)) { timers = timers.filter((x) => x !== t); t.fn(); }
  };
  return { gate, log, tick, pending: () => timers.length };
}

test('a hide lets the exit play, then takes the prompt away', () => {
  const { gate, log, tick } = rig();
  gate.set('gym');
  gate.set(null);
  assert.deepEqual(log, ['show gym fresh', 'leave']);
  assert.equal(gate.place, null);
  tick(159);
  assert.deepEqual(log, ['show gym fresh', 'leave']);
  tick(1);
  assert.deepEqual(log, ['show gym fresh', 'leave', 'gone']);
});

test('a second hide in the same frame keeps the pending exit (the ghost prompt bug)', () => {
  const { gate, log, tick, pending } = rig();
  gate.set('up-lock');
  gate.set(null);
  gate.set(null); // showBanner and update both ask, one frame apart or the same frame
  assert.equal(pending(), 1, 'the exit timer is still pending');
  tick(200);
  assert.deepEqual(log, ['show up-lock fresh', 'leave', 'gone']);
});

test('hiding when nothing is shown does nothing', () => {
  const { gate, log, pending } = rig();
  gate.set(null);
  assert.deepEqual(log, []);
  assert.equal(pending(), 0);
});

test('showing again before the exit ends cancels it and is not a fresh entrance', () => {
  const { gate, log, tick } = rig();
  gate.set('gym');
  gate.set(null);
  tick(80);
  gate.set('gym');
  tick(500);
  assert.deepEqual(log, ['show gym fresh', 'leave', 'show gym again']);
  assert.equal(gate.place, 'gym');
});

test('after the exit ends, the next show is a fresh entrance', () => {
  const { gate, log, tick } = rig();
  gate.set('gym');
  gate.set(null);
  tick(160);
  gate.set('house');
  assert.equal(log.at(-1), 'show house fresh');
});

test('with no exit to play (reduced motion) the prompt goes at once', () => {
  const { gate, log, pending } = rig(0);
  gate.set('gym');
  gate.set(null);
  assert.deepEqual(log, ['show gym fresh', 'leave', 'gone']);
  assert.equal(pending(), 0);
});

test('switching place while shown updates it without a fresh entrance', () => {
  const { gate, log } = rig();
  gate.set('gym');
  gate.set('house');
  assert.deepEqual(log, ['show gym fresh', 'show house again']);
});
