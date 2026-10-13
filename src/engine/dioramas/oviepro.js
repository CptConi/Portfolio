// OVIEPRO — sick-leave documents workflow, several profiles. A stack of sheets on a
// slanted tray gets stamped (ring + check mark pops in) while a marker hops between
// three profile pawns, one stamp per profile.
import * as THREE from 'three';
import { G, ORANGE, TAU, pulse, smooth, wrap } from './kit.js';

const PAPER = 0xc6cbd6, PAPER_D = 0xaab1c0, INK = 0x6b7385;
const TEAL = 0x1fb6a6, RED = 0xe5384f, GREEN = 0x2bff88;
const SLATE = 0x2c3340, RUBBER = 0x5a1f2e, STAMP = 0x2a2f3d, KNOB = 0xb86b3a, KNOB_L = 0xd88a52;
const PAWNS = [0x3b82f6, 0x22c55e, 0xf59e0b];
const PAWN_X = [-8, 0, 8];

const TILT = 0.8;
const T = 3;                       // one stamp per profile
const HOME = { x: 3.4, z: 2 };     // stamp target on the top sheet (tray frame)
const TOP = 6.3;                   // top of the sheet stack (tray frame)
const LIFT = 8;                    // how high the stamp idles above the sheet

export function build(kit) {
  const b = kit.main;
  kit.base(b);

  // easel legs
  for (const x of [-6.5, 6.5]) {
    b.box(x, G, -9.2, 1.6, 19, 1.6, SLATE);
    b.box(x, G, 7.2, 1.6, 2.2, 1.6, SLATE);
  }

  // slanted tray
  const desk = new THREE.Group();
  desk.position.set(0, G + 11.3, -1);
  desk.rotation.x = TILT;
  kit.root.add(desk);
  const d = kit.batch(desk);
  d.box(0, -0.7, 0, 18.4, 1.4, 23.4, SLATE);
  for (let i = 0; i < 6; i++) {
    const ox = ((i * 37) % 5 - 2) * 0.35, oz = ((i * 53) % 5 - 2) * 0.3;
    d.box(ox, 0.7 + i * 0.95, oz, 16.4, 0.85, 21.4, i % 2 ? PAPER_D : PAPER, { ry: ((i * 29) % 7 - 3) * 0.012 });
  }
  const ink = TOP + 0.02;
  d.box(0, ink, -8.2, 12, 0.12, 1.8, TEAL);
  d.box(-5.2, ink, -3.2, 3.6, 0.12, 1.1, RED);
  d.box(-5.2, ink, -3.2, 1.1, 0.12, 3.6, RED);
  [[-5.4, -2.4, 7.4], [-3.4, -2.4, 6.4], [0, -7.2, -1.6], [2, -7.2, -1.6], [4, -7.2, -2.4], [7.2, -7.2, 7.4], [9, -7.2, 5.2]]
    .forEach(([z, x0, x1]) => d.box((x0 + x1) / 2, ink, z, x1 - x0, 0.12, 0.7, INK));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    d.box(HOME.x + sx * 3.5, ink, HOME.z + sz * 3.5, 1.6, 0.1, 0.35, INK);
    d.box(HOME.x + sx * 4.2, ink, HOME.z + sz * 3.5, 0.35, 0.1, 1.6, INK);
  }

  // stamp
  const stamp = new THREE.Group();
  desk.add(stamp);
  const sb = kit.batch(stamp);
  sb.cyl(0, 0, 0, 3.4, 3.4, 1.2, RUBBER, 12);
  sb.cyl(0, 1.2, 0, 3, 3, 1.6, STAMP, 12);
  sb.cyl(0, 2.8, 0, 1.1, 1.1, 4, KNOB, 8);
  sb.cyl(0, 6.8, 0, 2.2, 2.2, 2.2, KNOB_L, 10);
  sb.cyl(0, 9, 0, 1.4, 1.4, 0.6, KNOB, 10);

  // mark: ring + check, pops in under the stamp
  const mark = new THREE.Group();
  mark.position.set(HOME.x, TOP + 0.05, HOME.z);
  desk.add(mark);
  const ring = new THREE.Mesh(kit.geo('ring'), kit.own(GREEN, { side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.scale.setScalar(3.4);
  mark.add(ring);
  const cb = kit.batch(mark);
  cb.beam(-1.6, 0.25, 0, -0.5, 0.25, 1.3, 0.55, GREEN);
  cb.beam(-0.5, 0.25, 1.3, 1.8, 0.25, -1.4, 0.55, GREEN);
  const flash = kit.glow(GREEN, 11, 0, desk);
  flash.position.set(HOME.x, TOP + 1.5, HOME.z);

  // profile pawns + hopping marker
  const pb = kit.batch(null);
  pb.cyl(0, 0, 0, 1.9, 1.9, 0.8, 0xffffff, 10);
  pb.cyl(0, 0.8, 0, 0.9, 1.5, 3.6, 0xffffff, 10);
  pb.box(0, 4.4, 0, 2.6, 2.4, 2.6, 0xffffff);
  const pawnGeo = kit.geometryOf(pb);
  const pawns = PAWNS.map((c, i) => {
    const m = kit.mesh(pawnGeo, c);
    m.position.set(PAWN_X[i], G, 14.5);
    return m;
  });
  const marker = kit.part(2.2, 2.2, 2.2, ORANGE);
  marker.rotation.set(0.6, 0.785, 0.6);

  return {
    staticT: 1.5,
    pose(t) {
      const s = wrap(t, T);
      const k = Math.floor(t / T) % 3;
      const prev = (k + 2) % 3;

      // stamp: idle high → drop → press → rise
      const drop = smooth(0.5, 0.95, s) * (1 - smooth(1.1, 1.7, s));
      const lift = 1 - drop * drop;
      stamp.position.set(HOME.x, TOP + 0.05 + LIFT * lift, HOME.z);
      stamp.scale.y = 1 - 0.1 * pulse(s, 1.02, 0.12);

      // mark pops in on contact, goes away before the next stamp
      const appear = smooth(0.95, 1.05, s) * (1 + 0.25 * pulse(s, 1.1, 0.18));
      const gone = 1 - smooth(2.7, 2.95, s);
      mark.scale.setScalar(Math.max(0.001, appear * gone));
      mark.visible = appear > 0.01 && gone > 0.01;
      flash.material.opacity = 0.8 * pulse(s, 1.02, 0.22);

      // marker follows the active profile
      const mx = PAWN_X[prev] + (PAWN_X[k] - PAWN_X[prev]) * smooth(0, 0.45, s);
      marker.position.set(mx, G + 10.8 + 0.8 * Math.sin(t * 6), 14.5);
      marker.rotation.y = wrap(t * 1.5, TAU);
      for (let i = 0; i < 3; i++) pawns[i].position.y = G + (i === k ? 1.6 * pulse(s, 1.15, 0.35) : 0);
    },
  };
}
