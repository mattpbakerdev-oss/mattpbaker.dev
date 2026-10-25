// Overlay UI: HUD, minimap, interact prompt, place panels, map and fast travel, how-to-play
// card, touch controls and toasts. Plain DOM; the game is reached through the objects passed in.
//
// Events fired on `events` for other layers (audio, extras):
//   panel-open { place }, panel-close { place }, visit { place, first }, travel { place },
//   map-open, map-close, menu-open, sound { effects, music, on }
import { PLACES } from './places.js';
import { placeInRange, travelSpot } from './proximity.js';
import { drawStatic, drawDynamic, drawLabels, placeAtMapPoint, MODEL_COLOUR } from './mapdraw.js';
import { createTouchControls } from './touch.js';

const $ = (id) => document.getElementById(id);
const FOCUSABLE = 'a[href], button:not([disabled]), video[controls], iframe, [tabindex]:not([tabindex="-1"])';
const STORE = { visited: 'mattsville.visited', howto: 'mattsville.howto' };

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode: fine */ } },
};

/** Tiny element builder: h('p', { class: 'x' }, 'text', child). */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

const ICON = {
  arrow: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h10M9 4l4 4-4 4"/></svg>',
  out: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11l6-6M6 5h5v5"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  tick: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>',
};
const isExternal = (href) => /^https?:\/\//.test(href);
const KIND_LABEL = { project: 'Project', about: 'About me', contact: 'Get in touch', soon: 'Coming soon' };

export function createUI({ car, chase, world, input, events, canvas, reducedMotion = false }) {
  const emit = (type, detail) => events.dispatchEvent(new CustomEvent(type, { detail }));
  const coarse = matchMedia('(pointer: coarse)');
  const isTouch = () => coarse.matches;

  const hud = $('hud'), minimap = $('minimap'), prompt = $('prompt'), touchEl = $('touch');
  const scrim = $('scrim'), panel = $('panel'), panelBody = $('panel-body');
  const mapDlg = $('map'), mapCanvas = $('map-canvas'), mapList = $('map-list');
  const howto = $('howto'), announcer = $('announcer'), toasts = $('toasts');
  const touchInteract = $('touch-interact'), soundBtn = $('hud-sound');
  const outside = [canvas, hud, minimap, prompt, touchEl, toasts];

  let visited;
  try { visited = new Set(JSON.parse(store.get(STORE.visited) || '[]')); } catch { visited = new Set(); }
  let active = null;      // place whose ring the car is in
  let arrival = null;     // place we fast-travelled to (prompt stays until the car drives off)
  let arrivalSpot = null;
  let shown = null;       // place the prompt and the touch button currently offer
  let started = false;
  let open = null;        // the open dialog element
  let openPlace = null;
  let lastFocus = null;

  createTouchControls(touchEl, input);

  // ---------- Dialogs: one open at a time, focus trapped, Esc closes, game paused ----------
  function pauseGame(paused) {
    input.setEnabled(!paused);
    car.frozen = paused;
    document.body.classList.toggle('is-paused', paused);
    for (const el of outside) el.inert = paused;
  }

  function openDialog(el, { focus, onClose, scrimClass = '' } = {}) {
    const replacing = open && open !== el;
    if (replacing) closeDialog({ restore: false }); // e.g. "Open the map" from a panel
    clearTimeout(el._hideTimer);
    closeSoundMenu();
    if (!replacing) lastFocus = document.activeElement;
    open = el;
    el._onClose = onClose;
    el.hidden = false;
    scrim.hidden = false;
    scrim.className = `scrim ${scrimClass}`;
    void el.offsetWidth; // start the transition from the closed state
    el.classList.add('is-open');
    scrim.classList.add('is-open');
    pauseGame(true);
    (focus ?? el).focus({ preventScroll: true });
  }

  function closeDialog({ restore = true } = {}) {
    if (!open) return;
    const el = open;
    open = null;
    el.classList.remove('is-open');
    scrim.classList.remove('is-open');
    el.style.transform = '';
    const done = () => { if (open !== el) el.hidden = true; if (!open) scrim.hidden = true; };
    if (reducedMotion) done(); else el._hideTimer = setTimeout(done, 220);
    pauseGame(false);
    const onClose = el._onClose;
    el._onClose = null;
    if (restore) {
      const usable = lastFocus && lastFocus.isConnected && lastFocus !== document.body && !lastFocus.closest('[inert], [role="dialog"]');
      const back = usable ? lastFocus : canvas;
      back.focus({ preventScroll: true });
    }
    onClose?.();
  }

  document.addEventListener('keydown', (e) => {
    if (!open) return;
    // Keys that close a dialog stop here, so the game doesn't also act on them (M would reopen the map).
    const shut = () => { e.preventDefault(); e.stopPropagation(); closeDialog(); };
    if (e.key === 'Escape') { shut(); return; }
    if (e.repeat && e.key !== 'Tab') return; // a key held from driving must not close what it opened
    if (open === mapDlg && e.code === 'KeyM' && !e.metaKey && !e.ctrlKey) { shut(); return; }
    if (open === howto && !['Tab', 'Shift', 'Enter', ' ', 'Meta', 'Control', 'Alt'].includes(e.key)) { shut(); return; }
    if (e.key !== 'Tab') return;
    const items = [...open.querySelectorAll(FOCUSABLE)].filter((n) => n.getClientRects().length && !n.closest('[hidden]'));
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    const inside = open.contains(document.activeElement);
    if (e.shiftKey && (!inside || document.activeElement === first || document.activeElement === open)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (!inside || document.activeElement === last)) { e.preventDefault(); first.focus(); }
  });
  for (const el of [panel, mapDlg, howto]) el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeDialog()));
  scrim.addEventListener('click', () => closeDialog());

  // ---------- Place panels ----------
  function linkEl(link, primary) {
    const ext = isExternal(link.href);
    return h('a', {
      class: `pill ${primary ? 'pill-amber' : 'pill-line'}`, href: link.href,
      target: ext ? '_blank' : null, rel: ext ? 'noopener' : null,
    },
    h('span', {}, link.label),
    ext ? h('span', { class: 'sr-only' }, ' (opens in a new tab)') : null,
    h('span', { class: 'disc', 'aria-hidden': 'true', html: ext ? ICON.out : ICON.arrow }));
  }

  function mediaEl(place) {
    const media = place.media ?? [];
    if (!media.length) return null;
    const images = media.filter((m) => m.type === 'image');
    const parts = [];
    if (images.length) {
      parts.push(h('ul', { class: 'gallery', tabindex: '0', 'aria-label': `${place.title} pictures` },
        images.map((m) => h('li', {}, h('img', { src: m.src, alt: m.alt, loading: 'lazy', decoding: 'async' })))));
    }
    for (const m of media.filter((x) => x.type === 'video')) {
      const video = h('video', { class: 'media-video', src: m.src, poster: m.poster, controls: true, muted: true, playsinline: true, preload: 'none', 'aria-label': m.alt ?? place.title });
      video.muted = true;
      parts.push(video);
    }
    const yts = media.filter((m) => m.type === 'youtube');
    if (yts.length) {
      parts.push(h('div', { class: 'yt-row' }, yts.map((m) => {
        const box = h('div', { class: 'yt' });
        const btn = h('button', { type: 'button', class: 'yt-thumb', 'aria-label': `Play ${m.alt}` },
          h('img', { src: `https://i.ytimg.com/vi/${m.id}/hqdefault.jpg`, alt: '', loading: 'lazy' }),
          h('span', { class: 'yt-play', 'aria-hidden': 'true', html: ICON.play }));
        btn.addEventListener('click', () => {
          const frame = h('iframe', {
            src: `https://www.youtube-nocookie.com/embed/${m.id}?autoplay=1&playsinline=1&rel=0`,
            title: m.alt, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
          });
          box.replaceChildren(frame);
          frame.focus();
        });
        box.append(btn);
        return box;
      })), h('p', { class: 'media-note' }, 'Videos load from YouTube when you press play.'));
    }
    return h('div', { class: 'media' }, parts);
  }

  function renderPlace(place) {
    const soon = place.kind === 'soon';
    const body = soon ? ['Something new is being built here.'] : place.body ?? [];
    const links = (place.links ?? []).map((l, i) => linkEl(l, i === 0));
    if (place.cv) links.push(linkEl({ label: 'Download my CV', href: place.cv }, false));
    for (const s of place.social ?? []) links.push(linkEl(s, false));
    return [
      h('header', { class: 'panel-head' },
        h('h2', { id: 'panel-title' }, place.title),
        place.tagline ? h('p', { class: 'panel-tagline' }, place.tagline) : null),
      mediaEl(place),
      h('div', { class: 'panel-copy' }, body.map((t) => h('p', {}, t))),
      place.stats?.length ? h('dl', { class: 'stats' }, place.stats.map((s) => h('div', {}, h('dt', {}, s.value), h('dd', {}, s.label)))) : null,
      links.length ? h('div', { class: 'links' }, links) : null,
      soon ? h('div', { class: 'links' }, h('button', { type: 'button', class: 'pill pill-line', onclick: () => openMap() },
        h('span', {}, 'Open the map'), h('span', { class: 'disc', 'aria-hidden': 'true', html: ICON.arrow }))) : null,
      place.tech?.length ? h('div', { class: 'tech' }, h('p', { class: 'tech-label', id: 'tech-label' }, 'Built with'),
        h('ul', { 'aria-labelledby': 'tech-label' }, place.tech.map((t) => h('li', {}, t)))) : null,
      h('p', { class: 'panel-hint' }, h('kbd', {}, 'Esc'), ' to keep driving'),
    ];
  }

  function openPanel(place) {
    panelBody.replaceChildren(...renderPlace(place).filter(Boolean));
    panelBody.scrollTop = 0;
    panel.dataset.kind = place.kind;
    openPlace = place;
    openDialog(panel, { scrimClass: 'scrim-panel', onClose: () => { emit('panel-close', { place }); openPlace = null; } });
    panelBody.scrollTop = 0;
    const first = !visited.has(place.id);
    if (first) { visited.add(place.id); store.set(STORE.visited, JSON.stringify([...visited])); drawMinimapStatic(); }
    emit('panel-open', { place });
    emit('visit', { place, first });
  }

  // Swipe the sheet down to close it on phones. A quick flick is enough.
  const grab = panel.querySelector('[data-grab]');
  let drag = null;
  grab.addEventListener('pointerdown', (e) => {
    drag = { y: e.clientY, t: performance.now(), id: e.pointerId };
    grab.setPointerCapture(e.pointerId);
    panel.classList.add('is-dragging');
  });
  grab.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    panel.style.transform = `translateY(${dy > 0 ? dy : dy * 0.15}px)`;
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y, v = dy / Math.max(1, performance.now() - drag.t);
    panel.classList.remove('is-dragging');
    drag = null;
    if (dy > 110 || (dy > 20 && v > 0.5)) closeDialog();
    else panel.style.transform = '';
  };
  grab.addEventListener('pointerup', endDrag);
  grab.addEventListener('pointercancel', endDrag);

  // ---------- Map and fast travel ----------
  const MAP_PAD = 10;
  function sizeCanvas(cv, cssSize) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(cssSize * dpr); cv.height = Math.round(cssSize * dpr);
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }
  function drawMap() {
    const size = mapCanvas.clientWidth || 360;
    const ctx = sizeCanvas(mapCanvas, size);
    drawStatic(ctx, size, { pad: MAP_PAD, places: PLACES });
    drawDynamic(ctx, size, { pad: MAP_PAD, places: PLACES, visited, car, dot: size > 400 ? 5 : 4 });
    drawLabels(ctx, size, { pad: MAP_PAD, places: PLACES, font: size > 400 ? 13 : 11.5 });
  }
  function buildMapList() {
    mapList.replaceChildren(...PLACES.map((place) => {
      const seen = visited.has(place.id);
      const name = place.kind === 'soon' ? `${place.title} ${place.id.split('-').pop()}` : place.title;
      return h('li', {}, h('button', { type: 'button', class: 'map-item', onclick: () => travel(place) },
        h('span', { class: `map-dot${seen ? ' is-seen' : ''}`, style: `--c:${MODEL_COLOUR[place.model] ?? '#8a7a6e'}`, 'aria-hidden': 'true', html: seen ? ICON.tick : '' }),
        h('span', { class: 'map-name' }, name),
        h('span', { class: 'map-meta' }, KIND_LABEL[place.kind], seen ? ', visited' : ''),
        h('span', { class: 'map-go', 'aria-hidden': 'true', html: ICON.arrow })));
    }));
  }
  function openMap() {
    buildMapList();
    openDialog(mapDlg, { scrimClass: 'scrim-dim', focus: mapList.querySelector('button'), onClose: () => emit('map-close') });
    drawMap();
    emit('map-open');
  }
  function travel(place) {
    const spot = travelSpot(place, world.roads, world.colliders);
    closeDialog({ restore: false });
    car.place(spot.x, spot.z, spot.heading);
    chase.snap();
    arrival = place;
    arrivalSpot = spot;
    active = null;
    canvas.focus({ preventScroll: true });
    announce(`You’re outside ${place.title}. ${isTouch() ? 'Tap the amber button' : 'Press E'} to look inside.`);
    emit('travel', { place });
  }
  mapCanvas.addEventListener('click', (e) => {
    const r = mapCanvas.getBoundingClientRect();
    const place = placeAtMapPoint(e.clientX - r.left, e.clientY - r.top, r.width, MAP_PAD, PLACES);
    if (place) travel(place);
  });
  $('hud-map').addEventListener('click', () => openMap());

  // ---------- Minimap ----------
  const MINI = 168, MINI_PAD = 8;
  const miniStatic = document.createElement('canvas');
  let miniCtx = null;
  function drawMinimapStatic() {
    const ctx = sizeCanvas(miniStatic, MINI);
    drawStatic(ctx, MINI, { pad: MINI_PAD, places: PLACES, detail: false });
  }
  function initMinimap() {
    miniCtx = sizeCanvas(minimap, MINI);
    drawMinimapStatic();
  }
  function drawMinimap() {
    if (!miniCtx || minimap.hidden || !minimap.getClientRects().length) return;
    miniCtx.clearRect(0, 0, MINI, MINI);
    miniCtx.drawImage(miniStatic, 0, 0, MINI, MINI);
    drawDynamic(miniCtx, MINI, { pad: MINI_PAD, places: PLACES, visited, car, dot: 3.4 });
  }

  // ---------- Prompt, announcer, HUD ----------
  function announce(text) {
    announcer.textContent = '';
    requestAnimationFrame(() => { announcer.textContent = text; });
  }
  function setPrompt(place) {
    if (!place) { prompt.classList.remove('is-shown'); prompt.hidden = true; return; }
    $('prompt-place').textContent = place.title;
    $('prompt-act').innerHTML = isTouch() ? 'Tap to look inside' : 'Press <kbd>E</kbd> to look inside';
    prompt.hidden = false;
    void prompt.offsetWidth;
    prompt.classList.add('is-shown');
  }
  prompt.addEventListener('click', () => { const p = active ?? arrival; if (p) openPanel(p); });

  events.addEventListener('interact', () => {
    const p = active ?? arrival;
    if (p && !open) openPanel(p);
  });
  events.addEventListener('map', () => { if (!open) openMap(); });

  // ---------- Sound menu: Effects and Music switches under the HUD sound button ----------
  // The menu only reports choices (`sound` { effects, music }); audio.js owns the settings
  // and calls setSound() back so the switches and the icon always show what is playing.
  const soundMenu = $('sound-menu');
  let sound = { effects: true, music: false };
  function setSound(next) {
    sound = { ...sound, ...next };
    const on = sound.effects || sound.music;
    soundBtn.classList.toggle('is-on', on);
    soundBtn.setAttribute('aria-label', `Sound settings, ${on ? 'sound on' : 'sound off'}`);
    for (const row of soundMenu.querySelectorAll('[data-setting]')) row.setAttribute('aria-checked', String(Boolean(sound[row.dataset.setting])));
  }
  function openSoundMenu() {
    soundMenu.hidden = false;
    void soundMenu.offsetWidth;
    soundMenu.classList.add('is-open');
    soundBtn.setAttribute('aria-expanded', 'true');
    soundMenu.querySelector('[data-setting]').focus({ preventScroll: true });
    emit('menu-open');
  }
  function closeSoundMenu({ restore = false } = {}) {
    if (soundMenu.hidden) return;
    soundMenu.classList.remove('is-open');
    soundBtn.setAttribute('aria-expanded', 'false');
    soundMenu.hidden = true;
    if (restore) soundBtn.focus({ preventScroll: true });
  }
  soundBtn.addEventListener('click', () => (soundMenu.hidden ? openSoundMenu() : closeSoundMenu()));
  soundMenu.addEventListener('click', (e) => {
    const row = e.target.closest('[data-setting]');
    if (!row) return;
    setSound({ [row.dataset.setting]: !sound[row.dataset.setting] });
    emit('sound', { ...sound, on: sound.effects || sound.music });
  });
  soundMenu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSoundMenu({ restore: true }); }
    const rows = [...soundMenu.querySelectorAll('[data-setting]')];
    const i = rows.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); rows[(i + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length].focus(); }
  });
  // Clicking or tapping anywhere else closes it.
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.hud-sound')) closeSoundMenu(); });
  // Tabbing out closes it. (A click elsewhere is handled above; Safari gives clicks no focus.)
  soundMenu.addEventListener('focusout', (e) => { if (e.relatedTarget instanceof Element && !e.relatedTarget.closest('.hud-sound')) closeSoundMenu(); });
  setSound(sound);

  function setFound(n, total = 4) { $('hud-found').textContent = `Found ${n} of ${total}`; }

  /** Small note at the top of the screen. Returns the element. */
  function toast(text, { title, duration = 4200 } = {}) {
    const el = h('div', { class: 'toast' }, title ? h('strong', {}, title) : null, h('span', {}, text));
    toasts.append(el);
    void el.offsetWidth;
    el.classList.add('is-shown');
    setTimeout(() => { el.classList.remove('is-shown'); setTimeout(() => el.remove(), 300); }, duration);
    return el;
  }

  function applyPointerMode() {
    const t = isTouch();
    document.body.classList.toggle('is-touch', t);
    touchEl.hidden = !started || !t;
    howto.dataset.mode = t ? 'touch' : 'keys';
    if (active || arrival) setPrompt(active ?? arrival);
  }
  coarse.addEventListener('change', applyPointerMode);

  // ---------- How to play ----------
  function maybeHowTo() {
    if (store.get(STORE.howto)) return;
    openDialog(howto, { scrimClass: 'scrim-dim', focus: howto.querySelector('.howto-go'), onClose: () => store.set(STORE.howto, 'seen') });
  }

  // iOS pinch-zoom on the game; panels still scroll.
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  return {
    get active() { return active ?? arrival; },
    visited,
    get isOpen() { return Boolean(open); },
    get openPlace() { return openPlace; },
    start() {
      started = true;
      hud.hidden = false;
      minimap.hidden = false;
      initMinimap();
      applyPointerMode();
      maybeHowTo();
    },
    update() {
      if (!started) return;
      active = placeInRange(car.x, car.z, PLACES, active);
      if (arrival && (active || Math.hypot(car.x - arrivalSpot.x, car.z - arrivalSpot.z) > 6)) arrival = null;
      const now = active ?? arrival;
      if (now !== shown) {
        const entered = now && active === now && shown !== now;
        shown = now;
        setPrompt(open ? null : now);
        touchInteract.setAttribute('aria-disabled', String(!now));
        touchInteract.classList.toggle('is-lit', Boolean(now));
        if (entered) announce(`${now.title}. ${isTouch() ? 'Tap the amber button' : 'Press E'} to look inside.`);
      }
      if (open && !prompt.hidden) setPrompt(null);
      if (!open && now && prompt.hidden) setPrompt(now);
      drawMinimap();
    },
    openPanel, openMap, closeDialog, travel, toast, setFound, setSound, closeSoundMenu,
  };
}
