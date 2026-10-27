// Overlay UI: HUD (badges, to-do card, speedometer, minimap), interact prompt, arrival banners,
// place panels, map and fast travel, pause menu, how-to-play card, touch controls and toasts.
// Plain DOM; the game is reached through the objects passed in.
//
// Events fired on `events` for other layers (audio, extras):
//   panel-open { place }, panel-close { place }, visit { place, first }, travel { place },
//   map-open, map-close, menu-open, pause-open, pause-close, sound { effects, music, on }
import { PLACES } from './places.js';
import { placeInRange, travelSpot } from './proximity.js';
import { drawStatic, drawDynamic, drawLabels, drawCar, placeAtMapPoint, MODEL_COLOUR } from './mapdraw.js';
import { createTouchControls } from './touch.js';
import { storeGet, storeSet } from './storage.js';
import { shouldDismiss } from './sheet.js';
import { toMph, needleAngle, easeToward, createReadout, DIAL_MAX_MPH } from './speedo.js';
import { createArrivals } from './arrival.js';
import { objectiveProgress, extrasRow } from './objectives.js';
import { createPromptGate } from './promptgate.js';

const $ = (id) => document.getElementById(id);
const FOCUSABLE = 'a[href], button:not([disabled]), video[controls], iframe, [tabindex]:not([tabindex="-1"])';
const STORE = { visited: 'mattsville.visited', howto: 'mattsville.howto' };

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
  arrow: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h10M9 4l4 4-4 4"/></svg>',
  out: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11l6-6M6 5h5v5"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  tick: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>',
  copy: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.6"/><path d="M10.5 3.2A1.6 1.6 0 008.9 2H3.6A1.6 1.6 0 002 3.6v5.3a1.6 1.6 0 001.2 1.6"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9z"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4.5c4-2.5 7 2.5 14 0v9c-7 2.5-10-2.5-14 0"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 6v7M12 17.5v.5"/></svg>',
};
const isExternal = (href) => /^https?:\/\//.test(href);
const KIND_LABEL = { project: 'Project', about: 'About me', contact: 'Get in touch', soon: 'Coming soon' };
const BANNER_HOLD = 2500;
// Layouts, kept in step with play.css. The minimap is off on short windows, where the compact
// speed badge sits in its spot.
const MQ_MINIMAP = '(min-width: 900px) and (min-height: 501px) and (hover: hover) and (pointer: fine)';
// The to-do starts as a chip on any touch device and on compact screens.
const MQ_TODO_CHIP = '(pointer: coarse), (max-width: 719px), (max-height: 500px)';
const TODO_PEEK = 3000;

export function createUI({ car, chase, world, input, events, canvas, reducedMotion = false }) {
  const emit = (type, detail) => events.dispatchEvent(new CustomEvent(type, { detail }));
  const coarse = matchMedia('(pointer: coarse)');
  const isTouch = () => coarse.matches;

  const hud = $('hud'), minimap = $('minimap'), minimapFrame = $('minimap-frame'), prompt = $('prompt'), touchEl = $('touch');
  const speedo = $('speedo'), backpill = $('backpill'), banner = $('banner'), pauseEl = $('pause');
  const scrim = $('scrim'), panel = $('panel'), panelBody = $('panel-body');
  const mapDlg = $('map'), mapCanvas = $('map-canvas'), mapList = $('map-list');
  const howto = $('howto'), announcer = $('announcer'), toasts = $('toasts');
  const touchInteract = $('touch-interact'), soundBtn = $('hud-sound');
  const panelTitle = $('panel-title');
  // Made inert while a dialog is open. Toasts stay live so "Copied" is still announced.
  const outside = [canvas, hud, minimapFrame, prompt, touchEl, backpill, speedo, banner];

  let visited;
  try { visited = new Set(JSON.parse(storeGet(STORE.visited) || '[]')); } catch { visited = new Set(); }
  let active = null;      // place whose ring the car is in
  let arrival = null;     // place we fast-travelled to (prompt stays until the car drives off)
  let arrivalSpot = null;
  let shown = null;       // place the prompt and the touch button currently offer
  let started = false;
  let open = null;        // the open dialog element
  let openPlace = null;
  let lastFocus = null;
  let openedAt = 0;

  createTouchControls(touchEl, input);

  // ---------- Dialogs: one open at a time, focus trapped, Esc closes, game paused ----------
  function pauseGame(paused) {
    input.setEnabled(!paused);
    car.frozen = paused;
    document.body.classList.toggle('is-paused', paused);
    for (const el of outside) el.inert = paused;
    if (!paused && !promptGate.place) prompt.inert = true; // a leaving prompt stays untouchable
  }

  function openDialog(el, { focus, onClose, scrimClass = '' } = {}) {
    const replacing = open && open !== el;
    if (replacing) closeDialog({ restore: false }); // e.g. "Open the map" from a panel
    clearTimeout(el._hideTimer);
    closeSoundMenu();
    if (!replacing) lastFocus = document.activeElement;
    open = el;
    openedAt = performance.now();
    el._onClose = onClose;
    el.hidden = false;
    scrim.hidden = false;
    scrim.className = `scrim ${scrimClass}`;
    void el.offsetWidth; // start the transition from the closed state
    el.classList.add('is-open');
    scrim.classList.add('is-open');
    pauseGame(true);
    refreshMinimap();
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
    refreshMinimap();
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
    if (!open) {
      // Esc with the sound menu open closes the menu first (focus may be on the sound button).
      if (e.key === 'Escape' && !soundMenu.hidden) {
        e.preventDefault();
        if (!e.repeat) closeSoundMenu({ restore: true });
        return;
      }
      // No dialog open: Esc or P pauses.
      const pauseKey = e.key === 'Escape' || (e.code === 'KeyP' && !e.metaKey && !e.ctrlKey && !e.altKey);
      if (started && pauseKey && !e.repeat && !e.defaultPrevented && !e.target?.closest?.('input, textarea, select, [contenteditable]')) {
        e.preventDefault();
        openPause();
      }
      return;
    }
    // Keys that close a dialog stop here, so the game doesn't also act on them (M would reopen the map).
    const shut = () => { e.preventDefault(); e.stopPropagation(); closeDialog(); };
    // A held key (from driving, or Esc that just opened Pause) must not close what it opened.
    if (e.repeat && e.key !== 'Tab') { if (e.key === 'Escape') e.preventDefault(); return; }
    if (e.key === 'Escape') { shut(); return; }
    if (open === mapDlg && e.code === 'KeyM' && !e.metaKey && !e.ctrlKey) { shut(); return; }
    if (open === pauseEl && e.code === 'KeyP' && !e.metaKey && !e.ctrlKey) { shut(); return; }
    if (open === howto && !['Tab', 'Shift', 'Enter', ' ', 'Meta', 'Control', 'Alt'].includes(e.key)) { shut(); return; }
    if (e.key !== 'Tab') return;
    const items = [...open.querySelectorAll(FOCUSABLE)].filter((n) => n.getClientRects().length && !n.closest('[hidden]'));
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    const inside = open.contains(document.activeElement);
    if (e.shiftKey && (!inside || document.activeElement === first || document.activeElement === open)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (!inside || document.activeElement === last)) { e.preventDefault(); first.focus(); }
  });
  for (const el of [panel, mapDlg, howto, pauseEl]) el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeDialog()));
  // A click arriving just after a dialog opened is the tail of the tap that opened it.
  scrim.addEventListener('click', () => { if (performance.now() - openedAt > 350) closeDialog(); });

  // ---------- Place panels ----------
  function linkEl(link, primary) {
    const ext = isExternal(link.href);
    return h('a', {
      class: `btn ${primary ? 'btn-yellow' : 'btn-cream'}`, href: link.href,
      target: ext ? '_blank' : null, rel: ext ? 'noopener' : null,
    },
    h('span', {}, link.label),
    ext ? h('span', { class: 'sr-only' }, ' (opens in a new tab)') : null,
    h('span', { class: 'btn-icon', 'aria-hidden': 'true', html: ext ? ICON.out : ICON.arrow }));
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
      // A voiced sample starts with sound on (nothing autoplays); a silent walkthrough stays muted.
      // A video with its own aspect (a portrait sample) keeps it rather than the 16:9 frame.
      const muted = !m.sound;
      const video = h('video', {
        class: m.aspect ? 'media-video media-video-own' : 'media-video', style: m.aspect ? `aspect-ratio:${m.aspect}` : null,
        src: m.src, poster: m.poster, controls: true, muted, playsinline: true, preload: 'none', 'aria-label': m.alt ?? place.title,
      }, m.captions ? h('track', { kind: 'captions', src: m.captions, srclang: 'en', label: 'English', default: true }) : null);
      video.muted = muted;
      parts.push(video);
      if (m.note) parts.push(h('p', { class: 'media-note' }, m.note));
    }
    const yts = media.filter((m) => m.type === 'youtube');
    if (yts.length) {
      parts.push(h('div', { class: 'yt-row' }, yts.map((m) => {
        const box = h('div', { class: 'yt', tabindex: '-1', 'aria-label': m.alt });
        const btn = h('button', { type: 'button', class: 'yt-thumb', 'aria-label': `Play ${m.alt}` },
          h('img', { src: `https://i.ytimg.com/vi/${m.id}/hqdefault.jpg`, alt: '', loading: 'lazy' }),
          h('span', { class: 'yt-play', 'aria-hidden': 'true', html: ICON.play }));
        btn.addEventListener('click', () => {
          const frame = h('iframe', {
            src: `https://www.youtube-nocookie.com/embed/${m.id}?autoplay=1&playsinline=1&rel=0`,
            title: m.alt, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
          });
          // Keys pressed inside the player never reach this page, so Esc wouldn't close the panel.
          // Once it has loaded (and started), keep focus on the box; a click into the player
          // still works, and the close button stays in view in the panel's header.
          frame.addEventListener('load', () => {
            if (document.activeElement === frame || document.activeElement === document.body) box.focus({ preventScroll: true });
          }, { once: true });
          box.replaceChildren(frame);
          box.focus({ preventScroll: true });
        });
        // Closing the panel puts the thumbnail back, which also stops the video.
        box._reset = () => { if (!box.contains(btn)) box.replaceChildren(btn); };
        box.append(btn);
        return box;
      })), h('p', { class: 'media-note' }, 'Videos load from YouTube when you press play.'));
    }
    return h('div', { class: 'media' }, parts);
  }

  /** The email address as text you can read and copy, with a Copy button. */
  function emailEl(address) {
    const label = h('span', { class: 'email-copy-label' }, 'Copy');
    const btn = h('button', { type: 'button', class: 'email-copy', 'aria-label': `Copy ${address}` },
      h('span', { class: 'email-icon', 'aria-hidden': 'true', html: ICON.copy }), label);
    // A break chance only after the @, so a narrow panel never splits a word of the address.
    const at = address.indexOf('@') + 1;
    const text = h('span', { class: 'email-text' }, address.slice(0, at), at ? h('wbr') : null, address.slice(at));
    let reset = null;
    btn.addEventListener('click', async () => {
      const ok = await copyText(address, btn);
      if (ok) {
        toast('Email address copied.', { title: 'Copied', icon: 'tick', duration: 2400 });
        label.textContent = 'Copied';
        btn.classList.add('is-done');
        clearTimeout(reset);
        reset = setTimeout(() => { label.textContent = 'Copy'; btn.classList.remove('is-done'); }, 1800);
      } else {
        // No clipboard here: select the address so a long-press or Ctrl+C copies it.
        const range = document.createRange();
        range.selectNodeContents(text);
        const sel = getSelection();
        sel?.removeAllRanges(); sel?.addRange(range);
        toast('The address is selected, so you can copy it yourself.', { title: 'Couldn’t copy', icon: 'alert' });
      }
    });
    return h('div', { class: 'email' }, h('p', { class: 'email-label' }, 'Email'), h('div', { class: 'email-row' }, text, btn));
  }

  /** Copy to the clipboard; the old textarea fallback steals focus, so it goes back to `owner`. */
  async function copyText(text, owner) {
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
    } catch { /* blocked: try the old way */ }
    const area = h('textarea', { class: 'sr-only', readonly: true, 'aria-hidden': 'true' });
    try {
      area.value = text;
      panel.append(area);
      area.select();
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      area.remove();
      owner?.focus({ preventScroll: true });
    }
  }

  function renderPlace(place) {
    const soon = place.kind === 'soon';
    const body = soon ? ['Something new is being built here. The finished ones are on the map.'] : place.body ?? [];
    const firstPrimary = !(place.links ?? []).some((l) => l.primary);
    const links = (place.links ?? []).map((l, i) => linkEl(l, l.primary || (firstPrimary && i === 0)));
    if (place.cv) links.push(linkEl({ label: 'Download my CV', href: place.cv }, false));
    for (const s of place.social ?? []) links.push(linkEl(s, false));
    return [
      place.tagline ? h('p', { class: 'panel-tagline' }, place.tagline) : null,
      mediaEl(place),
      h('div', { class: 'panel-copy' }, body.map((t) => h('p', {}, t))),
      place.email ? emailEl(place.email) : null,
      place.stats?.length ? h('dl', { class: 'stats' }, place.stats.map((s) => h('div', {}, h('dt', {}, s.value), h('dd', {}, s.label)))) : null,
      links.length ? h('div', { class: 'links' }, links) : null,
      // No links yet (a private repo, not launched): say when, rather than leave a gap.
      !links.length && place.status ? h('p', { class: 'panel-status' }, h('span', { class: 'panel-status-dot', 'aria-hidden': 'true' }), place.status) : null,
      soon ? h('div', { class: 'links' }, h('button', { type: 'button', class: 'btn btn-cream', onclick: () => openMap() },
        h('span', {}, 'Open the map'), h('span', { class: 'btn-icon', 'aria-hidden': 'true', html: ICON.arrow }))) : null,
      place.tech?.length ? h('div', { class: 'tech' }, h('p', { class: 'tech-label', id: 'tech-label' }, 'Built with'),
        h('ul', { 'aria-labelledby': 'tech-label' }, place.tech.map((t) => h('li', {}, t)))) : null,
      h('p', { class: 'panel-hint' }, h('kbd', {}, 'Esc'), ' to keep driving'),
    ];
  }

  /** Stop anything playing in the panel: pause videos, put YouTube thumbnails back. */
  function stopMedia() {
    for (const v of panel.querySelectorAll('video')) v.pause();
    for (const box of panel.querySelectorAll('.yt')) box._reset?.();
  }

  function openPanel(place) {
    stopMedia();
    panelTitle.textContent = place.title;
    $('panel-kind').textContent = KIND_LABEL[place.kind];
    panelBody.replaceChildren(...renderPlace(place).filter(Boolean));
    panelBody.scrollTop = 0;
    panel.classList.remove('is-scrolled');
    panel.dataset.kind = place.kind;
    openPlace = place;
    openDialog(panel, { scrimClass: 'scrim-panel', onClose: () => { stopMedia(); emit('panel-close', { place }); openPlace = null; afterPanel(); } });
    // The HUD hides while a panel is open, so the tick lands (and the to-do peeks) when it closes.
    panelBody.scrollTop = 0;
    const first = !visited.has(place.id);
    if (first) {
      const wasComplete = objectiveProgress(visited).complete;
      visited.add(place.id);
      storeSet(STORE.visited, JSON.stringify([...visited]));
      drawMinimapStatic();
      renderTodo();
      freshTick = place.id;
      if (!wasComplete && objectiveProgress(visited).complete) allDonePending = true;
    }
    emit('panel-open', { place });
    emit('visit', { place, first });
  }

  // Swipe the sheet down to close it on phones: from the grab handle, or from the content when
  // it is scrolled to the top. A quick flick is enough (sheet.js has the rule).
  panelBody.addEventListener('scroll', () => panel.classList.toggle('is-scrolled', panelBody.scrollTop > 2), { passive: true });
  const phone = matchMedia('(max-width: 719px)');
  const grab = panel.querySelector('[data-grab]');
  let drag = null;
  const dragTo = (dy) => { panel.style.transform = `translateY(${dy > 0 ? dy : dy * 0.15}px)`; };
  const finishDrag = (dy) => {
    const ms = performance.now() - drag.t;
    panel.classList.remove('is-dragging');
    drag = null;
    if (shouldDismiss(dy, ms)) closeDialog();
    else panel.style.transform = '';
  };
  grab.addEventListener('pointerdown', (e) => {
    drag = { y: e.clientY, t: performance.now(), id: e.pointerId };
    grab.setPointerCapture(e.pointerId);
    panel.classList.add('is-dragging');
  });
  grab.addEventListener('pointermove', (e) => { if (drag && e.pointerId === drag.id) dragTo(e.clientY - drag.y); });
  const endGrab = (e) => { if (drag && e.pointerId === drag.id) finishDrag(e.clientY - drag.y); };
  grab.addEventListener('pointerup', endGrab);
  grab.addEventListener('pointercancel', endGrab);
  // From the content: touch events, so a pull down at the top can take over from scrolling.
  let pull = null;
  panelBody.addEventListener('touchstart', (e) => {
    pull = phone.matches && e.touches.length === 1 && panelBody.scrollTop <= 0 ? { y: e.touches[0].clientY, on: false } : null;
  }, { passive: true });
  panelBody.addEventListener('touchmove', (e) => {
    if (!pull) return;
    const dy = e.touches[0].clientY - pull.y;
    if (!pull.on) {
      if (dy < 0 || panelBody.scrollTop > 0) { pull = null; return; } // scrolling up: leave it be
      if (dy < 8) return;
      pull.on = true;
      pull.y += 8;
      drag = { t: performance.now() };
      panel.classList.add('is-dragging');
    }
    e.preventDefault();
    pull.dy = Math.max(0, e.touches[0].clientY - pull.y);
    dragTo(pull.dy);
  }, { passive: false });
  const endPull = () => { if (pull?.on && drag) finishDrag(pull.dy ?? 0); pull = null; };
  panelBody.addEventListener('touchend', endPull);
  panelBody.addEventListener('touchcancel', endPull);

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
    const dot = size > 400 ? 6 : 5;
    drawDynamic(ctx, size, { pad: MAP_PAD, places: PLACES, visited, car: null, dot });
    drawLabels(ctx, size, { pad: MAP_PAD, places: PLACES, font: size > 400 ? 15 : 13 });
    drawCar(ctx, size, { pad: MAP_PAD, car, dot }); // on top, so a label never hides where you are
  }
  // The building sites share one row; it takes you to the middle one.
  const sites = PLACES.filter((p) => p.kind === 'soon');
  const MAP_ROWS = PLACES.filter((p) => p.kind !== 'soon' || p === sites[Math.floor(sites.length / 2)]);
  function buildMapList() {
    mapList.replaceChildren(...MAP_ROWS.map((place) => {
      const seen = place.kind === 'soon' ? sites.every((p) => visited.has(p.id)) : visited.has(place.id);
      const name = place.kind === 'soon' ? 'Building sites' : place.title;
      return h('li', {}, h('button', { type: 'button', class: `map-item${seen ? ' is-seen' : ''}`, onclick: () => travel(place) },
        h('span', { class: 'map-dot', style: `--c:${MODEL_COLOUR[place.model] ?? '#8a7a6e'}`, 'aria-hidden': 'true' }),
        h('span', { class: 'map-name' }, name),
        h('span', { class: 'map-meta' }, KIND_LABEL[place.kind], seen ? ', visited' : ''),
        h('span', { class: 'map-tick', 'aria-hidden': 'true', html: ICON.tick })));
    }));
  }
  function openMap() {
    buildMapList();
    openDialog(mapDlg, { scrimClass: 'scrim-dim', focus: mapList.querySelector('button'), onClose: () => emit('map-close') });
    drawMap();
    // The labels use Lilita One; redraw once it has arrived if it hadn't yet.
    if (!document.fonts.check('16px "Lilita One"')) document.fonts.load('16px "Lilita One"').then(() => { if (open === mapDlg) drawMap(); }).catch(() => {});
    emit('map-open');
  }
  function travel(place) {
    const spot = travelSpot(place, world.roads, world.clearance());
    closeDialog({ restore: false });
    car.place(spot.x, spot.z, spot.heading);
    chase.snap();
    arrival = place;
    arrivalSpot = spot;
    active = null;
    arrivals.reset();
    canvas.focus({ preventScroll: true });
    announce(`You’re outside ${place.title}. ${isTouch() ? 'Tap the hand button' : 'Press E'} to look inside.`);
    emit('travel', { place });
  }
  mapCanvas.addEventListener('click', (e) => {
    const r = mapCanvas.getBoundingClientRect();
    const place = placeAtMapPoint(e.clientX - r.left, e.clientY - r.top, r.width, MAP_PAD, PLACES);
    if (place) travel(place);
  });
  $('hud-map').addEventListener('click', () => openMap());

  // ---------- Minimap ----------
  const MINI = 170, MINI_PAD = 8;
  const miniStatic = document.createElement('canvas');
  let miniCtx = null;
  // Whether the minimap is on screen, cached so the render loop never asks the layout.
  const miniMQ = matchMedia(MQ_MINIMAP);
  let miniVisible = false;
  function refreshMinimap() { miniVisible = Boolean(miniCtx) && started && !open && miniMQ.matches; }
  miniMQ.addEventListener('change', refreshMinimap);
  function drawMinimapStatic() {
    const ctx = sizeCanvas(miniStatic, MINI);
    drawStatic(ctx, MINI, { pad: MINI_PAD, places: PLACES, detail: false });
  }
  function initMinimap() {
    miniCtx = sizeCanvas(minimap, MINI);
    drawMinimapStatic();
  }
  function drawMinimap() {
    if (!miniVisible) return;
    miniCtx.clearRect(0, 0, MINI, MINI);
    miniCtx.drawImage(miniStatic, 0, 0, MINI, MINI);
    drawDynamic(miniCtx, MINI, { pad: MINI_PAD, places: PLACES, visited, car, dot: 4.2 });
  }

  // ---------- Prompt, announcer, HUD ----------
  function announce(text) {
    announcer.textContent = '';
    requestAnimationFrame(() => { announcer.textContent = text; });
  }
  // The prompt goes inert and leaves the accessibility tree the moment it starts to hide, so a
  // fading prompt can never be tapped; it leaves the layout once the exit has played.
  const promptGate = createPromptGate({
    delay: reducedMotion ? 0 : 160,
    show(place, fromHidden) {
      $('prompt-place').textContent = place.title;
      $('prompt-act').innerHTML = isTouch() ? 'Tap to look inside' : 'Press <kbd>E</kbd> to look inside';
      prompt.inert = Boolean(open);
      prompt.removeAttribute('aria-hidden');
      prompt.hidden = false;
      if (fromHidden) void prompt.offsetWidth;
      prompt.classList.add('is-shown');
      if (fromHidden) placeToasts();
    },
    leave() {
      prompt.classList.remove('is-shown');
      prompt.inert = true;
      prompt.setAttribute('aria-hidden', 'true');
    },
    gone() { prompt.hidden = true; placeToasts(); },
  });
  const setPrompt = (place) => promptGate.set(place);

  /**
   * Toasts sit under whatever is in the top slot: the arrival banner, or the prompt where it lives
   * at the top (phones). Measured only when one of them comes or goes, never per frame.
   */
  function placeToasts() {
    let below = 0;
    const inTop = (el) => !el.hidden && el.offsetHeight && el.offsetTop < innerHeight / 2;
    if (bannerUp && inTop(banner)) below = banner.offsetTop + banner.offsetHeight;
    else if (promptGate.place && inTop(prompt)) below = prompt.offsetTop + prompt.offsetHeight;
    const shift = below ? Math.max(0, below + 16 - toasts.offsetTop) : 0; // 16: room for the tilt
    toasts.style.transform = shift ? `translate(-50%, ${shift}px)` : '';
  }
  window.addEventListener('resize', () => { if (started) placeToasts(); });
  prompt.addEventListener('click', () => { const p = promptGate.place && (active ?? arrival); if (p) openPanel(p); });

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
    for (const row of document.querySelectorAll('[data-setting]')) row.setAttribute('aria-checked', String(Boolean(sound[row.dataset.setting])));
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
  // The same switches sit in the sound menu and in the pause menu.
  const onSwitch = (e) => {
    const row = e.target.closest('[data-setting]');
    if (!row) return;
    setSound({ [row.dataset.setting]: !sound[row.dataset.setting] });
    emit('sound', { ...sound, on: sound.effects || sound.music });
  };
  soundMenu.addEventListener('click', onSwitch);
  pauseEl.querySelector('.pause-sound').addEventListener('click', onSwitch);
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

  let found = { n: 0, total: 4 }, foundBumped = false;
  function setFound(n, total = 4) {
    foundBumped = n > found.n && started;
    found = { n, total };
    renderTodo();
  }

  /** Small note at the top of the screen: an icon disc, a title and a line. Returns the element. */
  function toast(text, { title, icon = 'star', duration = 4200 } = {}) {
    const el = h('div', { class: 'toast' },
      h('span', { class: 'toast-icon', 'data-icon': icon, 'aria-hidden': 'true', html: ICON[icon] ?? ICON.star }),
      title ? h('strong', {}, title) : null, h('span', { class: 'toast-text' }, text));
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
    backpill.hidden = !started || t;
    howto.dataset.mode = t ? 'touch' : 'keys';
    if ((active || arrival) && !open && !holdPrompt()) setPrompt(active ?? arrival);
  }
  coarse.addEventListener('change', applyPointerMode);

  // ---------- How to play ----------
  function openHowTo({ back = null } = {}) {
    openDialog(howto, { scrimClass: 'scrim-dim', focus: howto.querySelector('.howto-go'), onClose: () => { storeSet(STORE.howto, 'seen'); back?.(); } });
  }
  function maybeHowTo() {
    // Desktop: the to-do opens for the first look, then folds to its chip once you're driving.
    if (storeGet(STORE.howto)) { todoTimer = setTimeout(() => foldTodo(), 5000); return; }
    openHowTo({ back: () => foldTodo() });
  }

  // ---------- Pause menu ----------
  function openPause() {
    openDialog(pauseEl, { scrimClass: 'scrim-pause', focus: pauseEl.querySelector('[data-close]'), onClose: () => emit('pause-close') });
    emit('pause-open');
  }
  $('hud-pause').addEventListener('click', () => openPause());
  $('pause-map').addEventListener('click', () => openMap());
  // Controls from the pause menu comes back to the pause menu when it closes.
  $('pause-controls').addEventListener('click', () => openHowTo({ back: () => { if (!open) openPause(); } }));

  // ---------- To-do card ----------
  const todoToggle = $('todo-toggle'), todoList = $('todo-list');
  const chipFirst = matchMedia(MQ_TODO_CHIP);
  let freshTick = null, todoTimer = null, todoByHand = false;
  function renderTodo(fresh = null) {
    const p = objectiveProgress(visited);
    const x = extrasRow(found.n, found.total);
    todoList.replaceChildren(...p.items.map((item) => h('li', { class: `todo-item${item.done ? ' is-done' : ''}${item.id === fresh ? ' is-new' : ''}` },
      h('span', { class: 'todo-box', 'aria-hidden': 'true', html: ICON.tick }),
      h('span', { class: 'todo-label' }, item.label),
      h('span', { class: 'sr-only' }, item.done ? ', done' : ', not done yet'))),
    // The collectibles: optional, so they sit apart with their own count, outside the four.
    h('li', { class: `todo-item todo-extra${x.done ? ' is-done' : ''}${foundBumped ? ' is-new' : ''}` },
      h('span', { class: 'todo-box', 'aria-hidden': 'true', html: x.done ? ICON.tick : ICON.star }),
      // The narrowest phones show the short label; only one of the two is ever displayed.
      h('span', { class: 'todo-label' }, h('span', { class: 'todo-label-long' }, x.label), h('span', { class: 'todo-label-short' }, x.short)),
      h('span', { class: 'todo-extra-count', 'aria-hidden': 'true' }, x.count),
      h('span', { class: 'sr-only' }, `, optional, ${found.n} of ${found.total} found`)));
    foundBumped = false;
    $('todo-count').textContent = `${p.done}/${p.total}`;
    $('todo-count-sr').textContent = `, ${p.done} of ${p.total} done`;
  }
  function setTodoOpen(on) { todoToggle.setAttribute('aria-expanded', String(on)); }
  todoToggle.addEventListener('click', () => {
    todoByHand = true;
    clearTimeout(todoTimer);
    setTodoOpen(todoToggle.getAttribute('aria-expanded') !== 'true');
  });
  renderTodo();
  // A chip on touch devices and small screens, where the screen is busy; open on desktop at first.
  setTodoOpen(!chipFirst.matches);
  /** Fold the to-do to its chip, unless the visitor opened or closed it themselves. */
  function foldTodo() {
    clearTimeout(todoTimer);
    if (!todoByHand) setTodoOpen(false);
  }
  /** A tick just landed: show the card for a moment on desktop, then fold it again. */
  function peekTodo() {
    if (!freshTick) return;
    renderTodo(freshTick);
    freshTick = null;
    if (chipFirst.matches || todoByHand) return;
    setTodoOpen(true);
    clearTimeout(todoTimer);
    todoTimer = setTimeout(() => foldTodo(), TODO_PEEK);
  }
  let allDonePending = false;
  function afterPanel() {
    peekTodo();
    if (!allDonePending) return;
    allDonePending = false;
    setTimeout(() => toast('That’s the tour. The building sites are for whatever I build next.', { title: 'All done', icon: 'flag', duration: 6500 }), 350);
  }

  // ---------- Speedometer ----------
  const needle = $('speedo-needle'), speedNum = $('speedo-num');
  (function drawTicks() {
    const g = $('speedo-ticks');
    const NS = 'http://www.w3.org/2000/svg';
    for (let mph = 0; mph <= DIAL_MAX_MPH; mph += 5) {
      const major = mph % 10 === 0;
      const a = (needleAngle(mph) * Math.PI) / 180;
      const sx = Math.sin(a), sy = -Math.cos(a);
      const r1 = major ? 40 : 44, r2 = 49;
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', 60 + sx * r1); line.setAttribute('y1', 60 + sy * r1);
      line.setAttribute('x2', 60 + sx * r2); line.setAttribute('y2', 60 + sy * r2);
      line.setAttribute('stroke-width', major ? 3.2 : 2);
      if (mph >= 60) line.setAttribute('class', 'redline');
      g.append(line);
      if (major && mph % 20 === 0 && mph > 0) {
        const t = document.createElementNS(NS, 'text');
        t.setAttribute('x', 60 + sx * 31); t.setAttribute('y', 60 + sy * 31);
        t.textContent = mph;
        g.append(t);
      }
    }
  })();
  let shownMph = 0;
  const readout = createReadout();
  function updateSpeedo(dt) {
    const target = car.frozen ? 0 : toMph(car.speed);
    shownMph = easeToward(shownMph, target, dt, 8);
    const r = readout.step(shownMph); // only what changed, so most frames write nothing
    if (r.angle !== null) needle.style.transform = `rotate(${r.angle}deg)`;
    if (r.num !== null) speedNum.textContent = r.num;
  }

  // ---------- Arrival banners ----------
  const arrivals = createArrivals(PLACES);
  const arrivalOpts = { blocked: false, heading: 0 }; // reused every frame
  let bannerTimer = null, bannerOutTimer = null;
  let bannerUp = false; // in, or still sliding out: the top slot is taken
  const bannerGone = () => { bannerUp = false; banner.classList.remove('is-out'); placeToasts(); };
  function hideBanner(now = false) {
    if (!banner.classList.contains('is-in')) return;
    clearTimeout(bannerTimer); clearTimeout(bannerOutTimer);
    banner.classList.remove('is-in');
    if (now || reducedMotion) { bannerGone(); return; }
    banner.classList.add('is-out');
    bannerOutTimer = setTimeout(bannerGone, 450);
  }
  /** The prompt shares the banner's slot at the top, so it waits for the banner to go. */
  const holdPrompt = () => bannerUp;
  function showBanner(place) {
    clearTimeout(bannerTimer); clearTimeout(bannerOutTimer);
    const soon = place.kind === 'soon';
    $('banner-name').textContent = soon ? 'Building site' : place.title;
    $('banner-line').textContent = soon ? 'Coming soon' : place.tagline ?? KIND_LABEL[place.kind];
    banner.classList.remove('is-in', 'is-out');
    void banner.offsetWidth;
    banner.classList.add('is-in');
    bannerUp = true;
    if (holdPrompt()) setPrompt(null);
    placeToasts();
    bannerTimer = setTimeout(() => hideBanner(), BANNER_HOLD);
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
      minimapFrame.hidden = false;
      speedo.hidden = false;
      initMinimap();
      refreshMinimap();
      applyPointerMode();
      maybeHowTo();
    },
    update(dt = 0) {
      if (!started) return;
      arrivalOpts.blocked = Boolean(open);
      arrivalOpts.heading = car.heading;
      const arrived = arrivals.update(car.x, car.z, arrivalOpts);
      if (arrived) showBanner(arrived);
      if (open) hideBanner(true);
      updateSpeedo(dt);
      active = placeInRange(car.x, car.z, PLACES, active);
      if (arrival && (active || Math.hypot(car.x - arrivalSpot.x, car.z - arrivalSpot.z) > 6)) arrival = null;
      const now = active ?? arrival;
      if (now !== shown) {
        const entered = now && active === now && shown !== now;
        shown = now;
        setPrompt(open || holdPrompt() ? null : now);
        touchInteract.setAttribute('aria-disabled', String(!now));
        touchInteract.classList.toggle('is-lit', Boolean(now));
        if (entered) announce(`${now.title}. ${isTouch() ? 'Tap the hand button' : 'Press E'} to look inside.`);
      }
      const hold = Boolean(open) || holdPrompt();
      if (hold && promptGate.place) setPrompt(null);
      if (!hold && now && !promptGate.place) setPrompt(now);
      drawMinimap();
    },
    openPanel, openMap, openPause, closeDialog, travel, toast, setFound, setSound, closeSoundMenu,
  };
}
