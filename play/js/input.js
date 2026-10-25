// Input as one plain state object, fed by the keyboard and the touch controls.
// Steer: -1 left, +1 right. Throttle: +1 forward, -1 back.

const KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  brake: ['Space'],
  interact: ['KeyE', 'Enter'],
  horn: ['KeyH'],
  map: ['KeyM'],
  reset: ['KeyR'],
};
const GAME_KEYS = new Set(Object.values(KEYS).flat());
const BUTTONS = ['interact', 'horn', 'map', 'reset'];

export function createState() {
  return { throttle: 0, steer: 0, brake: false, interact: false, horn: false, map: false, reset: false };
}

/** Write the keyboard's contribution into `state` from the set of held key codes. */
export function applyKeys(state, held) {
  const any = (name) => KEYS[name].some((code) => held.has(code));
  state.throttle = (any('forward') ? 1 : 0) - (any('back') ? 1 : 0);
  state.steer = (any('right') ? 1 : 0) - (any('left') ? 1 : 0);
  state.brake = any('brake');
  for (const b of BUTTONS) state[b] = any(b);
  return state;
}

/**
 * Add the touch controls on top of the keyboard. Keys win on an axis they are holding.
 * touch.tapped holds buttons pressed since the last frame, so a tap shorter than a frame counts.
 */
export function mergeTouch(state, touch) {
  if (!state.throttle) state.throttle = Math.max(-1, Math.min(1, touch.throttle || 0));
  if (!state.steer) state.steer = Math.max(-1, Math.min(1, touch.steer || 0));
  state.interact = state.interact || Boolean(touch.interact || touch.tapped?.interact);
  state.horn = state.horn || Boolean(touch.horn || touch.tapped?.horn);
  return state;
}

// Keys pressed inside these belong to them, not to the car (arrow keys in the sound menu).
const UI_KEYS = '.soundmenu, [role="dialog"], [role="menu"]';
const TYPING = 'input, textarea, select, [contenteditable]';
const inside = (target, selector) => typeof target?.closest === 'function' && Boolean(target.closest(selector));

/** True when a keydown should not reach the car. */
export function shouldIgnoreKey(e) {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return true;
  return inside(e.target, TYPING) || inside(e.target, UI_KEYS);
}

/** Which one-shot buttons went down since the last frame. */
export function risingEdges(prev, cur) {
  const out = {};
  for (const b of BUTTONS) out[b] = Boolean(cur[b] && !prev[b]);
  return out;
}

/**
 * Attach keyboard listeners. Returns { state, touch, update(), touchDown(), touchUp(),
 * setEnabled(bool), dispose() }. Touch controls write the stick into `touch` and press buttons
 * with touchDown/touchUp; update() merges it all with the keys.
 * update() returns this frame's rising edges; call it once per frame.
 */
export function createInput(target = window) {
  const state = createState();
  const touch = { throttle: 0, steer: 0, interact: false, horn: false, tapped: {} };
  const held = new Set();
  const tapped = new Set(); // pressed since the last update, so a tap shorter than a frame still counts
  let prev = createState();
  let enabled = true;

  const onDown = (e) => {
    if (!enabled || !GAME_KEYS.has(e.code) || shouldIgnoreKey(e)) return;
    // Enter and Space on a focused button belong to the button.
    if ((e.code === 'Enter' || e.code === 'Space') && inside(e.target, 'button, a')) return;
    held.add(e.code);
    tapped.add(e.code);
    e.preventDefault();
  };
  const onUp = (e) => held.delete(e.code);
  const clearTouch = () => Object.assign(touch, { throttle: 0, steer: 0, interact: false, horn: false, tapped: {} });
  const clear = () => { held.clear(); tapped.clear(); clearTouch(); };

  target.addEventListener('keydown', onDown);
  target.addEventListener('keyup', onUp);
  target.addEventListener('blur', clear);
  document.addEventListener('visibilitychange', clear);

  return {
    state,
    touch,
    update() {
      if (enabled) mergeTouch(applyKeys(state, tapped.size ? new Set([...held, ...tapped]) : held), touch);
      tapped.clear();
      touch.tapped = {};
      const edges = risingEdges(prev, state);
      prev = { ...state };
      return edges;
    },
    /** A touch button went down ('interact' or 'horn'). */
    touchDown(field) {
      if (!enabled) return;
      touch[field] = true;
      touch.tapped[field] = true;
    },
    touchUp(field) { touch[field] = false; },
    setEnabled(on) {
      enabled = on;
      held.clear();
      tapped.clear();
      Object.assign(state, createState());
      clearTouch();
    },
    dispose() {
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
      target.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', clear);
    },
  };
}
