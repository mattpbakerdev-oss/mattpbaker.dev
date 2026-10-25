// Amber markers, like Hit & Run's mission markers: a glowing ring on the ground outside each
// door and a floating gem above it. Both are instanced, so all places cost two draw calls.
// Visited places dim; the place the car is in brightens. Static under reduced motion. A gem
// shrinks away when the camera comes within about 4 units, so the lens never sits inside one.
import * as THREE from 'three';
import { RING_RADIUS, ringCentre } from './places.js';
import { gemScale } from './camrig.js';

const AMBER = '#E0A94A';
const ICON_HEIGHT = 4.1; // just above the door

function ringTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  const band = RING_RADIUS / (RING_RADIUS + 0.9); // where the bright band sits, 0..1
  g.addColorStop(0, 'rgba(224,169,74,0.10)');
  g.addColorStop(band - 0.16, 'rgba(224,169,74,0.16)');
  g.addColorStop(band - 0.05, 'rgba(255,214,140,0.75)');
  g.addColorStop(band - 0.015, 'rgba(255,236,190,1)');
  g.addColorStop(band + 0.02, 'rgba(240,186,92,0.85)');
  g.addColorStop(band + 0.1, 'rgba(224,169,74,0.22)');
  g.addColorStop(1, 'rgba(224,169,74,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createMarkers(scene, places, { reducedMotion = false } = {}) {
  const n = places.length;
  const size = (RING_RADIUS + 0.9) * 2;
  const ringMat = new THREE.MeshBasicMaterial({ map: ringTexture(), transparent: true, depthWrite: false });
  const rings = new THREE.InstancedMesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), ringMat, n);
  rings.renderOrder = 1;

  const gem = new THREE.OctahedronGeometry(0.62, 0).scale(0.8, 1.35, 0.8);
  const iconMat = new THREE.MeshLambertMaterial({ color: AMBER, emissive: AMBER, emissiveIntensity: 0.6, flatShading: true });
  const icons = new THREE.InstancedMesh(gem, iconMat, n);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3(), scale = new THREE.Vector3();
  const spots = places.map((p) => {
    const [rx, rz] = ringCentre(p);
    const out = p.footprint[1] / 2 + 1.2; // just in front of the door
    return { rx, rz, ix: p.position[0] + Math.sin(p.rotation) * out, iz: p.position[1] + Math.cos(p.rotation) * out, phase: p.position[0] * 0.13, size: 1 };
  });
  spots.forEach((s, i) => {
    rings.setMatrixAt(i, m.compose(pos.set(s.rx, 0.09, s.rz), q.identity(), one));
    rings.setColorAt(i, new THREE.Color(1, 1, 1));
    icons.setColorAt(i, new THREE.Color(1, 1, 1));
  });
  scene.add(rings, icons);

  const colour = new THREE.Color();
  let t = 0;
  return {
    rings, icons,
    /** activeId: the place the car is in (or null). visited: Set of ids. camera: to fade gems near the lens. */
    update(dt, activeId, visited, camera = null) {
      if (!reducedMotion) t += dt;
      ringMat.opacity = reducedMotion ? 0.95 : 0.82 + Math.sin(t * 2.4) * 0.16;
      spots.forEach((s, i) => {
        const id = places[i].id;
        const active = id === activeId;
        const k = active ? 1.35 : visited.has(id) ? 0.5 : 1;
        rings.setColorAt(i, colour.setScalar(k));
        icons.setColorAt(i, colour.setScalar(visited.has(id) && !active ? 0.6 : 1));
        const bob = reducedMotion ? 0 : Math.sin(t * 2 + s.phase) * 0.28;
        q.setFromAxisAngle(up, reducedMotion ? Math.PI / 4 : t * 1.4 + s.phase);
        pos.set(s.ix, ICON_HEIGHT + bob, s.iz);
        const want = camera ? gemScale(camera.position.distanceTo(pos)) : 1;
        s.size = !dt || reducedMotion ? want : s.size + (want - s.size) * (1 - Math.exp(-12 * dt));
        icons.setMatrixAt(i, m.compose(pos, q, scale.setScalar((active ? 1.2 : 1) * s.size)));
      });
      rings.instanceColor.needsUpdate = true;
      icons.instanceColor.needsUpdate = true;
      icons.instanceMatrix.needsUpdate = true;
    },
  };
}
