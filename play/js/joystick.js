// Pure mapping from a thumb offset on the virtual joystick to throttle and steer.
// dx, dy are pixels from the stick's centre (dy grows downwards, as on screen).

/**
 * Returns { throttle, steer, knobX, knobY }. Up is forward, right steers right. The knob is
 * clamped to the rim; output is zero inside the dead zone and rises smoothly from its edge.
 */
export function joystickVector(dx, dy, radius, deadZone = 0.14) {
  const len = Math.hypot(dx, dy);
  const k = len > radius ? radius / len : 1;
  const knobX = dx * k, knobY = dy * k;
  const mag = Math.min(len / radius, 1);
  if (mag <= deadZone || len === 0) return { throttle: 0, steer: 0, knobX, knobY };
  // Rescale so the dead-zone edge is 0 and the rim is 1, keeping the direction.
  const scaled = (mag - deadZone) / (1 - deadZone);
  const ux = knobX / (mag * radius), uy = knobY / (mag * radius);
  const clean = (v) => (Math.abs(v) < 1e-9 ? 0 : v);
  return { throttle: clean(-uy * scaled), steer: clean(ux * scaled), knobX, knobY };
}
