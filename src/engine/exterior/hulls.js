import * as THREE from 'three';
import { Pix } from '../props/pixels.js';
import { hash } from '../props/dither.js';
import { floorAt } from '../Map.js';
import * as SLOTS from '../decor/windowSlots.js';   // read-only data: the windows' exterior faces are drawn from it
import { BLOCKS, LINKS, GROUND_Y } from './exteriorLayout.js';

// The hulls of exteriorLayout.js seen from outside, every one at its real height and with an identity of its own (IDENTITY): the tall
// ATRIUM (cool blue-grey tower, cyan stripes and slits), the ARMURERIE (olive-green plates, green paint), the TROPHEES (amber), the QUARTIERS
// (brick, warm), the PROD annex (dark, hazard). Each is the same kind of building: a concrete foundation, a panelled facade, an accent stripe,
// a cornice, a roof plate with a parapet. Every window of the level (windowSlots.js) appears on its hull as lit glass in a frame, at the
// same place. The tubes that cross the alleys, a concrete walkway in the alleys and low drifts of regolith at the foot of the outer walls
// complete it. Everything lit is merged into ONE mesh with ONE texture sheet; the lit glass (and the beacons of the exterior) go to a
// second, unlit mesh.
//
// The sheet is painted from the game's own Doom textures (the `tex` TextureManager: GRAYT panels, TEKGRT01, BRICKDRT, CNCRT1, METALT1,
// METLT02, PLATEF1, WARNWL01), darkened and dusted for vacuum, with a little deterministic grain. 64 px per metre, like the interior's
// walls. Mip-mapped (a hull seen from 40 m must not shimmer), nearest when magnified (crisp up close). Hulls are tinted per face by
// vertex colours (IDENTITY.paint), so one sheet serves every building.
//
// Faces are FrontSide: a hull seen from inside is see-through (a window looks out through its own wall); nothing of the exterior stands
// inside a room's footprint. Faces are 1 m wide segments (a texture cell is 1 m x 2 m); a facade taller than 2 m is stacked.

// ── Identity ──────────────────────────────────────────────────────────────────────────────────────
const lum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
// linear multiplier of the hue whose luminance is `bright` (1 = the untinted material): a hue never changes the brightness by accident
const tintOf = (hex, bright = 1) => { const c = new THREE.Color(hex), k = bright / lum(c); return [c.r * k, c.g * k, c.b * k]; };
const lin = hex => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

// paint    multiplier of the facade's panels         stripe   multiplier of the accent band (a concrete tile)
// found    multiplier of the foundation              accent   the colour of the building's lights, signs and glass (sRGB hex)
// skin     the panel cells of the sheet, picked per metre of facade
// glass    linear HDR colours of the lit glass: [the lit lower half, the dark upper half] (the room's lamp colour, features/mood.js)
export const IDENTITY = {
  atrium: {
    label: 'ATRIUM', accent: 0x4fc3ff, kerb: false,
    skin: ['panelA', 'panelB', 'panelC', 'panelA', 'panelE', 'panelB', 'panelD', 'panelC'],
    paint: tintOf(0xc4d8f4, 1.0), found: tintOf(0xc8d4e6, 0.85), stripe: tintOf(0x38b8ff, 2.1),
    glass: [lin(0x2c8fd8).map(v => v * 0.9), lin(0x123a68).map(v => v * 0.7)],
  },
  armurerie: {
    label: 'ARMURERIE', accent: 0x56ff86, kerb: true,
    skin: ['tek', 'tek', 'panelB', 'tek', 'tek', 'panelE', 'tek', 'tek'],
    paint: tintOf(0xa8f0b6, 1.25), found: tintOf(0xb8d6c0, 0.85), stripe: tintOf(0x32d060, 2.1),
    glass: [lin(0x2fd868).map(v => v * 0.85), lin(0x0f4a22).map(v => v * 0.7)],
  },
  trophees: {
    label: 'TROPHÉES', accent: 0xffb44a, kerb: true,
    skin: ['panelA', 'panelC', 'panelB', 'panelE', 'panelA', 'panelC', 'panelB', 'panelE'],
    paint: tintOf(0xf2b868, 1.15), found: tintOf(0xe0c8a0, 0.85), stripe: tintOf(0xff9a1c, 2.1),
    glass: [lin(0xffb040).map(v => v * 0.9), lin(0x5a3208).map(v => v * 0.8)],
  },
  quartiers: {
    label: 'QUARTIERS', accent: 0xff8a4c, kerb: false,
    skin: ['brick', 'brick', 'brick', 'brick', 'brick', 'brick', 'brick', 'brick'],
    paint: tintOf(0xffd6b0, 1.35), found: tintOf(0xe0c0a0, 0.8), stripe: tintOf(0xff7a30, 2.0),
    glass: [lin(0xffa060).map(v => v * 0.9), lin(0x5e2a10).map(v => v * 0.8)],
  },
  annex: {
    label: 'PROD', accent: 0xff3a2a, kerb: true,
    skin: ['panelB', 'panelE', 'panelB', 'panelC', 'panelB', 'panelE', 'panelB', 'panelC'],
    paint: tintOf(0x8c8ea0, 0.62), found: tintOf(0xa0a0a8, 0.6), stripe: tintOf(0xe02418, 1.6),
    glass: [lin(0xff4030).map(v => v * 0.55), lin(0x3a0c08).map(v => v * 0.8)],
  },
};

// ── The sheet ─────────────────────────────────────────────────────────────────────────────────────
const CW = 64, CH = 128;      // one cell = 1 m × 2 m
const COLS = 8, ROWS = 2;
// [col, row, Doom texture id, treatment]
const CELLS = {
  panelA:   { c: 0, r: 0, id: 20, tint: [0.86, 0.90, 1.00], k: 1.5, grain: 0.07, streak: 0.10 },   // GRAYT01
  panelB:   { c: 1, r: 0, id: 21, tint: [0.86, 0.90, 1.00], k: 1.5, grain: 0.07, streak: 0.10 },   // GRAYT02
  panelC:   { c: 2, r: 0, id: 22, tint: [0.86, 0.90, 1.00], k: 1.45, grain: 0.07, streak: 0.12 },   // GRAYT03
  panelD:   { c: 3, r: 0, id: 24, tint: [0.86, 0.90, 1.00], k: 1.5, grain: 0.07, streak: 0.10 },   // GRAYT05 (vents)
  panelE:   { c: 4, r: 0, id: 27, tint: [0.86, 0.90, 1.00], k: 1.45, grain: 0.07, streak: 0.12 },   // GRAYT08
  pipe:     { c: 5, r: 0, id: 29, tint: [0.90, 0.88, 0.95], k: 1.4, grain: 0.06, streak: 0.06 },   // GRAYT10 (pipe run)
  grate:    { c: 6, r: 0, id: 33, tint: [0.86, 0.90, 1.00], k: 1.4, grain: 0.06, streak: 0.04 },   // GRAYT14 (grating)
  hazard:   { c: 7, r: 0, id: 6,  tint: [0.95, 0.95, 0.90], k: 1.3, grain: 0.07, streak: 0.04, rows: [[48, 64]] },   // WARNWL01 (the kerb takes rows 50-61)
  roofA:    { c: 0, r: 1, id: 56, tint: [0.95, 0.97, 1.05], k: 2.7, sat: 0.35, grain: 0.10, pits: 0.012, dust: 0.9, rows: [[0, 64]] },   // METALT1: dark plate, lifted, greyed, dusted
  roofB:    { c: 1, r: 1, id: 61, tint: [0.95, 0.97, 1.05], k: 2.9, sat: 0.30, grain: 0.10, pits: 0.010, dust: 0.8, rows: [[0, 64]] },   // METLT02: diamond plate
  roofC:    { c: 2, r: 1, id: 7,  tint: [0.95, 0.97, 1.05], k: 2.9, sat: 0.30, grain: 0.10, pits: 0.012, dust: 0.9, rows: [[0, 64]] },   // PLATEF1
  concrete: { c: 3, r: 1, id: 41, tint: [1.00, 0.96, 0.90], k: 1.25, grain: 0.09, streak: 0.10, dust: 0.10, rows: [[0, 64], [96, 128]] },   // CNCRT1: slabs (top 1 m), foundations and stripes (bottom 0.5 m)
  tube:     { c: 4, r: 1, id: 41, tint: [0.90, 0.92, 1.00], k: 1.05, grain: 0.10, streak: 0.14, ribs: true, rows: [[48, 128]] },   // the tubes' skin (1.2 m high: the bottom 80 rows)
  cornice:  { c: 5, r: 1, id: 56, tint: [0.95, 0.97, 1.05], k: 1.25, grain: 0.08, band: true, rows: [[112, 128]] },
  tek:      { c: 6, r: 1, id: 2,  tint: [1.00, 1.00, 1.00], k: 1.7, grain: 0.06, streak: 0.10 },   // TEKGRT01: the Armurerie's olive plates
  brick:    { c: 7, r: 1, id: 1,  tint: [1.00, 0.96, 0.92], k: 1.55, grain: 0.06, streak: 0.06 },   // BRICKDRT: the Quartiers' brick
};
const NAMES = Object.keys(CELLS);

// Pixels of a loaded Doom texture, or null (node, or a texture missing from the manager): the sheet then falls back to a painted grey.
function readTexture(tex, id) {
  const img = tex?.get?.(id)?.image;
  if (!img || typeof document === 'undefined' || !img.width) return null;
  try {
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    return { w: img.width, h: img.height, data: g.getImageData(0, 0, img.width, img.height).data };
  } catch { return null; }
}

// Paints one cell of the sheet (only the rows the hulls use: `rows`; the rest is copied from the nearest painted row so that the mip levels have
// no black to bleed in). Writes the bytes itself (a Pix.set per pixel is the cost of the whole sheet).
function paintCell(p, name, src, seed) {
  const d = CELLS[name], ox = d.c * CW, oy = d.r * CH, data = p.data, W = p.w;
  const rows = d.rows ?? [[0, CH]];
  const streakCol = [];
  for (let x = 0; x < CW; x++) streakCol.push(hash(x, 7, seed));
  const sx = src ? Int32Array.from({ length: CW }, (_, x) => (x % src.w) * 4) : null;
  const sd = src?.data;
  const [t0, t1, t2] = d.tint;
  for (const [ya, yb] of rows) {
    for (let y = ya; y < yb; y++) {
      const sy = src ? (y % src.h) * src.w * 4 : 0;
      let o = ((oy + y) * W + ox) * 4;
      for (let x = 0; x < CW; x++, o += 4) {
        let r, g, b;
        if (src) { const i = sy + sx[x]; r = sd[i]; g = sd[i + 1]; b = sd[i + 2]; }
        else { const seam = (x % 32 === 0 || y % 64 === 0) ? 0.7 : 1; r = g = b = 128 * seam; }   // no image (node): a seamed grey plate
        const n = (hash(x, y, seed) - 0.5) * 2;
        let k = d.k * (1 + n * d.grain);
        if (d.streak) k *= 1 - d.streak * (0.5 + streakCol[x]) * (0.4 + 0.6 * (y / CH));   // rain-less streaks: dust sliding down the plates
        if (d.sat !== undefined) { const l = 0.3 * r + 0.59 * g + 0.11 * b; r = l + (r - l) * d.sat; g = l + (g - l) * d.sat; b = l + (b - l) * d.sat; }
        r *= t0 * k; g *= t1 * k; b *= t2 * k;
        if (d.pits && hash(x * 3 + 1, y * 3 + 2, seed + 1) < d.pits) { r *= 0.45; g *= 0.45; b *= 0.45; }   // micro-meteorite pits
        if (d.dust) {                                                                                       // regolith dust settled on the plates
          const f = Math.min(1, d.dust * (0.3 + 0.9 * hash(x >> 1, y >> 1, seed + 2))) * 0.5;
          r += (150 - r) * f; g += (143 - g) * f; b += (130 - b) * f;
        }
        if (d.ribs && x % 32 < 2) { r *= 0.6; g *= 0.6; b *= 0.6; }                                         // a seam every half metre
        if (d.band) {                                                                                       // cornice: shadow, metal, a lit top edge (bottom rows of the cell = the strip)
          const yy = CH - 1 - y;
          if (yy < 2) { r *= 0.4; g *= 0.4; b *= 0.4; } else if (yy === 6 || yy === 7) { r *= 1.5; g *= 1.5; b *= 1.5; } else if (yy > 7) { r *= 0.8; g *= 0.8; b *= 0.8; }
        }
        data[o] = r > 255 ? 255 : r | 0; data[o + 1] = g > 255 ? 255 : g | 0; data[o + 2] = b > 255 ? 255 : b | 0; data[o + 3] = 255;
      }
    }
  }
  // the rows nobody samples: the nearest painted row, copied
  const copyRow = (from, to) => { const a = ((oy + from) * W + ox) * 4, b = ((oy + to) * W + ox) * 4; data.copyWithin(b, a, a + CW * 4); };
  for (let y = 0; y < CH; y++) {
    if (rows.some(([ya, yb]) => y >= ya && y < yb)) continue;
    let best = -1, dist = Infinity;
    for (const [ya, yb] of rows) for (const e of [ya, yb - 1]) if (Math.abs(e - y) < dist) { dist = Math.abs(e - y); best = e; }
    copyRow(best, y);
  }
}

function paintSheet(tex) {
  const cache = new Map();
  const now = () => (typeof performance !== 'undefined' ? performance.now() : 0);
  const timing = { read: 0, paint: 0 };
  const src = id => { if (!cache.has(id)) { const t = now(); cache.set(id, readTexture(tex, id)); timing.read += now() - t; } return cache.get(id); };
  const p = new Pix(CW * COLS, CH * ROWS);
  NAMES.forEach((n, i) => { const s = src(CELLS[n].id), t = now(); paintCell(p, n, s, 100 + i * 7); timing.paint += now() - t; });
  const t = now();
  const texture = p.toTexture({ mip: true });
  texture.anisotropy = 8;
  timing.upload = now() - t;
  for (const k in timing) timing[k] = +timing[k].toFixed(1);
  return { texture, pix: p, timing };
}

// UV rectangle of a pixel box of a cell (px coordinates inside the cell, y down), as [u0, vBottom, u1, vTop]. Half a texel of inset keeps
// the cell's neighbours out of it.
function uvRect(name, x0, y0, x1, y1) {
  const d = CELLS[name], W = CW * COLS, H = CH * ROWS, ox = d.c * CW, oy = d.r * CH, e = 0.5;
  return [(ox + x0 + e) / W, 1 - (oy + y1 - e) / H, (ox + x1 - e) / W, 1 - (oy + y0 + e) / H];
}
// The four corners [bl, br, tr, tl] of a rect, turned `k` quarter turns (so a roof plate is not the same everywhere).
function corners(r, k = 0) {
  const c = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
  return c.map((_, i) => c[(i + k) % 4]);
}

// ── A tiny mesher ─────────────────────────────────────────────────────────────────────────────────
export class Mesher {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = []; }

  // Quad a-b-c-d with uv corners `uvs` (same order); n = the direction the face must look toward: the winding is fixed to match it.
  quad(a, b, c, d, uvs, color = [1, 1, 1], n = null) {
    let B = b, D = d, UB = uvs[1], UD = uvs[3];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    if (n && nx * n[0] + ny * n[1] + nz * n[2] < 0) { B = d; D = b; UB = uvs[3]; UD = uvs[1]; nx = -nx; ny = -ny; nz = -nz; }
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const base = this.pos.length / 3;
    [[a, uvs[0]], [B, UB], [c, uvs[2]], [D, UD]].forEach(([p, uv]) => {
      this.pos.push(p[0], p[1], p[2]); this.nor.push(nx, ny, nz); this.uv.push(uv[0], uv[1]); this.col.push(color[0], color[1], color[2]);
    });
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return this;
  }

  // Axis-aligned box [x0..x1] × [y0..y1] × [z0..z1] with one pixel box of one cell on its visible faces (no bottom).
  box(x0, x1, y0, y1, z0, z1, uvr, color = [1, 1, 1], faces = 'nsewt') {
    const uvs = corners(uvr);
    if (faces.includes('t')) this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], uvs, color, [0, 1, 0]);
    if (faces.includes('n')) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], uvs, color, [0, 0, -1]);
    if (faces.includes('s')) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], uvs, color, [0, 0, 1]);
    if (faces.includes('w')) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], uvs, color, [-1, 0, 0]);
    if (faces.includes('e')) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], uvs, color, [1, 0, 0]);
    return this;
  }

  // Unlit octahedron (a beacon): HDR colour, radius r.
  octa(x, y, z, r, color) {
    const P = [[x + r, y, z], [x - r, y, z], [x, y + r, z], [x, y - r, z], [x, y, z + r], [x, y, z - r]];
    const F = [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]];
    for (const f of F) {
      const a = P[f[0]], b = P[f[1]], c = P[f[2]];
      const cx = (a[0] + b[0] + c[0]) / 3 - x, cy = (a[1] + b[1] + c[1]) / 3 - y, cz = (a[2] + b[2] + c[2]) / 3 - z;
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const dot = (e1[1] * e2[2] - e1[2] * e2[1]) * cx + (e1[2] * e2[0] - e1[0] * e2[2]) * cy + (e1[0] * e2[1] - e1[1] * e2[0]) * cz;
      const [A, B, C] = dot >= 0 ? [a, b, c] : [a, c, b];
      const base = this.pos.length / 3;
      for (const q of [A, B, C]) { this.pos.push(q[0], q[1], q[2]); this.nor.push(0, 1, 0); this.uv.push(0, 0); this.col.push(color[0], color[1], color[2]); }
      this.idx.push(base, base + 1, base + 2);
    }
    return this;
  }

  get empty() { return this.idx.length === 0; }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// ── Faces of a block ──────────────────────────────────────────────────────────────────────────────
// o = start corner, T = direction along the face as seen from outside (to the viewer's right), N = outward normal. T = up × N.
export const sideOf = (b, k) => ({
  N: { o: [b.x1, b.z0], T: [-1, 0], n: [0, -1], len: b.x1 - b.x0 },
  S: { o: [b.x0, b.z1], T: [1, 0], n: [0, 1], len: b.x1 - b.x0 },
  E: { o: [b.x1, b.z1], T: [0, -1], n: [1, 0], len: b.z1 - b.z0 },
  W: { o: [b.x0, b.z0], T: [0, 1], n: [-1, 0], len: b.z1 - b.z0 },
})[k];
export const SIDES = ['N', 'S', 'E', 'W'];

const pt = (sd, s, y, off = 0) => [sd.o[0] + sd.T[0] * s + sd.n[0] * off, y, sd.o[1] + sd.T[1] * s + sd.n[1] * off];

// A face in WORLD terms, for everything that is hung on it: `s` runs along the face in world axes (x on N/S faces, z on E/W faces),
// `off` is the distance in front of the wall. pt(s, y, off) → [x, y, z]; box(s0, s1, y0, y1, o0, o1) → [x0, x1, y0, y1, z0, z1].
export function faceOf(b, k) {
  const sd = sideOf(b, k), alongX = k === 'N' || k === 'S';
  const plane = alongX ? (k === 'N' ? b.z0 : b.z1) : (k === 'E' ? b.x1 : b.x0);
  const sgn = alongX ? sd.n[1] : sd.n[0];
  const F = {
    id: `${b.id}.${k}`, b, k, n: [sd.n[0], 0, sd.n[1]], plane, sgn, alongX, lo: alongX ? b.x0 : b.z0, hi: alongX ? b.x1 : b.z1,
    top: b.roofY, base: GROUND_Y, mid: 0,
    right: (k === 'S' || k === 'W') ? 1 : -1,   // the sign of the world `s` a viewer facing the wall sees growing toward his right
  };
  F.mid = (F.lo + F.hi) / 2;
  F.pt = (s, y, off = 0) => (alongX ? [s, y, plane + sgn * off] : [plane + sgn * off, y, s]);
  F.box = (s0, s1, y0, y1, o0, o1) => {
    const a = plane + sgn * o0, c = plane + sgn * o1, lo = Math.min(a, c), hi = Math.max(a, c);
    return alongX ? [s0, s1, y0, y1, lo, hi] : [lo, hi, y0, y1, s0, s1];
  };
  return F;
}

const ACCENTS = { N: { pipe: 4, grate: 6 }, S: { pipe: 5, grate: 0 }, E: { pipe: 4, grate: 6 }, W: { pipe: 2, grate: 0 } };   // panel indices of a 7 m facade

// A band of a face from y0 to y1 (at most 2 m), cut into 1 m segments (one cell width each); each shows the bottom (y1 - y0) × 64 rows of
// its cell. `pick(i)` chooses the cell of segment i, `color(i)` its tint.
function band(m, sd, { y0, y1, off = 0, cell, color, pick }) {
  const h = y1 - y0, py1 = CH, py0 = CH - h * 64;
  for (let i = 0, s = 0; s < sd.len - 1e-6; i++, s += 1) {
    const w = Math.min(1, sd.len - s), name = pick ? pick(i) : cell;
    const r = uvRect(name, 0, py0, 64 * w, py1);
    const c = color ? color(i) : [1, 1, 1];
    m.quad(pt(sd, s, y0, off), pt(sd, s + w, y0, off), pt(sd, s + w, y1, off), pt(sd, s, y1, off), corners(r), c, [sd.n[0], 0, sd.n[1]]);
  }
}
// The same, for any height: stacked rows of at most 2 m, the lowest first (the seam is a joint between two plates)
function stacked(m, sd, o) {
  for (let y = o.y0; y < o.y1 - 1e-6; y += 2) band(m, sd, { ...o, y0: y, y1: Math.min(o.y1, y + 2) });
}

// A roof plate of 1 m tiles (the last row / column partial), turned at random so it does not read as a grid.
function roofPlate(m, b, y, pickCell, seed, shade = 1) {
  for (let x = b.x0, i = 0; x < b.x1 - 1e-6; x += 1, i++) {
    for (let z = b.z0, j = 0; z < b.z1 - 1e-6; z += 1, j++) {
      const w = Math.min(1, b.x1 - x), d = Math.min(1, b.z1 - z);
      const name = pickCell(hash(i, j, seed));
      const r = uvRect(name, 0, 0, 64 * w, 64 * d);
      const k = shade * (0.92 + 0.16 * hash(i, j, seed + 5));
      m.quad([x, y, z], [x + w, y, z], [x + w, y, z + d], [x, y, z + d], corners(r, w === 1 && d === 1 ? Math.floor(hash(i, j, seed + 9) * 4) : 0), [k, k, k], [0, 1, 0]);
    }
  }
}

// A thin lip around a roof (parapet), `t` thick, `h` high, flush with the face; mitred by overlapping at the corners.
function parapet(m, b, y, t, h, cell = 'cornice') {
  const r = uvRect(cell, 0, 120, 64, 128), c = [1, 1, 1];
  m.box(b.x0, b.x1, y, y + h, b.z0, b.z0 + t, r, c, 'nst');
  m.box(b.x0, b.x1, y, y + h, b.z1 - t, b.z1, r, c, 'nst');
  m.box(b.x0, b.x0 + t, y, y + h, b.z0 + t, b.z1 - t, r, c, 'wet');
  m.box(b.x1 - t, b.x1, y, y + h, b.z0 + t, b.z1 - t, r, c, 'wet');
}

// ── Alleys and drifts ─────────────────────────────────────────────────────────────────────────────
// A side that looks onto another block across an alley (≤ 2 m) stays clear of drifts: tubes cross it and the neighbour's wall is the view.
export function facesAlley(b, k) {
  const near = 2.01;
  return BLOCKS.some(o => o !== b && (
    (k === 'N' && o.z1 <= b.z0 + 1e-6 && b.z0 - o.z1 <= near && o.x0 < b.x1 && o.x1 > b.x0) ||
    (k === 'S' && o.z0 >= b.z1 - 1e-6 && o.z0 - b.z1 <= near && o.x0 < b.x1 && o.x1 > b.x0) ||
    (k === 'W' && o.x1 <= b.x0 + 1e-6 && b.x0 - o.x1 <= near && o.z0 < b.z1 && o.z1 > b.z0) ||
    (k === 'E' && o.x0 >= b.x1 - 1e-6 && o.x0 - b.x1 <= near && o.z0 < b.z1 && o.z1 > b.z0)));
}

// The alleys between blocks, as rectangles of the plain ({ id, x0, x1, z0, z1 }), with the links that cross them: { w, a } = the wall's two blocks.
export function alleys() {
  const out = [];
  for (const a of BLOCKS) {
    for (const o of BLOCKS) {
      if (a === o) continue;
      const gx = o.x0 - a.x1, gz = o.z0 - a.z1;
      const zo0 = Math.max(a.z0, o.z0), zo1 = Math.min(a.z1, o.z1), xo0 = Math.max(a.x0, o.x0), xo1 = Math.min(a.x1, o.x1);
      if (gx > 0 && gx <= 2.01 && zo1 > zo0) out.push({ id: `${a.id}|${o.id}`, a, b: o, axis: 'x', x0: a.x1, x1: o.x0, z0: zo0, z1: zo1 });
      if (gz > 0 && gz <= 2.01 && xo1 > xo0) out.push({ id: `${a.id}|${o.id}`, a, b: o, axis: 'z', x0: xo0, x1: xo1, z0: a.z1, z1: o.z0 });
    }
  }
  return out;
}

// Low drifts of regolith at the foot of the outer walls, as the "berms" the terrain skirts (terrain.js buildBerms): the top edge runs along the
// wall a little over the plain (DRIFT_H) and slopes down over DRIFT_RUN m. The sides that face an alley get none.
export const DRIFT_H = 0.2, DRIFT_RUN = 0.9;
export function bermsOf() {
  const out = [];
  for (const b of BLOCKS) {
    const topY = GROUND_Y + DRIFT_H, e = {};
    for (const k of SIDES) e[k.toLowerCase()] = facesAlley(b, k) ? 0 : DRIFT_RUN;
    out.push({ id: b.id, x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1, topY, e, run: DRIFT_RUN });
  }
  return out;
}

// ── Windows on hulls ──────────────────────────────────────────────────────────────────────────────
// Every wall window of the level, as it lies on the face of its hull: { w, b, k, s (world), hw, yb, yt, id, room }
export function windowsOnFaces(windows) {
  const out = [];
  for (const w of windows) {
    if (w.kind !== 'wall' || !Array.isArray(w.facing)) continue;
    const [fx, fz] = w.facing;
    const k = fx > 0.5 ? 'W' : fx < -0.5 ? 'E' : fz > 0.5 ? 'N' : 'S';
    const b = BLOCKS.find(q => {
      const onFace = (k === 'W' || k === 'E') ? Math.abs(w.x - (k === 'W' ? q.x0 : q.x1)) < 0.011 : Math.abs(w.z - (k === 'N' ? q.z0 : q.z1)) < 0.011;
      const along = (k === 'W' || k === 'E') ? (w.z > q.z0 && w.z < q.z1) : (w.x > q.x0 && w.x < q.x1);
      return onFace && along;
    });
    if (!b) continue;
    const floor = floorAt(w.x + fx * 0.3, w.z + fz * 0.3);
    const yb = floor + w.sill, yt = yb + w.h;
    out.push({ id: w.id, room: w.room, w, b, k, s: (k === 'W' || k === 'E') ? w.z : w.x, hw: w.w / 2, yb, yt });
  }
  return out;
}

// ── Build ─────────────────────────────────────────────────────────────────────────────────────────
export function buildHulls({ tex, windows = SLOTS.WINDOWS ?? [] }) {
  const _now = () => (typeof performance !== 'undefined' ? performance.now() : 0), timing = {};
  let _t = _now();
  const lap = k => { const n = _now(); timing[k] = +(n - _t).toFixed(1); _t = n; };
  const sheet = paintSheet(tex);
  lap('sheet');
  timing.sheetParts = sheet.timing;
  const lit = new Mesher();    // textured, Lambert-lit
  const glow = new Mesher();   // unlit, HDR vertex colours (lit glass, beacons)
  const features = [];         // flat things painted on the faces, for the proofs: { face, kind, s0, s1, y0, y1 }

  const G = GROUND_Y;
  const onFaces = windowsOnFaces(windows);
  const winOf = (b, k) => onFaces.filter(q => q.b === b && q.k === k);
  const tone = (i, a = 0.9, b = 1.08) => a + (b - a) * hash(i, 5, 23);
  const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

  for (const b of BLOCKS) {
    const id = IDENTITY[b.id], seedB = [...b.id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) % 1000;
    const foundH = 0.5, cornH = 0.1, stripeH = 0.16;
    const yF = G + foundH, yC = b.roofY - cornH, yS = yC - stripeH;   // foundation top, cornice bottom, accent stripe bottom
    SIDES.forEach((k, ki) => {
      const sd = sideOf(b, k), wins = winOf(b, k), F = faceOf(b, k);
      const face = F.id;
      // panels that carry no window: the pipe run and the grating of the facade go there
      const covered = i => wins.some(q => { const t = Math.abs(q.s - (k === 'W' || k === 'E' ? sd.o[1] : sd.o[0])); return t + q.hw + 0.1 > i && t - q.hw - 0.1 < i + 1; });
      const accent = ACCENTS[k];
      const pick = i => {
        if (i === accent.pipe % Math.max(1, Math.floor(sd.len)) && !covered(i)) return 'pipe';
        if (i === accent.grate % Math.max(1, Math.floor(sd.len)) && !covered(i) && id.skin[0] !== 'brick') return 'grate';
        return id.skin[Math.floor(hash(i + ki * 13, 3, 17 + seedB) * 8) % 8];
      };
      // foundation, then the facade (stacked rows of at most 2 m: the seam is a joint between two plates), then a stripe in the identity colour
      band(lit, sd, { y0: G, y1: yF, cell: 'concrete', color: i => mul(id.found, tone(i + ki * 9 + seedB)) });
      stacked(lit, sd, { y0: yF, y1: yS, pick, color: i => mul(id.paint, tone(i + ki * 7 + seedB)) });
      band(lit, sd, { y0: yS, y1: yC, off: 0.004, cell: 'concrete', color: i => mul(id.stripe, tone(i + ki, 0.94, 1.06)) });
      features.push({ face, kind: 'stripe', s0: F.lo, s1: F.hi, y0: yS, y1: yC });
      // hazard-stripe kerb at the foot of the panels (not where a window comes down to it)
      if (id.kerb) {
        for (let s = 0; s < sd.len - 1e-6; s += 1) {
          const w = Math.min(1, sd.len - s);
          const t0 = s, t1 = s + w;
          const blocked = wins.some(q => { const t = Math.abs(q.s - (k === 'W' || k === 'E' ? sd.o[1] : sd.o[0])); return t + q.hw + 0.12 > t0 && t - q.hw - 0.12 < t1 && q.yb - 0.1 < yF + 0.17; });
          if (blocked) continue;
          const r = uvRect('hazard', 0, 50, 64 * w, 61);   // 11 rows of the diagonal stripes (the cell's last rows are a grey duct)
          lit.quad(pt(sd, s, yF, 0.012), pt(sd, s + w, yF, 0.012), pt(sd, s + w, yF + 0.17, 0.012), pt(sd, s, yF + 0.17, 0.012), corners(r), [1, 1, 1], [sd.n[0], 0, sd.n[1]]);
        }
      }
    });
    // cornice: a ledge 6 cm proud, all round (extends past the corners so the four meet)
    const co = uvRect('cornice', 0, 112, 64, 128), P = 0.06;
    lit.box(b.x0 - P, b.x1 + P, yC, b.roofY, b.z0 - P, b.z0, co, [1, 1, 1], 'nwet');
    lit.box(b.x0 - P, b.x1 + P, yC, b.roofY, b.z1, b.z1 + P, co, [1, 1, 1], 'swet');
    lit.box(b.x0 - P, b.x0, yC, b.roofY, b.z0, b.z1, co, [1, 1, 1], 'wt');
    lit.box(b.x1, b.x1 + P, yC, b.roofY, b.z0, b.z1, co, [1, 1, 1], 'et');
    roofPlate(lit, b, b.roofY, h => (h < 0.55 ? 'roofB' : h < 0.8 ? 'roofA' : 'roofC'), 40 + seedB);
    parapet(lit, b, b.roofY, 0.08, 0.12);
  }

  // Tubes: concrete skin, a metal roof, two raised collars where they meet the hulls. The two ends are open against the hulls (no cap:
  // a cap would be a wall inside the room's own wall).
  for (const l of LINKS) {
    const axisX = (l.x1 - l.x0) < (l.z1 - l.z0);   // the tube runs along x when it is the short way across (link-w / link-e)
    SIDES.filter(k => (axisX ? k === 'N' || k === 'S' : k === 'E' || k === 'W')).forEach((k, ki) => band(lit, sideOf(l, k), { y0: G, y1: l.roofY, cell: 'tube', color: i => mul([1, 1, 1], tone(i + ki + 3)) }));
    roofPlate(lit, l, l.roofY, h => (h < 0.6 ? 'roofA' : 'roofC'), 90);
    const c = uvRect('cornice', 0, 112, 64, 128), t = 0.07, up = l.roofY + 0.04;
    if (axisX) {
      for (const x of [l.x0 + 0.08, l.x1 - 0.08 - t]) lit.box(x, x + t, G, up, l.z0 - 0.04, l.z1 + 0.04, c, [1, 1, 1], 'nswet');
    } else {
      for (const z of [l.z0 + 0.08, l.z1 - 0.08 - t]) lit.box(l.x0 - 0.04, l.x1 + 0.04, G, up, z, z + t, c, [1, 1, 1], 'nswet');
    }
  }

  // The walkway of the alleys: a concrete slab on the regolith (cut around the tubes that cross it)
  const slabs = [];
  for (const a of alleys()) {
    let pieces = [[a.x0, a.x1, a.z0, a.z1]];
    for (const l of LINKS) {
      const next = [];
      for (const [x0, x1, z0, z1] of pieces) {
        if (l.x1 <= x0 || l.x0 >= x1 || l.z1 <= z0 || l.z0 >= z1) { next.push([x0, x1, z0, z1]); continue; }
        if (a.axis === 'x') { if (l.z0 > z0) next.push([x0, x1, z0, l.z0]); if (l.z1 < z1) next.push([x0, x1, l.z1, z1]); }
        else { if (l.x0 > x0) next.push([x0, l.x0, z0, z1]); if (l.x1 < x1) next.push([l.x1, x1, z0, z1]); }
      }
      pieces = next;
    }
    for (const [x0, x1, z0, z1] of pieces) {
      slabs.push({ x0, x1, z0, z1 });
      for (let x = x0, i = 0; x < x1 - 1e-6; x += 1, i++) for (let z = z0, j = 0; z < z1 - 1e-6; z += 1, j++) {
        const w = Math.min(1, x1 - x), d = Math.min(1, z1 - z), r = uvRect('concrete', 0, 0, 64 * w, 64 * d), k = 0.7 * (0.9 + 0.2 * hash(i + Math.floor(x0), j + Math.floor(z0), 61));
        lit.quad([x, G + 0.02, z], [x + w, G + 0.02, z], [x + w, G + 0.02, z + d], [x, G + 0.02, z + d], corners(r, Math.floor(hash(Math.floor(x), Math.floor(z), 62) * 4)), [k, k, k], [0, 1, 0]);
      }
    }
  }

  // The windows of the base seen from outside: lit glass in a frame, on the face of every hull that has one, at the same place as the pane
  // inside. The lit half of the glass is the room's lamp colour; slats (a 6 cm step darker every other one) are the blinds, and no flat
  // plate in a dithered facade.
  const windowsOnHulls = [];
  for (const q of onFaces) {
    const { w, b, k } = q;
    const id = IDENTITY[b.id], sd = sideOf(b, k);
    const { yb, yt } = q;
    windowsOnHulls.push(q);
    const s0 = Math.abs(q.s - ((k === 'W' || k === 'E') ? sd.o[1] : sd.o[0]));   // distance of the window's centre from the face's start
    const hw = q.hw, off = 0.014, fr = 0.05, gy = (yb + yt) / 2;
    const uvF = corners(uvRect('cornice', 0, 120, 64, 128));
    for (let y = yb, i = 0; y < yt - 1e-6; y += 0.06, i++) {
      const y2 = Math.min(y + 0.06, yt), kk = i % 2 ? 0.55 : 1;
      const c = (y + y2) / 2 <= gy ? mul(id.glass[0], kk) : mul(id.glass[1], kk);
      glow.quad(pt(sd, s0 - hw, y, off), pt(sd, s0 + hw, y, off), pt(sd, s0 + hw, y2, off), pt(sd, s0 - hw, y2, off), corners([0, 0, 1, 1]), c, [sd.n[0], 0, sd.n[1]]);
    }
    // frame: four bars, a sill and a mullion for a wide one (lit, a little proud)
    const bar = (sa, sb, ya, yb2) => lit.quad(pt(sd, sa, ya, off + 0.012), pt(sd, sb, ya, off + 0.012), pt(sd, sb, yb2, off + 0.012), pt(sd, sa, yb2, off + 0.012), uvF, [1, 1, 1], [sd.n[0], 0, sd.n[1]]);
    bar(s0 - hw - fr, s0 + hw + fr, yt, yt + fr);
    bar(s0 - hw - fr, s0 + hw + fr, yb - fr * 1.4, yb);
    bar(s0 - hw - fr, s0 - hw, yb, yt);
    bar(s0 + hw, s0 + hw + fr, yb, yt);
    if (w.w > 0.95) bar(s0 - 0.015, s0 + 0.015, yb, yt);
    if (w.h > 1.0) bar(s0 - hw, s0 + hw, gy - 0.015, gy + 0.015);
  }

  // The skylight of the atrium seen from outside: a lit pane in a thin frame, lying on the roof. Every face of it looks UP, so from inside
  // (where the pane of the real skylight looks out) it is culled and the view stays free.
  for (const w of windows) {
    if (w.kind !== 'skylight') continue;
    const b = BLOCKS.find(q => w.x > q.x0 && w.x < q.x1 && w.z > q.z0 && w.z < q.z1);
    if (!b) continue;
    const id = IDENTITY[b.id], y = b.roofY + 0.03, hw = w.w / 2, hd = w.d / 2, fr = 0.06;
    for (let i = 0; i < 8; i++) {
      const z0 = w.z - hd + (i * 2 * hd) / 8, z1 = z0 + (2 * hd) / 8, kk = i % 2 ? 0.6 : 1;
      glow.quad([w.x - hw, y, z0], [w.x + hw, y, z0], [w.x + hw, y, z1], [w.x - hw, y, z1], corners([0, 0, 1, 1]), mul(i < 4 ? id.glass[0] : id.glass[1], kk), [0, 1, 0]);
    }
    const uvF = corners(uvRect('cornice', 0, 120, 64, 128));
    const bar = (x0, x1, z0, z1) => lit.quad([x0, y + 0.012, z0], [x1, y + 0.012, z0], [x1, y + 0.012, z1], [x0, y + 0.012, z1], uvF, [1, 1, 1], [0, 1, 0]);
    bar(w.x - hw - fr, w.x + hw + fr, w.z - hd - fr, w.z - hd); bar(w.x - hw - fr, w.x + hw + fr, w.z + hd, w.z + hd + fr);
    bar(w.x - hw - fr, w.x - hw, w.z - hd, w.z + hd); bar(w.x + hw, w.x + hw + fr, w.z - hd, w.z + hd);
    bar(w.x - 0.02, w.x + 0.02, w.z - hd, w.z + hd);
  }

  // Footprints the props must respect: hulls, tubes, drifts (ctx.clear tests them).
  const berms = bermsOf();
  const footprints = [
    ...BLOCKS.map(b => ({ id: b.id, kind: 'block', x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1 })),
    ...LINKS.map(l => ({ id: l.id, kind: 'link', x0: l.x0, x1: l.x1, z0: l.z0, z1: l.z1 })),
    ...berms.map(m => ({ id: `${m.id}-berm`, kind: 'berm', x0: m.x0 - m.e.w, x1: m.x1 + m.e.e, z0: m.z0 - m.e.n, z1: m.z1 + m.e.s })),
    // the alleys between the blocks are the windows' view: nothing lies there (no rock, no prop) but what is hung on the walls and strung across
    ...alleys().map(a => ({ id: `alley:${a.id}`, kind: 'alley', x0: a.x0, x1: a.x1, z0: a.z0, z1: a.z1 })),
  ];

  lap('meshes');
  return {
    lit, glow, berms, footprints, windowsOnHulls, slabs, features, timing,
    texture: sheet.texture,
    dispose() { sheet.texture.dispose(); },
  };
}
