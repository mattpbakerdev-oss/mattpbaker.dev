import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, applyKeys, risingEdges } from '../js/input.js';

test('createState starts at rest with every field', () => {
  assert.deepEqual(createState(), { throttle: 0, steer: 0, brake: false, interact: false, horn: false, map: false, reset: false });
});

test('WASD and arrows map to throttle and steer', () => {
  const s = createState();
  applyKeys(s, new Set(['KeyW', 'KeyD']));
  assert.equal(s.throttle, 1); assert.equal(s.steer, 1);
  applyKeys(s, new Set(['ArrowDown', 'ArrowLeft']));
  assert.equal(s.throttle, -1); assert.equal(s.steer, -1);
  applyKeys(s, new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD']));
  assert.equal(s.throttle, 0); assert.equal(s.steer, 0);
});

test('action keys', () => {
  const s = createState();
  applyKeys(s, new Set(['Space', 'KeyE', 'KeyH', 'KeyM', 'KeyR']));
  assert.deepEqual(s, { throttle: 0, steer: 0, brake: true, interact: true, horn: true, map: true, reset: true });
  applyKeys(s, new Set(['Enter']));
  assert.equal(s.interact, true); assert.equal(s.brake, false);
});

test('risingEdges reports only buttons that went from up to down', () => {
  const prev = { interact: false, horn: true, map: false, reset: false };
  const cur = { interact: true, horn: true, map: false, reset: true };
  assert.deepEqual(risingEdges(prev, cur), { interact: true, horn: false, map: false, reset: true });
});

test('mergeTouch adds the touch controls to the keyboard state', async () => {
  const { mergeTouch } = await import('../js/input.js');
  const s = createState();
  mergeTouch(s, { throttle: 0.6, steer: -0.4, interact: true, horn: false });
  assert.equal(s.throttle, 0.6); assert.equal(s.steer, -0.4); assert.equal(s.interact, true);
  // Keys win when both are held, and the sum never leaves -1..1.
  applyKeys(s, new Set(['KeyW']));
  mergeTouch(s, { throttle: 0.6, steer: 0, interact: false, horn: true });
  assert.equal(s.throttle, 1); assert.equal(s.horn, true);
});

// ---------- Key filtering and touch latching (review fixes) ----------
import { shouldIgnoreKey, createInput } from '../js/input.js';

/** A stand-in for a DOM element: closest() answers for the selectors listed in `inside`. */
const el = (...inside) => ({ closest: (sel) => (sel.split(',').some((s) => inside.includes(s.trim())) ? {} : null) });
const keyEvent = (code, target = el(), extra = {}) => ({ code, target, defaultPrevented: false, metaKey: false, ctrlKey: false, altKey: false, ...extra });

test('keys typed into the sound menu or a dialog do not drive the car', () => {
  assert.equal(shouldIgnoreKey(keyEvent('ArrowDown', el('.soundmenu'))), true);
  assert.equal(shouldIgnoreKey(keyEvent('ArrowUp', el('[role="dialog"]'))), true);
  assert.equal(shouldIgnoreKey(keyEvent('KeyW', el('input'))), true);
});

test('a key another handler already used (defaultPrevented) is ignored', () => {
  assert.equal(shouldIgnoreKey(keyEvent('ArrowDown', el(), { defaultPrevented: true })), true);
});

test('driving keys on the canvas or the page still drive', () => {
  assert.equal(shouldIgnoreKey(keyEvent('KeyW', el())), false);
  assert.equal(shouldIgnoreKey(keyEvent('ArrowLeft', {})), false);
  assert.equal(shouldIgnoreKey(keyEvent('KeyW', el(), { metaKey: true })), true);
});

/** createInput with just enough of window and document to run in node. */
function fakeInput() {
  const handlers = {};
  const target = { addEventListener: (t, fn) => { (handlers[t] ??= []).push(fn); }, removeEventListener() {} };
  const saved = globalThis.document;
  globalThis.document = { addEventListener: (t, fn) => { (handlers[`doc:${t}`] ??= []).push(fn); }, removeEventListener() {} };
  const input = createInput(target);
  globalThis.document = saved;
  const fire = (t, e = {}) => (handlers[t] ?? []).forEach((fn) => fn(e));
  return { input, fire };
}

test('a touch tap shorter than a frame still fires interact and horn once', () => {
  const { input } = fakeInput();
  input.update();
  input.touchDown('interact'); input.touchUp('interact');   // both inside one frame
  input.touchDown('horn'); input.touchUp('horn');
  const edges = input.update();
  assert.equal(edges.interact, true);
  assert.equal(edges.horn, true);
  const next = input.update();
  assert.equal(next.interact, false);
  assert.equal(next.horn, false);
});

test('a held touch button gives one rising edge, not one per frame', () => {
  const { input } = fakeInput();
  input.touchDown('interact');
  assert.equal(input.update().interact, true);
  assert.equal(input.update().interact, false);
  input.touchUp('interact');
  assert.equal(input.update().interact, false);
});

test('blur and a hidden tab clear the touch stick and buttons', () => {
  const { input, fire } = fakeInput();
  input.touch.throttle = 1; input.touch.steer = -0.5; input.touchDown('horn');
  fire('blur');
  assert.deepEqual([input.touch.throttle, input.touch.steer, input.touch.horn], [0, 0, false]);
  input.touch.throttle = 1;
  fire('doc:visibilitychange');
  assert.equal(input.touch.throttle, 0);
  assert.equal(input.update().horn, false);
});

test('a key pressed inside the sound menu never reaches the car', () => {
  const { input, fire } = fakeInput();
  fire('keydown', keyEvent('ArrowDown', el('.soundmenu'), { preventDefault() {} }));
  input.update();
  assert.equal(input.state.throttle, 0);
  fire('keydown', keyEvent('ArrowUp', el(), { preventDefault() {} }));
  input.update();
  assert.equal(input.state.throttle, 1);
});
