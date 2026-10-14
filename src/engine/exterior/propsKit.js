import * as THREE from 'three';
import { Pix } from '../props/pixels.js';
import { Atlas, Batch, xf, flipped } from '../props/kit.js';
import { hash, noise, bayer4, ditherRamp } from '../props/dither.js';

// Tools of the exterior props dresser (props.js): a deterministic rng, a 3x5 stencil font, the painted atlas of the dressing, and the
// small solid builders (boxes, tubes, panels, rocks, dishes) that every merged mesh of the exterior props is made of.
//
//   Kit    holds the atlas and the THREE batches the props are poured into:
//            lit     opaque, Lambert-lit solids (casts and receives the sun's shadows)
//            decal   flush graphics: stencils, paint, tyre tracks, boot prints, the pad (alpha-tested, never casts)
//            glow    unlit light (lamps, indicator LEDs, the dithered pools of light on the walls): additive
//   Every colour handed to a batch is an sRGB hex (three converts it to linear); atlas pixels are sRGB too.

export const D2R = Math.PI / 180;

// mulberry32: the same stream on every machine (no Math.random anywhere in the exterior)
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Colour helpers on 0xRRGGBB ──────────────────────────────────────────────────────────────────
export const mulC = (c, k) => {
  const r = Math.min(255, Math.max(0, (((c >> 16) & 255) * k) | 0)), g = Math.min(255, Math.max(0, (((c >> 8) & 255) * k) | 0)), b = Math.min(255, Math.max(0, ((c & 255) * k) | 0));
  return (r << 16) | (g << 8) | b;
};
export const mixC = (a, b, t) => {
  const r = (((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t) | 0, g = (((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t) | 0, bl = ((a & 255) * (1 - t) + (b & 255) * t) | 0;
  return (r << 16) | (g << 8) | bl;
};

// ── Stencil font (3 x 5), caps and digits ────────────────────────────────────────────────────────
const FONT = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'], C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'], E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'], H: ['#.#', '#.#', '###', '#.#', '#.#'], I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'], K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'], N: ['##.', '#.#', '#.#', '#.#', '#.#'], O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'], Q: ['.#.', '#.#', '#.#', '##.', '.##'], R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'], U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'], W: ['#.#', '#.#', '###', '###', '#.#'], X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'], Z: ['###', '..#', '.#.', '#..', '###'],
  0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['##.', '..#', '.#.', '#..', '###'],
  3: ['##.', '..#', '.#.', '..#', '##.'], 4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '##.', '..#', '##.'],
  6: ['.##', '#..', '###', '#.#', '###'], 7: ['###', '..#', '.#.', '.#.', '.#.'], 8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '##.'],
  '-': ['...', '...', '###', '...', '...'], '.': ['.', '.', '.', '.', '#'], ' ': ['..', '..', '..', '..', '..'],
  '/': ['..#', '..#', '.#.', '#..', '#..'],
  // accented capitals are eight rows tall: the three rows above the cap height hold the accent (two pixels, then a blank row between it and the letter)
  '\u00c9': ['..#', '.#.', '...', '###', '#..', '##.', '#..', '###'],   // É
  '\u00c8': ['#..', '.#.', '...', '###', '#..', '##.', '#..', '###'],   // È
};
export const textWidth = str => { let w = 0; for (const ch of str) w += (FONT[ch] ?? FONT[' '])[0].length + 1; return Math.max(0, w - 1); };
// rows a string needs above its 5 row cap height (the accents)
export const textRows = str => { let up = 0; for (const ch of str) up = Math.max(up, (FONT[ch] ?? FONT[' ']).length - 5); return up; };
// `scale` pixels per font pixel; `y` is the top of the cap height (accents go above it); returns the width drawn
export function drawText(p, str, x, y, color, scale = 1) {
  let cx = x;
  for (const ch of str) {
    const g = FONT[ch] ?? FONT[' '], up = g.length - 5;
    for (let j = 0; j < g.length; j++) for (let i = 0; i < g[j].length; i++) if (g[j][i] === '#') p.rect(cx + i * scale, y + (j - up) * scale, scale, scale, color);
    cx += (g[0].length + 1) * scale;
  }
  return cx - x - scale;
}

// ── The atlas ────────────────────────────────────────────────────────────────────────────────────
// One 512 px sheet for every painted surface of the props. Cells are 64 px per metre where they hold detail (a hatch door, a tray) and
// stretch where they do not (a plate on a box). Opaque cells fill their whole rectangle; stencils and decals are alpha-tested masks.
function metal(p, w, h, base, seed, { grain = 0.07, bevel = 0.3, rivets = true, streak = 0 } = {}) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let k = 1 + (hash(x, y, seed) - 0.5) * 2 * grain;
      if (streak) k *= 1 - streak * hash(x, 5, seed + 3) * (0.3 + 0.7 * y / h);
      if (x === 0 || y === 0) k *= 1 + bevel; else if (x === w - 1 || y === h - 1) k *= 1 - bevel;
      p.set(x, y, mulC(base, k));
    }
  }
  if (rivets) for (const [x, y] of [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]]) { p.set(x, y, mulC(base, 0.55)); p.set(x + 1, y + 1, mulC(base, 1.3)); }
}

function rustBlotches(p, w, h, seed, amount = 0.5) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const n = noise(x / 5, y / 5, seed) * 0.6 + noise(x / 2, y / 2, seed + 1) * 0.4;
    const low = 0.25 + 0.75 * (y / h);
    if (n * low > 0.52 - amount * 0.25) {
      const c = p.get(x, y);
      p.set(x, y, mixC(c, n > 0.7 ? 0x8a4f26 : 0x5e3a22, 0.7));
    }
  }
}

// The names of the buildings, written on their hulls (props.js): one mask each, read with Kit.sign(text)
export const SIGN_TEXTS = ['ARMURERIE', 'CAPACIT\u00c9S', 'TROPH\u00c9ES', 'SUCC\u00c8S', 'QUARTIERS', 'ATRIUM', 'PROD', 'DF-01'];
export const signKey = str => `t:${str}`;

export function paintAtlas() {
  const atlas = new Atlas(512);
  const cell = {};
  const add = (name, w, h, fn, inset = 0.02) => {
    const r = atlas.paint(w, h, fn);
    cell[name] = { r, uv: atlas.uv(r, inset), w, h };
    return cell[name];
  };

  // equipment housings
  add('plate', 32, 32, p => metal(p, 32, 32, 0x586270, 11));
  add('plateLight', 32, 32, p => metal(p, 32, 32, 0x8d949c, 12, { grain: 0.05 }));
  add('plateDark', 32, 32, p => metal(p, 32, 32, 0x2f353d, 13));
  add('plateRust', 32, 32, p => { metal(p, 32, 32, 0x58606a, 14); rustBlotches(p, 32, 32, 21, 0.8); });
  add('louvre', 32, 32, p => {
    p.rect(0, 0, 32, 32, 0x20252b);
    p.frame(0, 0, 32, 32, 0x707a86); p.frame(1, 1, 30, 30, 0x3a414a);
    for (let y = 3; y < 29; y += 4) { p.rect(3, y, 26, 2, 0x5f6975); p.rect(3, y + 2, 26, 1, 0x0c0e11); }
  });
  add('hazard', 32, 8, p => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 32; x++) p.set(x, y, ((x + y) >> 2) & 1 ? 0x17181b : mulC(0xcaa31d, 0.9 + 0.2 * hash(x, y, 31)));
  });
  add('tray', 64, 16, p => {
    p.rect(0, 0, 64, 16, 0x14161a);
    for (let x = 0; x < 64; x += 8) p.rect(x, 0, 2, 16, 0x464d56);
    p.rect(0, 0, 64, 2, 0x707a86); p.rect(0, 2, 64, 1, 0x2d333a); p.rect(0, 14, 64, 2, 0x565e69); p.rect(0, 13, 64, 1, 0x2d333a);
    const cables = [[4, 0x22252b], [6, 0x7a2a22], [8, 0x23446f], [11, 0x1c1e23]];
    for (const [y, c] of cables) for (let x = 0; x < 64; x++) { p.set(x, y, mulC(c, 0.8 + 0.4 * hash(x, y, 41))); p.set(x, y + 1, mulC(c, 0.6)); }
  });

  // a rusty hatch door with its stencil: the face of the atrium that hides the push-wall
  add('door', 56, 72, p => {
    metal(p, 56, 72, 0x4b535d, 51, { grain: 0.09, bevel: 0.25, rivets: false, streak: 0.18 });
    for (let x = 0; x < 56; x++) { p.set(x, 0, 0x151a1f); p.set(x, 71, 0x151a1f); }
    p.frame(0, 0, 56, 72, 0x2a3037);
    p.frame(3, 3, 50, 66, 0x3a424b); p.frame(4, 4, 48, 64, 0x657080);
    for (let y = 8; y < 68; y += 12) { p.rect(6, y, 4, 7, 0x20262c); p.rect(6, y + 1, 3, 2, 0x76808c); }          // hinges
    for (let i = 0; i < 12; i++) { p.set(48, 8 + i * 5, 0x1a1e23); p.set(47, 7 + i * 5, 0x8a95a2); }                // rivet line
    // hand wheel
    p.disc(38, 40, 7, 0x1d2227); p.disc(38, 40, 6, 0x9aa3ad); p.disc(38, 40, 4, 0x2b3138); p.disc(38, 40, 1.5, 0xb0b8c0);
    p.line(32, 40, 44, 40, 0x9aa3ad); p.line(38, 34, 38, 46, 0x9aa3ad); p.line(34, 36, 42, 44, 0x7c858f); p.line(42, 36, 34, 44, 0x7c858f);
    rustBlotches(p, 56, 72, 61, 0.95);
    // faded stencil: two lines, yellow gone to dust
    const st = (str, x, y) => drawText(p, str, x, y, 0xb59a3c);
    st('NO DEPLOY', 11, 12); st('ON FRIDAY', 11, 20);
    // wear: knock a third of the stencil out so it reads as faded paint
    for (let y = 10; y < 28; y++) for (let x = 8; x < 50; x++) if (hash(x, y, 71) < 0.32 && p.get(x, y) === 0xb59a3c) p.set(x, y, 0x6a6247);
  });

  // cable and light
  add('stripBox', 32, 32, p => { metal(p, 32, 32, 0x3a424c, 15); p.rect(7, 6, 18, 20, 0x14181c); p.frame(7, 6, 18, 20, 0x6d7782); });

  // solar cells: 6 x 4 cells of 8 px; the back is a pale sheet with ribs
  add('solarF', 48, 32, p => {
    const ramp = [0x0b1633, 0x112349, 0x182f5c, 0x213d72];
    for (let y = 0; y < 32; y++) for (let x = 0; x < 48; x++) {
      const gx = x % 8, gy = y % 8;
      if (gx === 0 || gy === 0) { p.set(x, y, 0x98a2b0); continue; }
      if (gx === 4) { p.set(x, y, 0x45577a); continue; }
      const v = 0.3 + 0.5 * ((x + y * 0.6) / 66) + (hash(x, y, 81) - 0.5) * 0.25;
      p.set(x, y, ditherRamp(ramp, v, x, y));
    }
    for (let i = 0; i < 40; i++) p.set((hash(i, 1, 82) * 48) | 0, (hash(i, 2, 82) * 32) | 0, 0x7388b6);
    p.frame(0, 0, 48, 32, 0xb6bdc7);
  });
  add('solarB', 24, 16, p => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) p.set(x, y, mulC(x % 6 < 1 ? 0x9a978d : 0xd0ccc0, 0.92 + 0.16 * hash(x, y, 85)));
    p.rect(15, 2, 6, 4, 0x2a2d32); p.frame(15, 2, 6, 4, 0x555b63);
  });

  // thermal foils (the lander's gold, the rover's silver)
  const foil = (ramp, seed) => p => {
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const v = noise(x / 3.2, y / 2.6, seed) * 0.7 + noise(x / 1.4, y / 1.2, seed + 1) * 0.3;
      p.set(x, y, ditherRamp(ramp, v, x, y));
    }
  };
  add('foilGold', 32, 32, foil([0x3c2406, 0x6c430c, 0x9d6a16, 0xcf9a2e, 0xeac565], 91));
  add('foilSilver', 32, 32, foil([0x2a2d33, 0x555a62, 0x848a92, 0xb4b9c0, 0xd4d8dc], 93));

  // painted tanks: a seam every 16 px, an orange band, a stencil
  const tank = (label, seed) => p => {
    for (let y = 0; y < 64; y++) for (let x = 0; x < 32; x++) {
      let k = 1 + (hash(x, y, seed) - 0.5) * 0.12;
      k *= 1 - 0.18 * hash(x, 9, seed + 2) * (0.2 + 0.8 * y / 64);
      if (y % 16 === 0) k *= 0.62; else if (y % 16 === 1) k *= 1.18;
      p.set(x, y, mulC(0xa4abb2, k));
    }
    for (let y = 26; y < 31; y++) for (let x = 0; x < 32; x++) p.set(x, y, y === 26 || y === 30 ? 0x7a3a14 : mulC(0xc4631d, 0.9 + 0.2 * hash(x, y, seed + 4)));
    drawText(p, label, ((32 - textWidth(label)) >> 1) + 1, 38, 0x2a3038);
    drawText(p, 'DF', 14, 50, 0x2a3038);
    for (let i = 0; i < 26; i++) p.set((hash(i, 3, seed + 5) * 32) | 0, (hash(i, 4, seed + 5) * 64) | 0, 0x6d737a);
  };
  add('tankA', 32, 64, tank('H2O', 101));
  add('tankB', 32, 64, tank('O2', 103));
  add('tankC', 32, 64, tank('H2', 105));

  add('dishMesh', 16, 16, p => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, mulC((x + y) % 3 === 0 ? 0x3d434a : 0xa3a8ae, 0.92 + 0.16 * hash(x, y, 111)));
  });
  add('rock', 32, 32, p => {
    const ramp = [0x3a3c3f, 0x54575b, 0x6e7276, 0x898d92, 0xa6aaae];
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const v = noise(x / 6, y / 6, 121) * 0.55 + noise(x / 2.2, y / 2.2, 122) * 0.45;
      p.set(x, y, ditherRamp(ramp, 0.15 + v * 0.75, x, y, (xx, yy) => 0.5 * bayer4(xx, yy) + 0.5 * hash(xx, yy, 123)));
    }
    for (let i = 0; i < 18; i++) { const x = (hash(i, 1, 124) * 30) | 0, y = (hash(i, 2, 124) * 30) | 0; p.set(x, y, 0x1b1c1e); p.set(x + 1, y, 0x1b1c1e); }
  });

  // shipping containers: corrugated sides (ribs every 3 px), faded paint, a stencil; crates: a plate with a hazard band
  add('container', 64, 32, p => {
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
      const rib = x % 4 < 2 ? 1.0 : 0.78;
      p.set(x, y, mulC(0x6d8796, rib * (0.92 + 0.16 * hash(x, y, 151)) * (y < 2 || y > 29 ? 0.65 : 1)));
    }
    rustBlotches(p, 64, 32, 152, 0.5);
    drawText(p, 'DF-04', 6, 12, 0xd2d6d2);
    p.rect(2, 2, 60, 1, 0x3b4a53);
  });
  add('crate', 32, 32, p => {
    metal(p, 32, 32, 0x77714f, 153, { grain: 0.09 });
    for (let x = 0; x < 32; x++) for (let y = 4; y < 9; y++) p.set(x, y, ((x + y) >> 2) & 1 ? 0x15161a : 0xc29f22);
    p.frame(3, 12, 26, 17, 0x4c4730); p.line(3, 12, 28, 28, 0x4c4730);
  });
  // the flag: a field with the mark, a pale border, wrinkles
  add('flag', 40, 26, p => {
    for (let y = 0; y < 26; y++) for (let x = 0; x < 40; x++) {
      const wr = 1 + 0.14 * Math.sin(x * 0.55 + y * 0.12) + (hash(x, y, 131) - 0.5) * 0.07;
      p.set(x, y, mulC(0x15566a, wr));
    }
    p.frame(0, 0, 40, 26, 0xc7ccd0); p.frame(1, 1, 38, 24, 0x0f3f50);
    drawText(p, 'DF', 9, 6, 0xcdd1cb, 3);
  });
  // a road sign for the plain: a green board, white border, the arrow points to the viewer's left
  add('signEarth', 96, 20, p => {
    p.rect(0, 0, 96, 20, 0x17603f);
    p.frame(0, 0, 96, 20, 0xbfc4bf); p.frame(2, 2, 92, 16, 0xbfc4bf);
    const msg = 'EARTH 384400 KM';
    const w = textWidth(msg);
    const x0 = 7 + 11 + ((96 - 14 - 11 - w) >> 1);
    drawText(p, msg, x0, 7, 0xc9cec9);
    p.poly([[5, 10], [10, 5], [10, 8], [15, 8], [15, 12], [10, 12], [10, 15]], 0xc9cec9);
    for (let i = 0; i < 30; i++) p.set((hash(i, 1, 133) * 96) | 0, (hash(i, 2, 133) * 20) | 0, 0x0c3a26);
  });

  // the Trophées' emblem: a gold cup (16 x 16, transparent around it)
  add('cup', 16, 16, p => {
    const L = 0xf2d684, M = 0xd6a232, D = 0x93651a, X = 0x3c2406;
    p.poly([[2, 1], [14, 1], [13, 5], [11, 8.5], [10, 9.5], [6, 9.5], [5, 8.5], [3, 5]], X);
    p.poly([[3, 2], [13, 2], [12, 5], [10.4, 8], [5.6, 8], [4, 5]], M);
    p.rect(3, 2, 2, 3, L); p.rect(4, 5, 1, 2, L); p.rect(10, 4, 3, 4, D); p.rect(5, 2, 7, 1, L);
    for (const [x0, x1] of [[0, 2], [13, 15]]) { p.rect(x0, 2, 3, 1, X); p.rect(x0, 6, 3, 1, X); p.rect(x1 === 2 ? 0 : 15, 3, 1, 3, X); p.rect(x1 === 2 ? 1 : 14, 3, 1, 3, M); }
    p.rect(7, 9, 2, 3, X); p.rect(7, 9, 1, 3, M);
    p.rect(4, 12, 8, 2, X); p.rect(5, 12, 6, 1, M); p.rect(5, 13, 6, 1, D);
    p.rect(3, 14, 10, 2, X); p.rect(4, 14, 8, 1, M); p.rect(4, 15, 8, 1, D);
  });

  // masks (white on nothing: the vertex colour tints them)
  const mask = (name, str, scale = 1) => {
    const up = textRows(str) * scale;   // accents rise above the cap height
    return add(name, textWidth(str) * scale + 2, 5 * scale + up + 2, p => drawText(p, str, 1, 1 + up, 0xffffff, scale), 0);
  };
  mask('mDF', 'DF', 1); mask('mPROD', 'PROD', 1); mask('mHull', 'DF-01', 1); mask('mHull2', 'A-07', 1); mask('mN', 'N', 1);
  mask('mDF2', 'DF', 2);
  for (const str of SIGN_TEXTS) mask(signKey(str), str, 1);
  add('mGrime', 32, 32, p => { for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const n = noise(x / 4, y / 4, 141) * 0.7 + hash(x, y, 142) * 0.3; if (n > 0.62) p.set(x, y, 0xffffff); } });
  add('tread', 16, 16, p => {                       // a tyre track, 16 px = 1 m long, 0.25 m wide: chevrons of cleats
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.abs(x - 7.5), chev = ((y + d) % 4) < 2.2;
      if (d < 7.5 && (chev || d > 6.2)) p.set(x, y, 0xffffff);
    }
  });
  add('boot', 8, 12, p => { p.rect(1, 0, 6, 5, 0xffffff); p.rect(2, 5, 4, 2, 0xffffff); p.rect(1, 8, 6, 4, 0xffffff); for (let x = 1; x < 7; x += 2) p.set(x, 2, 0); });
  add('chevron', 16, 16, p => {                     // pad marking: a chevron
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const d = Math.abs(x - 7.5); if (Math.abs(y - (14 - d * 1.5)) < 2) p.set(x, y, 0xffffff); }
  });
  // the pool of light a lamp throws on a wall: a smooth falloff in alpha; the glow material cuts it into game pixels with the exterior's own
  // ordered dither (props.js), so it reads as a Doom light pool and never as a magnified checkerboard
  add('pool', 48, 48, p => {
    for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
      const d = Math.hypot(x - 23.5, y - 23.5) / 24;
      const v = Math.max(0, 1 - d);
      p.set(x, y, 0xffffff, Math.round(255 * Math.min(1, v * v * 1.25)));
    }
  }, 0);
  return { atlas, cell };
}

// ── Geometry caches ──────────────────────────────────────────────────────────────────────────────
const _geo = new Map();
const cached = (key, make) => { if (!_geo.has(key)) _geo.set(key, make()); return _geo.get(key); };
export const unitBox = () => cached('box', () => new THREE.BoxGeometry(1, 1, 1));
export const unitCyl = (seg = 10, open = false) => cached(`cyl${seg}${open}`, () => new THREE.CylinderGeometry(1, 1, 1, seg, 1, open));
export const unitPlane = () => cached('plane', () => new THREE.PlaneGeometry(1, 1));
export const domeGeo = (seg = 12, rings = 5) => cached(`dome${seg}${rings}`, () => new THREE.SphereGeometry(1, seg, rings, 0, Math.PI * 2, 0, Math.PI / 2));
export const sphereGeo = (seg = 10, rings = 7) => cached(`sph${seg}${rings}`, () => new THREE.SphereGeometry(1, seg, rings));

// A rock: a low-poly icosahedron whose vertices are pushed by value noise of their direction (the same point always moves the same,
// so the faces meet), flat-shaded (non-indexed: one normal per face).
export function rockGeo(seed, detail = 1, rough = 0.28) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const n = noise(x * 2.1 + 9.1, y * 2.1 + z * 1.7 + 3.3, seed) * 0.7 + noise(z * 3.9 + 1.3, x * 3.7 + y * 2.9, seed + 7) * 0.3;
    const k = 1 + (n - 0.5) * 2 * rough;
    P.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  return g;
}

// A paraboloid dish of unit radius, axis +y, focal depth `depth` (rim height over the vertex): lathe of the profile.
export function dishGeo(depth = 0.32, seg = 18, rings = 6) {
  const pts = [];
  for (let i = 0; i <= rings; i++) { const r = i / rings; pts.push(new THREE.Vector2(r, r * r * depth)); }
  const g = new THREE.LatheGeometry(pts, seg);
  g.computeVertexNormals();
  return g;
}

const _up = new THREE.Vector3(0, 1, 0), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _v3 = new THREE.Vector3();
// (the batches read the matrix they are handed at once and keep none of it: these temporaries are passed as they are, nothing is cloned per solid)
const _r = new THREE.Vector3(), _u2 = new THREE.Vector3();

// ── The kit ──────────────────────────────────────────────────────────────────────────────────────
// A batch that tells its kit which vertices every add() produced, so that the geometry can be traced back to the thing that made it
// (Kit.item): the proofs (check-exterior.mjs) test every object against the face, roof or ground it stands on.
class TrackedBatch extends Batch {
  constructor(atlas, name, kit) { super(atlas); this.name = name; this._kit = kit; }
  add(geo, opts) {
    const v0 = this.pos.length / 3, i0 = this.idx.length;
    super.add(geo, opts);
    this._kit._record(this, v0, i0);
    return this;
  }
}

export class Kit {
  // `shared` = another kit's { atlas, cell }: the same painted sheet, so that a second kit (the plain, poured later) shares the materials
  constructor(shared = null) {
    const { atlas, cell } = shared ?? paintAtlas();
    this.atlas = atlas;
    this.cell = cell;
    this.lit = new TrackedBatch(atlas, 'lit', this);
    this.decal = new TrackedBatch(atlas, 'decal', this);
    this.glow = new TrackedBatch(atlas, 'glow', this);
    this.items = [];          // every described object: { id, kind, host, …, ranges: [{ batch, v0, v1, i0, i1 }] }
    this.untracked = 0;       // geometry poured outside any item (the proofs demand none)
    this._scope = null;
    this.tris = 0;
  }
  // Everything poured into the batches while `fn` runs belongs to ONE described object. kind: 'wall' (hangs on a face: host 'block.F'),
  // 'roof' (stands on a roof: host = block id), 'ground' (on the plain), 'cable' (strung between two points, stays between its ends)
  item(id, meta, fn) {
    if (this._scope) throw new Error(`item ${id} nested in ${this._scope.id}`);
    const sc = { id, ...meta, ranges: [], kit: this };
    this._scope = sc;
    try { fn(); } finally { this._scope = null; }
    this.items.push(sc);
    return sc;
  }
  _record(batch, v0, i0) {
    const sc = this._scope;
    if (!sc) { this.untracked++; return; }
    const v1 = batch.pos.length / 3, i1 = batch.idx.length, last = sc.ranges[sc.ranges.length - 1];
    if (last && last.batch === batch.name && last.v1 === v0) { last.v1 = v1; last.i1 = i1; } else sc.ranges.push({ batch: batch.name, v0, v1, i0, i1 });
  }
  // uv rectangle of the mask of a sign text (see SIGN_TEXTS)
  sign(str) { return this.uv(signKey(str)); }
  uv(name) { const c = this.cell[name]; if (!c) throw new Error(`no atlas cell ${name}`); return c.uv; }
  get white() { return this.atlas.whiteUV; }

  // an axis-aligned box from its corners; `cell` = one cell on every face, or `faces` = { px, nx, py, ny, pz, nz } cell names (the rest use `cell`)
  boxMM(b, x0, x1, y0, y1, z0, z1, { cell = null, color = 0xffffff, faces = null } = {}) {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, h = y1 - y0, d = z1 - z0;
    if (!faces) {
      _m.compose(_s.set(cx, cy, cz), _q.identity(), _v3.set(w, h, d));
      return b.add(unitBox(), { matrix: _m, color, uv: cell ? this.uv(cell) : null });
    }
    const F = (name, def) => (name ? this.uv(name) : def);
    const def = cell ? this.uv(cell) : null;
    const colorOf = color;
    const q = (nx, ny, nz, ww, hh, name, px, py, pz) => this.quadAt(b, [px, py, pz], [nx, ny, nz], ww, hh, { uv: F(name, def), color: colorOf });
    q(1, 0, 0, d, h, faces.px, x1, cy, cz); q(-1, 0, 0, d, h, faces.nx, x0, cy, cz);
    q(0, 1, 0, w, d, faces.py, cx, y1, cz); q(0, -1, 0, w, d, faces.ny, cx, y0, cz);
    q(0, 0, 1, w, h, faces.pz, cx, cy, z1); q(0, 0, -1, w, h, faces.nz, cx, cy, z0);
    return b;
  }

  // a box from its centre, optionally turned about y
  box(b, cx, cy, cz, w, h, d, { yaw = 0, cell = null, color = 0xffffff, faces = null } = {}) {
    if (!yaw) return this.boxMM(b, cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2, cz - d / 2, cz + d / 2, { cell, color, faces });
    if (!faces) {
      _m.compose(_s.set(cx, cy, cz), _q.setFromAxisAngle(_up, yaw), _v3.set(w, h, d));
      return b.add(unitBox(), { matrix: _m, color, uv: cell ? this.uv(cell) : null });
    }
    b.push(xf({ pos: [cx, cy, cz], rot: [0, yaw, 0] }));
    this.boxMM(b, -w / 2, w / 2, -h / 2, h / 2, -d / 2, d / 2, { cell, color, faces });
    b.pop();
    return b;
  }

  // a w × h rectangle at `pos` facing `normal`; its u axis runs to the right of a viewer who looks at it (right = up × normal), v is up.
  quadAt(b, pos, normal, w, h, { uv = null, color = 0xffffff, up = null } = {}) {
    _b.set(normal[0], normal[1], normal[2]).normalize();
    _a.set(0, 1, 0);
    if (up) _a.set(up[0], up[1], up[2]);
    if (Math.abs(_a.dot(_b)) > 0.98) _a.set(0, 0, -1);
    _r.crossVectors(_a, _b).normalize();
    _u2.crossVectors(_b, _r).normalize();
    _m.makeBasis(_r, _u2, _b).setPosition(pos[0], pos[1], pos[2]);
    _s.set(w, h, 1);
    _m.scale(_s);
    return b.add(unitPlane(), { matrix: _m, color, uv: uv ?? this.white });
  }

  // a rod / pipe / strut from p0 to p1 (round: radius r, `seg` sides; square: a box r x r across)
  tube(b, p0, p1, r, { seg = 8, color = 0xffffff, cell = null, caps = true, square = false } = {}) {
    _a.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    const len = _a.length();
    if (len < 1e-6) return b;
    _b.copy(_a).normalize();
    _q.setFromUnitVectors(_up, _b);
    _m.compose(_s.set((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2), _q, _v3.set(r, len, r));
    return b.add(square ? unitBox() : unitCyl(seg, !caps), { matrix: _m, color, uv: cell ? this.uv(cell) : null });
  }

  // a cone frustum standing on `base`: bottom radius rBot, top radius rTop, height h (a cached unit frustum, scaled)
  cone(b, base, rBot, rTop, h, { seg = 12, color = 0xffffff, cell = null } = {}) {
    const ratio = Math.round((rTop / rBot) * 200) / 200;
    const g = cached(`frustum${ratio}_${seg}`, () => new THREE.CylinderGeometry(ratio, 1, 1, seg));
    _m.compose(_s.set(base[0], base[1] + h / 2, base[2]), _q.identity(), _v3.set(rBot, h, rBot));
    return b.add(g, { matrix: _m, color, uv: cell ? this.uv(cell) : null });
  }
  // an upright cylinder from y0 up by h (a cached unit cylinder, scaled)
  cyl(b, cx, y0, cz, r, h, { seg = 12, color = 0xffffff, cell = null, caps = true } = {}) {
    _m.compose(_s.set(cx, y0 + h / 2, cz), _q.identity(), _v3.set(r, h, r));
    return b.add(unitCyl(seg, !caps), { matrix: _m, color, uv: cell ? this.uv(cell) : null });
  }

  // both faces of a thin shape, lit from either side
  twoSided(b, geo, opts) { b.add(geo, opts); b.add(flipped(geo), opts); return b; }

  // add a geometry with a free pose: position, yaw (about y), pitch/roll (about x / z), scale
  put(b, geo, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], color = 0xffffff, cell = null } = {}) {
    return b.add(geo, { matrix: xf({ pos, rot, scale }), color, uv: cell ? this.uv(cell) : null });
  }

  // A mound of dust: a flattened half-dome whose normals lean toward the Sun (like the plain's own: a drift keeps the brightness of the ground it
  // lies on instead of going dark at a 15 degree sun) but still tilt with the slope, so the lit side of a drift is brighter than the far side.
  mound(b, x, y, z, rx, h, rz, color, sun) {
    const g = domeGeo(10, 3).clone();
    const P = g.attributes.position, N = g.attributes.normal;
    for (let i = 0; i < P.count; i++) {
      const nx = N.getX(i), ny = N.getY(i), nz = N.getZ(i);
      P.setXYZ(i, x + P.getX(i) * rx, y + P.getY(i) * h, z + P.getZ(i) * rz);
      _a.set(sun.x + nx * 0.55, sun.y + ny * 0.2, sun.z + nz * 0.55).normalize();
      N.setXYZ(i, _a.x, _a.y, _a.z);
    }
    b.add(g, { color });
    g.dispose();
    return b;
  }

  // How many triangles the three batches hold, for the report
  count() { return [this.lit, this.decal, this.glow].map(b => b.idx.length / 3); }
}
