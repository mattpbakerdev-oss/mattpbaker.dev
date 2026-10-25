// The town's extras: wooden signs in Matt's voice, four townsfolk, knock-over props, the four
// hidden collectibles and the celebration for finding them all. Pure logic lives in
// collect.js, tumble.js, walkers.js and placement.js; this file draws and wires it.
//
// Fires on `events`: prop-hit { kind, strength }, walker-hit, collect { id }, collect-all.
// Listens for: horn.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mergeColoured, box, material } from './world.js';
import { COLLECTIBLES, findPickups, loadFound, saveFound } from './collect.js';
import { PROP_KINDS, createBody, resetBody, knock, stepBody, shouldReset } from './tumble.js';
import { TOWNSFOLK, createWalker, stepWalker, hitWalker, hornWalker } from './walkers.js';
import { clearSpot } from './placement.js';
import { circleVsBox, clampToPlot } from './physics.js';
import { safeStorage } from './storage.js';

const CAR_R = 1.35;
const SIGN_NEAR = 11;
const SAY_NEAR = 8.5;
const HORN_REACH = 24;
const $ = (id) => document.getElementById(id);

// rot turns the board's face (local +z) towards the road. The Bangkok board is an arrow whose
// tip (local +x) points east-south-east: rotation -22.5 degrees.
const SIGNS = [
  { text: 'Speed limit: whatever ships it', x: 7.6, z: 34, rot: -Math.PI / 2, along: [0, 1] },
  { text: 'Caution: specs ahead', x: -39, z: 62.4, rot: 0, along: [1, 0] },
  { text: 'This road was built by an AI. I reviewed the plan', x: -38, z: 7.6, rot: Math.PI, along: [1, 0] },
  { text: 'Bangkok: 9,500\u00a0km that way', x: 58, z: -7.6, rot: -Math.PI / 8, along: [1, 0], arrow: true },
  { text: 'Every build keeps a log. This sign is in it', x: -7.6, z: -60, rot: Math.PI / 2, along: [0, 1] },
  { text: 'Park responsibly. Or don’t, it’s a game', x: 62.4, z: 51, rot: Math.PI / 2, along: [0, 1] },
];

// Knock-over props: building-site gaps, pavements, the park.
const PROPS = [
  ...[[-34, 76.2], [-32.5, 76.2], [-31, 76.2], [-9, 76.2], [-7.5, 76.2], [-6, 76.2], [16, 76.2], [17.5, 76.2],
    [-4, -18.5], [4, -18.5], [46, 44], [49, 48], [52, 44], [55, 48]].map(([x, z]) => ({ kind: 'cone', x, z })),
  ...[[17, 7.4], [-14, -7.4], [7.4, -50], [-62.6, 27], [63.4, -20], [36.5, -7.4]].map(([x, z]) => ({ kind: 'bin', x, z })),
  ...[[-60, 30], [-60, 28.6], [-58.6, 29.3], [37, 41.4], [38.3, 41.4], [-33, 99], [-31.6, 99.3]].map(([x, z], i) => ({ kind: 'crate', x, z, rot: i * 0.4 })),
  ...[[-32.5, 78.3, 0], [-7.5, 78.3, 0], [12.2, 40, Math.PI / 2], [12.2, 42.3, Math.PI / 2], [58, 32.5, 0], [60.3, 32.5, 0]]
    .map(([x, z, rot]) => ({ kind: 'fence', x, z, rot })),
];

const M4 = new THREE.Matrix4(), M4b = new THREE.Matrix4(), Q = new THREE.Quaternion(), Q2 = new THREE.Quaternion();
const V = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1), ONE = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0), XAXIS = new THREE.Vector3(1, 0, 0);

export function createExtras({ scene, camera, world, car, events, ui, reducedMotion = false }) {
  const emit = (type, detail) => events.dispatchEvent(new CustomEvent(type, { detail }));
  const tagLayer = $('tags');
  const live = $('extras-live');
  const say = (text) => { live.textContent = ''; requestAnimationFrame(() => { live.textContent = text; }); };

  const signs = buildSigns(scene, world);
  const folk = buildTownsfolk(scene, world, reducedMotion);
  const props = buildProps(scene, world);
  const loot = buildCollectibles(scene, world, reducedMotion);
  const confetti = buildConfetti(scene);

  // Floating labels: one DOM element per sign and per townsperson, positioned each frame.
  const makeTag = (cls, text) => {
    const el = document.createElement('div');
    el.className = `tag ${cls}`;
    const card = document.createElement('div');
    card.className = 'tag-card';
    card.textContent = text;
    el.append(card);
    el.hidden = true;
    tagLayer.append(el);
    return { el, card, shown: false, text };
  };
  for (const s of signs) s.tag = makeTag('tag-sign', s.text);
  for (const w of folk.walkers) w.tag = makeTag('tag-say', w.line);

  const projected = new THREE.Vector3();
  function placeTag(tag, x, y, z, want) {
    let on = want;
    if (on) {
      projected.set(x, y, z).project(camera);
      on = projected.z < 1 && Math.abs(projected.x) < 1.15 && projected.y < 1.2 && projected.y > -1.1;
    }
    if (on) {
      const W = window.innerWidth;
      const px = (projected.x + 1) / 2 * W, py = (1 - projected.y) / 2 * window.innerHeight;
      if (tag.el.hidden) { tag.el.hidden = false; tag.half = 0; void tag.el.offsetWidth; }
      // Keep the card on screen; the bubble's tail still points at the speaker.
      if (!tag.half) tag.half = tag.card.offsetWidth / 2;
      const cx = Math.min(Math.max(px, tag.half + 10), W - tag.half - 10);
      tag.el.style.transform = `translate3d(${cx.toFixed(1)}px, ${py.toFixed(1)}px, 0)`;
      const tail = Math.max(-tag.half + 20, Math.min(tag.half - 20, px - cx));
      if (Math.abs((tag.tail ?? 0) - tail) > 0.5) { tag.tail = tail; tag.card.style.setProperty('--tail', `${tail.toFixed(1)}px`); }
    }
    if (on !== tag.shown) {
      tag.shown = on;
      tag.el.classList.toggle('is-shown', on);
      clearTimeout(tag.hideTimer);
      if (!on) tag.hideTimer = setTimeout(() => { if (!tag.shown) tag.el.hidden = true; }, 220);
    }
    return on;
  }
  const setTagText = (tag, text) => {
    if (tag.text === text) return;
    tag.text = text;
    tag.card.textContent = text;
    tag.half = 0;
    tag.el.classList.toggle('is-oi', text === 'Oi!');
  };

  // Collectibles: counter, persistence, celebration.
  const store = safeStorage();
  const found = loadFound(store);
  for (const c of loot.items) if (found.has(c.id)) c.mesh.visible = false;
  loot.refreshHalos(found);
  ui.setFound(found.size, COLLECTIBLES.length);

  function collect(id) {
    const item = loot.items.find((c) => c.id === id);
    found.add(id);
    saveFound(store, found);
    item.mesh.visible = false;
    loot.refreshHalos(found);
    ui.setFound(found.size, COLLECTIBLES.length);
    ui.toast(item.text, { title: item.title });
    emit('collect', { id });
    if (found.size === COLLECTIBLES.length) {
      setTimeout(() => {
        if (!reducedMotion) confetti.burst(car.x, car.y + 2.4, car.z);
        emit('collect-all');
        ui.toast('Thanks for driving round. If you’d like to talk, the post office is open.', { title: 'You found everything', duration: 7000 });
      }, 1300);
    }
  }

  events.addEventListener('horn', () => {
    for (const w of folk.walkers) if (Math.hypot(w.x - car.x, w.z - car.z) < HORN_REACH) hornWalker(w);
  });

  const carHit = () => ({ x: car.x, z: car.z, vx: car.vx, vz: car.vz });
  let clock = 0;
  const frustum = new THREE.Frustum(), sphere = new THREE.Sphere();
  const inView = (x, y, z) => frustum.intersectsSphere(sphere.set(V.set(x, y, z), 1.6));

  return {
    signs, folk, props, loot, found, confetti,
    /** Per frame. `paused` while a panel or the map is open. */
    update(dt, paused) {
      if (paused) {
        for (const s of signs) placeTag(s.tag, 0, 0, 0, false);
        for (const w of folk.walkers) placeTag(w.tag, 0, 0, 0, false);
        return;
      }
      clock += dt;
      camera.updateMatrixWorld();
      M4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(M4);

      // Townsfolk walk, hop and talk.
      for (const w of folk.walkers) {
        const d = Math.hypot(w.x - car.x, w.z - car.z);
        if (d < CAR_R + 0.45 && w.y < 1 && car.y < 1.6 && Math.hypot(car.vx, car.vz) > 0.5 && hitWalker(w, carHit())) emit('walker-hit');
        stepWalker(w, dt, car);
        const line = w.saying ?? (d < SAY_NEAR ? w.line : null);
        if (line) setTagText(w.tag, line);
        const was = w.tag.shown;
        if (placeTag(w.tag, w.x, 2.55 + w.y, w.z, Boolean(line)) && !was) say(line);
      }
      folk.draw();

      // Signs.
      for (const s of signs) {
        const near = Math.hypot(s.x - car.x, s.z - car.z) < SIGN_NEAR;
        const was = s.tag.shown;
        if (placeTag(s.tag, s.x, 3.6, s.z, near) && !was) say(`Sign: ${s.text}`);
      }

      // Props: car hits, tumble, and reset out of view.
      for (const b of props.bodies) {
        b.cool = Math.max(0, (b.cool ?? 0) - dt);
        const kind = PROP_KINDS[b.kind];
        if (b.cool === 0 && car.y < b.y + 1.2 && Math.abs(b.x - car.x) < 3 && Math.abs(b.z - car.z) < 3) {
          const yaw = b.home.rot;
          const touching = b.kind === 'fence'
            ? circleVsBox(car.x, car.z, CAR_R, { x: b.x, z: b.z, hw: kind.half[0], hd: 0.15, rot: yaw })
            : Math.hypot(b.x - car.x, b.z - car.z) < CAR_R + kind.r;
          if (touching) {
            const strength = Math.hypot(car.vx, car.vz);
            knock(b, carHit(), clock);
            b.cool = 0.3;
            const scrub = 1 - 0.015 * kind.mass;
            car.vx *= scrub; car.vz *= scrub;
            props.dirty.add(b.kind);
            emit('prop-hit', { kind: b.kind, strength });
          }
        }
        if (b.knocked && !b.asleep) {
          stepBody(b, dt, world.groundHeightAt);
          const edge = clampToPlot(b.x, b.z, 0.5, world.plotHalf, world.plotCorner);
          if (edge.hit) { b.x = edge.x; b.z = edge.z; b.vx *= -0.3; b.vz *= -0.3; }
          props.dirty.add(b.kind);
        }
        if (shouldReset(b, clock, inView(b.x, b.y, b.z) || inView(b.home.x, 0.5, b.home.z))) {
          resetBody(b);
          props.dirty.add(b.kind);
        }
      }
      props.draw();

      // Collectibles: spin, glow, pick up.
      loot.animate(clock, camera, found);
      for (const id of findPickups(car, loot.items, found)) collect(id);
      confetti.update(dt);
    },
    /** For checks: every placed extra that sits inside a solid collider (should be empty). */
    overlaps() {
      const bad = [];
      const solid = world.colliders.filter((c) => c.kind !== 'extra-sign');
      const hits = (x, z, r) => solid.some((c) => (c.type === 'circle' ? Math.hypot(x - c.x, z - c.z) < r + c.r : circleVsBox(x, z, r, c)));
      for (const b of props.bodies) if (hits(b.home.x, b.home.z, 0.4)) bad.push(`prop ${b.kind} ${b.home.x},${b.home.z}`);
      for (const s of signs) if (world.colliders.some((c) => c.kind !== 'extra-sign' && (c.type === 'circle' ? Math.hypot(s.x - c.x, s.z - c.z) < 0.5 + c.r : circleVsBox(s.x, s.z, 0.5, c)))) bad.push(`sign ${s.text}`);
      for (const w of folk.walkers) for (const [x, z] of w.path) if (hits(x, z, 0.4)) bad.push(`walker ${w.line.slice(0, 12)} ${x},${z}`);
      for (const c of loot.items) if (c.y < 2 && hits(c.x, c.z, 1.4)) bad.push(`collectible ${c.id}`);
      return bad;
    },
  };
}

// ---------- Signs ----------
function signAtlas(signs) {
  const CW = 512, CH = 204;
  const canvas = document.createElement('canvas');
  canvas.width = CW * 2; canvas.height = CH * 3;
  const ctx = canvas.getContext('2d');
  signs.forEach((s, i) => {
    const x0 = (i % 2) * CW, y0 = Math.floor(i / 2) * CH;
    ctx.fillStyle = '#e2b47a';
    ctx.fillRect(x0, y0, CW, CH);
    // Planks and grain.
    ctx.fillStyle = 'rgba(120,72,36,0.16)';
    for (let k = 1; k < 3; k++) ctx.fillRect(x0, y0 + (CH / 3) * k - 1, CW, 3);
    ctx.strokeStyle = 'rgba(120,72,36,0.1)';
    ctx.lineWidth = 2;
    for (let k = 0; k < 7; k++) {
      ctx.beginPath();
      const gy = y0 + 14 + k * 27;
      ctx.moveTo(x0 + 10, gy); ctx.bezierCurveTo(x0 + 160, gy - 6, x0 + 330, gy + 7, x0 + CW - 10, gy - 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#3b2a20';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const maxW = s.arrow ? CW - 90 : CW - 56;
    let size = 50, lines;
    for (; size >= 26; size -= 2) {
      ctx.font = `600 ${size}px Onest, "Segoe UI", Helvetica, Arial, sans-serif`;
      lines = wrapText(ctx, s.text, maxW);
      if (lines.length * size * 1.15 <= CH - 34 && lines.length <= 3) break;
    }
    const lh = size * 1.15, cx = x0 + (s.arrow ? CW / 2 - 18 : CW / 2);
    lines.forEach((l, k) => ctx.fillText(l, cx, y0 + CH / 2 + (k - (lines.length - 1) / 2) * lh + 2));
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function wrapText(ctx, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width > maxW && cur) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

function buildSigns(scene, world) {
  const BW = 2.6, BH = 1.04, BY = 1.75, K = 1.25; // K: the whole sign scaled up to read from the road
  const wood = [], faces = [];
  const signs = SIGNS.map((def, i) => {
    const spot = clearSpot(def.x, def.z, 1.4, world.colliders, def.along[0], def.along[1]);
    const s = { ...def, x: spot.x, z: spot.z };
    const m = new THREE.Matrix4().compose(new THREE.Vector3(s.x, 0, s.z), new THREE.Quaternion().setFromAxisAngle(UP, s.rot), new THREE.Vector3(K, K, K));
    const parts = [
      { geo: box(0.16, BY + 0.2, 0.16, -0.95, (BY + 0.2) / 2, -0.12), color: '#7a4e32' },
      { geo: box(0.16, BY + 0.2, 0.16, 0.95, (BY + 0.2) / 2, -0.12), color: '#7a4e32' },
      { geo: box(BW + 0.14, BH + 0.14, 0.1, 0, BY, -0.02), color: '#a8703f' },
    ];
    if (s.arrow) {
      const tri = new THREE.Shape();
      tri.moveTo(0, -(BH + 0.5) / 2); tri.lineTo(0.75, 0); tri.lineTo(0, (BH + 0.5) / 2); tri.closePath();
      const tip = new THREE.ExtrudeGeometry(tri, { depth: 0.1, bevelEnabled: false }).translate(BW / 2 + 0.07, BY, -0.07);
      parts.push({ geo: tip, color: '#a8703f' });
      const inner = new THREE.Shape();
      inner.moveTo(0, -(BH + 0.2) / 2); inner.lineTo(0.55, 0); inner.lineTo(0, (BH + 0.2) / 2); inner.closePath();
      parts.push({ geo: new THREE.ShapeGeometry(inner).translate(BW / 2, BY, 0.04), color: '#e2b47a' });
    }
    for (const p of parts) { p.geo.applyMatrix4(m); wood.push(p); }
    const face = new THREE.PlaneGeometry(BW, BH);
    const uv = face.attributes.uv, col = i % 2, row = Math.floor(i / 2);
    for (let k = 0; k < uv.count; k++) uv.setXY(k, (col + uv.getX(k)) / 2, 1 - (row + 1) / 3 + uv.getY(k) / 3);
    face.translate(0, BY, 0.035).applyMatrix4(m);
    faces.push(face);
    world.colliders.push({ type: 'box', x: s.x - Math.sin(s.rot) * 0.1, z: s.z - Math.cos(s.rot) * 0.1, hw: (BW / 2 + (s.arrow ? 0.4 : 0.1)) * K, hd: 0.2, rot: s.rot, kind: 'extra-sign' });
    return s;
  });
  const woodMesh = new THREE.Mesh(mergeColoured(wood), material({ vertexColors: true }));
  woodMesh.castShadow = woodMesh.receiveShadow = true;
  const faceMesh = new THREE.Mesh(mergeGeometries(faces), new THREE.MeshLambertMaterial({ map: signAtlas(signs) }));
  faceMesh.receiveShadow = true;
  woodMesh.name = 'extras:signs';
  scene.add(woodMesh, faceMesh);
  return signs;
}

// ---------- Townsfolk ----------
function buildTownsfolk(scene, world, reducedMotion) {
  const n = TOWNSFOLK.length;
  // Parts are white (or dark for eyes and shoes) so the per-person instance colour tints them.
  const limbGeo = mergeColoured([{ geo: box(0.22, 0.66, 0.24, 0, -0.33, 0), color: '#ffffff' }, { geo: box(0.24, 0.1, 0.3, 0, -0.66, 0.03), color: '#2a2224' }]);
  const torsoGeo = mergeColoured([
    { geo: box(0.64, 0.74, 0.36, 0, 1.12, 0), color: '#ffffff' },
    { geo: box(0.66, 0.08, 0.38, 0, 0.79, 0), color: '#9a9a9a' },
  ]);
  const headGeo = mergeColoured([
    { geo: box(0.46, 0.46, 0.44, 0, 1.78, 0), color: '#ffffff' },
    { geo: box(0.07, 0.08, 0.03, -0.1, 1.8, 0.225), color: '#241c1c' },
    { geo: box(0.07, 0.08, 0.03, 0.1, 1.8, 0.225), color: '#241c1c' },
    { geo: box(0.16, 0.04, 0.03, 0, 1.66, 0.225), color: '#a0605a' },
  ]);
  const hairGeo = mergeColoured([
    { geo: box(0.5, 0.14, 0.48, 0, 2.06, -0.01), color: '#ffffff' },
    { geo: box(0.5, 0.3, 0.1, 0, 1.9, -0.2), color: '#ffffff' },
  ]);
  const mat = material({ vertexColors: true });
  const limbs = new THREE.InstancedMesh(limbGeo, mat, n * 4);
  const torsos = new THREE.InstancedMesh(torsoGeo, mat, n);
  const heads = new THREE.InstancedMesh(headGeo, mat, n);
  const hair = new THREE.InstancedMesh(hairGeo, mat, n);
  const walkers = TOWNSFOLK.map((t, i) => {
    const [shirt, trousers, skin, hairC] = t.look.map((c) => new THREE.Color(c));
    torsos.setColorAt(i, shirt); heads.setColorAt(i, skin); hair.setColorAt(i, hairC);
    for (let k = 0; k < 2; k++) limbs.setColorAt(i * 4 + k, trousers);
    for (let k = 2; k < 4; k++) limbs.setColorAt(i * 4 + k, shirt);
    const w = createWalker({ path: t.path, speed: 1.05 + i * 0.07, s: i * 2.3, reducedMotion, line: t.line });
    w.id = t.id;
    return w;
  });
  for (const m of [limbs, torsos, heads, hair]) {
    m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
    scene.add(m);
  }

  const root = new THREE.Matrix4(), local = new THREE.Matrix4();
  const LIMBS = [[-0.15, 0.76, 1], [0.15, 0.76, -1], [-0.41, 1.46, -1], [0.41, 1.46, 1]]; // x, pivot y, swing phase
  function draw() {
    walkers.forEach((w, i) => {
      const moving = !w.hopping && w.lookTimer === 0;
      w.swing = (w.swing ?? 0) + ((moving ? Math.sin(w.stride * 5.2) * 0.55 : 0) - (w.swing ?? 0)) * 0.25;
      const bob = reducedMotion || !moving ? 0 : Math.abs(Math.sin(w.stride * 5.2)) * 0.05;
      Q.setFromAxisAngle(UP, w.heading);
      root.compose(V.set(w.x, world.groundHeightAt(w.x, w.z) + w.y + bob, w.z), Q, ONE);
      torsos.setMatrixAt(i, root);
      heads.setMatrixAt(i, root);
      hair.setMatrixAt(i, root);
      LIMBS.forEach(([x, py, phase], k) => {
        const arm = k >= 2;
        // Arms go up in surprise mid-hop; otherwise everything swings with the stride.
        const angle = w.hopping && arm ? -2.6 : w.swing * phase * (arm ? 0.8 : 1);
        Q2.setFromAxisAngle(XAXIS, angle);
        local.compose(V.set(x, py, 0), Q2, S.set(arm ? 0.78 : 1, arm ? 0.92 : 1, arm ? 0.8 : 1));
        limbs.setMatrixAt(i * 4 + k, M4b.multiplyMatrices(root, local));
      });
    });
    for (const m of [limbs, torsos, heads, hair]) m.instanceMatrix.needsUpdate = true;
  }
  draw();
  return { walkers, draw, meshes: [limbs, torsos, heads, hair] };
}

// ---------- Knock-over props ----------
function propGeometry(kind) {
  const P = (geo, color) => ({ geo, color });
  if (kind === 'cone') return mergeColoured([
    P(box(0.6, 0.08, 0.6, 0, -0.46, 0), '#e06f2a'),
    P(new THREE.ConeGeometry(0.27, 0.92, 8).translate(0, 0.04, 0), '#f08a3c'),
    P(new THREE.CylinderGeometry(0.135, 0.165, 0.14, 8).translate(0, -0.03, 0), '#f5f1ee'),
  ]);
  if (kind === 'bin') return mergeColoured([
    P(new THREE.CylinderGeometry(0.33, 0.29, 1.0, 10).translate(0, -0.05, 0), '#3f7d5a'),
    P(new THREE.CylinderGeometry(0.36, 0.36, 0.1, 10).translate(0, 0.5, 0), '#2f6447'),
    P(box(0.16, 0.06, 0.06, 0, 0.58, 0), '#2f6447'),
  ]);
  if (kind === 'crate') {
    const parts = [P(box(0.94, 0.94, 0.94), '#c99258')];
    for (const [x, z] of [[-0.43, -0.43], [0.43, -0.43], [-0.43, 0.43], [0.43, 0.43]]) parts.push(P(box(0.12, 0.96, 0.12, x, 0, z), '#9a6537'));
    for (const y of [-0.43, 0.43]) parts.push(P(box(0.96, 0.12, 0.96, 0, y, 0), '#9a6537'));
    parts.push(P(box(0.96, 0.1, 0.96, 0, 0, 0), '#b07a45'));
    return mergeColoured(parts);
  }
  // Fence panel: a striped site barrier on two feet.
  const parts = [];
  for (const x of [-0.85, 0.85]) parts.push(P(box(0.08, 1.0, 0.08, x, -0.05, 0), '#f5f1ee'), P(box(0.18, 0.1, 0.5, x, -0.5, 0), '#3d3537'));
  for (let k = 0; k < 5; k++) parts.push(P(box(0.4, 0.42, 0.07, -0.8 + k * 0.4, 0.2, 0), k % 2 ? '#f5f1ee' : '#cf3d31'));
  return mergeColoured(parts);
}

function buildProps(scene, world) {
  const mat = material({ vertexColors: true });
  const bodies = PROPS.map((p) => {
    const spot = clearSpot(p.x, p.z, p.kind === 'fence' ? 1.1 : PROP_KINDS[p.kind].r, world.colliders, 1, 0, 4);
    return createBody(p.kind, spot.x, spot.z, p.rot ?? 0);
  });
  const meshes = {};
  for (const kind of Object.keys(PROP_KINDS)) {
    const list = bodies.filter((b) => b.kind === kind);
    const mesh = new THREE.InstancedMesh(propGeometry(kind), mat, Math.max(1, list.length));
    mesh.count = list.length;
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.frustumCulled = false; // instances move anywhere once knocked
    mesh.name = `extras:${kind}`;
    meshes[kind] = { mesh, list };
    scene.add(mesh);
  }
  const dirty = new Set(Object.keys(PROP_KINDS));
  const quat = new THREE.Quaternion();
  function draw() {
    for (const kind of dirty) {
      const { mesh, list } = meshes[kind];
      list.forEach((b, i) => {
        quat.set(b.q[0], b.q[1], b.q[2], b.q[3]);
        mesh.setMatrixAt(i, M4.compose(V.set(b.x, b.y, b.z), quat, ONE));
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
    dirty.clear();
  }
  draw();
  return { bodies, meshes, dirty, draw };
}

// ---------- Collectibles ----------
const GOLD = '#f2c14e', GOLD_DARK = '#c99a30', GOLD_LIGHT = '#ffe08a';
function collectibleGeometry(id) {
  const P = (geo, color) => ({ geo, color });
  const rotZ = (g) => g.rotateZ(Math.PI / 2);
  const rotX = (g) => g.rotateX(Math.PI / 2);
  if (id === 'dumbbell') return mergeColoured([
    P(rotZ(new THREE.CylinderGeometry(0.07, 0.07, 1.3, 8)), GOLD_LIGHT),
    ...[-0.42, 0.42].map((x) => P(rotZ(new THREE.CylinderGeometry(0.32, 0.32, 0.2, 10)).translate(x, 0, 0), GOLD)),
    ...[-0.56, 0.56].map((x) => P(rotZ(new THREE.CylinderGeometry(0.24, 0.24, 0.1, 10)).translate(x, 0, 0), GOLD_DARK)),
  ]);
  if (id === 'reel') {
    const parts = [
      P(rotX(new THREE.CylinderGeometry(0.62, 0.62, 0.16, 16)), GOLD),
      P(rotX(new THREE.CylinderGeometry(0.16, 0.16, 0.22, 10)), GOLD_LIGHT),
    ];
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      parts.push(P(rotX(new THREE.CylinderGeometry(0.13, 0.13, 0.2, 8)).translate(Math.cos(a) * 0.36, Math.sin(a) * 0.36, 0), GOLD_DARK));
    }
    parts.push(P(box(0.9, 0.05, 0.12, 0.55, -0.6, 0), GOLD_DARK)); // a tail of film
    return mergeColoured(parts);
  }
  if (id === 'cap') return mergeColoured([
    P(box(1.0, 0.07, 1.0, 0, 0.18, 0, Math.PI / 4), GOLD),
    P(new THREE.CylinderGeometry(0.34, 0.38, 0.32, 10).translate(0, 0, 0), GOLD_DARK),
    P(box(0.1, 0.06, 0.1, 0, 0.24, 0), GOLD_LIGHT),
    P(box(0.04, 0.04, 0.5, 0, 0.24, 0.25), GOLD_LIGHT),
    P(box(0.06, 0.32, 0.06, 0, 0.06, 0.5), GOLD_LIGHT),
  ]);
  // Mini tuk-tuk: three wheels, cab and canopy.
  return mergeColoured([
    P(box(0.7, 0.36, 1.1, 0, -0.08, 0), GOLD),
    P(box(0.78, 0.08, 1.0, 0, 0.46, -0.05), GOLD_DARK),
    ...[[-0.33, 0.12, 0.42], [0.33, 0.12, 0.42], [-0.33, 0.12, -0.5], [0.33, 0.12, -0.5]].map(([x, y, z]) => P(box(0.06, 0.6, 0.06, x, y + 0.04, z), GOLD_DARK)),
    P(box(0.5, 0.26, 0.06, 0, 0.18, 0.47), GOLD_LIGHT),
    ...[[0, -0.3, 0.55], [-0.36, -0.3, -0.38], [0.36, -0.3, -0.38]].map(([x, y, z]) => P(rotZ(new THREE.CylinderGeometry(0.15, 0.15, 0.12, 10)).translate(x, y, z), '#8a6a2a')),
  ]);
}

function haloTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,224,150,0.85)');
  g.addColorStop(0.35, 'rgba(242,193,78,0.35)');
  g.addColorStop(1, 'rgba(224,169,74,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildCollectibles(scene, world, reducedMotion) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: '#e0a94a', emissiveIntensity: 0.32 });
  const items = COLLECTIBLES.map((c) => {
    const spot = c.y < 2 ? clearSpot(c.x, c.z, 1.6, world.colliders, 1, 0, 6) : { x: c.x, z: c.z };
    const mesh = new THREE.Mesh(collectibleGeometry(c.id), mat);
    mesh.position.set(spot.x, c.y, spot.z);
    mesh.rotation.y = reducedMotion ? Math.PI / 5 : 0;
    mesh.castShadow = true;
    mesh.name = `collectible:${c.id}`;
    scene.add(mesh);
    return { ...c, x: spot.x, z: spot.z, mesh };
  });
  const halos = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(2.6, 2.6),
    new THREE.MeshBasicMaterial({ map: haloTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true }),
    items.length,
  );
  halos.frustumCulled = false;
  halos.renderOrder = 2;
  scene.add(halos);
  let hidden = new Set();
  return {
    items, halos,
    refreshHalos(found) { hidden = new Set(found); },
    animate(t, camera) {
      mat.emissiveIntensity = reducedMotion ? 0.32 : 0.28 + Math.sin(t * 2.2) * 0.1;
      items.forEach((c, i) => {
        if (!reducedMotion) {
          c.mesh.rotation.y = t * 1.5 + i;
          c.mesh.position.y = c.y + Math.sin(t * 1.8 + i) * 0.14;
        }
        const scale = hidden.has(c.id) ? 0 : 1;
        halos.setMatrixAt(i, M4.compose(V.set(c.x, c.mesh.position.y, c.z), camera.quaternion, S.setScalar(scale)));
      });
      halos.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---------- Celebration ----------
function buildConfetti(scene) {
  const N = 160;
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.16, 0.09), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), N);
  const shades = ['#E0A94A', '#f2c14e', '#ffd98a', '#c9862f', '#F5F1EE'].map((c) => new THREE.Color(c));
  for (let i = 0; i < N; i++) mesh.setColorAt(i, shades[i % shades.length]);
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  const bits = Array.from({ length: N }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), axis: new THREE.Vector3(), spin: 0, a: 0, phase: 0 }));
  let life = 0;
  return {
    mesh,
    get active() { return mesh.visible; },
    burst(x, y, z) {
      for (const b of bits) {
        const a = Math.random() * Math.PI * 2, up = 0.6 + Math.random() * 0.4, sp = 4 + Math.random() * 4;
        b.p.set(x, y, z);
        b.v.set(Math.cos(a) * sp * (1 - up * 0.7), sp * up + 4, Math.sin(a) * sp * (1 - up * 0.7));
        b.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        b.spin = 6 + Math.random() * 10; b.a = Math.random() * 6; b.phase = Math.random() * 6;
      }
      life = 4.2;
      mesh.visible = true;
    },
    update(dt) {
      if (!mesh.visible) return;
      life -= dt;
      if (life <= 0) { mesh.visible = false; return; }
      const drag = Math.exp(-1.8 * dt);
      const shrink = Math.min(1, life / 0.8);
      bits.forEach((b, i) => {
        b.v.y -= 9 * dt;
        b.v.multiplyScalar(drag);
        b.p.addScaledVector(b.v, dt);
        b.p.x += Math.sin(life * 7 + b.phase) * 0.6 * dt; // flutter
        if (b.p.y < 0.05) { b.p.y = 0.05; b.v.set(0, 0, 0); }
        b.a += b.spin * dt;
        mesh.setMatrixAt(i, M4.compose(b.p, Q.setFromAxisAngle(b.axis, b.a), S.setScalar(shrink)));
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
