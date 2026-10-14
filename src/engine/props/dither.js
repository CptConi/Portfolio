// Doom-style shading helpers for the procedural sprites: ordered dithering, hash noise and a few
// earth-tone ramps. Pure maths (no three.js, no DOM), so the pixel art builds in node as well.
//
// The look to imitate is Doom's: indexed colours, banded ramps, a stipple where a modern painter
// would blend, grainy "clay model" surfaces. Colours come from ramps (dark → light, 0xRRGGBB);
// a light value v in 0..1 picks a step, and dithering blends two neighbouring steps.

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const BAYER2 = [0, 2, 3, 1];

// Ordered-dither thresholds in 0..1 for pixel (x, y).
export const bayer4 = (x, y) => (BAYER4[((y & 3) << 2) | (x & 3)] + 0.5) / 16;
export const bayer2 = (x, y) => (BAYER2[((y & 1) << 1) | (x & 1)] + 0.5) / 4;

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

// Deterministic white noise in 0..1 for an integer lattice point.
export function hash(x, y, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Smooth value noise in 0..1 (scale the coordinates yourself: noise(x / 4, y / 4) is a 4 px grain).
export function noise(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Colour of `ramp` for light value v (0 = darkest step, 1 = lightest), dithered between the two
// nearest steps with an ordered matrix (bayer4 by default; bayer2 gives a coarser checker).
export function ditherRamp(ramp, v, x, y, matrix = bayer4) {
  const f = clamp01(v) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(f));
  return ramp[i + (f - i > matrix(x, y) ? 1 : 0)];
}

// Same, hard bands (posterised, no dithering).
export const bandRamp = (ramp, v) => ramp[Math.min(ramp.length - 1, Math.floor(clamp01(v) * ramp.length))];

// Doom-ish earth tones, dark → light. Pick from these so that every sprite sits in the same palette
// as the wall textures instead of introducing candy colours.
export const RAMPS = {
  brown: [0x1b1008, 0x2f1c0e, 0x47301a, 0x624526, 0x7f5c33, 0x9d7744, 0xbf9a5c],
  rust:  [0x2b0f06, 0x4b1d0a, 0x7a3410, 0xa84e17, 0xd0702a, 0xeb9a4c],
  olive: [0x0b1a0b, 0x143018, 0x1f4a22, 0x2f6a2c, 0x4a8a38, 0x74ae4e],
  steel: [0x15171a, 0x2a2e33, 0x41464d, 0x5c636c, 0x7c848e],
  bone:  [0x3a3226, 0x6b5f48, 0x9d8f6f, 0xc8bb98],
  eye:   [0x6a4a00, 0xc08a00, 0xffc61a, 0xfff08a],
};
