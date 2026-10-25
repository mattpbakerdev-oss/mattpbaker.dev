// Input as one plain state object. Keyboard feeds it now; touch controls can write the same
// fields later. Steer: -1 left, +1 right. Throttle: +1 forward, -1 back.

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

/** Which one-shot buttons went down since the last frame. */
export function risingEdges(prev, cur) {
  const out = {};
  for (const b of BUTTONS) out[b] = Boolean(cur[b] && !prev[b]);
  return out;
}

/**
 * Attach keyboard listeners. Returns { state, update(), setEnabled(bool), dispose() }.
 * update() returns this frame's rising edges; call it once per frame.
 */
export function createInput(target = window) {
  const state = createState();
  const held = new Set();
  let prev = createState();
  let enabled = true;

  const typing = (e) => e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]');
  const onDown = (e) => {
    if (!enabled || typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!GAME_KEYS.has(e.code)) return;
    // Enter and Space on a focused button belong to the button.
    if ((e.code === 'Enter' || e.code === 'Space') && e.target instanceof HTMLElement && e.target.closest('button, a')) return;
    held.add(e.code);
    e.preventDefault();
  };
  const onUp = (e) => held.delete(e.code);
  const clear = () => held.clear();

  target.addEventListener('keydown', onDown);
  target.addEventListener('keyup', onUp);
  target.addEventListener('blur', clear);
  document.addEventListener('visibilitychange', clear);

  return {
    state,
    update() {
      if (enabled) applyKeys(state, held);
      const edges = risingEdges(prev, state);
      prev = { ...state };
      return edges;
    },
    setEnabled(on) {
      enabled = on;
      held.clear();
      Object.assign(state, createState());
    },
    dispose() {
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
      target.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', clear);
    },
  };
}
