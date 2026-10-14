import * as THREE from 'three';
import { Pix } from './pixels.js';
import { RAMPS, ditherRamp, bayer4, hash, noise } from './dither.js';

// The house cat, as camera-facing pixel-art sprites (seen at 640x360, nearest-filtered, from 1.5-3.5 m).
// Reusable wherever a cat belongs:
//
//   const cat = createCat('sleeping');      // a curled tabby asleep, eyes shut, tiny "z z"
//   const eyes = createCat('eyes');          // two glowing eyes with slit pupils, watching from the dark
//   cat.object.position.set(x, y, z);        // origin = bottom centre (it sits on a surface)
//   scene.add(cat.object);
//   cat.update(t, calm);                     // every frame; `calm` (reduced motion) freezes it, eyes open
//   cat.dispose();
//
// Returns { kind, object: THREE.Group, width, height, update(t, calm), dispose() }.
// Width/height are the sprite's world size in metres. Kinds: 'sleeping' | 'eyes' | 'loaf'
// ('loaf' = a tabby loafing on a keyboard, eyes on the visitor; sits on a table-top, 0.42 m wide;
// it blinks slowly, twitches an ear and flicks its tail tip, and has react(t), which makes it squint
// contentedly for a few seconds).
// Every group carries userData.catKind, so a feature can find a cat that another module built.
//
// Art direction: an alley cat that has seen the bunker, painted the way Doom's monsters were. Earth-tone
// ramps (props/dither.js), light from the upper left, every surface a few banded tones with an ordered
// dither at the seams and a grain of stipple on top (a "digitised clay model"). No clean outline: the
// darkest tone sits on the shadow side, the lit side is thin and broken, the silhouette is ragged and
// tufted. A heavy brow shadow over small full-bright amber eyes with slit pupils, a dark nose, a flat
// downturned mouth, a nicked ear. At most ~24 colours per cat, all from the shared ramps.

const FUR = [RAMPS.brown[0], RAMPS.brown[1], RAMPS.rust[1], RAMPS.rust[2], RAMPS.rust[3], RAMPS.rust[4]];
const BONE = RAMPS.bone, STEEL = RAMPS.steel, EYE = RAMPS.eye;
const CREAM = [FUR[2], FUR[3], RAMPS.brown[5], RAMPS.brown[6]];   // the pale fur of muzzle, paws and tail tip, warm in the shade
const LED = RAMPS.olive[4];

// ── Drawing toolkit ──────────────────────────────────────────────────────────────────────

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, x) => { const u = clamp01((x - a) / (b - a)); return u * u * (3 - 2 * u); };

// Light from the upper left and the front, as a unit vector toward the light (x right, y down, z at the viewer).
const LIGHT = (() => { const v = [-0.58, -0.66, 0.48], n = Math.hypot(...v); return v.map(c => c / n); })();
const TOWARD_LIGHT = (() => { const n = Math.hypot(LIGHT[0], LIGHT[1]); return [LIGHT[0] / n, LIGHT[1] / n]; })();

// Ordered dither with a little grain in the threshold, so the pattern is not a perfect lattice.
const threshold = (x, y) => 0.8 * bayer4(x, y) + 0.2 * hash(x, y, 3);

// Colour of `ramp` for light v: flat bands with a narrow dithered seam between neighbouring steps.
function tone(ramp, v, x, y, seam = 0.55) {
  const f = clamp01(v) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(f));
  const u = clamp01((f - i - 0.5) / seam + 0.5);
  return ditherRamp(ramp, (i + u) / (ramp.length - 1), x, y, threshold);
}

// The same colour a few steps down (or up) its ramp, for contours, cast shadows and catch-lights.
const RAMP_LIST = [FUR, CREAM, BONE, STEEL, EYE];
function stepDown(c, n = 1) {
  for (const r of RAMP_LIST) {
    const i = r.indexOf(c);
    if (i >= 0) return r[Math.min(r.length - 1, Math.max(0, i - n))];
  }
  return c;
}
const deep = c => stepDown(c, 9);
const stepUp = c => stepDown(c, -1);

const maskOf = (p, draw) => { const m = new Pix(p.w, p.h); draw(m); return m; };

// How far inside the shape each of its pixels lies (px from the nearest outside pixel, 0.5 at the rim).
// Rows from `floor` down count as inside, so a shape that rests on something has no rim there.
// A two-pass chamfer transform: cheap enough to run for every pose at boot.
function depthOf(m, floor = Infinity) {
  const { w, h } = m, W = w + 2, D = 1.4142;
  const d = new Float32Array(W * (h + 2));
  for (let y = -1; y <= h; y++) {
    for (let x = -1; x <= w; x++) d[(y + 1) * W + x + 1] = x >= 0 && x < w && y >= 0 && (m.alpha(x, y) || y >= floor) ? 1e9 : 0;
  }
  for (let y = 1; y <= h; y++) {
    for (let x = 1; x <= w; x++) {
      const i = y * W + x;
      if (d[i]) d[i] = Math.min(d[i - 1] + 1, d[i - W] + 1, d[i - W - 1] + D, d[i - W + 1] + D);
    }
  }
  for (let y = h; y >= 1; y--) {
    for (let x = w; x >= 1; x--) {
      const i = y * W + x;
      if (d[i]) d[i] = Math.min(d[i], d[i + 1] + 1, d[i + W] + 1, d[i + W + 1] + D, d[i + W - 1] + D);
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = Math.max(0.5, d[(y + 1) * W + x + 1] - 0.5);
  return out;
}

// Paints a shape as a lump of clay: a rounded height field (quarter-circle profile, `R` px deep) lit from
// the upper left, plus grain and fur strokes. Options:
//   ramp       colours, dark to light (or a function (x, y) => ramp)
//   R          rim radius of the dome, in px
//   base/gain  ambient light and how much the light matters
//   grain      amplitude of the stipple; flow = [sx, sy] size of the fur streaks (px), fur = their strength
//   bias(x, y) extra light (negative = shade): stripes, brow shadow, contact shadows
//   ao         extra darkening toward the bottom of the image, where the cat rests on something
//   floor      the row where the shape meets its support: from there down it counts as solid (no rim)
//   shadow     the lump casts a hard shadow down and to the right on what is already painted
function lump(p, draw, o = {}) {
  const { ramp = FUR, R = 6, base = 0.1, gain = 1, grain = 0.08, flow = [1.4, 3.2], fur = 0.26, bias, seed = 1, shadow = true, ao = 0, floor = Infinity } = o;
  const m = maskOf(p, draw);
  const depth = depthOf(m, floor);
  const h = (x, y) => {
    if (y >= floor) return 1;
    if (!m.alpha(x, y)) return 0;
    const t = Math.min(depth[y * m.w + x], R) / R;
    return Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)));
  };

  if (shadow) {
    // The cast shadow of this lump on whatever is painted below it: hard, down and to the right.
    const marks = [];
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        if (m.alpha(x, y) || !p.alpha(x, y)) continue;
        if (m.alpha(x - 1, y - 1) || m.alpha(x, y - 1) || m.alpha(x - 1, y)) marks.push([x, y, 3]);
        else if (m.alpha(x - 2, y - 2) || m.alpha(x - 2, y - 1) || m.alpha(x - 1, y - 2)) marks.push([x, y, hash(x, y, 5) < 0.55 ? 1 : 0]);
      }
    }
    for (const [x, y, n] of marks) if (n) p.set(x, y, stepDown(p.get(x, y), n));
  }

  const K = R * 0.85;
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      if (!m.alpha(x, y)) continue;
      const gx = (h(x + 1, y) - h(x - 1, y)) * 0.5 * K, gy = (h(x, y + 1) - h(x, y - 1)) * 0.5 * K;
      const inv = 1 / Math.hypot(gx, gy, 1);
      const lam = Math.max(0, (-gx * LIGHT[0] - gy * LIGHT[1] + LIGHT[2]) * inv);
      let v = base + gain * lam;
      v += (hash(x, y, seed) - 0.5) * grain * 2;
      v += (noise(x / flow[0], y / flow[1], seed + 7) - 0.5) * fur;
      if (lam > 0.8 && hash(x, y, seed + 1) > 0.93) v += 0.3;           // a few hard highlights
      if (hash(x, y, seed + 2) > 0.95) v -= 0.3;                         // and some dark flecks
      if (ao) v -= ao * smooth(0.55, 1, y / p.h);                        // darker toward the ground
      if (bias) v += bias(x, y);
      const rp = typeof ramp === 'function' ? ramp(x, y) : ramp;
      p.set(x, y, tone(rp, v, x, y));
    }
  }
  return m;
}

// Catmull-Rom spline through `pts` ([x, y] pairs), sampled `n + 1` times with t in 0..1 along it.
function spline(pts, n = 160) {
  const g = i => pts[Math.max(0, Math.min(pts.length - 1, i))];
  const out = [];
  for (let k = 0; k <= n; k++) {
    const u = (k / n) * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(u)), f = u - i;
    const [p0, p1, p2, p3] = [g(i - 1), g(i), g(i + 1), g(i + 2)];
    const c = j => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * f + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * f * f + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * f * f * f);
    out.push({ x: c(0), y: c(1), t: k / n });
  }
  return out;
}

// A tapered tail along `pts`: `bands` ([t0, t1] along its length) are dark rings, the last `tip` fraction is pale.
function tail(p, pts, { r0, r1, bands, tip, seed = 4, base = 0.1 }) {
  const s = spline(pts);
  const near = (x, y) => {
    let best = Infinity, t = 0;
    for (const q of s) {
      const d = (q.x - x - 0.5) ** 2 + (q.y - y - 0.5) ** 2;
      if (d < best) { best = d; t = q.t; }
    }
    return t;
  };
  lump(p, m => { for (const q of s) m.disc(q.x, q.y, r0 + (r1 - r0) * q.t, 0xffffff); }, {
    R: 2.4, seed, base, flow: [2.2, 1.2], fur: 0.25,
    ramp: (x, y) => (near(x, y) > 1 - tip ? CREAM : FUR),
    bias: (x, y) => {
      const t = near(x, y);
      if (t > 1 - tip) return 0.1;
      return bands.some(([a, b]) => t >= a + 0.03 * (hash(x, y, 8) - 0.5) && t < b) ? -0.42 : 0;
    },
  });
}

// Lays the dark contour on the shadow side of the finished silhouette, thin and broken on the lit side, and
// frays the edge: a few pixels fall off the lit rim, a few stick out on the shadow rim (fur).
function contour(p, { fray = 1, ground = Infinity } = {}) {
  const snap = new Pix(p.w, p.h);
  snap.data.set(p.data);
  const on = (x, y) => snap.alpha(x, y) > 0;
  const edge = [], extra = [];
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      if (on(x, y)) {
        let nx = 0, ny = 0;
        if (!on(x - 1, y)) nx -= 1;
        if (!on(x + 1, y)) nx += 1;
        if (!on(x, y - 1)) ny -= 1;
        if (!on(x, y + 1)) ny += 1;
        if (nx || ny) edge.push([x, y, (nx * TOWARD_LIGHT[0] + ny * TOWARD_LIGHT[1]) / Math.hypot(nx, ny)]);
      } else {
        // A transparent pixel touching the cat on its shadow side may grow a pixel of dark fur.
        let nx = 0, ny = 0, c = 0;
        if (on(x - 1, y)) { nx -= 1; c = snap.get(x - 1, y); }
        if (on(x + 1, y)) { nx += 1; c = snap.get(x + 1, y); }
        if (on(x, y - 1)) { ny -= 1; c = snap.get(x, y - 1); }
        if (on(x, y + 1)) { ny += 1; c = snap.get(x, y + 1); }
        if ((nx || ny) && (nx * TOWARD_LIGHT[0] + ny * TOWARD_LIGHT[1]) / Math.hypot(nx, ny) > 0.3 && y < ground && hash(x, y, 21) < 0.2 * fray) extra.push([x, y, c]);
      }
    }
  }
  for (const [x, y, s] of edge) {
    const c = p.get(x, y);
    if (s < -0.25) p.set(x, y, deep(c));
    else if (s < 0.25) p.set(x, y, stepDown(c, 2));
    else if (hash(x, y, 22) < 0.3) p.set(x, y, stepDown(c, 2));
    else if (hash(x, y, 24) < 0.22) p.set(x, y, stepUp(c));                  // a hard catch-light on the lit rim
    else if (hash(x, y, 23) < 0.12 * fray && !snap.alpha(x - 1, y) === !snap.alpha(x, y - 1)) p.set(x, y, c, 0);   // chipped lit rim
  }
  for (const [x, y, c] of extra) p.set(x, y, deep(c));
}

// Lays `src` over `dst` (opaque pixels only).
function over(dst, src) {
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) if (src.alpha(x, y)) dst.set(x, y, src.get(x, y));
}

const mirrorPoly = (pts, mirror) => pts.map(([x, y]) => [mirror(x), y]);
const pixels = (p, list, c) => { for (const [x, y] of list) p.set(x, y, c); };

// ── Sleeping cat ─────────────────────────────────────────────────────────────────────────

export const SLEEPING_TEX = { w: 46, h: 33 };
export function paintSleepingCat(out) {
  // Painted one row short and dropped by one, so the cat's last row of fur is the sprite's last row (it sits on its crate).
  const p = new Pix(out.w, out.h - 1);
  const HX = 13.5, HY = 21.5;
  const mx = x => 2 * HX - 1 - x;       // pixel mirror about the face's axis
  const mxc = x => 2 * HX - x;          // continuous mirror
  const dark = (x, y, n) => { if (p.alpha(x, y)) p.set(x, y, stepDown(p.get(x, y), n)); };

  // Tail first (it is behind the body), lying along the ground with its tip curled up.
  tail(p, [[35, 29.6], [41, 29.6], [44, 26.4], [44, 22], [43, 18.6]], { r0: 2.3, r1: 1.9, bands: [[0.28, 0.38], [0.52, 0.62]], tip: 0.14, seed: 12, base: 0.42 });

  // Body: a big hunched bun, flat underneath, mackerel stripes from the spine.
  const spine = x => 19 - 12.5 * Math.sqrt(Math.max(0, 1 - ((x - 27) / 15) ** 2));
  lump(p, m => { m.ellipse(27, 19, 15, 12.5, 0xffffff); m.rect(0, 32, 46, 1, 0, 0); }, {
    R: 8, seed: 13, ao: 0.2, floor: 32, base: 0.27, flow: [1.2, 3.4], grain: 0.08, fur: 0.26,
    bias: (x, y) => {
      const reach = y - spine(x), len = 6 + 8 * noise(x / 2.2, 5.5, 16);
      if (reach < 0 || reach > len) return 0;
      const phase = (x + 2.2 * (noise(y / 4, x / 7, 13) - 0.5)) / 4.1;
      return phase - Math.floor(phase) < 0.5 * (1 - reach / len) + 0.14 ? -0.42 : 0;
    },
  });

  // Head and ears (one silhouette): ears pricked even in sleep, cheek ruffs, the right one nicked.
  const earL = [[2.8, 20], [4.2, 4.8], [12.8, 14.2]];
  const tuftL = [[3.2, 23], [0.8, 26.4], [3.8, 26.4], [2.8, 29.6], [7.2, 28.8]];
  lump(p, m => {
    m.ellipse(HX, HY, 11, 9.2, 0xffffff);
    m.poly(earL, 0xffffff);
    m.poly(mirrorPoly(earL, mxc), 0xffffff);
    m.poly(tuftL, 0xffffff);
    m.poly(mirrorPoly(tuftL, mxc), 0xffffff);
    m.poly([[24.6, 8], [22, 9.8], [24.6, 11.6]], 0, 0);
  }, {
    R: 5.5, seed: 14, flow: [1.6, 2.4], base: 0.4, grain: 0.05, fur: 0.18,
    bias: (x, y) => {
      const dx = Math.abs(x - (HX - 0.5));
      let b = 0;
      // The brow sinks over the shut eyes.
      const yc = 19 + 0.2 * Math.max(0, 6.5 - dx);
      if (y > 16 && dx < 11) b -= 0.62 * (1 - smooth(0.5, 1.5, Math.abs(y - yc)));
      return b;
    },
  });
  const hollow = poly => {
    const m = maskOf(p, q => q.poly(poly, 0xffffff));
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (m.alpha(x, y)) p.set(x, y, tone(FUR, 0.12 + 0.2 * hash(x, y, 33), x, y));
  };
  const inner = [[4.8, 17.4], [5.2, 8.6], [11, 14]];
  hollow(inner);
  hollow(mirrorPoly(inner, mxc));

  // Dark marks: the forehead's "M", cheek stripes.
  const darkLine = (x0, y0, x1, y1, n) => { const t = new Pix(p.w, p.h).line(x0, y0, x1, y1, 0xffffff); for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (t.alpha(x, y)) dark(x, y, n); };
  for (const [x0, y0, x1, y1] of [[13, 13, 13, 18], [14, 13, 14, 18], [10, 14, 11, 18], [17, 14, 16, 18], [7, 15, 9, 18], [20, 15, 18, 18]]) darkLine(x0, y0, x1, y1, 3);
  for (const [x, y, w] of [[3, 23, 4], [2, 25, 4]]) for (let i = 0; i < w; i++) { dark(x + i, y, 2); dark(mx(x + i), y, 2); }

  // Muzzle, nose, mouth.
  lump(p, m => { m.ellipse(11.9, 25.6, 2.8, 2.1, 0xffffff); m.ellipse(mxc(11.9), 25.6, 2.8, 2.1, 0xffffff); m.rect(12, 23, 3, 3, 0xffffff); }, { ramp: CREAM, R: 2, seed: 15, base: 0.45, gain: 0.85, shadow: false, grain: 0.04, fur: 0.1 });
  pixels(p, [[12, 24], [13, 24], [14, 24], [15, 24], [13, 25], [14, 25]], FUR[2]);
  p.set(12, 24, FUR[4]);
  pixels(p, [[13, 26], [14, 26], [12, 27], [11, 27], [10, 28], [15, 27], [16, 27], [17, 28]], FUR[0]);

  // Shut eyes: two slanted slits under the brow, a thin lit lid beneath each.
  for (const [x, y] of [[5, 21], [6, 21], [7, 22], [8, 22], [9, 22]]) { p.set(x, y, FUR[0]); p.set(mx(x), y, FUR[0]); }
  for (const [x, y] of [[5, 22], [6, 22], [7, 23], [8, 23]]) { p.set(x, y, FUR[5]); p.set(mx(x), y, FUR[5]); }

  // Front paws under the chin.
  for (const cx of [8, 19]) {
    lump(p, m => m.ellipse(cx, 29.8, 3.8, 2.1, 0xffffff), { ramp: CREAM, R: 2.2, seed: 17, base: 0.4, gain: 0.85, floor: 32 });
    for (const dx of [-1.2, 1.2]) { const x = Math.floor(cx + dx); dark(x, 30, 2); dark(x, 31, 2); }
  }
  contour(p, { ground: 32 });
  out.copy(p, 0, 1);
}

// ── Eyes in the dark ─────────────────────────────────────────────────────────────────────

export const EYES_TEX = { w: 20, h: 8 };
const EYE_SHAPE = ['####...', '#######', '#######', '.######', '..####.'];   // the left eye: the lid slants down toward the nose
export function paintEyes(p, glance = 0) {
  const AX = 10;                          // the axis between the two eyes (between pixels 9 and 10)
  const lit = new Pix(p.w, p.h), slit = new Pix(p.w, p.h);
  for (const side of [-1, 1]) {
    const X = c => (side < 0 ? 2 + c : 2 * AX - 1 - (2 + c));
    EYE_SHAPE.forEach((row, j) => {
      for (let c = 0; c < 7; c++) {
        if (row[c] !== '#') continue;
        const rim = row[c - 1] !== '#' || row[c + 1] !== '#';
        // Brighter toward the lower, inner corner; the rim a step dimmer.
        const v = 0.28 + 0.16 * j + (side < 0 ? 0.02 * c : 0.02 * (6 - c)) - (rim ? 0.14 : 0);
        lit.set(X(c), 2 + j, tone(EYE, v, X(c), 2 + j));
      }
      // The slit pupil: dark, one pixel wide, slid by the glance; the lids stay lit around it.
      const sc = 3 + (side < 0 ? glance : -glance);
      if (j >= 1 && j <= 3 && row[sc] === '#') slit.set(X(sc), 2 + j, 0xffffff);
    });
  }
  // A banded, dithered glow around them: denser and warm close by, a thin stipple further out.
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      if (lit.alpha(x, y)) { if (!slit.alpha(x, y)) p.set(x, y, lit.get(x, y)); continue; }
      let d = Infinity;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (lit.alpha(x + dx, y + dy)) d = Math.min(d, Math.hypot(dx, dy));
      if (d <= 1.01 && (x + y) % 2 === 0) p.set(x, y, FUR[3]);                       // a checker next to the eye
      else if (d <= 2.01 && d > 1.01 && x % 2 === 0 && y % 2 === 0) p.set(x, y, FUR[2]);   // a sparser lattice beyond
    }
  }
}

// ── Loafing cat ──────────────────────────────────────────────────────────────────────────

export const LOAF_TEX = { w: 56, h: 44 };
export function paintLoaf(p, { eyes = 'open', ear = 0, tail: flick = 0 } = {}) {
  const AX = 26;                         // the face's axis (continuous x); the tail takes the room on the right
  const mx = x => 2 * AX - 1 - x;        // pixel mirror about that axis
  const mxc = x => 2 * AX - x;           // continuous mirror

  // Keyboard under the cat: worn steel, one row of keycaps, a front lip, one LED; in shade toward the right.
  const kb = new Pix(p.w, p.h);
  for (let y = 37; y < 44; y++) {
    for (let x = 1; x < 53; x++) {
      const cell = (x - 2) & 3;
      let v;
      if (y === 37) v = 0.1;
      else if (y < 40) {
        v = cell < 3 ? (y === 38 ? 0.84 : 0.6) : 0.12;
        if (cell < 3 && hash(x >> 2, 0, 41) < 0.14) v -= 0.22;                // a dead key
      } else v = y === 40 ? 0.3 : y === 41 ? 0.78 : y === 42 ? 0.5 : 0.1;
      v += (hash(x, y, 40) - 0.5) * 0.04 - 0.24 * smooth(14, 52, x);
      kb.set(x, y, tone(STEEL, v, x, y));
    }
  }
  for (let y = 37; y < 44; y++) kb.set(52, y, STEEL[0]);
  kb.set(49, 42, LED);

  const cat = new Pix(p.w, p.h);

  // Tail, curling up behind the right shoulder; the tip curls in, or flicks up, or flicks out.
  const base = [[44, 34], [50, 31], [52.5, 26], [51.5, 20.5]];
  const ends = [[[48.5, 17], [45.6, 18.4]], [[50.8, 15.5], [49.4, 11.8]], [[52.6, 16.8], [53, 13.6]]];
  tail(cat, [...base, ...ends[flick]], { r0: 2.5, r1: 1.9, bands: [[0.34, 0.44], [0.62, 0.72]], tip: 0.1 });

  // Body: a loaf, flat underneath and round on top, mackerel stripes hanging from the spine.
  const spine = x => 31 - 10 * Math.sqrt(Math.max(0, 1 - ((x - 26) / 23) ** 2));
  lump(cat, m => { m.ellipse(26, 31, 23, 10, 0xffffff); m.rect(3, 31, 46, 6, 0xffffff); m.rect(0, 37, 56, 7, 0, 0); }, {
    R: 10, seed: 2, ao: 0.22, floor: 37, base: 0.25, flow: [1.2, 3.6],
    bias: (x, y) => {
      const reach = y - spine(x), len = 4 + 6 * noise(x / 2.2, 2.5, 6);
      if (reach < 0 || reach > len) return 0;
      const phase = (x + 2.2 * (noise(y / 4, x / 7, 3) - 0.5)) / 4.3;
      return phase - Math.floor(phase) < 0.5 * (1 - reach / len) + 0.14 ? -0.42 : 0;
    },
  });

  // Head with its two ears (one silhouette), cheek ruffs, the right ear nicked.
  const earL = ear ? [[9.4, 14.5], [5.6, 4.4], [21, 8.6]] : [[9.4, 14.5], [11, 0.6], [22, 7.6]];
  const earR = [[42.6, 14.5], [40.8, 0.6], [30, 7.6]];
  const tuftL = [[11.5, 18], [7.6, 22.4], [11.2, 22.2], [9.6, 26.6], [15, 25]];
  const browY = x => 12 + 0.42 * Math.max(0, 9.5 - Math.abs(x - 25.5));
  lump(cat, m => {
    m.ellipse(26, 17.5, 15, 10.5, 0xffffff);
    m.poly(earL, 0xffffff);
    m.poly(earR, 0xffffff);
    m.poly(tuftL, 0xffffff);
    m.poly(mirrorPoly(tuftL, mxc), 0xffffff);
    m.poly([[42.6, 3.2], [39.2, 5.4], [42.6, 7.6]], 0, 0);
  }, {
    R: 8, seed: 3, flow: [1.6, 2.4], base: 0.26,
    bias: (x, y) => {
      const dx = Math.abs(x - 25.5);
      let b = 0;
      // Heavy brow: a dark band slanting down toward the nose; the eye sockets sink a little.
      if (y > 9 && dx < 15) b -= 0.6 * (1 - smooth(0.8, 2.2, Math.abs(y - browY(x))));
      if (y > 11 && y < 19 && dx > 2.5 && dx < 11.5) b -= 0.15;
      return b;
    },
  });
  // Inner ears: dark hollows, stippled.
  const hollow = (poly, side) => {
    const m = maskOf(cat, q => q.poly(poly, 0xffffff));
    for (let y = 0; y < cat.h; y++) for (let x = 0; x < cat.w; x++) {
      if (!m.alpha(x, y)) continue;
      const v = 0.12 + 0.2 * hash(x, y, 31) + (side < 0 ? 0.08 * (x - 12) / 8 : 0);
      cat.set(x, y, tone(FUR, v, x, y));
    }
  };
  hollow(ear ? [[11.2, 13], [8.4, 6.6], [19.2, 9.6]] : [[12, 12.4], [12.4, 3.6], [19.6, 8.4]], -1);
  hollow([[40, 12.4], [39.6, 3.6], [32.4, 8.4]], 1);

  // Dark marks on the fur: the forehead's "M", cheek stripes.
  const dark = (list, n) => { for (const [x, y] of list) if (cat.alpha(x, y)) cat.set(x, y, stepDown(cat.get(x, y), n)); };
  const darkLine = (x0, y0, x1, y1, n) => { const t = new Pix(p.w, p.h).line(x0, y0, x1, y1, 0xffffff); for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (t.alpha(x, y)) dark([[x, y]], n); };
  for (const [x0, y0, x1, y1] of [[25, 5, 25, 11], [26, 5, 26, 11], [22, 6, 23, 10], [29, 6, 28, 10], [18, 8, 20, 11], [33, 8, 31, 11]]) darkLine(x0, y0, x1, y1, 2);
  for (const [x, y, w] of [[11, 17, 5], [10, 19, 5], [10, 21, 3]]) for (let i = 0; i < w; i++) { dark([[x + i, y]], 2); dark([[mx(x + i), y]], 2); }

  // Muzzle: two pale whisker pads, a dark nose sitting on them, a flat downturned mouth.
  lump(cat, m => { m.ellipse(23.5, 23.8, 3.2, 2.5, 0xffffff); m.ellipse(mxc(23.5), 23.8, 3.2, 2.5, 0xffffff); m.rect(24, 20, 4, 3, 0xffffff); }, { ramp: CREAM, R: 2.2, seed: 5, base: 0.45, gain: 0.85, shadow: false, grain: 0.04, fur: 0.1 });
  pixels(cat, [[24, 21], [25, 21], [26, 21], [27, 21], [25, 22], [26, 22]], FUR[1]);
  pixels(cat, [[24, 21], [25, 21]], FUR[2]);
  cat.set(24, 21, FUR[4]);
  pixels(cat, [[25, 23], [26, 23], [24, 24], [23, 24], [22, 25], [27, 24], [28, 24], [29, 25]], FUR[0]);
  // A small pale chin under the frown.
  lump(cat, m => m.ellipse(26, 28.2, 2.6, 1.3, 0xffffff), { ramp: CREAM, R: 1.4, seed: 8, base: 0.4, gain: 0.8, shadow: false, grain: 0.04, fur: 0.1 });

  // Eyes: small, full-bright amber, slit pupils under the brow. Left eye drawn from a template, right mirrored.
  const OPEN = ['####...', '######.', '.######', '..####.'];
  const eye = (side) => {
    const X = col => (side < 0 ? 16 + col : mx(16 + col));
    const Y = 14;
    const put = (col, row, c) => cat.set(X(col), Y + row, c);
    const rows = eyes === 'half' ? [2, 3] : eyes === 'open' ? [0, 1, 2, 3] : [];
    for (const r of rows) {
      for (let c = 0; c < 7; c++) {
        if (OPEN[r][c] !== '#') continue;
        const rim = c === 0 || OPEN[r][c - 1] !== '#' || OPEN[r][c + 1] !== '#' ? 0.12 : 0;
        const v = 0.4 + 0.2 * r - rim * (eyes === 'half' ? 0 : 1) - (eyes === 'half' ? 0.15 : 0);
        put(c, r, tone(EYE, v, X(c), Y + r));
      }
      if (OPEN[r][3] === '#') put(3, r, FUR[0]);
    }
    if (eyes === 'closed') {
      // Shut: a dark lid line and a thin lit lid edge under it.
      for (let c = 0; c < 6; c++) put(c, 2, FUR[0]);
      for (let c = 1; c < 6; c++) put(c, 3, FUR[4]);
    } else if (eyes === 'happy') {
      // A content squint: a narrow slit of dim amber between two dark lids.
      for (let c = 0; c < 7; c++) put(c, 1, FUR[0]);
      for (let c = 1; c < 6; c++) { put(c, 2, c === 3 ? EYE[2] : EYE[1]); put(c, 3, FUR[1]); }
    }
  };
  eye(-1);
  eye(1);
  // The eyes bleed a little light into the brow shadow: a checker of ember on the dark fur next to them.
  if (eyes === 'open' || eyes === 'half') {
    const lit = (x, y) => EYE.includes(cat.get(x, y)) && cat.alpha(x, y);
    const marks = [];
    for (let y = 11; y < 20; y++) for (let x = 12; x < 40; x++) {
      if (lit(x, y) || (x + y) % 2) continue;
      if ([[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => lit(x + dx, y + dy)) && FUR.indexOf(cat.get(x, y)) <= 2) marks.push([x, y]);
    }
    for (const [x, y] of marks) cat.set(x, y, FUR[3]);
  }

  // The front paws, tucked, with their toes.
  for (const cx of [20.5, 31.5]) {
    lump(cat, m => m.ellipse(cx, 34.6, 4, 2.3, 0xffffff), { ramp: CREAM, R: 2.4, seed: 7, base: 0.4, gain: 0.85, floor: 37 });
    for (const dx of [-1.4, 1.4]) { const x = Math.floor(cx + dx); cat.set(x, 35, stepDown(cat.get(x, 35), 2)); cat.set(x, 36, stepDown(cat.get(x, 36), 2)); }
  }

  contour(cat, { ground: 37 });
  // The cat's contact shadow on the keys.
  for (let y = 37; y < 42; y++) for (let x = 0; x < p.w; x++) {
    if (kb.alpha(x, y) && !cat.alpha(x, y) && (cat.alpha(x, y - 1) || cat.alpha(x - 1, y - 1))) kb.set(x, y, STEEL[0]);
  }
  over(p, kb);
  over(p, cat);
}

// A small "z" glyph for the sleeping cat: a chunky, bevelled letter with a hard drop shadow, like Doom's own type.
export const Z_TEX = { w: 9, h: 9 };
const Z_GLYPH = ['HHHHHHM', 'HHHHHMd', '....MMd', '...MMd.', '..MMd..', '.MMd...', 'HHMMMMM', 'MMMMMdd'];
export function paintZ(p) {
  const on = (x, y) => Z_GLYPH[y]?.[x] !== undefined && Z_GLYPH[y][x] !== '.';
  const ink = { H: BONE[3], M: BONE[2], d: BONE[1] };
  for (let y = 0; y < Z_GLYPH.length + 1; y++) {
    for (let x = 0; x < 8; x++) if (!on(x, y) && (on(x - 1, y - 1) || on(x - 1, y) || on(x, y - 1))) p.set(x, y, RAMPS.brown[0]);
  }
  Z_GLYPH.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] !== '.') p.set(x, y, ink[row[x]]); });
}

const frac = x => x - Math.floor(x);

function texture(size, paint, opts) {
  const p = new Pix(size.w, size.h);
  paint(p);
  return p.toTexture(opts);
}

// ── Sprites ──────────────────────────────────────────────────────────────────────────────

const BREATH_HZ = 0.32;
const Z_COUNT = 2, Z_PERIOD = 4;

function sleeping() {
  const width = 0.38, height = (width * SLEEPING_TEX.h) / SLEEPING_TEX.w;
  const map = texture(SLEEPING_TEX, paintSleepingCat, { mip: true });
  const zMap = texture(Z_TEX, paintZ);
  const body = new THREE.Sprite(new THREE.SpriteMaterial({ map, color: 0xe2dbd2, alphaTest: 0.5 }));
  body.center.set(0.5, 0);
  body.scale.set(width, height, 1);

  const group = new THREE.Group();
  group.add(body);
  const zs = [];
  for (let i = 0; i < Z_COUNT; i++) {
    const z = new THREE.Sprite(new THREE.SpriteMaterial({ map: zMap, transparent: true, opacity: 0, depthWrite: false }));
    zs.push(z);
    group.add(z);
  }

  return {
    kind: 'sleeping', object: group, width, height,
    update(t, calm) {
      const b = calm ? 0 : Math.sin(t * Math.PI * 2 * BREATH_HZ);
      body.scale.set(width * (1 - 0.012 * b), height * (1 + 0.04 * b), 1);
      for (let i = 0; i < Z_COUNT; i++) {
        const z = zs[i];
        z.visible = !calm;
        if (calm) continue;
        const u = frac(t / Z_PERIOD + i / Z_COUNT);
        const s = 0.04 + 0.035 * u;
        // The "z"s rise from just above the head (the head sits left of the sprite's centre).
        z.scale.set(s, s, 1);
        z.position.set(-width * 0.2 + 0.07 * u + Math.sin(t * 1.3 + i * 2) * 0.012, height * 0.8 + 0.02 + 0.2 * u, 0);
        z.material.opacity = 0.9 * smooth(0, 0.2, u) * (1 - smooth(0.55, 1, u));
      }
    },
    dispose() {
      map.dispose(); zMap.dispose();
      body.material.dispose();
      zs.forEach(z => z.material.dispose());
    },
  };
}

const EYES_BLINK_PERIOD = 5.3, EYES_BLINK_LENGTH = 0.2;
// Within an 11 s cycle the pupils glance right from 3 to 3.8 s, left from 6.4 to 7 s.
const glanceAt = t => { const g = t % 11; return g >= 3 && g < 3.8 ? 1 : g >= 6.4 && g < 7 ? -1 : 0; };

function eyes() {
  const width = 0.13, height = (width * EYES_TEX.h) / EYES_TEX.w;
  const maps = { '-1': texture(EYES_TEX, p => paintEyes(p, -1)), 0: texture(EYES_TEX, p => paintEyes(p, 0)), 1: texture(EYES_TEX, p => paintEyes(p, 1)) };
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: maps[0], transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  // Centred vertically on its box, so that a blink closes the lids toward the middle of the eyes.
  sprite.center.set(0.5, 0.5);
  sprite.position.y = height / 2;
  sprite.scale.set(width, height, 1);
  const group = new THREE.Group();
  group.add(sprite);

  return {
    kind: 'eyes', object: group, width, height,
    update(t, calm) {
      if (calm) {
        sprite.material.map = maps[0];
        sprite.material.opacity = 1;
        sprite.scale.set(width, height, 1);
        return;
      }
      // A blink every ~5 s, a barely perceptible shimmer, and now and then a glance to one side.
      const u = t % EYES_BLINK_PERIOD - (EYES_BLINK_PERIOD - EYES_BLINK_LENGTH);
      const lid = u > 0 ? Math.sin((u / EYES_BLINK_LENGTH) * Math.PI) : 0;
      sprite.scale.set(width, height * (1 - 0.9 * lid), 1);
      sprite.material.opacity = 0.85 + 0.15 * Math.sin(t * 1.7);
      sprite.material.map = maps[glanceAt(t)];
    },
    dispose() { Object.values(maps).forEach(m => m.dispose()); sprite.material.dispose(); },
  };
}

// The loafing cat's idle, over a 13 s cycle: two slow blinks (~5 s apart), a flick of the tail tip, one
// ear twitch. The events never overlap, so a frame is simply "the face, the ear and the tail" of one pose.
const LOAF_CYCLE = 13, HAPPY_SECONDS = 2.6;
const LOAF_POSES = {
  open: {}, half: { eyes: 'half' }, closed: { eyes: 'closed' }, happy: { eyes: 'happy' },
  ear: { ear: 1 }, tailUp: { tail: 1 }, tailOut: { tail: 2 },
};
const LOAF_BLINKS = [3.1, 10.8];
const between = (u, a, b) => u >= a && u < b;
function loafPose(t) {
  const u = t % LOAF_CYCLE;
  for (let i = 0; i < LOAF_BLINKS.length; i++) {
    const at = LOAF_BLINKS[i];
    if (between(u, at, at + 0.44)) return between(u, at + 0.12, at + 0.32) ? 'closed' : 'half';
  }
  if (between(u, 5.6, 6.35)) return between(u, 5.85, 6.1) ? 'tailOut' : 'tailUp';
  if (between(u, 9, 9.34)) return between(u, 9.12, 9.2) ? 'open' : 'ear';
  return 'open';
}

function loaf() {
  const width = 0.42, height = (width * LOAF_TEX.h) / LOAF_TEX.w;
  const maps = {};
  for (const [key, pose] of Object.entries(LOAF_POSES)) maps[key] = texture(LOAF_TEX, p => paintLoaf(p, pose), { mip: true });
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: maps.open, color: 0xe2dbd2, alphaTest: 0.5 }));
  sprite.center.set(0.5, 0);
  sprite.scale.set(width, height, 1);
  const group = new THREE.Group();
  group.add(sprite);

  let happyUntil = -Infinity;
  return {
    kind: 'loaf', object: group, width, height,
    // Squints contentedly (narrow slits) for a few seconds, whatever `calm` says: it is a state, not motion.
    react(t) { happyUntil = t + HAPPY_SECONDS; },
    update(t, calm) {
      sprite.material.map = maps[t < happyUntil ? 'happy' : calm ? 'open' : loafPose(t)];
    },
    dispose() {
      Object.values(maps).forEach(m => m.dispose());
      sprite.material.dispose();
    },
  };
}

const KINDS = { sleeping, eyes, loaf };

export function createCat(kind = 'sleeping') {
  const make = KINDS[kind];
  if (!make) throw new RangeError(`unknown cat kind: ${kind}`);
  const cat = make();
  cat.object.userData.catKind = kind;
  return cat;
}

export const CAT_KINDS = Object.freeze(Object.keys(KINDS));
