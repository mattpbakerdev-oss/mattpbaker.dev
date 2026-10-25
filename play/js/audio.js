// Web Audio synthesis for Mattsville: no sound files. Engine hum, horn, bumps, landings, prop
// thunks, chimes, soft UI clicks and an optional cheerful loop. Nothing starts until the
// "Start driving" click (a user gesture), and settings live in localStorage.
//
// Listens on `events`: start, sound { effects, music }, horn, bump { strength }, land { impact },
// prop-hit { kind, strength }, walker-hit, collect, collect-all, panel-open/close,
// map-open/close, menu-open.

export const SOUND_KEY = 'mattsville.sound';
const DEFAULTS = { effects: true, music: false };

/** Engine pitch and loudness for a speed in units per second (either direction). */
export function engineTone(speed) {
  const s = Math.min(Math.abs(speed), 30);
  return { freq: 46 + s * 3.3, gain: 0.05 + (s / 30) * 0.045 };
}

export function loadSoundSettings(storage) {
  try {
    const raw = JSON.parse(storage?.getItem(SOUND_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
    return { effects: raw.effects !== false, music: raw.music === true };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSoundSettings(storage, settings) {
  try { storage?.setItem(SOUND_KEY, JSON.stringify({ effects: Boolean(settings.effects), music: Boolean(settings.music) })); } catch { /* fine */ }
}

const midi = (n) => 440 * 2 ** ((n - 69) / 12);

// Music: F major, I vi IV V, 100 bpm in eighths. Soft pad, round bass, a light plucked tune.
const BPM = 100;
const EIGHTH = 60 / BPM / 2;
const CHORDS = [[53, 57, 60], [50, 53, 57], [46, 50, 53], [48, 52, 55]];
const BASS = [41, 38, 34, 36];
const TUNE = [
  [72, null, 69, 72, 74, null, 72, null],
  [74, null, 72, 69, 67, null, 69, null],
  [65, 67, 69, null, 72, null, 74, 72],
  [67, null, null, 69, 67, null, null, null],
  [72, null, 69, 72, 74, null, 77, null],
  [74, null, 72, 69, 67, null, 65, null],
  [65, 67, 69, null, 72, null, 69, 67],
  [65, null, null, null, null, null, null, null],
];

export function createAudio({ events, car, ui, storage = globalThis.localStorage }) {
  let settings = loadSoundSettings(storage);
  let ctx = null, out, fx, music, engine, noise;
  let started = false;
  let musicTimer = null, nextNote = 0, step = 0;

  function unlock() {
    if (ctx) { if (ctx.state === 'suspended' && !document.hidden) ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ctx = new AC(); } catch { ctx = null; return; }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    out = ctx.createGain(); out.gain.value = 0.9;
    out.connect(comp).connect(ctx.destination);
    fx = ctx.createGain(); fx.connect(out);
    music = ctx.createGain(); music.gain.value = 0;
    const musicTone = ctx.createBiquadFilter(); musicTone.type = 'lowpass'; musicTone.frequency.value = 2600;
    music.connect(musicTone).connect(out);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    buildEngine();
    apply();
  }

  function buildEngine() {
    const a = ctx.createOscillator(), b = ctx.createOscillator();
    a.type = 'sawtooth'; b.type = 'square';
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 400; filter.Q.value = 2;
    const gain = ctx.createGain(); gain.gain.value = 0;
    // A wobble before the volume stage so it chugs rather than drones (and silence is silent).
    const wobble = ctx.createGain(); wobble.gain.value = 1;
    const lfo = ctx.createOscillator(), depth = ctx.createGain();
    lfo.frequency.value = 7; depth.gain.value = 0.25;
    lfo.connect(depth).connect(wobble.gain);
    const bGain = ctx.createGain(); bGain.gain.value = 0.6;
    a.connect(filter); b.connect(bGain).connect(filter);
    filter.connect(wobble).connect(gain).connect(fx);
    a.start(); b.start(); lfo.start();
    engine = { a, b, filter, gain, lfo };
  }

  function apply() {
    if (!ctx) return;
    const t = ctx.currentTime;
    fx.gain.setTargetAtTime(settings.effects ? 1 : 0, t, 0.03);
    music.gain.setTargetAtTime(settings.music ? 0.13 : 0, t, 0.15);
    if (settings.music && !musicTimer) startMusic();
    if (!settings.music && musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  }

  const live = () => ctx && settings.effects && ctx.state !== 'closed';

  // ---------- Building blocks ----------
  function tone({ type = 'sine', from, to = from, at = 0, dur = 0.2, gain = 0.2, attack = 0.005, dest = fx, curve = 'exp' }) {
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    if (to !== from) o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    else { g.gain.setValueAtTime(gain, t + dur - 0.03); g.gain.linearRampToValueAtTime(0.0001, t + dur); }
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }
  function hiss({ at = 0, dur = 0.1, gain = 0.2, type = 'lowpass', freq = 600, q = 0.8, dest = fx }) {
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource(); src.buffer = noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }

  // ---------- Effects ----------
  const sfx = {
    horn() {
      // Cartoon double honk: two reedy notes a third apart, the second a touch lower.
      for (const [at, k] of [[0, 1], [0.19, 0.94]]) {
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1700; f.connect(fx);
        for (const base of [349, 440]) tone({ type: 'square', from: base * k, to: base * k * 0.97, at, dur: 0.15, gain: 0.07, attack: 0.012, dest: f, curve: 'flat' });
      }
    },
    bump(strength) {
      const k = Math.min(1, strength / 16);
      tone({ from: 120, to: 42, dur: 0.22, gain: 0.25 + k * 0.45 });
      hiss({ dur: 0.12, gain: 0.08 + k * 0.2, freq: 500 });
    },
    land(impact) {
      const k = Math.min(1, impact / 16);
      tone({ from: 90, to: 34, dur: 0.3, gain: 0.25 + k * 0.4 });
      hiss({ dur: 0.18, gain: 0.06 + k * 0.12, freq: 350 });
    },
    thunk(kind, strength) {
      const k = 0.45 + Math.min(1, strength / 20) * 0.55;
      const pitch = { cone: 520, bin: 260, crate: 200, fence: 300 }[kind] ?? 260;
      tone({ type: 'triangle', from: pitch, to: pitch * 0.45, dur: 0.1, gain: 0.22 * k });
      hiss({ dur: 0.06, gain: 0.1 * k, type: 'bandpass', freq: pitch * 3, q: 1.6 });
      if (kind === 'bin') tone({ type: 'square', from: 610, to: 590, dur: 0.12, gain: 0.025 * k }); // tinny lid
    },
    hop() { tone({ from: 280, to: 720, dur: 0.16, gain: 0.08, attack: 0.01 }); },
    chime() {
      [76, 80, 83, 88].forEach((n, i) => {
        tone({ type: 'triangle', from: midi(n), at: i * 0.075, dur: 0.9, gain: 0.09 });
        tone({ from: midi(n + 12), at: i * 0.075, dur: 0.5, gain: 0.025 });
      });
    },
    fanfare() {
      [72, 76, 79, 84, 79, 84].forEach((n, i) => tone({ type: 'triangle', from: midi(n), at: i * 0.11, dur: i === 5 ? 1.4 : 0.35, gain: 0.09 }));
      [60, 64, 67].forEach((n) => tone({ type: 'sine', from: midi(n), at: 0.55, dur: 1.5, gain: 0.05, attack: 0.05 }));
    },
    click() { tone({ from: 1500, to: 900, dur: 0.045, gain: 0.05, attack: 0.002 }); },
  };
  const play = (name, ...args) => { if (live() && ctx.state === 'running') sfx[name](...args); };

  // ---------- Music ----------
  function startMusic() {
    nextNote = ctx.currentTime + 0.12;
    step = 0;
    musicTimer = setInterval(scheduleMusic, 90);
    scheduleMusic();
  }
  function scheduleMusic() {
    if (!ctx || ctx.state !== 'running') return;
    while (nextNote < ctx.currentTime + 0.35) {
      const bar = Math.floor(step / 8) % TUNE.length, beat = step % 8, chord = bar % 4;
      const at = nextNote - ctx.currentTime;
      if (beat === 0) {
        for (const n of CHORDS[chord]) tone({ type: 'triangle', from: midi(n), at, dur: EIGHTH * 8, gain: 0.05, attack: 0.25, dest: music, curve: 'flat' });
      }
      if (beat === 0 || beat === 4) tone({ type: 'sine', from: midi(BASS[chord]), at, dur: EIGHTH * 3, gain: 0.22, attack: 0.01, dest: music });
      if (beat % 2 === 1) hiss({ at, dur: 0.04, gain: 0.03, type: 'highpass', freq: 7000, dest: music });
      const n = TUNE[bar][beat];
      if (n) {
        tone({ type: 'triangle', from: midi(n), at, dur: EIGHTH * 1.8, gain: 0.1, attack: 0.008, dest: music });
        tone({ type: 'sine', from: midi(n + 12), at, dur: EIGHTH, gain: 0.025, dest: music });
      }
      nextNote += EIGHTH;
      step++;
    }
  }

  // ---------- Wiring ----------
  events.addEventListener('start', () => {
    started = true;
    unlock(); // inside the Start driving click, so browsers allow it
    ui.setSound(settings);
  });
  events.addEventListener('sound', (e) => {
    settings = { effects: Boolean(e.detail?.effects), music: Boolean(e.detail?.music) };
    saveSoundSettings(storage, settings);
    unlock();
    apply();
    play('click');
  });
  // Any later tap or key brings audio back if the browser suspended it.
  for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, () => { if (started) unlock(); }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend().catch(() => {});
    else if (started) ctx.resume().catch(() => {});
  });

  events.addEventListener('horn', () => play('horn'));
  events.addEventListener('bump', (e) => play('bump', e.detail?.strength ?? 5));
  events.addEventListener('land', (e) => play('land', e.detail?.impact ?? 5));
  events.addEventListener('prop-hit', (e) => play('thunk', e.detail?.kind, e.detail?.strength ?? 5));
  events.addEventListener('walker-hit', () => play('hop'));
  events.addEventListener('collect', () => play('chime'));
  events.addEventListener('collect-all', () => play('fanfare'));
  for (const type of ['panel-open', 'panel-close', 'map-open', 'map-close', 'menu-open']) events.addEventListener(type, () => play('click'));

  return {
    get settings() { return { ...settings }; },
    get state() { return ctx?.state ?? 'none'; },
    /** Engine volume right now (for checks). */
    get engineLevel() { return engine ? engine.gain.gain.value : 0; },
    /** Per frame: engine pitch follows speed; silent while a panel is open or before Start. */
    update(input) {
      if (!ctx || !engine) return;
      const t = ctx.currentTime;
      const running = started && !ui.isOpen && !car.frozen;
      const { freq, gain } = engineTone(car.speed);
      const rev = car.grounded ? 1 : 1.18; // wheels spin free in the air
      const push = Math.abs(input?.throttle ?? 0) * 0.02;
      engine.a.frequency.setTargetAtTime(freq * rev, t, 0.06);
      engine.b.frequency.setTargetAtTime(freq * rev * 0.5, t, 0.06);
      engine.filter.frequency.setTargetAtTime(320 + Math.abs(car.speed) * 22, t, 0.08);
      engine.lfo.frequency.setTargetAtTime(6 + Math.abs(car.speed) * 0.5, t, 0.1);
      engine.gain.gain.setTargetAtTime(running ? gain + push : 0, t, running ? 0.08 : 0.04);
    },
  };
}
