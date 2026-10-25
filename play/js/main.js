// Boot: loading screen, renderer, world, car, camera and the render loop.
import * as THREE from 'three';
import { buildWorld } from './world.js';
import './models.js'; // registers the building builders before the world is built
import { PLACES } from './places.js';
import { createMarkers } from './markers.js';
import { createUI } from './ui.js';
import { Car } from './car.js';
import { createInput } from './input.js';
import { createChaseCamera } from './camera.js';
import { cameraOccluders } from './occlusion.js';
import { createExtras } from './extras.js';
import { createAudio } from './audio.js';
import { WebGLFailure, isWebGLFailure } from './bootfail.js';

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

/** The friendly card for browsers that can't draw the town, with a way into every project. */
function showFallback() {
  loader.classList.add('is-fallback');
  status.parentElement.hidden = true;
  const list = $('fallback-links');
  list.replaceChildren(...PLACES.filter((p) => p.kind === 'project').map((p) => {
    const link = p.links.find((l) => l.href.startsWith('/work/'));
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = link?.href ?? '/';
    a.textContent = p.title;
    li.append(a);
    return li;
  }));
  $('fallback').hidden = false;
  $('fallback').querySelector('a')?.focus({ preventScroll: true });
}

/** Any other boot error: a short apology with a way to the normal site. */
function showError() {
  loader.classList.add('is-fallback');
  status.parentElement.hidden = true;
  $('boot-error').hidden = false;
  $('boot-error').querySelector('a')?.focus({ preventScroll: true });
}

function webglAvailable() {
  // ?webgl=0 shows the fallback card on purpose, for checking it.
  if (new URLSearchParams(location.search).get('webgl') === '0') return false;
  try {
    const c = document.createElement('canvas');
    return Boolean(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

async function boot() {
  if (!webglAvailable()) throw new WebGLFailure('WebGL is switched off or missing');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (err) {
    throw new WebGLFailure('Could not create a WebGL renderer', err);
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
  const markers = createMarkers(scene, PLACES, { reducedMotion });
  progress(0.65);
  await nextFrame();

  const car = new Car(world);
  scene.add(car.object);
  const chase = createChaseCamera(camera, car, { reducedMotion, occluders: cameraOccluders(world.colliders) });
  chase.snap();
  const input = createInput(window);
  input.setEnabled(false);

  // Events for the UI, audio and extras layers to listen to.
  const events = new EventTarget();
  const emit = (type, detail) => events.dispatchEvent(new CustomEvent(type, { detail }));
  car.onBump = (strength, nx, nz) => { chase.nudge(strength, nx, nz); emit('bump', { strength }); };
  car.onLand = (impact) => emit('land', { impact });
  const ui = createUI({ car, chase, world, input, events, canvas, reducedMotion });
  markers.update(0, null, ui.visited, camera);
  const extras = createExtras({ scene, camera, world, car, events, ui, reducedMotion });
  const audio = createAudio({ events, car, ui });

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
    chase.setFocus(ui.active);
    chase.update(dt);
    ui.update(dt);
    markers.update(dt, ui.active?.id ?? null, ui.visited, camera);
    extras.update(dt, ui.isOpen);
    audio.update(input.state);
    world.update(dt, car.position, camera);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame((t) => { last = t; frame(t); });

  window.__game = { renderer, scene, camera, car, world, input, chase, events, ui, markers, extras, audio };

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
    ui.start();
    emit('start');
  }, { once: true });
}

boot().catch((err) => {
  if (isWebGLFailure(err)) { showFallback(); return; }
  console.error(err);
  showError();
});
