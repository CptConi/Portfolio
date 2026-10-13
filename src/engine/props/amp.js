import * as THREE from 'three';
import { xf } from './kit.js';

// A guitar half-stack: speaker cabinet (grille cloth) under an amp head (brushed gold panel,
// eight knobs, a standby LED). Both fronts are painted pixel-art quads on a tolex-black body,
// 5 mm per pixel; the LED halo is added by the lounge (additive sprite).

export const AMP = { w: 0.56, cabH: 0.36, cabD: 0.26, headH: 0.15, headD: 0.22, headBack: 0.02 };
export const HEAD_TEX = { w: 112, h: 30 };
export const CAB_TEX = { w: 112, h: 72 };

const GOLD = 0xc8a14c, GOLD_DARK = 0xa98332, TOLEX = 0x0f0f12;

export function paintHead(p) {
  p.rect(0, 0, p.w, p.h, GOLD);
  for (let y = 2; y < p.h - 2; y += 3) p.rect(0, y, p.w, 1, 0xb98f3a);       // brushed metal
  p.rect(0, 0, p.w, 1, TOLEX).rect(0, p.h - 2, p.w, 2, TOLEX);
  p.rect(0, 1, p.w, 1, 0xe3c46d);

  // Script logo (a wavy white stroke) on the left.
  const logo = [[6, 11], [8, 7], [10, 12], [12, 7], [14, 12], [16, 8], [18, 12], [21, 9], [24, 12]];
  for (let i = 1; i < logo.length; i++) p.line(logo[i - 1][0], logo[i - 1][1], logo[i][0], logo[i][1], 0xf6f1e4);
  p.rect(6, 15, 19, 1, 0xf6f1e4);

  // Eight knobs with a pointer each.
  for (let k = 0; k < 8; k++) {
    const cx = 37 + k * 8.4, cy = 14;
    p.disc(cx, cy, 3.1, 0x2a2214).disc(cx, cy, 2.5, 0x14100c);
    const a = -2.3 + k * 0.62;
    p.set(Math.round(cx + Math.sin(a) * 1.8 - 0.5), Math.round(cy - Math.cos(a) * 1.8 - 0.5), 0xf1ead6);
  }
  // Inputs, power switch and the standby LED.
  p.rect(5, 19, 4, 4, 0x1c1a17).rect(6, 20, 2, 2, 0x050505).rect(12, 19, 4, 4, 0x1c1a17).rect(13, 20, 2, 2, 0x050505);
  p.rect(98, 17, 8, 5, 0x1c1a17).rect(100, 18, 4, 3, 0xcfd3dc);
  p.rect(104, 6, 5, 5, 0x3a1010).rect(105, 7, 3, 3, 0xff3b2a);
}

export function paintCab(p) {
  p.rect(0, 0, p.w, p.h, TOLEX);
  p.rect(3, 3, p.w - 6, p.h - 6, 0x1b1710);
  for (let y = 3; y < p.h - 3; y++) {
    for (let x = 3; x < p.w - 3; x++) {
      if ((x + y) % 2 === 0) p.set(x, y, 0x262015);
      if (x % 8 === 3 || y % 8 === 3) p.set(x, y, 0x2c2619);
    }
  }
  p.frame(2, 2, p.w - 4, p.h - 4, GOLD_DARK);
  p.rect(p.w - 22, p.h - 11, 16, 5, GOLD);
  p.rect(p.w - 20, p.h - 9, 12, 1, 0x6b5320);
  p.rect(p.w - 20, p.h - 7, 8, 1, 0x6b5320);
}

// Adds the stack to `L.solid`. `rects` = { head, cab } atlas regions. Returns the LED position.
//   at  { x, y, z }  world position of the middle of the cabinet's base, on the floor
export function addAmp(L, { rects, at, yaw = 0 }) {
  const { solid, bright, atlas } = L;
  const { w, cabH, cabD, headH, headD, headBack } = AMP;
  const place = xf({ pos: [at.x, at.y, at.z], rot: [0, yaw, 0] });
  solid.push(place);

  solid.box(w, cabH, cabD, { pos: [0, cabH / 2 + 0.012, 0], color: TOLEX });
  for (const sx of [-1, 1]) solid.box(0.04, 0.012, 0.04, { pos: [sx * (w / 2 - 0.04), 0.006, cabD / 2 - 0.04], color: 0x050505 });
  const headY = 0.012 + cabH;
  solid.box(w, headH, headD, { pos: [0, headY + headH / 2, -headBack], color: TOLEX });

  const cabFront = cabD / 2 + 0.0015;
  solid.quad(w - 0.004, cabH - 0.004, { pos: [0, cabH / 2 + 0.012, cabFront], uv: atlas.uv(rects.cab, 0.02) });
  const headFront = headD / 2 - headBack + 0.0015;
  solid.quad(w - 0.004, headH - 0.004, { pos: [0, headY + headH / 2, headFront], uv: atlas.uv(rects.head, 0.02) });

  // Metal corner caps on the cabinet.
  for (const sx of [-1, 1]) for (const sy of [0, 1]) {
    solid.box(0.026, 0.026, 0.026, { pos: [sx * (w / 2 - 0.006), 0.026 + sy * (cabH - 0.026), cabD / 2 - 0.006], color: 0xaeb2bd });
  }
  // Carrying handle, side-on, above the head.
  solid.box(0.14, 0.012, 0.012, { pos: [0, headY + headH + 0.018, -headBack], color: 0x060606 });
  for (const sx of [-1, 1]) solid.box(0.012, 0.018, 0.012, { pos: [sx * 0.07, headY + headH + 0.009, -headBack], color: 0x060606 });

  solid.pop();

  // LED centre: pixel (106.5, 8.5) of the head panel; an unlit chip over the painted one.
  const led = new THREE.Vector3(
    ((106.5 - HEAD_TEX.w / 2) / HEAD_TEX.w) * w,
    headY + headH - (8.5 / HEAD_TEX.h) * headH,
    headFront + 0.002,
  );
  bright.push(place);
  bright.quad(0.014, 0.014, { pos: [led.x, led.y, led.z], color: new THREE.Color().setRGB(2.2, 0.35, 0.2) });
  bright.pop();
  return { led: led.applyMatrix4(place) };
}

// Standby LED halo: a small red additive sprite breathing slowly (steady when `calm`).
export function createLedGlow(at, glowMap) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, color: 0xff2a1a, transparent: true,
    opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
  sprite.scale.set(0.1, 0.1, 1);
  sprite.position.copy(at);
  return {
    sprite,
    update(t, calm) { sprite.material.opacity = calm ? 0.7 : 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(t * Math.PI)); },
    dispose() { sprite.material.dispose(); },
  };
}
