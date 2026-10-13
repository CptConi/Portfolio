import * as THREE from 'three';

// A small neon sign: pixel text (5 × 7 font, only the glyphs the lounge needs) drawn unlit and
// over-bright so it blooms, with a soft additive halo on the wall behind it.

const GLYPHS = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  G: ['.####', '#....', '#....', '#..##', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  "'": ['.#', '.#', '..', '..', '..', '..', '..'],
  ' ': ['...', '...', '...', '...', '...', '...', '...'],
};

const ACUTE = ['..#', '.#.'];   // drawn two rows above the letter, top right
const glyph = ch => GLYPHS[ch === 'É' ? 'E' : ch];

export const SIGN_ROWS = 9;

// Pixel width of `text` (glyphs separated by one column).
export function signWidth(text) {
  let w = 0;
  for (const ch of text) w += glyph(ch)[0].length + 1;
  return w - 1;
}

// Paints `text` in `color` onto a Pix, top-left at (ox, oy). Rows 0-1 hold the accents.
export function drawText(p, text, color, ox = 0, oy = 0) {
  let x = ox;
  for (const ch of text) {
    const g = glyph(ch);
    if (!g) throw new RangeError(`no glyph for ${ch}`);
    p.grid(g, { '#': color }, x, oy + 2);
    if (ch === 'É') p.grid(ACUTE, { '#': color }, x + 2, oy);
    x += g[0].length + 1;
  }
}

// Adds the sign to `L.bright` (the text quad) and `L.glow` (the halo).
//   rect   Atlas region (in L.hot) holding the painted text, SIGN_ROWS tall
//   at     { x, y, z } centre of the text on the wall      facing   [fx, fz] unit normal
//   pixel  world size of one font pixel (m)                  tint     halo colour
export function addSign(L, { rect, widthPx, at, facing = [0, 1], pixel = 0.0145, tint = 0x37c0ff }) {
  const { bright, glow, hot } = L;
  const w = widthPx * pixel, h = SIGN_ROWS * pixel;
  const yaw = Math.atan2(facing[0], facing[1]);
  const off = 0.014;
  // The painted region is wider than the text (atlas rows): map only the used columns.
  const uv = hot.uv({ x: rect.x, y: rect.y, w: widthPx, h: rect.h }, 0);
  bright.quad(w, h, { pos: [at.x + facing[0] * off, at.y, at.z + facing[1] * off], rot: [0, yaw, 0], uv,
    color: new THREE.Color().setRGB(1.5, 1.5, 1.5) });
  glow.quad(w + 0.7, h + 0.45, { pos: [at.x + facing[0] * 0.012, at.y, at.z + facing[1] * 0.012], rot: [0, yaw, 0],
    color: new THREE.Color(tint).multiplyScalar(0.33) });
}
