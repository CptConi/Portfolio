import * as THREE from 'three';
import { Pix } from './pixels.js';

// A potted plant (rubber-plant style, broad glossy leaves) as a camera-facing pixel-art sprite,
// like the other living things of the lounge. Origin = bottom centre.

export const PLANT_TEX = { w: 34, h: 46 };
const WIDTH = 0.5;

const OUTLINE = 0x16301c, DARK = 0x2a7a3a, MID = 0x3d9d4c, LIGHT = 0x73c973;
const POT = 0xb5532f, POT_RIM = 0xd06a3a, POT_SHADE = 0x8a3d22, SOIL = 0x2a1a12;

// One oval leaf from (bx, by) toward `angle` (radians from straight up), outlined so that
// overlapping leaves stay readable.
function leaf(p, bx, by, angle, len, wid, base) {
  const ux = Math.sin(angle), uy = -Math.cos(angle), nx = -uy, ny = ux;
  const outline = (grow, c) => {
    const left = [], right = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8, w = (wid * Math.sin(Math.PI * Math.pow(t, 0.75))) / 2 + grow;
      left.push([bx + ux * (len + grow) * t + nx * w, by + uy * (len + grow) * t + ny * w]);
      right.push([bx + ux * (len + grow) * t - nx * w, by + uy * (len + grow) * t - ny * w]);
    }
    p.poly([...left, ...right.reverse()], c);
  };
  outline(0.9, OUTLINE);
  outline(0, base);
  p.line(bx + ux, by + uy, bx + ux * len * 0.85, by + uy * len * 0.85, LIGHT);
}

export function paintPlant(p) {
  const cx = 17, potTop = 34;
  // A thin stem with leaves in pairs, longest at the bottom, a single one on top.
  p.line(cx, potTop, cx, 9, 0x24542c);
  const rows = [[31, 1.3, 13, 7, DARK], [27, 1.05, 13, 7, MID], [22, 0.85, 12, 7, DARK], [17, 0.65, 11, 6, MID], [12, 0.4, 10, 6, DARK]];
  for (const [y, a, len, wid, c] of rows) {
    leaf(p, cx, y, -a, len, wid, c);
    leaf(p, cx, y, a, len, wid, c === DARK ? MID : DARK);
  }
  leaf(p, cx, 13, 0, 9, 6, LIGHT);
  leaf(p, cx, 10, 0.05, 8, 5, MID);

  // Pot: flared rim, tapered body, soil showing above it.
  p.rect(cx - 8, potTop, 16, 2, SOIL);
  p.poly([[cx - 8, potTop + 2], [cx + 8, potTop + 2], [cx + 6, p.h - 1], [cx - 6, p.h - 1]], POT);
  p.poly([[cx + 2, potTop + 2], [cx + 8, potTop + 2], [cx + 6, p.h - 1], [cx + 2, p.h - 1]], POT_SHADE);
  p.rect(cx - 9, potTop + 2, 18, 3, POT_RIM);
  p.rect(cx - 9, potTop + 4, 18, 1, POT_SHADE);
  p.outline(OUTLINE);
}

export function createPlant() {
  const height = (WIDTH * PLANT_TEX.h) / PLANT_TEX.w;
  const map = (() => { const p = new Pix(PLANT_TEX.w, PLANT_TEX.h); paintPlant(p); return p.toTexture({ mip: true }); })();
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, color: 0xd2d2d2, alphaTest: 0.5 }));
  sprite.center.set(0.5, 0);
  sprite.scale.set(WIDTH, height, 1);
  return { object: sprite, width: WIDTH, height, dispose() { map.dispose(); sprite.material.dispose(); } };
}
