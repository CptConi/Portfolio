import * as THREE from 'three';
import { Pix } from './pixels.js';
import { prefs } from '../prefs.js';

// The notes of the level, drawn (data/notes.js says where and what, features/notes.js lets the visitor read
// them): a yellow post-it, a rivetted plaque, a white label with a red border, a paper tag on a string.
// They are scenery. The words are on the card, so what is painted here is only the look of the object:
// scribble lines, engraved bars, a barcode. Everything is pixel art drawn from plain byte arrays (no canvas,
// no asset), at 3.75 mm per texel, on one atlas.
//
// An unread note is a touch brighter and wears a faint warm halo that breathes slowly; once read it dims and
// shows a small green tick, the halo gone. That is the whole cue: no bubble, no glow worth a name (the halo
// peaks well under the bloom threshold), nothing that moves toward the visitor. Reduced motion: a steady halo.
//
// Cost: two draw calls for every note of the level: one alpha-tested mesh for the paper, one additive mesh
// for the halos. Both are static geometry, except the plate of a sprite pillar (`billboard`), which is turned
// to the camera, like the sprite, by rewriting its four vertices when the heading changes. No light, no new
// texture per note, no allocation in update().
//
//   paintNote(carrier, { seed, read, finish, mark }) → Pix   one painted cell (pure, node-safe)
//   createNoteProps(scene, entries) → { setRead(id), setHidden(id, hidden), update(t, player), corners(id),
//                                       dispose() }
//     entries: [{ id, carrier, voice, pose }], pose as in data/notes.js PLACEMENTS

const TEXEL = 0.00375;                 // m per texel
export const CARRIERS = Object.freeze({
  postit:  { w: 40, h: 40 },           // 0.150 × 0.150 m
  plaque:  { w: 56, h: 32 },           // 0.210 × 0.120 m
  sticker: { w: 48, h: 32 },           // 0.180 × 0.120 m
  tag:     { w: 32, h: 60 },           // 0.120 × 0.225 m, its top 8 texels are the string
});
export const sizeOf = carrier => ({ w: CARRIERS[carrier].w * TEXEL, h: CARRIERS[carrier].h * TEXEL });

const LIFT = 0.006;                    // m off the surface; the halo sits 3 mm behind the paper
const GUTTER = 6;                      // transparent texels around every cell: mipmaps must not mix neighbours
const ATLAS = { w: 512, h: 256 };

// Brightness of the paper (linear vertex colour). The bloom pass starts at a luminance of 0.72 and a post-it
// is the brightest thing in a room: kept under it, a note stands out by its colour and never by a glare.
const LEVEL = { unread: 0.74, read: 0.5 };
const HALO = { base: 0.2, amp: 0.07, rate: 1.3, grow: 1.5 };     // opacity, its breathing, size relative to the note
const HALO_TINT = { nicolas: [1.0, 0.74, 0.34], systeme: [0.55, 0.84, 1.0], chat: [1.0, 0.5, 0.74] };

// ── Painting ─────────────────────────────────────────────────────────────────────────────────────
const mulberry = seed => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const clear = (p, x, y) => p.set(x, y, 0, 0);
const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];   // bottom-left, bottom-right, top-right, top-left

// Something handwritten: a 1 px line that wobbles every two texels and breaks into words.
function scribble(p, x, y, len, ink, rng) {
  let k = 0;
  while (k < len) {
    const word = 3 + Math.floor(rng() * 6);
    for (let i = 0; i < word && k < len; i++, k++) p.set(x + k, y + ((k >> 1) & 1), ink);
    k += 2;
  }
}

// The "read" mark: a green tick with a dark shadow.
function tick(p, x, y) {
  const rows = ['......##', '.....##.', '##..##..', '.####...', '..##....'];
  p.grid(rows, { '#': 0x0b3d1a }, x + 1, y + 1);
  p.grid(rows, { '#': 0x2fe066 }, x, y);
}

function paintPostit(p, { rng, read }) {
  const PAPER = 0xffe45e, HI = 0xfff390, LO = 0xf2c933, EDGE = 0xd3a519, INK = 0x28367e;
  p.rect(0, 0, 40, 40, PAPER).rect(0, 0, 40, 3, HI).rect(0, 29, 40, 11, LO);
  p.rect(0, 39, 40, 1, EDGE).rect(39, 0, 1, 40, EDGE);

  // Tape across the top edge, slightly askew.
  p.poly([[10, -1], [30, 1], [30, 6], [10, 4]], 0xece3c4);
  p.line(10, 4, 30, 6, 0xb5aa82).line(10, 0, 30, 1, 0xf7f1da);

  // Handwriting: four lines, the last one short.
  for (let i = 0; i < 4; i++) {
    const len = i === 3 ? 8 + Math.floor(rng() * 7) : 20 + Math.floor(rng() * 14);
    scribble(p, 5, 12 + i * 5, len, INK, rng);
  }

  // The bottom-right corner curls up: cut it, then draw the flap that lies back over the paper.
  const C = 10;
  for (let y = 40 - C; y < 40; y++) for (let x = 40 - C; x < 40; x++) if (x + y >= 80 - C) clear(p, x, y);
  for (let y = 40 - C; y < 40; y++) {
    for (let x = 40 - C; x < 40; x++) {
      const s = x + y;
      if (s < 80 - C - 1) p.set(x, y, s < 80 - C - 4 ? 0xfff6bd : 0xffeb86);   // the back of the paper, lighter
      else if (s === 80 - C - 1) p.set(x, y, 0xb38a14);                          // the fold
    }
  }
  if (read) tick(p, 4, 31);
}

const FINISH = {
  steel: { base: 0xa9b2ba, hi: 0xe4eaef, lo: 0x666f77, ink: 0x30373d, streaks: [0xb8c0c7, 0x9aa3ab] },
  brass: { base: 0xcaa24b, hi: 0xf4de93, lo: 0x80601b, ink: 0x45300f, streaks: [0xd6b05a, 0xbb923b] },
};

function paintPlaque(p, { rng, read, finish }) {
  const F = FINISH[finish] ?? FINISH.steel;
  p.rect(0, 0, 56, 32, F.base);
  // Brushed metal: short horizontal streaks, one row at a time.
  for (let y = 1; y < 31; y++) {
    for (let x = 1; x < 55;) {
      const len = 4 + Math.floor(rng() * 9);
      if (rng() < 0.55) p.rect(x, y, Math.min(len, 55 - x), 1, F.streaks[rng() < 0.5 ? 0 : 1]);
      x += len;
    }
  }
  p.rect(0, 0, 56, 1, F.hi).rect(0, 0, 1, 32, F.hi).rect(0, 31, 56, 1, F.lo).rect(55, 0, 1, 32, F.lo);
  p.frame(3, 3, 50, 26, F.lo).rect(4, 28, 48, 1, F.hi).rect(52, 4, 1, 25, F.hi);

  // Four rivets.
  for (const [cx, cy] of [[6, 6], [49, 6], [6, 25], [49, 25]]) {
    p.disc(cx + 0.5, cy + 0.5, 2.2, F.lo).disc(cx, cy, 1.7, F.hi).set(cx - 1, cy - 1, 0xeef2f5);
  }

  // Engraved lines: a dark groove with a light lip under it.
  const lines = [[9, 14 + Math.floor(rng() * 8)], [15, 28 + Math.floor(rng() * 10)], [21, 20 + Math.floor(rng() * 16)]];
  for (const [y, len] of lines) {
    for (let x = 0; x < len;) {
      const bar = 3 + Math.floor(rng() * 5);
      const w = Math.min(bar, len - x);
      p.rect(10 + x, y, w, 2, F.ink).rect(10 + x, y + 2, w, 1, F.hi);
      x += bar + 2;
    }
  }
  if (read) tick(p, 34, 24);
}

function paintSticker(p, { rng, read }) {
  const WHITE = 0xf3f0e8, RED = 0xcf2a2a, INK = 0x5a5a62, DARK = 0x1c1c21;
  p.rect(0, 0, 48, 32, WHITE).frame(0, 0, 48, 32, RED).frame(1, 1, 46, 30, RED);
  p.rect(4, 4, 15, 6, RED).rect(6, 6, 4, 2, WHITE).rect(12, 6, 5, 2, WHITE);
  scribble(p, 5, 13, 26 + Math.floor(rng() * 8), INK, rng);
  scribble(p, 5, 17, 14 + Math.floor(rng() * 10), INK, rng);
  // Barcode.
  for (let x = 5; x < 42;) {
    const bar = 1 + Math.floor(rng() * 2);
    p.rect(x, 21, bar, 8, DARK);
    x += bar + 1 + Math.floor(rng() * 2);
  }
  if (read) tick(p, 34, 5);
}

function paintTag(p, { rng, read, mark }) {
  const KRAFT = 0xcba267, EDGE = 0x8d6934, HI = 0xe4c58f, INK = 0x3a2810;
  p.poly([[5, 15], [11, 8], [21, 8], [27, 15], [27, 58], [5, 58]], KRAFT);
  p.rect(5, 15, 1, 43, EDGE).rect(26, 15, 1, 43, EDGE).rect(5, 57, 22, 1, EDGE);
  p.line(5, 14, 10, 8, EDGE).line(21, 8, 26, 14, EDGE);
  p.rect(11, 9, 10, 1, HI).rect(6, 16, 1, 40, HI);

  // The eyelet and the string up to the knot at the very top (the tag hangs from the edge of its host).
  p.disc(16, 16, 4.4, 0xefe0b8).disc(16, 16, 2.5, 0x2b1d0c);
  for (let y = 0; y < 12; y++) p.set(15 + ((y >> 1) & 1), y, 0xe9dfc2).set(16 + ((y >> 1) & 1), y, 0xb4a680);
  p.rect(14, 0, 4, 2, 0x6b4a22);

  for (let i = 0; i < 3; i++) scribble(p, 8, 28 + i * 5, 11 + Math.floor(rng() * 9), INK, rng);

  if (mark === 'paw') {
    p.ellipse(20, 50, 3.4, 2.8, INK);
    for (const [cx, cy] of [[15.5, 45.8], [18, 43.5], [22, 43.5], [24.5, 45.8]]) p.disc(cx, cy, 1.5, INK);
  }
  if (read) tick(p, 7, 49);
}

const PAINTERS = { postit: paintPostit, plaque: paintPlaque, sticker: paintSticker, tag: paintTag };

// Colours under transparent texels take the colour of the nearest opaque ones, so that mipmapped edges blend
// into the paper instead of into black. Alpha stays 0 in the end.
function bleed(p, passes) {
  const filled = [];
  for (let n = 0; n < passes; n++) {
    const next = [];
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        if (p.alpha(x, y) > 0) continue;
        for (const [dx, dy] of NEIGHBOURS) {
          if (p.alpha(x + dx, y + dy) > 0) { next.push([x, y, p.get(x + dx, y + dy)]); break; }
        }
      }
    }
    for (const [x, y, c] of next) { p.set(x, y, c, 1); filled.push(y * p.w + x); }   // alpha 1: a source for the next pass
  }
  for (const i of filled) p.data[i * 4 + 3] = 0;
}

export function paintNote(carrier, { seed = 1, read = false, finish = 'steel', mark = null } = {}) {
  const { w, h } = CARRIERS[carrier];
  const p = new Pix(w, h);
  PAINTERS[carrier](p, { rng: mulberry(seed), read, finish, mark });
  return p;
}

const hashOf = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

// Cells side by side in shelves, `GUTTER` texels of their own colour (alpha 0) all round.
function packAtlas(cells) {
  const atlas = new Pix(ATLAS.w, ATLAS.h);
  let x = 0, y = 0, rowH = 0;
  const order = cells.map((c, i) => i).sort((a, b) => cells[b].pix.h - cells[a].pix.h);
  for (const i of order) {
    const { pix } = cells[i];
    const cw = pix.w + 2 * GUTTER, ch = pix.h + 2 * GUTTER;
    if (x + cw > ATLAS.w) { x = 0; y += rowH; rowH = 0; }
    if (y + ch > ATLAS.h) throw new RangeError('notes atlas full');
    const ox = x + GUTTER, oy = y + GUTTER;
    atlas.copy(pix, ox, oy);
    for (let j = -GUTTER; j < pix.h + GUTTER; j++) {
      for (let k = -GUTTER; k < pix.w + GUTTER; k++) {
        if (j >= 0 && j < pix.h && k >= 0 && k < pix.w) continue;
        const sx = Math.min(pix.w - 1, Math.max(0, k)), sy = Math.min(pix.h - 1, Math.max(0, j));
        const c = pix.get(sx, sy);
        atlas.set(ox + k, oy + j, c, 0);
      }
    }
    cells[i].uv = {
      u0: ox / ATLAS.w, u1: (ox + pix.w) / ATLAS.w,
      v0: 1 - (oy + pix.h) / ATLAS.h, v1: 1 - oy / ATLAS.h,
    };
    x += cw;
    rowH = Math.max(rowH, ch);
  }
  return atlas;
}

// Soft rectangular falloff: opaque inside 1/HALO.grow of the way to the edge, fading to nothing at the edge.
function haloTexture() {
  const S = 32, p = new Pix(S, S);
  const inner = 1 / HALO.grow;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const e = Math.max(Math.abs(x + 0.5 - S / 2), Math.abs(y + 0.5 - S / 2)) / (S / 2);
      const k = e <= inner ? 1 : Math.max(0, 1 - (e - inner) / (1 - inner));
      p.set(x, y, 0xffffff, Math.round(255 * k * k));
    }
  }
  const t = p.toTexture();
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  return t;
}

// ── Geometry ─────────────────────────────────────────────────────────────────────────────────────
const _c = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();

// Writes the four corners (bottom-left, bottom-right, top-right, top-left) of a w × h quad.
function writeQuad(arr, i, c, r, u, w, h) {
  const hw = w / 2, hh = h / 2;
  let o = i * 12;
  for (const [sx, sy] of CORNERS) {
    arr[o++] = c.x + r.x * hw * sx + u.x * hh * sy;
    arr[o++] = c.y + r.y * hw * sx + u.y * hh * sy;
    arr[o++] = c.z + r.z * hw * sx + u.z * hh * sy;
  }
}

function collapse(arr, i, c) {
  for (let k = 0; k < 4; k++) { arr[i * 12 + k * 3] = c.x; arr[i * 12 + k * 3 + 1] = c.y; arr[i * 12 + k * 3 + 2] = c.z; }
}

// Basis of a note on a surface that faces [fx, fz], leans back by `tilt` and is turned by `roll` in its own
// plane: r = toward the viewer's right, u = up along the surface, n = out of it.
function basis(pose, r, u, n) {
  const [fx, fz] = pose.facing;
  const ct = Math.cos(pose.tilt), st = Math.sin(pose.tilt);
  r.set(fz, 0, -fx);
  u.set(-fx * st, ct, -fz * st);
  n.set(fx * ct, st, fz * ct);
  const cr = Math.cos(pose.roll), sr = Math.sin(pose.roll);
  const rr = _r.copy(r).multiplyScalar(cr).addScaledVector(u, sr);
  const uu = _u.copy(u).multiplyScalar(cr).addScaledVector(r, -sr);
  r.copy(rr); u.copy(uu);
}

export function createNoteProps(scene, entries) {
  const N = entries.length;

  // One unread and one read cell per note.
  const cells = [];
  for (const e of entries) {
    const seed = hashOf(e.id);
    const look = { seed, finish: e.pose.finish, mark: e.pose.mark };
    for (const read of [false, true]) {
      const pix = paintNote(e.carrier, { ...look, read });
      bleed(pix, 3);
      cells.push({ pix });
    }
  }
  const atlasPix = packAtlas(cells);
  const map = atlasPix.toTexture({ mip: true });
  const haloMap = haloTexture();

  const pos = new Float32Array(N * 12), hpos = new Float32Array(N * 12);
  const uv = new Float32Array(N * 8);
  const col = new Float32Array(N * 12), hcol = new Float32Array(N * 12);
  const index = new Uint16Array(N * 6);
  const items = entries.map((e, i) => {
    const scale = e.pose.scale ?? 1;
    const size = { w: sizeOf(e.carrier).w * scale, h: sizeOf(e.carrier).h * scale };
    const it = {
      id: e.id, i, pose: e.pose, size, read: false, hidden: false,
      cells: [cells[i * 2], cells[i * 2 + 1]],
      tint: HALO_TINT[e.voice] ?? HALO_TINT.nicolas,
      base: new THREE.Vector3(e.pose.x, e.pose.y, e.pose.z),
      r: new THREE.Vector3(), u: new THREE.Vector3(), n: new THREE.Vector3(),
    };
    basis(e.pose, it.r, it.u, it.n);
    index.set([0, 1, 2, 0, 2, 3].map(k => k + i * 4), i * 6);
    paint(it);
    place(it);
    return it;
  });
  const byId = new Map(items.map(it => [it.id, it]));

  // UVs, vertex colours and (re)placement of one note.
  function paint(it) {
    const { u0, u1, v0, v1 } = it.cells[it.read ? 1 : 0].uv;
    uv.set([u0, v0, u1, v0, u1, v1, u0, v1], it.i * 8);
    const k = it.read ? LEVEL.read : LEVEL.unread;
    const [tr, tg, tb] = it.read ? [0, 0, 0] : it.tint;
    for (let v = 0; v < 4; v++) {
      col.set([k, k, k], it.i * 12 + v * 3);
      hcol.set([tr, tg, tb], it.i * 12 + v * 3);
    }
  }

  function place(it) {
    if (it.hidden) { collapse(pos, it.i, it.base); collapse(hpos, it.i, it.base); return; }
    _c.copy(it.base).addScaledVector(it.n, LIFT);
    writeQuad(pos, it.i, _c, it.r, it.u, it.size.w, it.size.h);
    _c.copy(it.base).addScaledVector(it.n, LIFT / 2);
    writeQuad(hpos, it.i, _c, it.r, it.u, it.size.w * HALO.grow, it.size.h * HALO.grow);
  }

  const paperGeo = new THREE.BufferGeometry();
  const attr = (a, n) => new THREE.BufferAttribute(a, n);
  const posAttr = attr(pos, 3), uvAttr = attr(uv, 2), colAttr = attr(col, 3);
  paperGeo.setAttribute('position', posAttr).setAttribute('uv', uvAttr).setAttribute('color', colAttr).setIndex(new THREE.BufferAttribute(index, 1));
  const haloGeo = new THREE.BufferGeometry();
  const hposAttr = attr(hpos, 3), hcolAttr = attr(hcol, 3);
  haloGeo.setAttribute('position', hposAttr).setAttribute('uv', attr(new Float32Array(N * 8).map((_, k) => [0, 0, 1, 0, 1, 1, 0, 1][k % 8]), 2))
    .setAttribute('color', hcolAttr).setIndex(new THREE.BufferAttribute(index, 1));

  const paperMat = new THREE.MeshBasicMaterial({
    map, vertexColors: true, alphaTest: 0.5,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const haloMat = new THREE.MeshBasicMaterial({
    map: haloMap, vertexColors: true, transparent: true, opacity: HALO.base,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const paper = new THREE.Mesh(paperGeo, paperMat);
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.renderOrder = 2;
  // Static but for one billboard, and spread over the whole level: culling would only cost bounds updates.
  paper.frustumCulled = halo.frustumCulled = false;
  scene.add(paper, halo);

  const billboards = items.filter(it => it.pose.billboard);
  let heading = NaN;

  const touch = () => {
    posAttr.needsUpdate = hposAttr.needsUpdate = true;
  };

  return {
    // Dims the paper, shows the tick, puts the halo out.
    setRead(id, read = true) {
      const it = byId.get(id);
      if (!it || it.read === read) return;
      it.read = read;
      paint(it);
      uvAttr.needsUpdate = colAttr.needsUpdate = hcolAttr.needsUpdate = true;
    },

    // A note stuck to a console must not show in the view of that console's screen.
    setHidden(id, hidden) {
      const it = byId.get(id);
      if (!it || it.hidden === hidden) return;
      it.hidden = hidden;
      if (it.pose.billboard) heading = NaN;
      place(it);
      touch();
    },

    update(t, player) {
      haloMat.opacity = prefs.reducedMotion ? HALO.base : HALO.base + HALO.amp * Math.sin(t * HALO.rate);
      // A plate on a sprite faces the screen, as the sprite does (the view plane, not the player's position).
      if (billboards.length && player.angle !== heading) {
        heading = player.angle;
        const sx = -Math.sin(heading), sz = Math.cos(heading);
        for (const it of billboards) {
          it.r.set(sx, 0, sz);
          it.u.set(0, 1, 0);
          it.n.set(-Math.cos(heading), 0, -Math.sin(heading));
          place(it);
        }
        touch();
      }
    },

    // World position of the four corners of a note (bottom-left, bottom-right, top-right, top-left).
    corners(id) {
      const it = byId.get(id);
      return it ? Array.from({ length: 4 }, (_, k) => [pos[it.i * 12 + k * 3], pos[it.i * 12 + k * 3 + 1], pos[it.i * 12 + k * 3 + 2]]) : null;
    },

    dispose() {
      scene.remove(paper, halo);
      for (const d of [paperGeo, haloGeo, paperMat, haloMat, map, haloMap]) d.dispose();
    },
  };
}
