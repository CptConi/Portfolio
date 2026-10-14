// The sky of the moon, painted once as ONE equirectangular sphere (x ↔ heading 0..360°, row 0 = zenith, row 256 = horizon),
// and the regolith tile of the plain. Everything is pixel art in the Doom manner (banded ramps, Bayer dithering, grain),
// procedural and seeded: it builds the same in node (the scratch viewers) and in the browser. No DOM, no Math.random.
//
// The sky is global: a window shows what really lies in its direction (the exterior scene draws it on a dome around the camera,
// exterior/Exterior.js). Headings are the player's: 0 = east (+x), 90 = south (+z), 180 = west, 270 = north; a viewer who looks
// north has east on his right. One texel is 0.35°; the game shows 60° across 640 px, so a texel is about 3.75 screen pixels.
//
//   SOUTH  (90)    the EARTH, 13° across, gibbous and lit from the east, clouds, ocean glint and city lights on its night side;
//                  a little orbital station beside it, a lost coffee MUG adrift (with frozen droplets) between it and the Sun.
//   EAST   (0-60)  the SUN, a hard disc with glare and spikes, long shadows' side of the world; bright planets sit on the
//                  ecliptic (Jupiter with its four moons, Venus, Mars, Saturn); a spiral galaxy; a flying SAUCER, far away
//                  towards the north-east, carries a server rack off, near a red supergiant and a blue open cluster.
//   NORTH  (268)   a huge RINGED gas giant half-risen behind the ridge (banded cloud, a storm, rings and globe that cast
//                  shadows on each other), a cratered moon on its right, a smooth creamy one on its left.
//   WEST   (160-250) an ASTEROID FIELD streaming down towards the horizon, a derelict yellow RUBBER DUCK (the debugging duck, a
//                  satellite now: broken solar wing, bent dish) tumbling in it, and a COMET whose tails point away from the Sun.
//   UP             thousands of stars and the Milky Way: a pillar rising from the north-east and the south-west horizons, an arch
//                  high over the south-east, a rose nebula with dust pillars on its bright arm (south-west).
//   HORIZON        three far skylines of ridges and crater rims, low under the Earth, higher behind the giant and the asteroids,
//                  lit or backlit by the Sun; the sky rows under the horizon hold HORIZON, the colour the exterior's fog melts
//                  the plain into, and the feet of the ridges melt into it too.
//
// What a window can show: the view is 36° tall (−18°…+18° about the horizon; the 35° freelook shears the projection, up to
// +21°…+46°), and a window head 0.5 m above the eye frames up to ~15° at 2 m and ~10° at 3 m with a level view, so the bodies
// that matter stand at 4°…20° of elevation. BODIES lists who stands where (az, el, radius, note).
//
// Cheats, on purpose: the Earth is gibbous (the Sun, 60° from it in this sky, would make a crescent of it), and the three
// jokes are lit as if the Sun stood up and to the left of the viewer, so that none of them hides in its own shadow.
//
// Ground: the exterior ground samples the regolith tile with mipmaps (LinearMipmapLinear, RepeatWrapping, anisotropy), and
// cuts the far plain into a few ordered-dithered grey steps. The tile itself is already painted on GROUND_RAMP.
import { bayer4, hash, ditherRamp } from './dither.js';

export const SKY = { w: 1024, h: 512 };
// Degrees, heading convention of the player (0 = +x, 90 = +z, 270 = north). `radius` is the angular radius.
export const EARTH = { az: 90, el: 11, radius: 6.5 };
export const SUN = { az: 30, el: 15, radius: 1.25 };
export const GROUND = { w: 128, h: 128, meters: 10 };
export const HORIZON = 0x34312e;   // far ground fades to this; it is also the colour of the sky rows below the horizon

// Everything else that stands in the sky (angular radii in degrees; a field's radius is its half length).
const GIANT = { az: 268, el: 4, radius: 8.5, ring: [1.28, 2.12], tilt: 14, incl: 21 };   // tilt: screen rotation of the rings, incl: their opening
const MOON_A = { az: 290, el: 8, radius: 2.6 };      // cratered: stands in the window the visitor sees first (atr-n1, 287°–291° from the spawn)
const MOON_B = { az: 243, el: 14.5, radius: 1.9 };   // smooth, pale and creamy
const STATION = { az: 103, el: 14.8, radius: 1.1 };
const MUG = { az: 67, el: 8.4, radius: 1.5 };
const SAUCER = { az: 337, el: 15.5, radius: 2.4 };
const COMET = { az: 166, el: 16.5, radius: 0.7, tail: 19 };
const DUCK = { az: 205, el: 12.5, radius: 2.6 };
const FIELD = { az: 204, el: 17, radius: 46, from: [166, 36], to: [248, 1.5] };
const NEBULA = { az: 134, el: 14, radius: 7 };      // a rose emission nebula above the south-west ridge, in the Milky Way's bright arm
const CLUSTER = { az: 313, el: 11.5, radius: 3 };   // a blue open cluster in the north-east
const RED_STAR = { az: 323, el: 8.5, radius: 0.6 };  // a bright orange supergiant, between the cluster and the saucer
const SPIRAL = { az: 352, el: 12.5, radius: 3.2 };   // a distant spiral galaxy seen at a slant, east-north-east
const ECLIPTIC = { apex: 78.5, incl: 22 };   // tan(el) = tan(incl) · cos(az − apex): a great circle through the Sun
const PLANETS = [
  { id: 'jupiter', az: 5.5, radius: 0.5, note: 'creamy and bright, with its four moons in a line' },
  { id: 'venus', az: 55, radius: 0.6, note: 'the brightest dot of the sky' },
  { id: 'mars', az: 121, radius: 0.4, note: 'the red dot' },
  { id: 'saturn', az: 146, radius: 0.5, note: 'pale gold, with a thin ring' },
];
const eclEl = az => Math.atan(Math.tan(ECLIPTIC.incl * Math.PI / 180) * Math.cos((az - ECLIPTIC.apex) * Math.PI / 180)) * 180 / Math.PI;

// What is where, for the proofs and the tests (the painters below read the same numbers).
export const BODIES = Object.freeze([
  { id: 'earth', kind: 'planet', az: EARTH.az, el: EARTH.el, radius: EARTH.radius, note: 'south: gibbous Earth lit from the east, clouds, ocean glint, city lights on the night side' },
  { id: 'station', kind: 'satellite', az: STATION.az, el: STATION.el, radius: STATION.radius, note: 'south-west of the Earth: a small orbital station with solar wings' },
  { id: 'mug', kind: 'joke', az: MUG.az, el: MUG.el, radius: MUG.radius, note: 'joke: a coffee mug adrift between the Sun and the Earth, with a few frozen droplets' },
  { id: 'sun', kind: 'star', az: SUN.az, el: SUN.el, radius: SUN.radius, note: 'east-south-east: hard disc, glare and spikes' },
  ...PLANETS.map(q => ({ id: q.id, kind: 'planet', az: q.az, el: eclEl(q.az), radius: q.radius, note: `on the ecliptic: ${q.note}` })),
  { id: 'milky-way', kind: 'band', az: 60, el: 62, radius: 8, note: 'the galactic plane (radius = half width): highest at az 60, el 62; it meets the horizon at az 150 and az 330, where it rises like a pillar; its bright core is at az 125, el 38' },
  { id: 'nebula', kind: 'nebula', az: NEBULA.az, el: NEBULA.el, radius: NEBULA.radius, note: 'south-west: a rose emission nebula with dark dust pillars, in the Milky Way\'s bright arm' },
  { id: 'cluster', kind: 'stars', az: CLUSTER.az, el: CLUSTER.el, radius: CLUSTER.radius, note: 'north-north-east: a blue open cluster of nine bright stars in a faint haze' },
  { id: 'red-star', kind: 'star', az: RED_STAR.az, el: RED_STAR.el, radius: RED_STAR.radius, note: 'north-east: a bright orange supergiant with a flare cross' },
  { id: 'spiral', kind: 'galaxy', az: SPIRAL.az, el: SPIRAL.el, radius: SPIRAL.radius, note: 'east-north-east: a distant spiral galaxy, a tilted oval with a bright core and a dust lane' },
  { id: 'saucer', kind: 'joke', az: SAUCER.az, el: SAUCER.el, radius: SAUCER.radius, note: 'joke: a flying saucer far away carrying a server rack off' },
  { id: 'giant', kind: 'planet', az: GIANT.az, el: GIANT.el, radius: GIANT.radius, note: `north: ringed gas giant half-risen behind the ridge; the rings reach ${GIANT.ring[1]} radii` },
  { id: 'moon-cratered', kind: 'moon', az: MOON_A.az, el: MOON_A.el, radius: MOON_A.radius, note: 'north, right of the giant: grey, cratered' },
  { id: 'moon-smooth', kind: 'moon', az: MOON_B.az, el: MOON_B.el, radius: MOON_B.radius, note: 'north-north-west, left of the giant: smooth and creamy, hairline cracks' },
  { id: 'asteroids', kind: 'field', az: FIELD.az, el: FIELD.el, radius: FIELD.radius, note: `west: a stream of rocks from (${FIELD.from}) down to (${FIELD.to}) with a few big ones near the ridge` },
  { id: 'duck', kind: 'joke', az: DUCK.az, el: DUCK.el, radius: DUCK.radius, note: 'joke: a derelict rubber-duck satellite tumbling among the asteroids (broken solar wing, dish)' },
  { id: 'comet', kind: 'comet', az: COMET.az, el: COMET.el, radius: COMET.radius, note: `west-south-west: head and a ${COMET.tail}° tail pointing away from the Sun (down to the right)` },
]);

const D2R = Math.PI / 180;
// Math.hypot is slow in V8: the painters' inner loops use this plain square root of squares.
const hyp = (a, b, c = 0) => Math.sqrt(a * a + b * b + c * c);
const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Value noise that repeats every perX × perY lattice cells (so tiles and the 360° sky wrap seamlessly).
function noiseP(x, y, perX, perY, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const g = (i, j) => hash(((i % perX) + perX) % perX, ((j % perY) + perY) % perY, seed);
  const a = g(xi, yi), b = g(xi + 1, yi), c = g(xi, yi + 1), d = g(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Periodic value noise on a precomputed lattice (nx × ny cells over the whole sky), sampled with a smooth bilinear blend.
function lattice(nx, ny, seed) {
  const g = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) g[j * nx + i] = hash(i, j, seed);
  return (u, v) => {   // u, v in cells
    const xi = Math.floor(u), yi = Math.floor(v), fx = u - xi, fy = v - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % nx) + nx) % nx, x1 = (x0 + 1) % nx, y0 = ((yi % ny) + ny) % ny, y1 = (y0 + 1) % ny;
    const a = g[y0 * nx + x0], b = g[y0 * nx + x1], c = g[y1 * nx + x0], d = g[y1 * nx + x1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

// Lightens the pixel to at least colour c (glows over stars without erasing them).
function lighten(p, x, y, c) {
  if (x < 0 || x >= p.w || y < 0 || y >= p.h) return;
  const i = (y * p.w + x) * 4, d = p.data, r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  if (d[i] < r) d[i] = r;
  if (d[i + 1] < g) d[i + 1] = g;
  if (d[i + 2] < b) d[i + 2] = b;
  d[i + 3] = 255;
}

// ── Sphere helpers ───────────────────────────────────────────────────────────────────────────
const colAz = x => ((x + 0.5) / SKY.w) * 360;
const rowEl = y => (0.5 - (y + 0.5) / SKY.h) * 180;
const azCol = az => (az / 360) * SKY.w;
const elRow = el => (0.5 - el / 180) * SKY.h;
const dir = (az, el) => {
  const ca = Math.cos(el * D2R);
  return [ca * Math.cos(az * D2R), Math.sin(el * D2R), ca * Math.sin(az * D2R)];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const wrapDeg = a => ((a % 360) + 540) % 360 - 180;
const SUN_DIR = dir(SUN.az, SUN.el);

// Camera-like frame at (az, el): right, up, forward (see SPEC: right = (−sin h, 0, cos h)).
function frame(az, el) {
  const f = dir(az, el);
  const r = [-Math.sin(az * D2R), 0, Math.cos(az * D2R)];
  const u = cross(r, f);
  return { f, r, u };
}
// Direction of the Sun in the disc coordinates of a body at (az, el): x right, y up, z towards the viewer.
function lightAt(az, el) {
  const fr = frame(az, el);
  return [dot(SUN_DIR, fr.r), dot(SUN_DIR, fr.u), -dot(SUN_DIR, fr.f)];
}

// Paints `shade(dx, dy, x, y)` (degrees in the tangent plane, +x = right, +y = up; texel x, y) around (az, el), reaching
// `reach` degrees. Texels are visited per row so that the shape stays round near the poles too.
function splat(p, az, el, reach, shade, blend = false) {
  const y0 = Math.max(0, Math.floor(elRow(el + reach))), y1 = Math.min(SKY.h - 1, Math.ceil(elRow(el - reach)));
  for (let y = y0; y <= y1; y++) {
    const e = rowEl(y), ce = Math.max(0.05, Math.cos(e * D2R));
    const span = Math.min(SKY.w / 2, Math.ceil((reach / ce) * (SKY.w / 360)) + 1);
    const xc = Math.round(azCol(az) - 0.5);
    for (let k = -span; k <= span; k++) {
      const x = ((xc + k) % SKY.w + SKY.w) % SKY.w, daz = wrapDeg(colAz(x) - az);
      const c = shade(daz * ce, e - el, x, y);
      if (c !== null && c !== undefined) { if (blend) lighten(p, x, y, c); else p.set(x, y, c); }
    }
  }
}

const rot = (x, y, deg) => { const c = Math.cos(deg * D2R), s = Math.sin(deg * D2R); return [x * c + y * s, -x * s + y * c]; };   // into the sprite's own axes

// ── Palettes ─────────────────────────────────────────────────────────────────────────────────
// Warm lunar greys, dark → light (ridges). The regolith ramp is exported for the scratch viewers.
const GREY = [0x151414, 0x211f1e, 0x2e2c2a, 0x3d3a37, 0x4f4b46, 0x625d56, 0x77716a, 0x8f8880];
export const GROUND_RAMP = [0x1f1d1b, 0x2b2927, 0x393633, 0x484541, 0x59554e, 0x6b665e, 0x7e786e];

// ── Milky Way, stars ─────────────────────────────────────────────────────────────────────────
// The galactic plane rises like a pillar from the north-east (heading 330) and south-west (150) horizons and arches over the
// south-east at 62°; its bright core sits on the south-western arm (heading 125).
const GALAXY = dir(240, 28);
const GAL_CORE = (() => {
  const t = Math.atan(Math.tan(62 * D2R) * Math.cos((125 - 60) * D2R)) / D2R;
  return dir(125, t);
})();
const GAL_SIGMA = 7;

function milkyWay(az, el) {   // 0..1 density at a direction
  const ce = Math.cos(el * D2R), d = ce * (Math.cos(az * D2R) * GALAXY[0] + Math.sin(az * D2R) * GALAXY[2]) + Math.sin(el * D2R) * GALAXY[1];
  const s = Math.asin(clamp(d, -1, 1)) / D2R;
  return Math.exp(-(s * s) / (2 * GAL_SIGMA * GAL_SIGMA));
}

function paintMilkyWay(p) {
  const RAMP = [0x000000, 0x02030a, 0x04071a, 0x080c26, 0x0d1438, 0x161c48, 0x242456, 0x34305c];
  const gx = new Float32Array(SKY.w), cx = new Float32Array(SKY.w);
  for (let x = 0; x < SKY.w; x++) {
    const ca = Math.cos(colAz(x) * D2R), sa = Math.sin(colAz(x) * D2R);
    gx[x] = ca * GALAXY[0] + sa * GALAXY[2];
    cx[x] = ca * GAL_CORE[0] + sa * GAL_CORE[2];
  }
  // look-up tables for the three smooth falloffs (the band across, the bulge along, the dust lane), evaluated once
  const N = 1024, DMAX = 0.34, inv2s = 1 / (2 * GAL_SIGMA * GAL_SIGMA), inv2c = 1 / (0.4538 * 0.4538);   // bulge: 26° in radians
  const band = new Float32Array(N + 1), bulge = new Float32Array(N + 1), laneT = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const d = ((i / N) * 2 - 1) * DMAX, sd = (Math.asin(d) / D2R);
    band[i] = Math.exp(-sd * sd * inv2s);
    bulge[i] = 1 + 1.25 * Math.exp(-(i / N) * 2 * inv2c);   // indexed by (1 − cos) over 0..2
    laneT[i] = Math.exp(-Math.pow(((i / N) * 2 - 1) * 8, 2));   // indexed by the offset from the lane, ±8° (in units of its width)
  }
  const big = lattice(SKY.w / 32, SKY.h / 16, 41), fine = lattice(SKY.w / 8, SKY.h / 8, 42), lanes = lattice(SKY.w / 64, 4, 43);
  for (let y = 0; y < SKY.h / 2; y += 2) {   // the fields are smooth: evaluated once per 2 × 2 texels, dithered per texel
    const e = rowEl(y) - 0.5 * (180 / SKY.h), ce = Math.cos(e * D2R), se = Math.sin(e * D2R);
    for (let x = 0; x < SKY.w; x += 2) {
      const d = ce * gx[x] + se * GALAXY[1];
      if (d > DMAX || d < -DMAX) continue;
      let m = band[Math.round(((d / DMAX + 1) / 2) * N)];
      if (m < 0.045) continue;
      m *= bulge[Math.round(((1 - (ce * cx[x] + se * GAL_CORE[1])) / 2) * N)];   // the bulge
      const clump = big((x + 1) / 32, (y + 1) / 16) * 0.7 + fine((x + 1) / 8, (y + 1) / 8) * 0.3;
      const s = (d * (1 + d * d / 6)) / D2R;   // asin(d) in degrees
      const lq = ((s - (1.6 + 2.2 * (lanes(x / 64, 0.5) - 0.5))) / 2.2) / 8;   // across the dust lane, −1..1 over ±8 widths
      const lane = lq > 1 || lq < -1 ? 0 : laneT[Math.round((lq + 1) * 0.5 * N)];
      const v = (m * (0.35 + 0.9 * clump) * (1 - 0.55 * lane) - 0.1) * 0.8;
      if (v <= 0) continue;
      p.set(x, y, ditherRamp(RAMP, v, x, y)); p.set(x + 1, y, ditherRamp(RAMP, v, x + 1, y));
      p.set(x, y + 1, ditherRamp(RAMP, v, x, y + 1)); p.set(x + 1, y + 1, ditherRamp(RAMP, v, x + 1, y + 1));
    }
  }
}

const STAR_FAINT = [0x252b3e, 0x2e354c, 0x363e58];
const STAR_DIM = [0x3c4258, 0x4a5170, 0x586080, 0x6a7090];
const STAR_MID = [0x8a93b4, 0xa8b0cc, 0xc8cee4, 0xb4a890];
const STAR_BRIGHT = [0xffffff, 0xe8ecff, 0xfff0d0, 0xbfd2ff, 0xffd8a8];

function paintStars(p) {
  const rand = rng(1337);
  const stars = [];
  let guard = 0;
  while (stars.length < 2500 && guard++ < 60000) {
    const y = rand() * 2 - 1, az = rand() * 360, el = Math.asin(y) / D2R;
    if (el < 0) { rand(); continue; }    // below the horizon: hidden by the ground
    const m = milkyWay(az, el);
    if (rand() > (0.34 + 3.2 * m) / 1.2) continue;   // thicker along the Milky Way
    stars.push({ az, el, k: rand(), c: rand() });
  }
  for (const s of stars) {
    const ce = Math.max(0.05, Math.cos(s.el * D2R));
    const x = Math.floor(azCol(s.az)), y = Math.floor(elRow(s.el));
    const px = (xx, yy, c) => p.set(((xx % SKY.w) + SKY.w) % SKY.w, yy, c);
    const half = Math.max(0, Math.round((1 / ce - 1) / 2));   // widen the star near the pole so it stays round on screen
    const pick = list => list[Math.floor(s.c * list.length) % list.length];
    if (s.k < 0.3) { for (let k = -half; k <= half; k++) px(x + k, y, pick(STAR_FAINT)); }
    else if (s.k < 0.62) { for (let k = -half; k <= half; k++) px(x + k, y, pick(STAR_DIM)); }
    else if (s.k < 0.9) { for (let k = -half; k <= half; k++) px(x + k, y, pick(STAR_MID)); }
    else if (s.k < 0.985) {
      const c = pick(STAR_BRIGHT);
      for (let k = -half; k <= half; k++) px(x + k, y, c);
      px(x - 1 - half, y, 0x4a5272); px(x + 1 + half, y, 0x4a5272); px(x, y - 1, 0x4a5272); px(x, y + 1, 0x4a5272);
    } else {   // the few big ones: a white core with a cross and a faint diagonal
      for (let k = -half; k <= half; k++) px(x + k, y, 0xffffff);
      for (const d of [1, 2]) {
        const col = d === 1 ? 0xc8d0f0 : 0x6a7498;
        px(x - d - half, y, col); px(x + d + half, y, col); px(x, y - d, col); px(x, y + d, col);
      }
      px(x - 1, y - 1, 0x4a5272); px(x + 1, y - 1, 0x4a5272); px(x - 1, y + 1, 0x4a5272); px(x + 1, y + 1, 0x4a5272);
    }
  }
}

// ── The Sun: a small hard disc, a dithered glare, two thin spikes ────────────────────────────
function paintSun(p) {
  const GLARE = [0x000000, 0x3a3220, 0x6a5a34, 0xa89052, 0xd8c47e, 0xf6e8a4];
  splat(p, SUN.az, SUN.el, 10, (dx, dy) => {
    const d = hyp(dx, dy);
    if (d <= SUN.radius) return 0xfffbe6;
    if (d <= SUN.radius + 0.5) return 0xffe99a;
    let v = 1.45 * Math.pow(SUN.radius / d, 1.25) - 0.22;
    // thin horizontal / vertical diffraction spikes, and shorter diagonal ones
    const sx = Math.max(0, 1 - Math.abs(dy) / 0.3) * Math.max(0, 1 - Math.abs(dx) / 8);
    const sy = Math.max(0, 1 - Math.abs(dx) / 0.3) * Math.max(0, 1 - Math.abs(dy) / 5);
    const u = (dx + dy) * 0.7071, w = (dx - dy) * 0.7071;
    const s1 = Math.max(0, 1 - Math.abs(w) / 0.25) * Math.max(0, 1 - Math.abs(u) / 4);
    const s2 = Math.max(0, 1 - Math.abs(u) / 0.25) * Math.max(0, 1 - Math.abs(w) / 4);
    v = Math.max(v, 0.62 * Math.max(sx, sy), 0.4 * Math.max(s1, s2));
    if (v <= 0.1) return null;
    return ditherRamp(GLARE, v, Math.round(dx * 9), Math.round(dy * 9));
  }, true);
}

// ── Bright planets on the ecliptic ───────────────────────────────────────────────────────────
function paintPlanets(p) {
  const put = (x, y, c) => p.set(((x % SKY.w) + SKY.w) % SKY.w, y, c);
  const at = az => [Math.floor(azCol(az)), Math.floor(elRow(eclEl(az)))];
  // Jupiter: a creamy dot with four moons strung along the ecliptic
  { const [x, y] = at(5.5);
    p.rect(x - 4, y - 3, 17, 7, 0x000000);
    put(x, y, 0xfff4d6); put(x + 1, y, 0xf2dcae); put(x, y + 1, 0xd8bc88); put(x + 1, y + 1, 0xc4a070);
    put(x - 1, y, 0x5a5036); put(x + 2, y, 0x5a5036); put(x, y - 1, 0x5a5036); put(x + 1, y - 1, 0x5a5036);
    for (const [dx, dy, c] of [[-3, 0, 0xc8c8d0], [4, 0, 0xe8e0d0], [6, -1, 0xa89070], [9, -1, 0x9098a8]]) put(x + dx, y + dy, c); }
  // Venus: the brightest of all, a small cross of light
  { const [x, y] = at(55);
    put(x, y, 0xffffff); put(x + 1, y, 0xfff6dc); put(x, y + 1, 0xfff6dc); put(x + 1, y + 1, 0xf2e6c4);
    for (const [dx, dy, c] of [[-1, 0, 0x9a9486], [2, 0, 0x9a9486], [0, -1, 0x9a9486], [1, -1, 0x9a9486], [-1, 1, 0x9a9486], [2, 1, 0x9a9486], [0, 2, 0x9a9486], [1, 2, 0x9a9486],
      [-2, 0, 0x4a4a52], [3, 0, 0x4a4a52], [0, -2, 0x4a4a52], [1, 3, 0x4a4a52]]) put(x + dx, y + dy, c); }
  // Mars: a red dot with a halo of rust
  { const [x, y] = at(121);
    put(x, y, 0xff7a4a); put(x + 1, y, 0xe0583a); put(x, y + 1, 0xc84a30); put(x + 1, y + 1, 0x9c3a28);
    for (const [dx, dy] of [[-1, 0], [2, 0], [0, -1], [1, -1], [-1, 1], [2, 1]]) put(x + dx, y + dy, 0x5a2a22); }
  // Saturn: a pale gold dot with a thin ring
  { const [x, y] = at(146);
    put(x, y, 0xf2dc98); put(x + 1, y, 0xd8bf7a);
    for (const dx of [-3, -2, 3, 4]) put(x + dx, y + 1, 0x9a8a62);
    for (const dx of [-1, 0, 1, 2]) put(x + dx, y + 1, 0xcbb888); }
}

// ── A rose nebula and a blue cluster ────────────────────────────────────────────────────────
function paintNebula(p) {
  const N = NEBULA, R = N.radius;
  const GLOW = [0x000000, 0x1a0a24, 0x3e1a4a, 0x7a2c6c, 0xb8487e, 0xea7c98, 0xffc8c0];
  const CORE = [0x000000, 0x0a2630, 0x14505a, 0x2c8a86, 0x70d0c0, 0xd0fff0];
  const big = lattice(128, 64, 111), mid = lattice(256, 128, 112), small = lattice(256, 128, 113);
  splat(p, N.az, N.el, R * 1.5, (dx, dy, x, y) => {
    const wx = dx + (big(x / 8, y / 8) - 0.5) * 5, wy = dy + (big(x / 8 + 40, y / 8) - 0.5) * 4;   // a warped, ragged outline
    const r = hyp(wx / (R * 1.15), (wy + 0.6) / (R * 0.8));
    if (r > 1.35) return null;
    const dens = Math.exp(-r * r * 1.6) * (0.45 + 0.56 * mid(x / 4, y / 4) + 0.17 * small(x / 2, y / 2));
    if (dens < 0.14) return null;
    const core = Math.exp(-Math.pow(hyp(dx + 1.2, dy - 0.4) / 2.2, 2)) * (0.6 + 0.6 * small(x / 2, y / 2));
    if (core > 0.45) return ditherRamp(CORE, clamp(core * 0.95), x, y);
    return ditherRamp(GLOW, clamp(dens * 1.05), x, y);
  }, true);
  // dark pillars of dust leaning into the glow, each with a rim of light on the side that faces the young stars
  const pillars = [[-2.4, -4.8, 5.6, 0.9, 8], [0.6, -5.0, 7.4, 1.15, -5], [3.2, -4.7, 4.4, 0.8, 6]];
  for (const [ox, oy, len, w, lean] of pillars) {
    splat(p, N.az + ox, N.el + oy, len + 2, (dx, dy, x, y) => {
      const t = dy / len, cx = Math.tan(lean * D2R) * dy;
      if (t < 0 || t > 1) return null;
      const half = w * (1.1 - 0.5 * t) + (big(x / 4, y / 4) - 0.5) * 0.5, off = dx - cx;
      if (Math.abs(off) > half) return null;
      return off > half - 0.45 ? 0xb8487e : off < -half + 0.3 ? 0x3a1a44 : t > 0.9 ? 0x5a2c58 : 0x0c0612;   // lit rim on the right, a dusky left edge
    });
  }
  // young bright stars inside
  const rand = rng(515);
  for (let i = 0; i < 9; i++) {
    const a = rand() * 6.28, d = Math.sqrt(rand()) * R * 0.8;
    const x = Math.floor(azCol(N.az + Math.cos(a) * d)), y = Math.floor(elRow(N.el + Math.sin(a) * d * 0.7));
    p.set(x, y, 0xe8f0ff); if (i % 3 === 0) { p.set(x - 1, y, 0x6a7ab0); p.set(x + 1, y, 0x6a7ab0); p.set(x, y - 1, 0x6a7ab0); p.set(x, y + 1, 0x6a7ab0); }
  }
}

function paintCluster(p) {
  const C = CLUSTER, rand = rng(616);
  const HAZE = [0x000000, 0x060c24, 0x0e1a48, 0x1a2e78];
  splat(p, C.az, C.el, C.radius * 1.5, (dx, dy, x, y) => {
    const d = hyp(dx, dy / 0.8) / C.radius;
    if (d > 1.4) return null;
    const v = Math.exp(-d * d * 1.8) * 0.9;
    return v < 0.12 ? null : ditherRamp(HAZE, v, x, y);
  }, true);
  for (let i = 0; i < 10; i++) {
    const a = rand() * 6.28, d = Math.sqrt(rand()) * C.radius * 0.85;
    const x = Math.floor(azCol(C.az + Math.cos(a) * d)), y = Math.floor(elRow(C.el + Math.sin(a) * d * 0.8));
    const big = i < 4, c = i % 3 === 0 ? 0xffffff : 0xd0e0ff;
    p.set(x, y, c);
    if (big) { p.set(x - 1, y, 0x8aa0d8); p.set(x + 1, y, 0x8aa0d8); p.set(x, y - 1, 0x8aa0d8); p.set(x, y + 1, 0x8aa0d8); }
    if (i === 0) { p.set(x - 2, y, 0x4a5a98); p.set(x + 2, y, 0x4a5a98); p.set(x, y - 2, 0x4a5a98); p.set(x, y + 2, 0x4a5a98); }
  }
}

// ── A distant spiral galaxy and a red supergiant ────────────────────────────────────────────
function paintSpiral(p) {
  const G = SPIRAL, th = 32 * D2R, ct = Math.cos(th), st = Math.sin(th);
  const GAL = [0x000000, 0x0e1430, 0x222c5c, 0x445494, 0x8496c8, 0xd0d8f0, 0xfff6d8];
  splat(p, G.az, G.el, G.radius * 1.3, (dx, dy, x, y) => {
    const u = dx * ct + dy * st, v = (-dx * st + dy * ct) / 0.3;   // along and across the disc (it is seen at a slant)
    const r = hyp(u, v) / G.radius;
    if (r > 1.25) return null;
    const arm = 0.5 + 0.5 * Math.cos(2 * (Math.atan2(v, u) - 2.6 * Math.log(r + 0.2)));   // two faint spiral arms
    let I = 0.95 * Math.exp(-r * r * 9) + 0.5 * Math.exp(-r * r * 1.6) * (0.55 + 0.45 * arm);
    if (v < 0 && v > -0.34 * G.radius && r > 0.18 && r < 0.9) I *= 0.5;   // a dust lane across the near edge
    if (I < 0.1) return null;
    return ditherRamp(GAL, clamp(I), x, y);
  }, true);
}

function paintRedStar(p) {
  const c = [azCol(RED_STAR.az), elRow(RED_STAR.el)].map(Math.floor);
  const put = (dx, dy, col) => p.set(c[0] + dx, c[1] + dy, col);
  p.rect(c[0] - 6, c[1] - 6, 13, 13, 0x000000);
  for (let k = 2; k <= 5; k++) for (const [sx, sy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) put(sx * k, sy * k, k < 3 ? 0xe07838 : k < 5 ? 0x8a4a28 : 0x4a2a1c);
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) put(dx * 2, dy * 2, 0x5a321e);
  put(0, 0, 0xfff0d8); put(1, 0, 0xffc890); put(0, 1, 0xffc890); put(-1, 0, 0xff9a50); put(0, -1, 0xff9a50); put(1, 1, 0xe87c3c); put(-1, -1, 0xd06a30);
}

// ── The Earth ────────────────────────────────────────────────────────────────────────────────
const LAND = {   // closed polygons as flat [lon, lat, …]
  africa: [
    -17.5, 14.7, -16.5, 19, -13, 27.5, -9.8, 30, -6, 35.8, -2, 35.2,
    3, 36.8, 10, 37.3, 11, 33.5, 15, 32.3, 20, 32, 25, 31.8,
    32.5, 31.3, 34.5, 28, 32.8, 25, 35, 22, 37.3, 18.5, 39.5, 15.5,
    43, 12.5, 44, 10.5, 51.2, 11.8, 49, 6, 46, 2, 41, -2,
    39, -6, 40.5, -11, 40.5, -15, 35, -20, 35.5, -24.5, 32.5, -27,
    28, -33, 23, -34.2, 19, -34.7, 17.2, -30, 15, -26, 11.8, -17,
    13.3, -12, 12, -6, 9.5, -1, 9.5, 3.5, 6, 4.2, 1, 5.5,
    -4, 5.2, -8, 4.4, -12.5, 7.3, -15, 10.5,
  ],
  eurasia: [
    -9.5, 37, -9, 43, -2, 43.5, -1.5, 46, -4.5, 48.3, -1.5, 49,
    2, 51, 5, 53, 8.5, 54, 8.5, 57, 10.5, 57.5, 10.5, 55,
    14, 54.3, 19, 54.5, 21, 57, 24, 59.5, 29, 60, 22.5, 60.5,
    21.5, 62, 25, 65.5, 21, 65, 17.5, 62.5, 18.5, 60, 16, 56,
    13, 55.5, 11, 58.5, 5.5, 59, 5, 62, 14, 67, 20, 69.8,
    28, 71, 40, 67.5, 44, 66, 60, 69, 70, 73, 100, 76,
    100, 22, 92, 22, 88, 21.5, 86, 20, 80, 15.5, 80, 10,
    77.5, 8, 76, 10, 73, 17, 72.5, 21, 70, 21, 67, 24.5,
    61, 25, 57.2, 25.7, 56.5, 27, 54, 26.8, 51, 27.8, 49.5, 30.2,
    48, 30, 48.5, 28.5, 50, 26.2, 51.5, 24.3, 54, 24, 56, 26,
    56.5, 24.5, 59.5, 22.5, 58, 19, 55, 17, 52.2, 16, 48, 14,
    45, 12.8, 43.3, 13, 42.7, 16, 41, 19, 39, 22, 37.5, 25,
    35, 28.2, 34.9, 29.6, 34.3, 31, 35, 32.7, 35.9, 34.7, 36, 36.5,
    32, 36.2, 29, 36.6, 27, 37.2, 26.3, 39.5, 26.5, 40.3, 29, 41,
    28, 42, 26, 40.8, 23.5, 40.2, 24, 38, 22.5, 36.5, 21.5, 38.2,
    20, 39.8, 19.5, 41.7, 18.5, 42.5, 16, 43.5, 13.5, 45.2, 12.3, 45.3,
    12.5, 44, 14, 42, 16, 41.5, 18.5, 40.2, 16.6, 38.9, 15.7, 38,
    15.8, 40, 14, 40.8, 12, 42, 10.5, 43.5, 8.5, 44.4, 6, 43.1,
    3.2, 43.3, 3, 41.5, 0.5, 40, -0.3, 38.4, -1.8, 36.8, -5.2, 36.1,
    -6.4, 36.8, -8.9, 37,
  ],
  samerica: [
    -80, -1, -77, 8, -72, 12, -62, 10.5, -52, 5, -50, 0,
    -44, -2.5, -35, -5.5, -35, -9, -39, -14, -41, -22, -48, -26,
    -49, -29, -53, -34, -58, -35, -57, -38.5, -62, -39, -65, -41,
    -64, -45, -67, -47, -69, -51, -68.5, -55, -72, -53, -75, -48,
    -73.5, -40, -71.5, -30, -70.5, -18, -76, -14, -81, -5,
  ],
  namerica: [
    -125, 49, -124, 40, -117, 32.5, -112, 29, -105, 23, -97, 16,
    -92, 14.5, -86, 12, -83, 9, -79.5, 8.5, -77.5, 8.2, -80, 10,
    -83.5, 15, -88, 16, -87, 21, -90, 21, -91, 18.5, -94, 18.2,
    -97.5, 22, -97.5, 27, -94, 29.5, -89, 29, -85, 30, -82.5, 27,
    -80, 25.5, -81, 31, -76, 35, -75, 38, -70, 41.5, -66, 44.5,
    -61, 45.5, -56, 47, -60, 50, -56, 52, -60, 55, -64, 60,
    -78, 62, -94, 59, -86, 66, -95, 70, -125, 70, -140, 70,
    -160, 70, -166, 66, -160, 60, -150, 60, -135, 55,
  ],
  greenland: [
    -73, 78, -60, 82, -30, 83, -20, 76, -22, 70, -40, 64,
    -50, 61, -55, 67, -58, 75,
  ],
  britain: [
    -5, 50, 1.5, 51, 0, 53.5, -2, 56, -3, 58.5, -5.5, 58.5,
    -6, 56, -3, 54.5, -4.5, 53, -5, 51.5,
  ],
  ireland: [-10, 51.5, -6, 52, -6, 55, -10, 54],
  madagascar: [44, -25, 47, -25, 50, -15, 49.5, -12, 47, -15, 44, -20],
};
const WATER = {
  blacksea: [
    28, 41.5, 41, 41.5, 40, 44, 37, 45, 33, 45.5, 30, 46,
    29, 44,
  ],
  caspian: [47, 37, 54, 37, 54, 41, 50, 45, 47, 45, 50, 41],
};
const inPoly = (pts, x, y) => {
  let c = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const isLand = (lon, lat) => {
  if (lat < -68) return true;   // Antarctica
  for (const k in WATER) if (inPoly(WATER[k], lon, lat)) return false;
  for (const k in LAND) if (inPoly(LAND[k], lon, lat)) return true;
  return false;
};

const OCEAN = [0x040a20, 0x0a1a4a, 0x112f78, 0x1a4aa8, 0x2c6ed2, 0x56a0ec];
const JUNGLE = [0x06120a, 0x0d2713, 0x174618, 0x266828, 0x3a8634, 0x56a246];
const GRASS = [0x0a1408, 0x1b2c10, 0x33481c, 0x516828, 0x768838, 0x98a64e];
const DESERT = [0x160f08, 0x35260f, 0x61451a, 0x926c2c, 0xbd9644, 0xdeba66];
const ICE = [0x10161e, 0x28323e, 0x55657a, 0x8798ae, 0xbccce0, 0xeef4fb];
const CLOUD = [0x10142c, 0x342c4a, 0x7c6474, 0xc0b0b6, 0xe2eaf6, 0xfafcff];   // dusk pinks near the terminator
const CITY = [0xffa850, 0xff8a30, 0xffd890];

function biome(lon, lat, n) {
  const a = Math.abs(lat);
  if (a > 66) return ICE;
  if (lon > 33 && lon < 62 && lat > 12 && lat < 31) return DESERT;                 // Arabia
  if (lon > -17 && lon < 36 && lat > 16 && lat < 31) return DESERT;                // Sahara
  if (lon > 36 && lon < 52 && lat > -1 && lat < 12) return n > 0.55 ? GRASS : DESERT;   // Horn of Africa
  if (lon > 12 && lon < 26 && lat < -17 && lat > -30) return n > 0.5 ? DESERT : GRASS;   // Kalahari
  if (lon > 50 && lon < 100 && lat > 25 && lat < 40) return n > 0.45 ? DESERT : GRASS;  // Iran, Turkestan
  if (a < 12) return JUNGLE;
  if (a > 56) return n > 0.5 ? ICE : GRASS;
  if (lat < -36) return n > 0.5 ? DESERT : GRASS;
  return n > 0.62 ? DESERT : (n < 0.3 ? JUNGLE : GRASS);
}

// Cloud cover 0..1 at (lon, lat): banded weather, noise and two swirling storms.
function clouds(lon, lat) {
  const per = 24;   // lattice cells around the globe (15° each) so that the field wraps
  const wx = lon + 30 * (noiseP(lon / 15 + 3, lat / 15, per, 12, 7) - 0.5);
  const wy = lat + 30 * (noiseP(lon / 15 + 9, lat / 15 + 4, per, 12, 8) - 0.5);
  let c = noiseP(wx / 15, wy / 15, per, 12, 5) * 0.62 + noiseP(wx / 6, wy / 6, 60, 30, 6) * 0.38;
  c += 0.2 * Math.exp(-Math.pow((lat - 6) / 7, 2)) - 0.1 * Math.exp(-Math.pow((Math.abs(lat) - 24) / 6, 2));   // ITCZ, subtropical clear belts
  c += 0.1 * Math.exp(-Math.pow((Math.abs(lat) - 55) / 9, 2));
  for (const s of [{ lon: -28, lat: 47, r: 16, t: 1 }, { lon: 62, lat: -44, r: 14, t: -1 }]) {
    const dx = (wrapDeg(lon - s.lon)) * Math.cos(lat * D2R), dy = lat - s.lat, r = Math.hypot(dx, dy);
    if (r < s.r * 1.6) {
      const th = Math.atan2(dy, dx) + s.t * (r / s.r) * 2.6;
      const arms = 0.5 + 0.5 * Math.cos(2 * th);
      const fall = Math.exp(-Math.pow(r / (s.r * 1.1), 2));
      c = Math.max(c, 0.25 + 0.75 * arms * fall * smooth(0.5, 3, r));
      if (r < s.r * 0.22) c = Math.min(c, 0.3);   // the eye
    }
  }
  return clamp(c);
}

const EARTH_VIEW = { lon: 12, lat: 14, tilt: 22 };   // sub-observer point of the globe, axis tilt (clockwise from up, degrees)
// The Earth is shown gibbous (about 70 % lit) although the Sun, 60° from it in this sky, would make a crescent of it: the light
// keeps its true direction on the disc (from the east, a little above) but arrives more from the front.
const EARTH_PHASE = 66;   // degrees between the light and the viewer

function paintEarth(p) {
  const S0 = lightAt(EARTH.az, EARTH.el), m0 = Math.hypot(S0[0], S0[1]) || 1;
  const L = [(S0[0] / m0) * Math.sin(EARTH_PHASE * D2R), (S0[1] / m0) * Math.sin(EARTH_PHASE * D2R), Math.cos(EARTH_PHASE * D2R)];   // light in disc coordinates
  const hl = Math.hypot(L[0], L[1], L[2] + 1), H = [L[0] / hl, L[1] / hl, (L[2] + 1) / hl];   // half vector Sun ↔ viewer
  const tilt = EARTH_VIEW.tilt * D2R, ct = Math.cos(tilt), st = Math.sin(tilt);
  const lat0 = EARTH_VIEW.lat * D2R, sl0 = Math.sin(lat0), cl0 = Math.cos(lat0);
  const Rtex = (EARTH.radius / 360) * SKY.w;   // radius in texels

  splat(p, EARTH.az, EARTH.el, EARTH.radius * 1.5, (dx, dy, x, y) => {
    const nx = dx / EARTH.radius, ny = dy / EARTH.radius, rr = hyp(nx, ny);
    if (rr > 1) {
      // atmosphere: a bright ring and a faint dithered halo just outside the limb, on the lit side only
      const lim = (rr - 1) * Rtex, side = (nx * L[0] + ny * L[1]) / rr;
      if (lim < 1 && side > -0.2) return side > 0.1 ? 0x2c66c6 : 0x13306a;
      if (lim < 2 && side > 0.3 && bayer4(x, y) < (side - 0.3) * 1.6) return 0x0e2554;
      return null;
    }
    const nz = Math.sqrt(Math.max(0, 1 - rr * rr));
    const lit = nx * L[0] + ny * L[1] + nz * L[2];
    // globe coordinates (axis tilted on screen)
    const gx = nx * ct - ny * st, gy = nx * st + ny * ct;
    const lat = Math.asin(clamp(nz * sl0 + gy * cl0, -1, 1)) / D2R;
    const lon = wrapDeg(EARTH_VIEW.lon + Math.atan2(gx, nz * cl0 - gy * sl0) / D2R);
    const land = isLand(lon, lat);
    const grain = hash(x, y, 91);
    const ramp = land ? biome(lon, lat, noiseP((lon + 180) / 9, (lat + 90) / 9, 40, 20, 3)) : OCEAN;
    const cover = clouds(lon, lat) + (grain - 0.5) * 0.1;
    const v = clamp((lit + 0.05) / 0.8);
    let col;
    if (cover > 0.62) col = ditherRamp(CLOUD, clamp(0.12 + v * 1.0), x, y);
    else if (cover > 0.54 && bayer4(x, y) < (cover - 0.54) * 12) col = ditherRamp(CLOUD, clamp(0.08 + v * 0.9), x, y);
    else {
      col = ditherRamp(ramp, v, x, y);
      if (!land && lit > 0.1) {   // the Sun's glint on the ocean: a small dithered highlight where the sea mirrors the Sun to the viewer
        const g = clamp(nx * H[0] + ny * H[1] + nz * H[2]);
        const spec = Math.pow(g, 90);
        if (spec > 0.18 + 0.5 * bayer4(x, y)) col = spec > 0.6 ? 0xd6eeff : 0x8cc4f6;
      }
    }
    // thin bright atmosphere on the lit limb; a dim blue edge on the dark one so the disc keeps its outline
    if (rr > 1 - 1.1 / Rtex) col = lit > -0.1 ? (rr > 1 - 0.6 / Rtex ? 0xa8e0ff : 0x62aef4) : 0x0b1a40;
    else if (lit < 0.02 && land && lat > 4 && lat < 62 && hash(x, y, 17) > 0.8 - 0.3 * noiseP(lon / 7 + 40, lat / 7, 52, 26, 20) && hash(x >> 1, y >> 1, 18) > 0.2) col = CITY[Math.floor(hash(x, y, 19) * 3)];
    return col;
  });
}

// ── A tiny orbital station, in the black next to the Earth ──────────────────────────────────
function paintStation(p) {
  const rows = [
    'bBbBb..a..bBbBb',
    'bBbBb.wMw.bBbBb',
    'bBbBb.wMw.bBbBb',
    'ttttttwMwttttcc',
    'bBbBb.wMw.bBbBb',
    'bBbBb.wMw.bBbBb',
    'bBbBb..a..bBbBb',
  ];
  const pal = { b: 0x264e98, B: 0x5e98dc, M: 0xd2dae8, w: 0x9098aa, t: 0x646c80, a: 0x7c849a, c: 0xe0e4ee };
  const x0 = Math.round(azCol(STATION.az) - 7), y0 = Math.round(elRow(STATION.el) - 3);
  p.rect(x0 - 3, y0 - 3, 21, 13, 0x000000);   // no star in front of it
  p.grid(rows, pal, x0, y0);
}

// ── The ringed gas giant, north ──────────────────────────────────────────────────────────────
// A globe of banded cloud (belts and zones, wavy edges, one storm, cold bluish poles) lit from the east, and rings seen from
// above their plane. Both cast shadows on each other: the planet's falls across the rings on the dark side, the rings' across
// the southern hemisphere. The exact 3D tests keep them honest without any special casing.
const GIANT_CLOUD = [0x120a10, 0x2a1418, 0x4a2420, 0x6e3a2a, 0x95583a, 0xb87a4c, 0xd9a468, 0xecc88c, 0xf8e4b8];
const GIANT_POLAR = [0x0b1018, 0x1a2430, 0x2f4256, 0x4c6680, 0x7a94ab, 0xaec2d2];
const RING = [0x1c1612, 0x3e3226, 0x6a5840, 0x9a8260, 0xc4aa7e, 0xe6d2a4, 0xfaf0cc];
const GIANT_BANDS = [0.5, 0.82, 0.42, 0.9, 0.55, 0.3, 0.75, 0.46, 0.95, 0.38, 0.7, 0.52, 0.86, 0.34, 0.66, 0.48];   // 16 bands from pole to pole

// Opacity and tone of the rings at radius q (in planet radii), or null outside them.
function ringProfile(q) {
  const [a, b] = GIANT.ring;
  if (q < a || q > b) return null;
  const stripe = hash(Math.floor(q * 40), 0, 311) - 0.5;
  if (q < 1.5) return [0.38 + 0.3 * (q - a) / (1.5 - a), 0.34 + 0.3 * stripe];          // C ring: dim, translucent
  if (q < 1.86) return [1, 0.84 + 0.3 * stripe - 0.1 * (1.86 - q)];                    // B ring: bright, opaque
  if (q < 1.96) return [0.1, 0.4];                                                      // Cassini division
  if (q < 2.05) return [0.9, 0.62 + 0.3 * stripe];                                      // A ring
  if (q < 2.08) return [0.18, 0.4];                                                     // Encke gap
  return [0.85, 0.5 + 0.2 * stripe];
}

function paintGiant(p) {
  const G = GIANT, R = G.radius, L = lightAt(G.az, G.el);
  const tau = G.tilt * D2R, ci = Math.cos(G.incl * D2R), si = Math.sin(G.incl * D2R), ct = Math.cos(tau), st = Math.sin(tau);
  const A = [-st * ci, ct * ci, si];                         // spin axis, disc coordinates (x right, y up, z towards us)
  const E1 = [ct, st, 0], E2 = [-si * st, si * ct, -ci];     // ring plane axes; E2 points away from us: v > 0 is the far half
  const LA = dot(L, A), face = LA > 0 ? 1 : 0.35;            // the lit face of the rings is the one we see
  const Rtex = (R / 360) * SKY.w;

  // Colour of the ring at screen offset (dx, dy) degrees (null: no ring or see-through).
  const ring = (dx, dy, x, y) => {
    const u = dx * ct + dy * st, v = (-dx * st + dy * ct) / si;
    const pr = ringProfile(hyp(u, v) / R);
    if (!pr) return null;
    if (pr[0] < 1 && bayer4(x, y) > pr[0]) return null;
    // the planet's shadow: the ring point, in planet radii, against the cylinder of the planet along the light
    const qx = (u / R) * E1[0] + (v / R) * E2[0], qy = (u / R) * E1[1] + (v / R) * E2[1], qz = (u / R) * E1[2] + (v / R) * E2[2];
    const s = qx * L[0] + qy * L[1] + qz * L[2];
    let shade = 1;
    if (s < 0) shade = smooth(0.9, 1.12, Math.sqrt(Math.max(0, qx * qx + qy * qy + qz * qz - s * s)));
    const light = face * (0.2 + 0.8 * shade);
    return ditherRamp(RING, clamp(pr[1] * (0.25 + 0.85 * light) + 0.02), x, y);
  };

  const stormX = 28, stormY = -23;
  splat(p, G.az, G.el, G.ring[1] * R + 1, (dx, dy, x, y) => {
    const nx = dx / R, ny = dy / R, rr = hyp(nx, ny);
    const v = dx * -st + dy * ct;   // screen height in the ring frame (below the middle = the near half)
    const nearRing = v < 0 ? ring(dx, dy, x, y) : null;
    if (nearRing !== null) return nearRing;
    if (rr > 1) {
      const far = v >= 0 ? ring(dx, dy, x, y) : null;
      if (far !== null) return far;
      // a thin haze on the lit limb
      const lim = (rr - 1) * Rtex, side = (nx * L[0] + ny * L[1]) / rr;
      if (lim < 1 && side > 0.05) return side > 0.4 ? 0xd9a468 : 0x6e3a2a;
      if (lim < 2.2 && side > 0.35 && bayer4(x, y) < (side - 0.35) * 1.4) return 0x3a2018;
      return null;
    }
    const nz = Math.sqrt(Math.max(0, 1 - rr * rr));
    const lit = nx * L[0] + ny * L[1] + nz * L[2];
    const sinLat = nx * A[0] + ny * A[1] + nz * A[2];
    const lat = Math.asin(clamp(sinLat, -1, 1)) / D2R;
    const lon = Math.atan2(nx * E2[0] + ny * E2[1] + nz * E2[2], nx * E1[0] + ny * E1[1] + nz * E1[2]) / D2R;   // −180..180
    const polar = bayer4(x, y) < smooth(66, 82, Math.abs(lat));
    // banded cloud tone with wavy edges and a few turbulent knots
    const wob = 5.5 * (noiseP((lon + 180) / 22, (lat + 90) / 8, 17, 24, 21) - 0.5) + 2.2 * (noiseP((lon + 180) / 8, (lat + 90) / 3.5, 46, 52, 22) - 0.5);
    const f = (lat + wob + 90) / 11.25, bi = clamp(Math.floor(f), 0, 15);
    let tone = GIANT_BANDS[bi] + 0.2 * (noiseP((lon + 180) / 6, (lat + 90) / 2.6, 60, 70, 23) - 0.5);
    const fr = f - bi;
    if (fr < 0.1) tone -= 0.14;   // a darker thread along each band edge
    // the storm: a pale ring around a rusty eye
    const sx = wrapDeg(lon - stormX) * Math.cos(lat * D2R) / 15, sy = (lat - stormY) / 7.5, se = sx * sx + sy * sy;
    if (se < 1) tone = se < 0.18 ? 0.12 : se < 0.5 ? 0.98 : 0.3;
    // ring shadow on the globe: where the ray towards the Sun crosses the ring plane inside the rings
    let shade = 1;
    if (Math.abs(LA) > 0.03) {
      const t = -sinLat / LA;
      if (t > 0) {
        const q = hyp(nx + t * L[0], ny + t * L[1], nz + t * L[2]), pr = ringProfile(q);
        if (pr) shade = 1 - 0.78 * pr[0];
      }
    }
    const light = clamp((lit + 0.04) / 0.85) * shade;
    let col = polar
      ? ditherRamp(GIANT_POLAR, clamp(light * (0.3 + 0.8 * tone)), x, y)
      : ditherRamp(GIANT_CLOUD, clamp(light * (0.22 + 0.86 * tone)), x, y);
    if (rr > 1 - 1.1 / Rtex) col = lit > 0 ? (rr > 1 - 0.6 / Rtex ? 0xf4d9a4 : 0xc8925a) : 0x24121a;
    return col;
  });
}

// ── Two moons of the giant ───────────────────────────────────────────────────────────────────
// Craters are bumps in the surface normal (a bowl and a rim), shaded against the light: a bowl is dark on the side that faces
// away from the Sun and bright on the other, the rim catches the light.
const MOON_RAMP = [0x1a1816, 0x2c2926, 0x433f3a, 0x5e5851, 0x7c756c, 0x9d958a, 0xc0b8aa, 0xd8d2c4];
const ICE_RAMP = [0x1c140c, 0x3c2c18, 0x6e5230, 0xa07c4c, 0xcca874, 0xe8d4a4, 0xf8ecc8];   // a polished, creamy moon
const MOON_A_CRATERS = [[-0.38, 0.28, 0.3], [0.3, -0.3, 0.36], [0.06, 0.6, 0.2], [-0.58, -0.3, 0.2], [0.6, 0.22, 0.17], [-0.1, -0.64, 0.17], [0.02, 0, 0.13], [0.36, 0.5, 0.12]];

function paintMoon(p, M, ramp, craters, seed, smoothIce) {
  const R = M.radius, L = lightAt(M.az, M.el), Rtex = (R / 360) * SKY.w;
  const cracks = [[0.62, 0.3, 0.72], [-0.4, 0.78, 0.48], [0.3, -0.7, 0.64]].map(c => { const m = Math.hypot(...c); return c.map(k => k / m); });
  splat(p, M.az, M.el, R + 0.5, (dx, dy, x, y) => {
    const nx = dx / R, ny = dy / R, rr = hyp(nx, ny);
    if (rr > 1) return null;
    const nz = Math.sqrt(Math.max(0, 1 - rr * rr));
    let bx = 0, by = 0, alb = (noiseP(nx * 2 + 5, ny * 2 + 5, 64, 64, seed) - 0.5) * 0.3;
    for (const [cx, cy, rc] of craters) {
      const ex = nx - cx, ey = ny - cy, el = hyp(ex, ey), d = el / rc;
      if (d > 1.6 || el < 1e-5) continue;
      const g = Math.exp(-Math.pow((d - 1) / 0.2, 2));
      const slope = 0.75 * ((d < 1 ? d : 0) - 12.5 * (d - 1) * g);   // dh/dd: a bowl that climbs to a raised rim, then falls off
      bx -= (slope * ex) / el; by -= (slope * ey) / el;
      if (d < 0.9) alb -= 0.05 * (1 - d);
    }
    const m = hyp(nx + bx, ny + by, nz) || 1;
    let lit = ((nx + bx) * L[0] + (ny + by) * L[1] + nz * L[2]) / m;
    if (smoothIce) for (const c of cracks) if (Math.abs(nx * c[0] + ny * c[1] + nz * c[2]) < 0.045) { alb -= 0.32; break; }
    let v = clamp((lit + 0.03) / 0.95 + alb);
    let col = ditherRamp(ramp, v, x, y);
    if (rr > 1 - 0.9 / Rtex && lit < 0.05) col = ramp[0];
    return col;
  });
}

// ── Sprites on the texel grid ────────────────────────────────────────────────────────────────
// fn(i, j) is called for every texel of a (2·half+1) square centred on the texel that holds (az, el) (i to the right, j UP) and
// returns a colour or null. `outline` adds a 1 texel ring in that colour around the sprite so that it reads against stars and rocks.
function sprite(p, az, el, half, fn, outline = null) {
  const n = half * 2 + 1, cells = new Array(n * n).fill(null);
  for (let j = -half; j <= half; j++) {
    for (let i = -half; i <= half; i++) {
      const c = fn(i, -j);
      if (c !== null && c !== undefined) cells[(j + half) * n + (i + half)] = c;
    }
  }
  const cx = Math.floor(azCol(az)), cy = Math.floor(elRow(el));
  const at = (i, j) => (i < 0 || j < 0 || i >= n || j >= n ? null : cells[j * n + i]);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let c = cells[j * n + i];
      if (c === null && outline !== null && (at(i - 1, j) !== null || at(i + 1, j) !== null || at(i, j - 1) !== null || at(i, j + 1) !== null)) c = outline;
      if (c !== null) p.set(((cx + i - half) % SKY.w + SKY.w) % SKY.w, cy + j - half, c);
    }
  }
}
const ell = (x, y, cx, cy, rx, ry) => { const a = (x - cx) / rx, b = (y - cy) / ry; return a * a + b * b; };
const segDist = (x, y, x0, y0, x1, y1) => {
  const dx = x1 - x0, dy = y1 - y0, t = clamp(((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy));
  return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
};

// ── The asteroid field, west ─────────────────────────────────────────────────────────────────
// A stream of rocks that flows down from the upper left to the horizon behind the ridge; the rocks grow (come closer) as they
// fall. The Sun is behind the viewer here, so they are almost full: one side lit, the other in shadow.
const ROCK = [0x1c1a18, 0x2f2b27, 0x4a443d, 0x6d655b, 0x948a7c, 0xb9ad9a, 0xd4c8b2];
const ROCK_RUST = [0x1e100a, 0x3a1e12, 0x5e3320, 0x854a2e, 0xa86a42, 0xcc9066, 0xe8b890];
const ROCK_DARK = [0x0c0b0a, 0x181614, 0x26231f, 0x3a352f, 0x544d44, 0x736a5e, 0x948978];
const ROCK_METAL = [0x16181a, 0x262a2e, 0x3e444c, 0x5c646e, 0x808a96, 0xa4aeba, 0xc8d0d8];

// One rock at (az, el), r texels across its long radius. Lumpy outline, an ellipsoid shaded against the light, optional craters.
function paintRock(p, az, el, r, seed, ramp, ar = 1, theta = 0, craters = null) {
  const cx = azCol(az), cy = elRow(el);
  if (r < 0.8) { p.set(Math.floor(cx) % SKY.w, Math.floor(cy), ramp[2 + (seed % 4)]); return; }
  const L = lightAt(az, el), co = Math.cos(theta * D2R), si = Math.sin(theta * D2R);
  const lx = L[0] * co + L[1] * si, ly = -L[0] * si + L[1] * co, lz = L[2];   // the light in the rock's own axes
  const reach = Math.ceil(r * Math.max(1, ar) * 1.3) + 1;
  for (let y = Math.floor(cy) - reach; y <= Math.floor(cy) + reach; y++) {
    for (let x = Math.floor(cx) - reach; x <= Math.floor(cx) + reach; x++) {
      const ox = x + 0.5 - cx, oy = cy - (y + 0.5);
      const nx = (ox * co + oy * si) / r, ny = (-ox * si + oy * co) / (r * ar);
      const rr0 = hyp(nx, ny);
      if (rr0 > 1.3) continue;
      const ang = (Math.atan2(ny, nx) / (2 * Math.PI) + 0.5) * 6;
      const rr = rr0 / (0.78 + 0.5 * ROCK_EDGE(ang, seed));
      if (rr > 1) continue;
      const nz = Math.sqrt(Math.max(0, 1 - rr * rr));
      let bx = 0, by = 0;
      const alb = (hash(x, y, seed) - 0.5) * 0.18;
      if (craters) for (const [ccx, ccy, rc] of craters) {
        const ex = nx - ccx, ey = ny - ccy, el2 = hyp(ex, ey), d = el2 / rc;
        if (d > 1.5 || el2 < 1e-5) continue;
        const g = Math.exp(-Math.pow((d - 1) / 0.22, 2));
        const slope = 0.8 * ((d < 1 ? d : 0) - 11 * (d - 1) * g);
        bx -= (slope * ex) / el2; by -= (slope * ey) / el2;
      }
      const m = hyp(nx + bx, ny + by, nz) || 1;
      const lit = ((nx + bx) * lx + (ny + by) * ly + nz * lz) / m;
      p.set(((x % SKY.w) + SKY.w) % SKY.w, y, ditherRamp(ramp, clamp(lit * 1.05 + 0.04 + alb), x, y));
    }
  }
}
// Lumpiness of a rock's outline: a periodic noise around the rim (6 lumps), per rock seed.
const ROCK_EDGE = (() => { const cache = new Map(); return (ang, seed) => { let f = cache.get(seed); if (!f) { f = lattice(6, 1, seed); cache.set(seed, f); } return f(ang, 0.5); }; })();

function paintAsteroids(p) {
  const rand = rng(777);
  const pickRamp = u => (u < 0.08 ? ROCK_RUST : u < 0.12 ? ROCK_METAL : u < 0.45 ? ROCK_DARK : ROCK);
  const gauss = () => (rand() + rand() + rand() - 1.5) * 1.55;
  const [a0, e0] = FIELD.from, [a1, e1] = FIELD.to;
  const len = Math.hypot(a1 - a0, e1 - e0), nxv = -(e1 - e0) / len, nyv = (a1 - a0) / len;   // unit normal of the stream
  const rocks = [];
  for (let i = 0; i < 360; i++) {
    const s = rand(), sigma = 2.5 + 8 * Math.sin(Math.PI * s), w = gauss() * sigma;
    rocks.push({ az: a0 + s * (a1 - a0) + nxv * w, el: e0 + s * (e1 - e0) + nyv * w, s });
  }
  for (let i = 0; i < 90; i++) rocks.push({ az: FIELD.az + (rand() * 2 - 1) * 46, el: 1 + rand() * 42, s: rand() * 0.5 });   // strays
  const list = [];
  for (const r of rocks) {
    if (r.el < 0.8 || r.el > 52 || Math.hypot(r.az - DUCK.az, r.el - DUCK.el) < 5.5 || Math.hypot(r.az - COMET.az, (r.el - COMET.el)) < 4 || Math.hypot(r.az - MOON_B.az, r.el - MOON_B.el) < 7) continue;
    const u = rand(), k = 0.7 + 0.9 * r.s;
    const size = u < 0.5 ? 0.5 : u < 0.78 ? 1 : u < 0.92 ? 1.6 * k : u < 0.975 ? 2.3 * k : 3.2 * k;
    list.push({ ...r, size, seed: Math.floor(rand() * 1000), ramp: pickRamp(rand()), ar: 0.7 + 0.6 * rand(), th: rand() * 180 });
  }
  list.sort((a, b) => a.size - b.size);
  for (const r of list) paintRock(p, r.az, r.el, r.size, r.seed, r.ramp, r.ar, r.th);
  // the big ones, closer to us: bigger and lower in the stream, some with craters
  const heroes = [
    [226, 8.6, 6.6, 1.1, 30, ROCK, [[-0.35, 0.3, 0.3], [0.3, -0.25, 0.34], [0.05, 0.62, 0.18], [-0.55, -0.4, 0.2]]],
    [182, 24, 4.4, 0.8, 70, ROCK, [[0.2, 0.15, 0.4], [-0.4, -0.3, 0.25]]],
    [241, 3.8, 5, 0.9, 10, ROCK_RUST, [[-0.2, 0.2, 0.35], [0.4, -0.2, 0.25]]],
    [157, 31, 3.6, 1, 120, ROCK_METAL, null],
    [215, 21, 3.1, 1.2, 150, ROCK, null],
    [194, 4.6, 3.8, 0.85, 40, ROCK, [[0.1, 0.1, 0.4]]],
    [232, 28, 2.4, 1, 20, ROCK_RUST, null],
    [250, 12.5, 2.2, 1, 90, ROCK, null],
  ];
  heroes.forEach(([az, el, r, ar, th, ramp, cr], i) => paintRock(p, az, el, r, 100 + i * 17, ramp, ar, th, cr));
}

// ── The comet ────────────────────────────────────────────────────────────────────────────────
// Two tails away from the Sun: a straight blue ion tail and a wider, curved, yellowish dust tail.
function paintComet(p) {
  const C = COMET, fr = frame(C.az, C.el);
  const sx = dot(SUN_DIR, fr.r), sy = dot(SUN_DIR, fr.u), m = Math.hypot(sx, sy), tx = -sx / m, ty = -sy / m;   // away from the Sun, in the tangent plane
  const ION = [0x000000, 0x0a1830, 0x14407a, 0x2c80c0, 0x7cc8f0, 0xdcf6ff];
  const DUST = [0x000000, 0x2a2010, 0x5a4824, 0x9a8048, 0xd0b878, 0xf8ecc0];
  const COMA = [0x000000, 0x0c2a28, 0x1c5a54, 0x3a9a8c, 0x9ae0cc, 0xf0fff8];
  splat(p, C.az, C.el, C.tail + 2, (dx, dy, x, y) => {
    const s = dx * tx + dy * ty, q = -dx * ty + dy * tx, d = hyp(dx, dy);
    if (d <= C.radius * 0.62) return 0xffffff;
    let coma = 0, v = 0, vd = 0;
    if (d < 2.4) coma = Math.exp(-Math.pow(d / 0.95, 2)) * 1.15;
    if (s > 0.2 && s < C.tail) {
      const w = 0.2 + 0.05 * s;
      if (Math.abs(q) < w * 3) v = Math.exp(-Math.pow(q / w, 2)) * Math.pow(1 - s / C.tail, 1) * 0.95;
    }
    if (s > 0 && s < C.tail * 0.85) {
      const w = 0.5 + 0.2 * s, c = q - 0.022 * s * s;
      if (Math.abs(c) < w * 3) vd = 0.75 * Math.exp(-Math.pow(c / w, 2)) * Math.pow(1 - s / (C.tail * 0.85), 1.4);
    }
    if (coma + v + vd < 0.1) return null;
    if (coma >= v && coma >= vd) return ditherRamp(COMA, clamp(coma), x, y);
    return v >= vd ? ditherRamp(ION, v, x, y) : ditherRamp(DUST, vd, x, y);
  }, true);
}

// ── The jokes ────────────────────────────────────────────────────────────────────────────────
// Three small wrinkles in the black, each readable at game scale (about 4 screen pixels per texel). They are lit as if the Sun
// stood up and to the left of the viewer, whatever the real geometry, so that none of them hides in its own shadow.
const JOKE_LIGHT = (() => { const v = [-0.5, 0.52, 0.69], m = Math.hypot(...v); return v.map(k => k / m); })();

// 1. A derelict rubber duck, a satellite now (it lost a solar wing and its dish is bent), tumbling among the rocks.
function paintDuck(p) {
  const L = lightAt(DUCK.az, DUCK.el), TH = 24;
  const [lx, ly] = rot(L[0], L[1], TH), lz = L[2];   // the light in the duck's own axes
  const YEL = [0x2e1f04, 0x6e4c0a, 0xb07e10, 0xe8b820, 0xffd940, 0xfff08a, 0xffffe0];
  const ORA = [0x4a1a04, 0x9a3a0a, 0xe0700e, 0xffa030, 0xffd070];
  const PAN = [0x0e1a3e, 0x1c3a7a, 0x3a6ac0, 0x80aaf0];
  const body = (x, y, cx, cy, rx, ry, ramp, i, j, bias = 0) => {
    const a = (x - cx) / rx, b = (y - cy) / ry, z = Math.sqrt(Math.max(0, 1 - a * a - b * b));
    return ditherRamp(ramp, clamp((a * lx + b * ly + z * lz) * 0.85 + 0.2 + bias), i, j);
  };
  sprite(p, DUCK.az, DUCK.el, 17, (i, j) => {
    const [x, y] = rot(i, j, TH);   // duck axes: x right, y up, the duck faces left
    if (ell(x, y, -4.6, 3.9, 0.7, 0.7) <= 1) return 0x120d06;                                       // eye
    if (ell(x, y, -7.0, 2.2, 2.4, 1.15) <= 1) return body(x, y, -7.0, 2.2, 2.4, 1.15, ORA, i, j);  // beak
    if (ell(x, y, -3.4, 3.1, 3.1, 3.1) <= 1) return body(x, y, -3.4, 3.1, 3.1, 3.1, YEL, i, j);    // head
    const we = ell(x, y, 1.9, -1.0, 3.7, 2.3);
    if (we <= 1) return body(x, y, 1.9, -1.0, 3.7, 2.3, YEL, i, j, we > 0.62 ? -0.32 : -0.1);       // wing
    if (ell(x, y, 0.4, -1.2, 6.5, 4.4) <= 1) {                                                       // body, with a dent and a scratch
      if (ell(x, y, -0.2, -3.3, 0.9, 0.7) <= 1) return 0x2a1c06;
      if (segDist(x, y, 4.3, 0.6, 5.6, -1.3) < 0.4) return 0x7a5410;
      return body(x, y, 0.4, -1.2, 6.5, 4.4, YEL, i, j);
    }
    if (ell(x, y, 6.9, 0.9, 2.6, 1.5) <= 1 || ell(x, y, 7.6, 2.0, 1.5, 1.3) <= 1) return body(x, y, 6.9, 1.2, 3.0, 2.0, YEL, i, j, -0.05);   // tail
    // the surviving solar wing: a boom and a panel of 3 × 2 cells, one of them gone
    if (segDist(x, y, 3.0, -4.6, 4.2, -8.0) < 0.55) return 0x7a8498;
    if (x > 2.0 && x < 13.5 && y > -13.5 && y < -8.0) {
      const fx = (x - 2.0) / 3.83, fy = (y + 13.5) / 2.75, cxn = Math.floor(fx), cyn = Math.floor(fy);
      if (cxn === 2 && cyn === 1) return null;                                                       // the missing cell
      if (fx - cxn < 0.17 || fy - cyn < 0.22) return 0xa4b2cc;                                        // frame lines
      return PAN[1 + ((cxn + cyn) & 1)];
    }
    // the dish: a thin bent mast and a small saucer
    if (segDist(x, y, -3.0, 5.8, -4.4, 9.2) < 0.45) return 0x8890a0;
    if (ell(x, y, -5.0, 10.0, 1.7, 0.85) <= 1) return 0xc8d0dc;
    return null;
  }, 0x0c0a06);
}

// 2. A lost coffee mug, adrift between the Sun and the Earth, a few droplets of coffee frozen around it.
function paintMug(p) {
  const TH = -11;
  const GLAZE = [0x7a2410, 0xb83c1c, 0xe85a28, 0xff8a4c, 0xffb084];   // dark side → highlight, flat bands
  sprite(p, MUG.az, MUG.el, 12, (i, j) => {
    const [x, y] = rot(i, j, TH);
    const top = ell(x, y, 0, 3.6, 4.6, 1.8);
    if (top <= 1) {
      if (top > 0.62) return x < -1.5 ? 0xfff4e8 : x > 2.5 ? 0xc8b4a4 : 0xe8d8c8;                      // the rim, lit on the left
      return (y > 3.7 && x < 0.6) ? 0x7a4a24 : 0x2c1708;                                                // the coffee, with a sheen
    }
    const bottom = -4.2 - 1.3 * Math.sqrt(Math.max(0, 1 - (x / 4.6) * (x / 4.6)));
    if (Math.abs(x) <= 4.6 && y <= 3.6 && y >= bottom) {
      const nx = x / 4.6;
      if (nx > -0.52 && nx < -0.3 && y < 2.2 && y > -3.4) return GLAZE[4];                              // a shine down the glaze
      return GLAZE[nx < -0.5 ? 3 : nx < 0.15 ? 2 : nx < 0.6 ? 1 : 0];
    }
    const hd = hyp(x - 5.6, y + 0.2);
    if (x > 3.8 && hd > 1.5 && hd < 2.9) return GLAZE[y > -0.2 ? 3 : 1];                                // the handle
    // frozen droplets of coffee, each with its glint
    for (const [dx, dy, r] of [[-7.4, 2.4, 1.1], [8.4, 6.2, 0.9], [7.6, -6.0, 0.7], [-6.6, -5.4, 0.6], [-4.4, 8.6, 0.5]]) {
      if (ell(x, y, dx, dy, r, r) <= 1) return (x < dx && y > dy && r > 0.8) ? 0xa87a4a : 0x5a3014;
    }
    return null;
  }, 0x0a0806);
}

// 3. A flying saucer, far away, making off with a server rack (its LEDs still blink green).
function paintSaucer(p) {
  const TH = 6;
  const [lx, ly] = rot(JOKE_LIGHT[0], JOKE_LIGHT[1], TH), lz = JOKE_LIGHT[2];
  const HULL = [0x1a1e28, 0x343c4e, 0x58647c, 0x8494b0, 0xb4c2d8, 0xe4eefa];
  const GLASS = [0x0a2a3a, 0x1a5a72, 0x3a9ab8, 0x8ae0f0, 0xe0fcff];
  const sh = (x, y, cx, cy, rx, ry, ramp, i, j, bias = 0) => {
    const a = (x - cx) / rx, b = (y - cy) / ry, z = Math.sqrt(Math.max(0, 1 - a * a - b * b));
    return ditherRamp(ramp, clamp((a * lx + b * ly + z * lz) * 0.85 + 0.25 + bias), i, j);
  };
  sprite(p, SAUCER.az, SAUCER.el, 17, (i, j) => {
    const [x, y] = rot(i, j, TH);
    // the rack, hanging under the hull from two arms
    if (x > -3.2 && x < 3.2 && y > -15.5 && y < -5) {
      if (y > -6 || x < -2.5 || x > 2.5 || y < -14.8) return 0xa0aabe;                              // frame
      const k = -y - 6;                                                                              // rows from the top, 2 texels each
      if (k % 2 < 0.9) return 0x14181f;
      if (Math.abs(x + 1.2) < 0.6) return Math.floor(k / 2) % 2 ? 0x2ab84a : 0x60ff80;               // green LEDs
      if (Math.abs(x - 1.2) < 0.6) return Math.floor(k / 2) === 1 ? 0xff5a3c : 0xffb83c;             // red / amber LEDs
      return 0x262c3a;
    }
    if (segDist(x, y, -3.0, -2.6, -2.5, -5.4) < 0.5 || segDist(x, y, 3.0, -2.6, 2.5, -5.4) < 0.5) return 0x8a94a8;   // the arms
    if (ell(x, y, 0.4, 2.4, 4.6, 3.8) <= 1 && y > 1.2) return sh(x, y, 0.4, 2.4, 4.6, 3.8, GLASS, i, j);   // dome
    const e = ell(x, y, 0, 0, 11.4, 2.9);
    if (e <= 1) {
      if (y < -0.5 && e > 0.5 && Math.floor(x + 20) % 4 === 0) return (Math.floor((x + 20) / 4) & 1) ? 0xffe070 : 0xffffff;   // rim lights
      return sh(x, y, 0, 0, 11.4, 2.9, HULL, i, j, y < -0.9 ? -0.2 : 0);
    }
    return null;
  }, 0x08080c);
}

// ── The lunar horizon: three skylines of angular ridges and crater rims ─────────────────────
// Each layer is a closed polyline (peaks and saddles, straight facets), so the silhouette stays jagged and crisp; the facets
// are lit or shadowed by the Sun's side, and the feet melt into HORIZON, the colour the plain fades to in the exterior's fog.
// How tall the ridges stand (0..1) in each direction: lowest under the Earth, a good wall behind the giant, a broken one west.
const RELIEF = [[0, 0.62], [30, 0.72], [58, 0.42], [90, 0.16], [122, 0.46], [150, 0.8], [185, 1], [225, 0.9], [262, 0.95], [300, 1], [335, 0.85], [360, 0.62]];
function relief(az) {
  const a = ((az % 360) + 360) % 360;
  for (let i = 0; i + 1 < RELIEF.length; i++) {
    const [a0, v0] = RELIEF[i], [a1, v1] = RELIEF[i + 1];
    if (a >= a0 && a <= a1) return mix(v0, v1, smooth(a0, a1, a));
  }
  return RELIEF[0][1];
}

function skyline(L, li, W) {
  const rand = rng(L.seed);
  const pts = [];
  let x = 0;
  while (x < W) {
    const az = colAz(x), calm = relief(az);
    const mass = smooth(0.34, 0.7, noiseP(x / L.cluster, li * 3.3, W / L.cluster, 12, L.seed + 1));
    const peak = pts.length % 2 === 1;   // starts (and so closes) on a saddle: the 360° seam stays quiet
    const k = peak ? 0.45 + 0.55 * Math.pow(rand(), 0.8) : 0.05 + 0.3 * rand();
    const y = L.base * (0.7 + 0.3 * calm) + L.amp * calm * (0.1 + 0.9 * mass) * k;
    pts.push([x, y]);
    if (peak && rand() < L.cliffs) pts.push([x + 0.01, y * (0.3 + 0.3 * rand())]);   // a sheer drop behind the crest
    x += L.stepMin + rand() * (L.stepMax - L.stepMin);
  }
  pts.push([W, pts[0][1]]);   // closes the loop: the 360° sky wraps
  const hgt = new Float32Array(W);
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    for (let xx = Math.ceil(x0); xx < Math.min(W, x1); xx++) hgt[xx] = mix(y0, y1, (xx - x0) / (x1 - x0));
  }
  // a few crater rims: two crests with a dip between them
  L.rims.forEach(([cx, wd]) => {
    const calm = relief(colAz(cx));
    for (let k = -wd; k <= wd; k++) {
      const t = k / wd;
      hgt[(((cx + k) % W) + W) % W] += calm * (L.amp * 0.42 * Math.exp(-Math.pow((Math.abs(t) - 0.82) / 0.16, 2)) - L.amp * 0.14 * Math.exp(-Math.pow(t / 0.4, 2)));
    }
  });
  // rugged detail, bigger on the bigger mountains
  [[32, 3.2], [16, 2], [8, 1.2], [4, 0.7]].forEach(([sc, a], j) => {   // scales divide the sky width: the detail wraps exactly
    const nz = lattice(W / sc, 12, L.seed + 100 + j);
    for (let xx = 0; xx < W; xx++) hgt[xx] += (nz(xx / sc, li * 7 + j) - 0.5) * a * L.rough * (0.35 + hgt[xx] / L.amp);
  });
  // keep the sky under the Earth clear: the skyline climbs back up on either side of it
  for (let xx = 0; xx < W; xx++) hgt[xx] = clamp(hgt[xx], 0.6, 3.4 + 60 * smooth(7, 24, Math.abs(wrapDeg(colAz(xx) - EARTH.az))));
  return hgt;
}

function paintRidges(p) {
  const W = SKY.w, HZ = SKY.h / 2;   // row of the horizon (el 0)
  p.rect(0, HZ, W, SKY.h - HZ, HORIZON);
  const layers = [   // far → near: the far one is the lightest, the near one the darkest, each with its own mottling
    { seed: 71, base: 2.5, amp: 15, stepMin: 18, stepMax: 52, cliffs: 0.16, rough: 1, tone: 0.2, grain: 0.04, cluster: 128, rims: [[310, 80], [870, 70]], mottle: 0.34 },
    { seed: 83, base: 1.5, amp: 18, stepMin: 10, stepMax: 34, cliffs: 0.22, rough: 1.2, tone: 0.0, grain: 0.06, cluster: 64, rims: [[40, 60], [560, 90]], mottle: 0.4 },
    { seed: 97, base: 0.6, amp: 7, stepMin: 4, stepMax: 14, cliffs: 0.1, rough: 0.8, tone: -0.2, grain: 0.08, cluster: 32, rims: [], mottle: 0.3 },
  ];
  layers.forEach((L, li) => {
    const hgt = skyline(L, li, W), mottle = lattice(W / 16, 12, L.seed + 5);
    const rand = rng(L.seed + 900);
    for (let x = 0; x < W; x++) {
      const az = colAz(x), top = Math.max(1, Math.round(hgt[x]));
      const sl = (hgt[(x - 2 + W) % W] - hgt[(x + 2) % W]) / 4;   // + = descends to the right (a face looking right)
      const face = Math.cos((az + 180 - clamp(sl * 120, -80, 80) - SUN.az) * D2R);   // 1 = square to the Sun
      for (let d = 0; d < top; d++) {
        const y = HZ - 1 - d, f = top > 1 ? d / (top - 1) : 1;   // 0 at the foot, 1 at the crest
        let v = 0.1 + L.tone + 0.46 * face + 0.2 * f;
        v += (hash(x, y, L.seed) - 0.5) * L.grain * 2 + (mottle(x / 16, y / 4) - 0.5) * L.mottle;
        v = Math.max(v, 0.1 + 0.05 * (2 - li) + 0.16 * f);          // even a backlit ridge keeps a dim silhouette against the black
        if (d === top - 1) v += 0.2;                                // lit crest line
        else if (d === top - 2) v -= 0.06;
        let c = ditherRamp(GREY, clamp(v), x, y);
        if (d < 3 && bayer4(x, y) < (3 - d) / 3.4) c = HORIZON;      // the foot melts into the plain's haze
        p.set(x, y, c);
      }
    }
    // small craters and boulders on the faces: a dark pit with a lit lip, a bright speck
    const n = 60 + li * 20;
    for (let k = 0; k < n; k++) {
      const x = Math.floor(rand() * W), top = Math.round(hgt[x]);
      if (top < 5) continue;
      const y = HZ - 2 - Math.floor(rand() * (top - 3));
      if (rand() < 0.55) { const w = 1 + Math.floor(rand() * 2); p.set(x, y, GREY[1]); p.set(x + 1, y, GREY[1]); if (w > 1) p.set(x + 2, y, GREY[2]); p.set(x, y - 1, GREY[6]); p.set(x + 1, y - 1, GREY[5]); }
      else p.set(x, y, GREY[7 - (k % 2)]);
    }
  });
}

export function paintSky(p) {
  p.rect(0, 0, SKY.w, SKY.h, 0x000000);
  paintMilkyWay(p);
  paintStars(p);
  paintNebula(p);
  paintCluster(p);
  paintSpiral(p);
  paintRedStar(p);
  paintSun(p);
  paintPlanets(p);
  paintComet(p);
  paintAsteroids(p);
  paintDuck(p);
  paintMug(p);
  paintSaucer(p);
  paintGiant(p);
  paintMoon(p, MOON_A, MOON_RAMP, MOON_A_CRATERS, 31, false);
  paintMoon(p, MOON_B, ICE_RAMP, [[-0.3, 0.35, 0.28], [0.35, -0.2, 0.2]], 37, true);
  paintEarth(p);
  paintStation(p);
  paintRidges(p);
}

// ── Regolith ─────────────────────────────────────────────────────────────────────────────────
export function paintGround(p) {
  const W = GROUND.w, H = GROUND.h, rand = rng(4242);
  const hm = new Float32Array(W * H), alb = new Float32Array(W * H);
  const idx = (x, y) => (((y % H) + H) % H) * W + (((x % W) + W) % W);

  // gentle undulation and broad albedo patches (periodic lattices, so the tile wraps)
  const nh1 = lattice(W / 32, H / 32, 11), nh2 = lattice(W / 16, H / 16, 12), na1 = lattice(W / 64, H / 64, 13), na2 = lattice(W / 16, H / 16, 14);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    hm[idx(x, y)] += (nh1(x / 32, y / 32) - 0.5) * 5 + (nh2(x / 16, y / 16) - 0.5) * 2.2;
    alb[idx(x, y)] += (na1(x / 64, y / 64) - 0.5) * 0.16 + (na2(x / 16, y / 16) - 0.5) * 0.1;
  }

  // craters of every size, wrapped on the torus
  const placed = [];
  const crater = (cx, cy, r, young) => {
    placed.push([cx, cy, r]);
    const depth = r * (r > 18 ? 0.13 : 0.2), rimH = r * 0.085, reach = Math.ceil(r * 2.6);
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const ccx = cx + ox * W, ccy = cy + oy * H;
      for (let y = Math.max(0, Math.floor(ccy - reach)); y <= Math.min(H - 1, ccy + reach); y++) for (let x = Math.max(0, Math.floor(ccx - reach)); x <= Math.min(W - 1, ccx + reach); x++) {
        const d = hyp(x + 0.5 - ccx, y + 0.5 - ccy) / r;
        let h = 0, a = 0;
        if (d < 1) { const b = 1 - d * d; h = -depth * (b > 0.4 ? 0.4 + (b - 0.4) * 0.8 : b); a = -0.05 * b; }
        if (d > 0.1 && d < 1.9) h += rimH * Math.exp(-Math.pow((d - 1) / 0.17, 2));   // beyond these bounds the terms are lost in float32
        if (d >= 1) { h += rimH * 0.35 * Math.exp(-(d - 1) / 0.9); if (young && d < 6) a += 0.16 * Math.exp(-Math.pow((d - 1.25) / 0.8, 2)); }
        hm[y * W + x] += h; alb[y * W + x] += a;
      }
    }
  };
  const clear = (cx, cy, r, gap) => placed.every(([x, y, q]) => {
    const dx = Math.min(Math.abs(cx - x), W - Math.abs(cx - x)), dy = Math.min(Math.abs(cy - y), H - Math.abs(cy - y));
    return Math.hypot(dx, dy) > r + q + gap;
  });
  const place = (n, rMin, rMax, young, gap) => {
    for (let i = 0, tries = 0; i < n && tries < 400; tries++) {
      const cx = Math.floor(rand() * W), cy = Math.floor(rand() * H), r = mix(rMin, rMax, rand());
      if (gap >= 0 && !clear(cx, cy, r, gap)) continue;
      crater(cx, cy, r, rand() < young); i++;
    }
  };
  crater(32, 36, 30, true);
  crater(96, 100, 21, false);
  crater(104, 30, 16, true);
  place(6, 9, 15, 0.4, 3);
  place(18, 4, 8, 0.3, -1);
  place(50, 1.6, 3.4, 0.2, -1);
  // pebbles and boulders: tiny bright bumps (shaded like everything else)
  for (let i = 0; i < 150; i++) {
    const x = Math.floor(rand() * W), y = Math.floor(rand() * H), r = 0.8 + rand() * 1.1;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const d = hyp(dx, dy) / r;
      if (d < 1) hm[idx(x + dx, y + dy)] += (1 - d * d) * (0.9 + r * 0.5);
    }
  }

  // relief shading, light from the upper left
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const relief = hm[idx(x + 1, y + 1)] - hm[idx(x - 1, y - 1)] + 0.5 * (hm[idx(x + 1, y)] - hm[idx(x - 1, y)] + hm[idx(x, y + 1)] - hm[idx(x, y - 1)]);
    let v = 0.5 + alb[idx(x, y)] + relief * 0.13;
    v += (hash(x, y, 5) - 0.5) * 0.1 + (hash(x >> 1, y >> 1, 6) - 0.5) * 0.08;
    // half ordered, half random threshold: no 4-texel period to alias into moire at grazing angles
    p.set(x, y, ditherRamp(GROUND_RAMP, clamp(v), x, y, (xx, yy) => 0.5 * bayer4(xx, yy) + 0.5 * hash(xx, yy, 77)));
  }
}
