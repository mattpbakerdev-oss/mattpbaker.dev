// Touch controls: a virtual joystick bottom-left and round buttons bottom-right. They write into
// input.touch, which input.update() merges with the keyboard, so the car sees one input state.
import { joystickVector } from './joystick.js';

export function createTouchControls(root, input) {
  const stick = root.querySelector('[data-stick]');
  const knob = root.querySelector('[data-knob]');
  let pointerId = null, cx = 0, cy = 0;

  const radius = () => stick.clientWidth * 0.36;
  const move = (e) => {
    const v = joystickVector(e.clientX - cx, e.clientY - cy, radius());
    knob.style.transform = `translate(${v.knobX}px, ${v.knobY}px)`;
    input.touch.throttle = v.throttle;
    input.touch.steer = v.steer;
  };
  const release = () => {
    pointerId = null;
    stick.classList.remove('is-active');
    knob.style.transform = '';
    input.touch.throttle = 0;
    input.touch.steer = 0;
  };

  stick.addEventListener('pointerdown', (e) => {
    if (pointerId !== null) return; // ignore a second finger
    pointerId = e.pointerId;
    stick.setPointerCapture(pointerId);
    const r = stick.getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    stick.classList.add('is-active');
    move(e);
    e.preventDefault();
  });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId === pointerId) move(e); });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    stick.addEventListener(type, (e) => { if (e.pointerId === pointerId) release(); });
  }

  // Hold-style buttons: down while pressed, so the input layer sees a rising edge.
  for (const btn of root.querySelectorAll('[data-hold]')) {
    const field = btn.dataset.hold;
    const up = () => { input.touch[field] = false; btn.classList.remove('is-pressed'); };
    btn.addEventListener('pointerdown', (e) => {
      input.touch[field] = true;
      btn.classList.add('is-pressed');
      btn.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('lostpointercapture', up);
    // Keyboard or switch access fires click without pointer events: pulse the button.
    btn.addEventListener('click', (e) => {
      if (e.detail !== 0) return;
      input.touch[field] = true;
      setTimeout(() => { input.touch[field] = false; }, 120);
    });
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  return { release };
}
