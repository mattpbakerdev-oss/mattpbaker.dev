// Boot: loading screen, renderer, world, car, camera and the render loop.
import * as THREE from 'three';
import { buildWorld } from './world.js';
import { Car } from './car.js';
import { createInput } from './input.js';
import { createChaseCamera } from './camera.js';

const MAX_PIXEL_RATIO = 1.75;
const MAX_DT = 0.05;   // clamp long frames (tab switches) so the car never tunnels
const STEP = 1 / 60;   // physics substep

const $ = (id) => document.getElementById(id);
const loader = $('loader');
const bar = $('loader-bar');
const status = $('loader-status');
const startBtn = $('start');
const canvas = $('scene');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Portrait screens get a taller view so there is still road ahead to see.
const fovFor = (aspect) => (aspect < 1 ? 60 + Math.min(18, (1 - aspect) * 30) : 60);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
function progress(fraction) {
  const pct = Math.round(fraction * 100);
  bar.style.transform = `scaleX(${fraction})`;
  bar.parentElement.setAttribute('aria-valuenow', String(pct));
}

function showFallback() {
  loader.classList.add('is-fallback');
  status.textContent = 'Your browser can’t draw the 3D town, but the normal site has everything in it.';
  bar.parentElement.hidden = true;
  $('fallback-link').hidden = false;
}

async function boot() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch {
    showFallback();
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  progress(0.1);

  // The welcome sign is drawn with Onest, so wait for it (but never hang on a slow font).
  await Promise.race([document.fonts.load('600 92px Onest'), new Promise((r) => setTimeout(r, 2500))]).catch(() => {});
  progress(0.3);
  await nextFrame();

  const scene = new THREE.Scene();
  const aspect = window.innerWidth / window.innerHeight;
  const camera = new THREE.PerspectiveCamera(fovFor(aspect), aspect, 0.5, 1200);
  const world = buildWorld(scene);
  progress(0.65);
  await nextFrame();

  const car = new Car(world);
  scene.add(car.object);
  const chase = createChaseCamera(camera, car, { reducedMotion });
  chase.snap();
  const input = createInput(window);
  input.setEnabled(false);

  // Events for the UI, audio and extras layers to listen to.
  const events = new EventTarget();
  const emit = (type, detail) => events.dispatchEvent(new CustomEvent(type, { detail }));
  car.onBump = (strength, nx, nz) => { chase.nudge(strength, nx, nz); emit('bump', { strength }); };
  car.onLand = (impact) => emit('land', { impact });

  world.update(0, car.position, camera);
  await renderer.compileAsync(scene, camera).catch(() => {});
  progress(1);

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = fovFor(camera.aspect);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, MAX_DT);
    last = now;
    const edges = input.update();
    if (edges.reset) { car.reset(); chase.snap(); emit('reset'); }
    for (const name of ['interact', 'horn', 'map']) if (edges[name]) emit(name);

    const steps = Math.ceil(dt / STEP);
    for (let i = 0; i < steps; i++) car.update(dt / steps, input.state);
    chase.update(dt);
    world.update(dt, car.position, camera);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame((t) => { last = t; frame(t); });

  window.__game = { renderer, scene, camera, car, world, input, chase, events };

  status.textContent = 'Mattsville is ready';
  loader.classList.add('is-ready');
  startBtn.hidden = false;
  startBtn.focus({ preventScroll: true });
  startBtn.addEventListener('click', () => {
    loader.classList.add('is-leaving');
    const done = () => { loader.hidden = true; };
    if (reducedMotion) done(); else loader.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 800); // in case transitionend never fires
    input.setEnabled(true);
    canvas.focus({ preventScroll: true });
    emit('start');
  }, { once: true });
}

boot().catch((err) => {
  console.error(err);
  showFallback();
});
