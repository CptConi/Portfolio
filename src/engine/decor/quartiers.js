import * as THREE from 'three';
import { MAP, floorAt } from '../Map.js';
import { softPool } from './helpers.js';
import { Atlas, Batch } from '../props/kit.js';

// Quartiers: the lounge's surfaces and light. Warm hearth glow over the middle of the room, a
// woven rug between the vestibule and the CONTACT console, the level blueprint pinned on the
// north wall, a red war banner above the sofa. The furniture itself (sofa, amp, guitar, barbecue,
// lamp, cat) is built by props/lounge.js.
//
// Everything painted is pixel art on one small atlas drawn with no canvas (plain byte arrays),
// so the whole dressing is a single unlit draw call (alpha-tested: the banner is not a rectangle).

const RUG = { x: 12.5, z: 4.55, w: 3.25, d: 1.875 };            // m, centred
const POSTER = { x: 10.2, z: 2.0, w: 0.72, h: 0.64, y: 0.72 };    // north wall face, y above the floor
const BANNER = { x: 9.05, z: 7.0, w: 0.42, h: 0.72, y: 0.95 };  // south wall face, over the sofa

export const RUG_TEX = { w: 208, h: 120 };
export const POSTER_TEX = { w: 72, h: 64 };
export const BANNER_TEX = { w: 48, h: 84 };

const WINE = 0x7b2231, WINE_LIGHT = 0x9a3041, GOLD = 0xdcb66c, TEAL = 0x2a6572, DARK = 0x1d1417, ORANGE = 0xd8693a, CREAM = 0xf0dca8;

// Wine field, gold + teal borders, a diamond medallion, small lozenges, short fringes at the ends.
export function paintRug(p) {
  const fringe = 4;
  const x0 = 0, x1 = p.w, y0 = fringe, y1 = p.h - fringe;
  p.rect(x0, y0, x1 - x0, y1 - y0, DARK);
  let inset = 2;
  const band = (w, c) => { p.rect(x0 + inset, y0 + inset, x1 - x0 - 2 * inset, y1 - y0 - 2 * inset, c); inset += w; };
  band(3, GOLD);
  band(6, TEAL);
  band(2, GOLD);
  band(1, DARK);
  p.rect(x0 + inset, y0 + inset, x1 - x0 - 2 * inset, y1 - y0 - 2 * inset, WINE);

  // Dots along the teal band.
  const tb = 5;
  for (let x = 10; x < p.w - 8; x += 6) { p.set(x, y0 + tb + 1, CREAM).set(x, y1 - tb - 2, CREAM); }
  for (let y = y0 + 12; y < y1 - 8; y += 6) { p.set(tb + 1, y, CREAM).set(p.w - tb - 2, y, CREAM); }

  // Field: lattice of small lozenges, then the big medallion.
  const fx0 = x0 + inset, fx1 = x1 - inset, fy0 = y0 + inset, fy1 = y1 - inset;
  const diamond = (cx, cy, r, c) => { for (let dy = -r; dy <= r; dy++) { const w = r - Math.abs(dy); p.rect(cx - w, cy + dy, 2 * w + 1, 1, c); } };
  for (let y = fy0 + 6; y < fy1 - 3; y += 12) {
    for (let x = fx0 + 6 + (((y - fy0) / 12) % 2) * 6; x < fx1 - 3; x += 12) diamond(x, y, 2, WINE_LIGHT);
  }
  const cx = Math.round(p.w / 2), cy = Math.round((y0 + y1) / 2);
  diamond(cx, cy, 25, DARK);
  diamond(cx, cy, 23, ORANGE);
  diamond(cx, cy, 17, WINE);
  diamond(cx, cy, 15, GOLD);
  diamond(cx, cy, 9, TEAL);
  diamond(cx, cy, 5, CREAM);
  diamond(cx, cy, 2, WINE);
  for (const s of [-1, 1]) { diamond(cx + s * 38, cy, 6, GOLD); diamond(cx + s * 38, cy, 3, ORANGE); }
  for (const s of [-1, 1]) for (const t of [-1, 1]) diamond(fx0 + (s < 0 ? 12 : fx1 - fx0 - 12), cy + t * 30, 4, GOLD);

  // Fringe: short tassels at both ends (opaque, so the rug needs no alpha).
  for (let x = 0; x < p.w; x++) {
    for (let k = 0; k < fringe; k++) {
      const c = x % 2 ? 0xe6d3a0 : 0xb89a5c;
      p.set(x, k, c).set(x, p.h - 1 - k, c);
    }
  }
}

// 3 × 5 pixel font for the few glyphs we need.
const FONT = {
  E: ['###', '#..', '##.', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  1: ['.#.', '##.', '.#.', '.#.', '###'],
};

// The level seen from above, like an architect's print: only the public rooms are drawn.
export function paintBlueprint(p) {
  const BLUE = 0x143a8c, GRID = 0x1d4fb4, LINE = 0xe3efff;
  p.rect(0, 0, p.w, p.h, BLUE);
  for (let i = 4; i < p.w; i += 8) { p.rect(i, 0, 1, p.h, GRID); p.rect(0, i, p.w, 1, GRID); }
  p.frame(0, 0, p.w, p.h, 0x2b1a10);
  p.frame(1, 1, p.w - 2, p.h - 2, 0x6a4426);

  const X0 = 2, X1 = 23, Z0 = 2, Z1 = 16;                    // map columns/rows kept (rows ≥ 17 stay off the print)
  const cell = 3, ox = Math.round((p.w - (X1 - X0 + 1) * cell) / 2), oy = 13;
  const tint = { 0: 0xb9c9e6, 2: 0x7dff9a, 3: 0xffb060, 4: 0xd98aff, 6: 0x9fd8ff };
  for (let z = Z0; z <= Z1; z++) {
    for (let x = X0; x <= X1; x++) {
      const v = MAP[z][x];
      if (v === 1) continue;
      p.rect(ox + (x - X0) * cell, oy + (z - Z0) * cell, cell, cell, tint[v] ?? 0xb9c9e6);
    }
  }
  // Outline: wall cells that touch an open cell.
  for (let z = Z0; z <= Z1; z++) {
    for (let x = X0; x <= X1; x++) {
      if (MAP[z][x] !== 1) continue;
      const open = (xx, zz) => zz >= Z0 && zz <= Z1 && xx >= X0 && xx <= X1 && MAP[zz][xx] !== 1;
      const px = ox + (x - X0) * cell, pz = oy + (z - Z0) * cell;
      if (open(x, z - 1)) p.rect(px, pz + cell - 1, cell, 1, LINE);
      if (open(x, z + 1)) p.rect(px, pz, cell, 1, LINE);
      if (open(x - 1, z)) p.rect(px + cell - 1, pz, 1, cell, LINE);
      if (open(x + 1, z)) p.rect(px, pz, 1, cell, LINE);
    }
  }
  // "You are here": a red pin on the Quartiers.
  const pinX = ox + (12 - X0) * cell, pinY = oy + (4 - Z0) * cell;
  p.rect(pinX - 1, pinY - 1, 5, 5, 0xff2a2a).rect(pinX + 1, pinY + 1, 1, 1, 0xffd0d0);

  // Title strip: E1M1.
  let tx = 6;
  for (const ch of 'E1M1') {
    p.grid(FONT[ch], { '#': LINE }, tx, 6);
    tx += 4;
  }
  p.rect(5, 12, 16, 1, LINE);
  p.rect(p.w - 24, 5, 18, 1, LINE).rect(p.w - 24, 7, 13, 1, LINE).rect(p.w - 24, 9, 16, 1, LINE);
  p.rect(5, p.h - 6, 22, 1, LINE).rect(5, p.h - 4, 15, 1, LINE);
}

// Red war banner on a wooden rod: gold trim, crossed axes, swallowtail hem.
export function paintBanner(p) {
  const RED = 0xa31f26, RED_DARK = 0x7a1419, TRIM = 0xe0b04a, WOOD = 0x6a4426;
  const w = p.w, rodY = 5;
  // Cloth with a swallowtail bottom.
  p.rect(4, rodY + 2, w - 8, p.h - rodY - 2 - 12, RED);
  p.poly([[4, p.h - 12], [w - 4, p.h - 12], [w - 4, p.h - 2], [w / 2 + 3, p.h - 12 + 3], [w / 2, p.h - 1], [w / 2 - 3, p.h - 12 + 3], [4, p.h - 2]], RED);
  // Folds.
  for (const x of [11, 19, 28, 36]) p.rect(x, rodY + 3, 2, p.h - 18, RED_DARK);
  // Trim.
  p.rect(4, rodY + 2, w - 8, 2, TRIM).rect(4, rodY + 2, 2, p.h - rodY - 14, TRIM).rect(w - 6, rodY + 2, 2, p.h - rodY - 14, TRIM);
  // Emblem: gold disc, black crossed axes.
  const cx = w / 2, cy = 34;
  p.disc(cx, cy, 14, TRIM).disc(cx, cy, 12, RED_DARK);
  p.line(cx - 9, cy - 9, cx + 9, cy + 9, 0x15100f).line(cx - 9, cy - 8, cx + 9, cy + 10, 0x15100f);
  p.line(cx + 9, cy - 9, cx - 9, cy + 9, 0x15100f).line(cx + 9, cy - 8, cx - 9, cy + 10, 0x15100f);
  p.poly([[cx - 12, cy - 11], [cx - 6, cy - 12], [cx - 4, cy - 6], [cx - 9, cy - 4]], 0xc9ccd6);
  p.poly([[cx + 12, cy - 11], [cx + 6, cy - 12], [cx + 4, cy - 6], [cx + 9, cy - 4]], 0xc9ccd6);
  p.disc(cx, cy, 3, TRIM);
  // Rod with finials.
  p.rect(1, rodY - 1, w - 2, 3, WOOD).rect(0, rodY - 2, 3, 5, TRIM).rect(w - 3, rodY - 2, 3, 5, TRIM);
}

export function buildQuartiers(scene) {
  // Hearth glow, centred on the rug.
  softPool(scene, 0xff7a33, RUG.x, RUG.z, 3.8, { y: floorAt(RUG.x, RUG.z) + 0.02, opacity: 0.14 });

  const atlas = new Atlas(256);
  const batch = new Batch(atlas);
  const rugRect = atlas.paint(RUG_TEX.w, RUG_TEX.h, paintRug);
  const posterRect = atlas.paint(POSTER_TEX.w, POSTER_TEX.h, paintBlueprint);
  const bannerRect = atlas.paint(BANNER_TEX.w, BANNER_TEX.h, paintBanner);

  const tone = new THREE.Color(0xa4a4a4);
  const fy = floorAt(RUG.x, RUG.z);
  batch.quad(RUG.w, RUG.d, { pos: [RUG.x, fy + 0.011, RUG.z], rot: [-Math.PI / 2, 0, 0], uv: atlas.uv(rugRect), color: tone });

  const wf = floorAt(POSTER.x, POSTER.z + 0.5);
  batch.quad(POSTER.w, POSTER.h, { pos: [POSTER.x, wf + POSTER.y, POSTER.z + 0.012], uv: atlas.uv(posterRect), color: tone });

  const bf = floorAt(BANNER.x, BANNER.z - 0.5);
  batch.quad(BANNER.w, BANNER.h, { pos: [BANNER.x, bf + BANNER.y, BANNER.z - 0.012], rot: [0, Math.PI, 0], uv: atlas.uv(bannerRect), color: tone });

  const mat = new THREE.MeshBasicMaterial({ map: atlas.texture({ mip: true }), vertexColors: true, alphaTest: 0.5,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  scene.add(batch.mesh(mat));
}
