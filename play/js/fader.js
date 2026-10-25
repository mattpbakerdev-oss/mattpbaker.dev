// Fades whatever hides the car from the chase camera, and brings it back once the view is clear.
// Buildings are one merged mesh each (models.js), so a faded building gets its own see-through
// copy of its materials until it is solid again. Trees are instanced, so a faded tree's
// instances are hidden and a one-off see-through stand-in is drawn in their place.
// Opacity easing lives in camrig.js (fadeStep).
import * as THREE from 'three';
import { fadeStep, FADE_OPACITY, FADE_INSIDE } from './camrig.js';
import { pointInside } from './occlusion.js';

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export function createFader(scene, world) {
  const live = new Map(); // key -> { opacity, materials, restore() }
  const seen = new Map(); // key -> opacity to fade to this frame

  function ghost(material) {
    const m = material.clone();
    m.onBeforeCompile = material.onBeforeCompile; // models.js tints the shady sides this way
    m.transparent = true;
    m.depthWrite = false;
    return m;
  }

  function startBuilding(id) {
    const obj = scene.getObjectByName(`place:${id}`);
    if (!obj) return null;
    const swaps = [];
    obj.traverse((o) => { if (o.isMesh) swaps.push([o, o.material, ghost(o.material)]); });
    for (const [o, , g] of swaps) o.material = g;
    return {
      materials: swaps.map((s) => s[2]),
      restore() { for (const [o, orig, g] of swaps) { o.material = orig; g.dispose(); } },
    };
  }

  function startTree(index) {
    const parts = world.trees?.[index];
    if (!parts) return null;
    const stand = [];
    for (const { mesh, index: i } of parts) {
      const matrix = new THREE.Matrix4();
      mesh.getMatrixAt(i, matrix);
      const mat = ghost(mesh.material);
      if (mesh.instanceColor) { const c = new THREE.Color(); mesh.getColorAt(i, c); mat.color.multiply(c); }
      const one = new THREE.Mesh(mesh.geometry, mat);
      one.matrixAutoUpdate = false;
      one.matrix.copy(matrix);
      one.castShadow = mesh.castShadow;
      scene.add(one);
      mesh.setMatrixAt(i, HIDDEN);
      mesh.instanceMatrix.needsUpdate = true;
      stand.push({ mesh, i, matrix, one });
    }
    return {
      materials: stand.map((s) => s.one.material),
      restore() {
        for (const { mesh, i, matrix, one } of stand) {
          mesh.setMatrixAt(i, matrix);
          mesh.instanceMatrix.needsUpdate = true;
          scene.remove(one);
          one.material.dispose();
        }
      },
    };
  }

  return {
    /** `blocking`: occluder shapes (with `key`) hiding the car this frame; `eye`: camera position. */
    update(dt, blocking, eye) {
      seen.clear();
      for (const s of blocking) {
        if (!s.key) continue;
        seen.set(s.key, s.kind === 'building' && pointInside(eye.x, eye.z, s) ? FADE_INSIDE : FADE_OPACITY);
        if (live.has(s.key)) continue;
        const [kind, ref] = [s.key[0], s.key.slice(2)];
        const state = kind === 'b' ? startBuilding(ref) : startTree(Number(ref));
        if (state) live.set(s.key, { opacity: 1, ...state });
      }
      for (const [key, f] of live) {
        f.opacity = fadeStep(f.opacity, seen.has(key), dt, seen.get(key));
        if (f.opacity >= 1) { f.restore(); live.delete(key); continue; }
        for (const m of f.materials) m.opacity = f.opacity;
      }
    },
    /** For checks: the keys currently faded and their opacity. */
    get faded() { return Object.fromEntries([...live].map(([k, f]) => [k, +f.opacity.toFixed(2)])); },
  };
}
