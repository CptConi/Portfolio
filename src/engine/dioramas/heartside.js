// HEARTSIDE — an immersive VR experience, plus a mobile app and microservices. A
// headset (its lenses show a synthwave sunset) hovers above a pedestal; a pixel
// heart beats above it (lub-dub), a ripple leaves with every beat, and three small
// satellites (two services and a phone) orbit around.
import * as THREE from 'three';
import { G, ORANGE, TAU, frac, pulse, wrap } from './kit.js';

const BODY = 0x1c1d2b, BODY_L = 0x2c2e44, FOAM = 0x0e0e16, STRAP = 0x3a3d52, SLATE = 0x2a2a3a;
const HEART = 0xff2f5f, HEART_L = 0xff8fa8;
const SUN = 0xff3d8b, SKY = 0x2ee6ff, HORIZON = 0x14122a;
const VIOLET = 0xb066ff, CYAN = 0x37c0ff, PHONE = 0xe9eefc;

const HS_Y = G + 13;
const HEART_Y = G + 26.5;
const BEAT = 0.9;
const HEART_ROWS = ['.XX.XX.', 'XHXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];

export function build(kit) {
  const b = kit.main;
  kit.base(b);

  // pedestal + tractor beam
  b.cyl(0, G, 0, 4.6, 5.2, 1.6, SLATE, 10);
  b.cyl(0, G + 1.6, 0, 3.6, 3.6, 0.5, ORANGE, 10);
  const beam = kit.part(1, 5.4, 1, CYAN, kit.root, { transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending });
  beam.position.y = G + 4.8;

  // headset, lenses facing the viewer
  const hs = new THREE.Group();
  hs.position.y = HS_Y;
  kit.root.add(hs);
  const h = kit.batch(hs);
  h.box(0, -5.5, 0, 22, 11, 11, BODY);
  h.box(0, 5.5, 5.2, 22.4, 0.5, 1, ORANGE);
  h.box(0, -4.6, 6.4, 20, 9.2, 1.8, FOAM);
  h.box(0, -3.4, 7.7, 1.6, 6.8, 0.5, FOAM);
  for (const x of [-5.2, 5.2]) {
    h.box(x, -3.8, 7.4, 8.8, 7.6, 0.6, BODY_L);
    h.box(x, -3.1, 7.9, 6.8, 2.9, 0.3, SKY);
    h.box(x, 0.2, 7.9, 6.8, 3.1, 0.3, SUN);
    h.box(x, -0.2, 7.95, 6.8, 0.4, 0.3, HORIZON);
  }
  for (const s of [-1, 1]) h.box(s * 11.6, -3.4, -4.5, 1.4, 6.8, 9, STRAP);
  h.box(0, 5.9, -3, 3.4, 1, 13, STRAP);
  const lensGlow = kit.glow(SKY, 18, 0.2, hs);
  lensGlow.position.set(0, -0.6, 8);

  // the heart
  const heart = new THREE.Group();
  heart.position.y = HEART_Y;
  kit.root.add(heart);
  kit.batch(heart).voxels(HEART_ROWS, 0, -6.3, 0, 2.1, 3.4, { X: HEART, H: HEART_L });
  const heartGlow = kit.glow(0xff2a6d, 14, 0.25);
  heartGlow.position.y = HEART_Y;
  const ripple = kit.glow(0xff5c8a, 24, 0, kit.root, 'ring');
  ripple.position.y = HS_Y;

  // satellites: two services and a phone
  const sats = [kit.part(2.8, 2.8, 2.8, VIOLET), kit.part(2.8, 2.8, 2.8, CYAN), kit.part(3, 5.4, 0.9, PHONE)];

  return {
    staticT: 0.5,
    pose(t) {
      const p = wrap(t, BEAT) / BEAT;
      const bump = pulse(p, 0.08, 0.1) + 0.65 * pulse(p, 0.27, 0.1);
      const s = 1 + 0.18 * bump;

      heart.scale.setScalar(s);
      heart.rotation.y = 0.3 * Math.sin(t * 0.8);
      heartGlow.material.opacity = 0.18 + 0.5 * bump;
      heartGlow.scale.setScalar(14 + 3 * bump);
      beam.material.opacity = 0.25 + 0.3 * bump;

      const q = frac((t - 0.05) / BEAT);
      ripple.scale.setScalar(8 + 16 * q);
      ripple.material.opacity = 0.6 * (1 - q) * (1 - q);

      hs.position.y = HS_Y + 0.7 * Math.sin(t * 1.4);
      hs.rotation.set(0.04 * Math.sin(t * 0.9), 0.3 * Math.sin(t * 0.6), 0.04 * Math.sin(t * 1.1));
      lensGlow.material.opacity = 0.16 + 0.08 * bump;

      for (let i = 0; i < 3; i++) {
        const a = t * 0.9 + i * TAU / 3;
        const m = sats[i];
        m.position.set(15.5 * Math.cos(a), HS_Y - 3 + 4 * Math.sin(a), 13 * Math.sin(a));
        m.rotation.set(wrap(a * 0.8, TAU), wrap(a * 1.3, TAU), i * 0.4);
      }
    },
  };
}
