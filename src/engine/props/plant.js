import * as THREE from 'three';
import { Pix } from './pixels.js';
import { RAMPS, ditherRamp, bayer2, hash, noise } from './dither.js';

// A salvaged-bunker plant as a camera-facing pixel-art sprite: sword-like leaves (snake plant /
// yucca) growing out of a dented, riveted, rusty drum. Painted the way Doom's things were: banded
// earth-tone ramps, ordered-dither shading, hard light from the upper left, ragged edges, a dark
// contour on the shadow side only. Origin = bottom centre.

export const PLANT_TEX = { w: 64, h: 96 };
const WIDTH = 0.5;

const OLIVE = RAMPS.olive, RUST = RAMPS.rust, STEEL = RAMPS.steel, BROWN = RAMPS.brown;
const LEAF = OLIVE, DEAD = BROWN.slice(1, 6), SOIL = BROWN.slice(0, 5), BODY = RUST.slice(0, 5);
const HAZARD = RAMPS.eye.slice(0, 2);
const INK = OLIVE[0], DEAD_INK = BROWN[0], POT_INK = RUST[0];

const LIGHT = [-0.55, -0.6, 0.58];             // toward the light: up, left, front
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const key = (x, y) => (y + 200) * 1000 + (x + 200);

// One sword leaf from (x, y): `a` = heading from straight up (rad, + = right), `bend` = how much the
// heading turns over its length (arching, drooping), `snap` = broken off, blunt and ragged. Returns
// the pixel mask: every pixel knows its length t along the blade and its signed side (nearest point
// on the centre line), which is all the shading needs.
function rasterBlade(leaf) {
  const { x: bx, y: by, a, len, wid, bend = 0, seed = 1, notch = 0.5, snap = false } = leaf;
  const N = 48, step = len / N, pts = [];
  let px = bx, py = by;
  for (let i = 0; i <= N; i++) {
    const ang = a + bend * Math.pow(i / N, 1.3);
    pts.push({ x: px, y: py, tx: Math.sin(ang), ty: -Math.cos(ang) });
    px += Math.sin(ang) * step; py -= Math.cos(ang) * step;
  }
  const profile = t => (t < 0.28 ? 0.5 + 0.5 * (t / 0.28) : snap ? 1 - 0.2 * (t - 0.28) : Math.pow(1 - (t - 0.28) / 0.72, 0.9));
  const halfAt = (t, along) => {
    let h = (wid / 2) * profile(t);
    if (t > 0.72 && !snap) h *= 0.62 + 0.7 * hash(along, seed, 5);              // ragged tip
    if (t > 0.18 && hash(along >> 2, seed, 9) < notch * 0.18) h *= 0.55;        // a nick in the margin
    if (t > 0.2 && t < 0.85) h *= 1 - 0.3 * (((along * 0.3 + seed) % 1 + 1) % 1);   // saw-toothed margin
    return h;
  };

  const mask = new Map();
  const minX = Math.floor(Math.min(...pts.map(q => q.x)) - wid), maxX = Math.ceil(Math.max(...pts.map(q => q.x)) + wid);
  const minY = Math.floor(Math.min(...pts.map(q => q.y)) - wid), maxY = Math.ceil(Math.max(...pts.map(q => q.y)) + wid);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const qx = x + 0.5, qy = y + 0.5;
      let best = null;
      for (let i = 0; i < N; i++) {
        const s0 = pts[i], dx = qx - s0.x, dy = qy - s0.y;
        const u = Math.max(0, Math.min(step, dx * s0.tx + dy * s0.ty));
        const ex = dx - s0.tx * u, ey = dy - s0.ty * u, d2 = ex * ex + ey * ey;
        if (!best || d2 < best.d2) best = { d2, t: (i + u / step) / N, lat: dx * s0.ty - dy * s0.tx, tx: s0.tx, ty: s0.ty };
      }
      if (best.t <= 0 || best.t >= 1) continue;
      const cut = snap ? 0.93 + 0.07 * hash(x, y, seed + 21) - 0.07 * hash(x >> 1, y >> 1, seed + 22) : 1;
      const half = halfAt(best.t, Math.floor(best.t * len));
      if (Math.abs(best.lat) <= half && best.t < cut) mask.set(key(x, y), { ...best, half });
    }
  }
  return mask;
}

// Shades one leaf as a folded blade: lit half, shadow half, dithered crease, grain and cross-bands;
// pixels in the shadow of a leaf in front of it are knocked down; a hard dark contour on the
// shadow side, a thin broken one on the lit side.
function paintBlade(p, leaf, mask, idx, owner) {
  const { len, depth = 0.5, ramp = LEAF, ink = INK, seed = 1, fold = 0.7, dry = 0, streaks = 0 } = leaf;
  for (const [k, m] of mask) {
    if (owner.get(k) !== idx) continue;                                           // hidden by a leaf in front
    const x = (k % 1000) - 200, y = Math.floor(k / 1000) - 200;
    const s = Math.max(-1, Math.min(1, m.lat / Math.max(0.6, m.half)));           // +1 = left edge
    const wx = m.ty, wy = -m.tx, sp = Math.sin(fold) * s, cp = Math.cos(fold);    // the blade's normal tilts toward its side
    const nl = Math.hypot(wx * sp, wy * sp, cp);
    const ndl = (wx * sp * LIGHT[0] + wy * sp * LIGHT[1] + cp * LIGHT[2]) / nl;
    let v = Math.pow(0.08 + 0.9 * Math.max(0, ndl), 2);
    v *= 0.4 + 0.6 * smooth(0, 0.38, m.t);                                        // dark where it leaves the soil
    v += (depth - 0.5) * 0.2 - 0.4 * (x - 30) / 30 - 0.18 * (y - 36) / 30 - 0.04;    // whole plant: lit upper left, dark lower right
    for (const [d, dark] of [[2, 0.42], [3, 0.26]]) {                              // cast shadow of a leaf in front, toward the light
      const o = owner.get(key(x - d, y - d));
      if (o !== undefined && o > idx) { v -= dark; break; }
    }
    v += (noise(m.t * len / 2.4 + seed * 7, s * 1.6 + seed) - 0.5) * 0.34;         // cross-banding
    if (streaks) v += (hash(Math.floor(s * 3 + 3), seed, 17) - 0.5) * streaks;     // dry fibres along the blade
    v += (hash(x, y, seed) - 0.5) * 0.26 + 0.12;                                  // grain

    const free = (dx, dy) => !mask.has(key(x + dx, y + dy));
    let c = ditherRamp(ramp, v, x, y, bayer2);
    if (m.t > 1 - dry) c = ditherRamp(DEAD, v, x, y, bayer2);                             // scorched tip
    if (free(1, 0) || free(0, 1) || free(1, 1)) c = ink;
    else if (free(-1, 0) || free(0, -1)) {
      const r = hash(x, y, seed + 11);
      if (r < 0.32) c = ramp[0]; else if (r > 0.8 && v > 0.55) c = ramp[ramp.length - 1];
    }
    p.set(x, y, c);
  }
}

// The drum: rolled steel lip with rivets, dark rusty body that gets rustier toward the bottom, two
// bare-steel riveted ribs with a worn hazard-stripe band between them, a couple of dents (lit on the
// side facing the light).
function drum(p, cx, top) {
  const lipH = 4, bodyTop = top + lipH, bodyH = p.h - bodyTop;
  const dents = [[cx - 8, bodyTop + 10, 6.5, 0.4], [cx + 10, bodyTop + 20, 4.5, 0.34]];
  const ribs = [bodyTop + 5, bodyTop + 18], hazard = [bodyTop + 11, bodyTop + 16];
  const half = y => (y < bodyTop ? 18 : 16.8 - 2.2 * ((y - bodyTop) / bodyH));
  const rag = (y, side) => (y >= bodyTop && hash(y, side, 41) < 0.22 ? 1 : 0);   // hammered, not ruled, edges

  for (let y = top; y < p.h; y++) {
    const hw = half(y);
    for (let x = Math.ceil(cx - hw - 0.5) + rag(y, 0); x < cx + hw - 0.5 - rag(y, 1); x++) {
      const u = (x + 0.5 - cx) / hw, nz = Math.sqrt(Math.max(0, 1 - u * u));
      let v = Math.pow(Math.max(0, 0.06 + 0.95 * (-0.55 * u + 0.58 * nz)), 1.4) + 0.04;
      let c;
      if (y < bodyTop) {                                                         // rolled lip
        const r = y - top;
        v = v * 0.7 + (r === 0 ? 0.32 : r === 1 ? 0.08 : r === 2 ? -0.02 : -0.34);
        v += (hash(x, y, 4) - 0.5) * 0.2 + (noise(x / 3, y, 6) - 0.5) * 0.2;
        c = ditherRamp(STEEL, v, x, y);
        if (r === 2 && (x - cx + 60) % 6 === 0) c = STEEL[4];                    // rivet head …
        if (r === 2 && (x - cx + 59) % 6 === 0) c = STEEL[0];                    // … and its shadow
      } else {
        for (const [dx, dy, R, amp] of dents) {
          const ex = (x + 0.5 - dx) / R, ey = (y + 0.5 - dy) / (R * 0.8), r2 = ex * ex + ey * ey;
          if (r2 < 1) v += amp * Math.max(-1, Math.min(1, (0.55 * ex + 0.6 * ey) * 3)) * Math.sqrt(1 - r2) - 0.08 * (1 - r2);
        }
        const rib = ribs.findIndex(ry => y >= ry && y < ry + 4);
        const r = rib < 0 ? -1 : y - ribs[rib];
        v += (noise(x / 2.2, y / 2.2, 7) - 0.5) * 0.4;                            // blotchy rust
        v += (noise(x * 0.9, y / 10, 3) - 0.5) * 0.4;                             // run-off streaks
        v += (hash(x, y, 8) - 0.5) * 0.22;
        v -= 0.25 * smooth(bodyTop + 6, bodyTop, y);                              // shade under the leaves
        if (y === ribs[0] + 4 || y === ribs[1] + 4) v -= 0.3;                      // shadow under a rib
        const chime = y - (p.h - 3);                                               // rolled bottom edge
        if (r < 0 && chime >= 0) {
          v = v * 0.6 + (chime === 0 ? 0.3 : chime === 1 ? -0.05 : -0.4);
          c = ditherRamp(STEEL, v, x, y);
        } else if (r >= 0) {                                                       // bare steel rib, a few rust specks
          v = v * 0.75 + (r === 0 ? 0.35 : r === 1 ? 0.05 : r === 2 ? -0.08 : -0.4);
          c = hash(x, y, 14) < 0.12 ? ditherRamp(BODY, v, x, y) : ditherRamp(STEEL, v, x, y);
          if (r === 1 && (x - cx + 60) % 5 === 0) c = STEEL[4];                   // rivet head
          if (r === 1 && (x - cx + 59) % 5 === 0) c = STEEL[0];                   // … shadow
        } else if (y >= hazard[0] && y < hazard[1] && hash(x, y, 31) > 0.1 && noise(x / 3, y / 3, 33) < 0.8) {
          const on = (((x + y) % 8) + 8) % 8 < 4;                                 // faded paint, chipped to the rust below
          c = on ? ditherRamp(HAZARD, v * 1.1, x, y) : ditherRamp(RUST.slice(0, 3), v, x, y);
        } else {
          const rust = noise(x / 3.5 + 21, y / 3.5, 5) + 0.01 * (y - bodyTop) - 0.14;
          c = rust > 0.82 ? ditherRamp(STEEL, v * 0.9, x, y) : ditherRamp(BODY, v, x, y);   // a few worn-bare flecks
        }
      }
      p.set(x, y, c);
    }
  }
  // Contour: dark and solid on the shadow side, broken on the lit side.
  const mark = [];
  for (let y = top; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      if (!p.alpha(x, y)) continue;
      if (!p.alpha(x + 1, y) || y === p.h - 1) mark.push([x, y, POT_INK]);
      else if (!p.alpha(x - 1, y) && hash(x, y, 2) < 0.5) mark.push([x, y, RUST[1]]);
    }
  }
  for (const [x, y, c] of mark) p.set(x, y, c);
}

// A mound of dark earth with grit in it, behind the lip.
function soil(p, cx, top) {
  for (let x = cx - 16; x < cx + 16; x++) {
    const u = (x + 0.5 - cx) / 16, h = Math.round(3.4 * Math.sqrt(1 - u * u) + (hash(x, 0, 12) - 0.5) * 1.6);
    for (let y = top - h; y < top; y++) {
      const v = 0.25 + 0.3 * hash(x, y, 13) - 0.18 * u + 0.15 * (top - y) / 4;
      p.set(x, y, ditherRamp(SOIL, v, x, y, bayer2));
    }
  }
  for (const [x, y, c] of [[cx - 9, top - 2, BROWN[5]], [cx + 5, top - 1, STEEL[3]], [cx - 3, top - 3, STEEL[2]], [cx + 11, top - 2, BROWN[4]], [cx - 13, top - 1, BROWN[4]]]) p.set(x, y, c);
}

// Leaves, back to front. Heading in rad from vertical; the outer ones arch and droop. `front` ones
// are painted over the drum.
const LEAVES = [
  { dx: -1, a: -0.16, len: 58, wid: 8, bend: 0.42, depth: 0.15, seed: 1, dry: 0.14 },
  { dx: 2, a: 0.20, len: 50, wid: 8, bend: 0.14, depth: 0.2, seed: 2 },
  { dx: -3, a: -0.45, len: 34, wid: 8, bend: -0.30, depth: 0.1, seed: 3, snap: true },
  { dx: 3, a: 0.50, len: 48, wid: 7, bend: 0.34, depth: 0.1, seed: 4, dry: 0.1 },
  { dx: 0, a: 0.02, len: 44, wid: 9, bend: 0.05, depth: 0.5, seed: 5 },
  { dx: -2, a: -0.26, len: 46, wid: 9, bend: -0.22, depth: 0.55, seed: 6 },
  { dx: 2, a: 0.36, len: 44, wid: 9, bend: 0.26, depth: 0.55, seed: 7, dry: 0.14 },
  { dx: -4, a: -0.78, len: 30, wid: 8, bend: -0.70, depth: 0.7, seed: 8 },
  { dx: 4, a: 0.82, len: 28, wid: 8, bend: 0.75, depth: 0.7, seed: 9 },
  { dx: -4, a: -0.55, len: 34, wid: 9, bend: -0.55, depth: 0.85, seed: 10, dry: 0.12, front: true },
  { dx: 4, a: 0.62, len: 32, wid: 9, bend: 0.6, depth: 0.85, seed: 11, front: true },
  { dx: -2, a: -0.7, len: 33, wid: 8, bend: -1.5, depth: 1, seed: 12, ramp: DEAD, ink: DEAD_INK, notch: 1.4, streaks: 0.5, front: true },
  { dx: 5, a: 1.1, len: 26, wid: 6, bend: 1.3, depth: 1, seed: 13, ramp: DEAD, ink: DEAD_INK, notch: 1.4, streaks: 0.5, front: true },
];

export function paintPlant(p) {
  const cx = 32, top = 66;
  const leaves = LEAVES.map(l => ({ ...l, x: cx + l.dx, y: top - (l.front ? 0 : 1) }));
  const masks = leaves.map(rasterBlade);
  const owner = new Map();                                   // the topmost leaf at each pixel
  masks.forEach((m, i) => { for (const k of m.keys()) owner.set(k, i); });
  const paint = front => leaves.forEach((l, i) => { if (!!l.front === front) paintBlade(p, l, masks[i], i, owner); });
  paint(false);
  soil(p, cx, top);
  drum(p, cx, top);
  paint(true);
}

export function createPlant() {
  const height = (WIDTH * PLANT_TEX.h) / PLANT_TEX.w;
  const map = (() => { const p = new Pix(PLANT_TEX.w, PLANT_TEX.h); paintPlant(p); return p.toTexture({ mip: true }); })();
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, color: 0xd2d2d2, alphaTest: 0.5 }));
  sprite.center.set(0.5, 0);
  sprite.scale.set(WIDTH, height, 1);
  return { object: sprite, width: WIDTH, height, dispose() { map.dispose(); sprite.material.dispose(); } };
}
