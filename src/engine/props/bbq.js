import * as THREE from 'three';
import { xf, flipped } from './kit.js';

// Barrel barbecue: a red oil-drum kettle on three legs, lid propped open behind it, a grate with
// three sausages over a heap of glowing coals, orange vents on the front. Everything that glows
// is unlit (Basic) so it blooms; the lounge animates the flicker and the smoke.
//
// Local frame: origin on the floor under the drum, the front (vents) faces +z.

const BBQ = { r: 0.19, legH: 0.12, bodyH: 0.2 };
const TOP = BBQ.legH + BBQ.bodyH;          // rim height, 0.32
const BBQ_TOP = TOP + 0.014;
export const COAL_TEX = { w: 32, h: 32 };

const RED = 0x9b3a2b, STEEL = 0x24262b, SOOT = 0x1c1210;

// Coal bed: charcoal with orange / yellow cracks and a few white-hot specks.
export function paintCoals(p) {
  p.rect(0, 0, p.w, p.h, 0xd8561a);
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 120; i++) {
    const x = Math.floor(rnd() * p.w), y = Math.floor(rnd() * p.h), r = rnd();
    p.rect(x, y, 1 + (r > 0.6 ? 1 : 0), 1 + (r > 0.8 ? 1 : 0), r < 0.25 ? 0x5a1a08 : r < 0.7 ? 0xff7a22 : 0xffc24a);
  }
  for (let i = 0; i < 14; i++) p.set(Math.floor(rnd() * p.w), Math.floor(rnd() * p.h), 0xfff1b0);
}

// Soft smoke puff, three alpha steps so it keeps the pixel look.
export function paintPuff(p) {
  const r = p.w / 2;
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      const d = Math.hypot(x + 0.5 - r, y + 0.5 - r) / r;
      const n = Math.sin(x * 1.7) * Math.cos(y * 2.3) * 0.1 + Math.sin((x + y) * 0.9) * 0.06;
      const k = d + n;
      const a = k < 0.45 ? 255 : k < 0.7 ? 150 : k < 0.92 ? 60 : 0;
      if (a) p.set(x, y, 0xffffff, a);
    }
  }
}

// Adds the drum, legs, lid, grate and food to `L.solid`, the coals and vents to `L.embers`.
//   at   { x, y, z } floor point under the drum        yaw  front direction (rotation about y)
export function addBbq(L, { at, yaw, coalUV }) {
  const { solid, embers } = L;
  const place = xf({ pos: [at.x, at.y, at.z], rot: [0, yaw, 0] });
  solid.push(place);
  embers.push(place);

  // Legs: three splayed rods from the bowl to the floor, plus an ash pan between them.
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI;     // one leg straight behind
    const top = new THREE.Vector3(Math.sin(a) * 0.13, BBQ.legH + 0.01, Math.cos(a) * 0.13);
    const foot = new THREE.Vector3(Math.sin(a) * 0.2, 0, Math.cos(a) * 0.2);
    const len = top.distanceTo(foot);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(foot).normalize());
    solid.add(new THREE.CylinderGeometry(0.0105, 0.0105, len, 6).translate(0, len / 2, 0), {
      matrix: new THREE.Matrix4().compose(foot, q, new THREE.Vector3(1, 1, 1)), color: STEEL });
  }
  solid.cyl(0.165, 0.165, 0.008, 14, { pos: [0, 0.052, 0], color: STEEL });

  // Drum: open shell + bottom, three hoops and a rim; the inside of the shell is soot-dark.
  const shell = new THREE.CylinderGeometry(BBQ.r, BBQ.r * 0.96, BBQ.bodyH, 20, 1, true).translate(0, BBQ.bodyH / 2, 0);
  solid.add(shell, { matrix: xf({ pos: [0, BBQ.legH, 0] }), color: RED });
  solid.add(flipped(shell), { matrix: xf({ pos: [0, BBQ.legH, 0] }), color: SOOT });
  for (const y of [0.025, 0.1, 0.19]) solid.cyl(BBQ.r + 0.004, BBQ.r + 0.004, 0.012, 20, { pos: [0, BBQ.legH + y, 0], color: 0x2a2523, open: true });
  solid.add(new THREE.CylinderGeometry(BBQ.r + 0.008, BBQ.r + 0.008, 0.014, 20, 1, true).translate(0, 0.007, 0),
    { matrix: xf({ pos: [0, TOP, 0] }), color: 0x1d1a19 });
  solid.add(new THREE.RingGeometry(BBQ.r - 0.004, BBQ.r + 0.008, 20).rotateX(-Math.PI / 2),
    { matrix: xf({ pos: [0, TOP + 0.014, 0] }), color: 0x1d1a19 });

  // Side handles.
  for (const sx of [-1, 1]) {
    solid.box(0.1, 0.014, 0.014, { pos: [sx * 0.245, TOP - 0.03, 0], rot: [0, Math.PI / 2, 0], color: 0x6a4426 });
    solid.box(0.04, 0.012, 0.012, { pos: [sx * 0.21, TOP - 0.03, 0], color: 0x24262b });
  }

  // Coals: a low glowing heap peeking over the rim (unlit, flickers).
  const heap = new THREE.SphereGeometry(BBQ.r - 0.012, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  embers.add(heap, { matrix: xf({ pos: [0, TOP - 0.03, 0], scale: [1, 0.3, 1] }), uv: coalUV, color: new THREE.Color().setRGB(1.5, 1.4, 1.3) });

  // Grate bars across the rim (each as long as the chord it spans), three sausages on top.
  const rimR = BBQ.r + 0.004;
  for (let k = -3; k <= 3; k++) {
    const z = k * 0.052, chord = 2 * Math.sqrt(rimR * rimR - z * z);
    solid.box(chord, 0.007, 0.007, { pos: [0, BBQ_TOP + 0.002, z], color: 0x1c1d21 });
  }
  [[-0.085, 0.03, 0.12, 0xa5482a], [0.0, -0.045, -0.2, 0x7d3018], [0.085, 0.055, 0.06, 0xa5482a]].forEach(([x, z, a, c]) => {
    solid.add(new THREE.CapsuleGeometry(0.0105, 0.085, 3, 6).rotateX(Math.PI / 2), { matrix: xf({ pos: [x, BBQ_TOP + 0.0145, z], rot: [0, a, 0] }), color: c });
  });

  // Vents: three glowing slits on the front of the drum, each in a dark frame.
  const onDrum = (a, r) => ({ matrix: xf({ pos: [Math.sin(a) * r, BBQ.legH + 0.075, Math.cos(a) * r], rot: [0, a, 0] }) });
  for (const a of [-0.55, 0, 0.55]) {
    solid.add(new THREE.PlaneGeometry(0.034, 0.1), { ...onDrum(a, BBQ.r + 0.001), color: 0x120c0a });
    embers.add(new THREE.PlaneGeometry(0.014, 0.08), { ...onDrum(a, BBQ.r + 0.0015), color: 0xff8a2a });
  }

  // Lid: a shallow dome hinged on the back rim, propped open past vertical; we see its sooty
  // inside, edged with a steel ring.
  const lidR = BBQ.r + 0.006;
  const dome = new THREE.SphereGeometry(lidR, 16, 7, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.42, 1);
  const lid = xf({ pos: [0, TOP + 0.014, -lidR] }).multiply(xf({ rot: [-1.78, 0, 0] })).multiply(xf({ pos: [0, 0, lidR] }));
  solid.add(dome, { matrix: lid, color: RED });
  solid.add(flipped(dome), { matrix: lid, color: SOOT });
  solid.add(new THREE.TorusGeometry(lidR, 0.0075, 5, 20).rotateX(Math.PI / 2), { matrix: lid, color: 0x9aa0ab });
  solid.add(new THREE.CylinderGeometry(0.011, 0.011, 0.034, 6).translate(0, lidR * 0.42 + 0.014, 0), { matrix: lid, color: STEEL });

  solid.pop();
  embers.pop();
}

// ── Animation: flickering coals, a glow halo, four rising smoke puffs ────────────────────────
const frac = x => x - Math.floor(x);
const smooth = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
const flicker = t => Math.min(1.05, Math.max(0.78, 0.9 + 0.08 * Math.sin(t * 9.3) + 0.05 * Math.sin(t * 23.1 + 1.3) + 0.03 * Math.sin(t * 41)));

const PUFFS = 4, PUFF_PERIOD = 5.4, SMOKE_RISE = 0.95;
const _warm = new THREE.Color(0xd9a070), _cool = new THREE.Color(0x8d8d9c);

// `at` = floor point under the drum. Returns { group, update(t, calm) } with sprites in world space.
// `calm` (reduced motion): no smoke, steady coals.
export function createBbqFx(at, { puffMap, glowMap, embersMaterial }) {
  const group = new THREE.Group();
  const y0 = at.y + BBQ_TOP + 0.05;

  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, color: 0xff7a2a, transparent: true, opacity: 0.4,
    blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.set(0.5, 0.5, 1);
  halo.position.set(at.x, at.y + BBQ_TOP + 0.03, at.z);
  group.add(halo);

  const puffs = [];
  for (let i = 0; i < PUFFS; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffMap, transparent: true, opacity: 0, depthWrite: false }));
    s.center.set(0.5, 0.5);
    group.add(s);
    puffs.push(s);
  }

  return {
    group,
    update(t, calm) {
      const f = calm ? 0.92 : flicker(t);
      embersMaterial.color.setScalar(f);
      halo.material.opacity = 0.14 + 0.3 * f;
      for (let i = 0; i < PUFFS; i++) {
        const s = puffs[i];
        s.visible = !calm;
        if (calm) continue;
        const u = frac(t / PUFF_PERIOD + i / PUFFS);
        const size = 0.09 + 0.3 * Math.pow(u, 0.75);
        s.scale.set(size, size, 1);
        s.position.set(
          at.x - 0.11 * u + Math.sin(t * 0.9 + i * 1.9) * 0.025 * u,
          y0 + SMOKE_RISE * u,
          at.z + 0.05 * u + Math.cos(t * 0.7 + i * 2.3) * 0.02 * u);
        s.material.opacity = 0.42 * smooth(0, 0.12, u) * (1 - smooth(0.4, 1, u));
        s.material.color.copy(_warm).lerp(_cool, smooth(0, 0.5, u));
      }
    },
    dispose() {
      for (const s of puffs) s.material.dispose();
      halo.material.dispose();
    },
  };
}
