// Lunar sky and regolith for the portal windows (decor/windows.js). Everything is painted in the
// Doom pixel-art manner (banded ramps, Bayer dithering, grain) and is procedural and seeded, so it
// builds the same in node (the scratch viewer) and in the browser. No DOM, no Math.random.
//
//   paintSky(p)     equirectangular, SKY.w × SKY.h: x ↔ heading 0..360°, row 0 = zenith, row 256 = horizon
//                   (rows ≥ 256 hold HORIZON: the ground itself is ray-cast by the window shader)
//   paintGround(p)  seamless regolith tile, GROUND.meters metres square (row 0 = top row of the Pix)
//
// What a window can show: the view is 36° tall (−18°…+18° about the horizon; the 35° freelook shears the projection, up to
// +21°…+46°), and a window head 0.5 m above the eye frames up to ~15° at 2 m and ~10° at 3 m with a level view. The
// Earth therefore sits low (an "Earthrise" just above the lowest hills, el 7.5°, 12° across) and the skyline is kept low
// under it; the Sun is a small disc at el 14°; the rest of the sphere is stars and a faint Milky Way, which a pitched view
// and the skylight do reach.
//
// Ground: the window shader (decor/windows.js) ray-casts the plane and samples this tile with mipmaps (LinearMipmapLinear,
// RepeatWrapping, anisotropy 4: with nearest filtering it shimmers badly), fades it to HORIZON by view angle in dithered
// steps, then cuts it into a few ordered-dithered grey steps. The tile itself is already painted on GROUND_RAMP.
import { bayer4, hash, ditherRamp } from './dither.js';

export const SKY = { w: 1024, h: 512 };
// Degrees, heading convention of the player (0 = +x, 90 = +z, 270 = north). `radius` is the angular radius.
export const EARTH = { az: 235, el: 7.5, radius: 6 };
export const SUN = { az: 128, el: 14, radius: 1.1 };
export const GROUND = { w: 128, h: 128, meters: 10 };
export const HORIZON = 0x34312e;   // far ground fades to this; it is also the colour of the sky rows below the horizon

const D2R = Math.PI / 180;
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

const split = c => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
// Lightens the pixel to at least colour c (glows over stars without erasing them).
function lighten(p, x, y, c) {
  if (x < 0 || x >= p.w || y < 0 || y >= p.h) return;
  const o = p.get(x, y);
  const [r0, g0, b0] = split(o), [r1, g1, b1] = split(c);
  p.set(x, y, (Math.max(r0, r1) << 16) | (Math.max(g0, g1) << 8) | Math.max(b0, b1));
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

// Camera-like frame at (az, el): right, up, forward (see SPEC: right = (−sin h, 0, cos h)).
function frame(az, el) {
  const f = dir(az, el);
  const r = [-Math.sin(az * D2R), 0, Math.cos(az * D2R)];
  const u = cross(r, f);
  return { f, r, u };
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

// ── Palettes ─────────────────────────────────────────────────────────────────────────────────
// Warm lunar greys, dark → light (ridges). The regolith ramp is exported for the scratch viewers.
const GREY = [0x151414, 0x211f1e, 0x2e2c2a, 0x3d3a37, 0x4f4b46, 0x625d56, 0x77716a, 0x8f8880];
export const GROUND_RAMP = [0x1f1d1b, 0x2b2927, 0x393633, 0x484541, 0x59554e, 0x6b665e, 0x7e786e];

// ── Milky Way, stars ─────────────────────────────────────────────────────────────────────────
const GALAXY = dir(235, 62);   // normal of the galactic plane: the band crosses the sky opposite the Earth

function milkyWay(az, el) {   // 0..1 density at a direction
  const s = Math.asin(clamp(dot(dir(az, el), GALAXY), -1, 1)) / D2R;
  return Math.exp(-(s * s) / (2 * 8 * 8));
}

function paintMilkyWay(p) {
  const RAMP = [0x000000, 0x02030a, 0x04071a, 0x080c26, 0x0c1234];
  for (let y = 0; y < SKY.h / 2; y++) {
    const e = rowEl(y);
    for (let x = 0; x < SKY.w; x++) {
      const m = milkyWay(colAz(x), e);
      if (m < 0.04) continue;
      const clump = noiseP(x / 32, y / 16, SKY.w / 32, SKY.h / 16, 41) * 0.7 + noiseP(x / 8, y / 8, SKY.w / 8, SKY.h / 8, 42) * 0.3;
      const v = m * (0.35 + 0.9 * clump) - 0.1;
      if (v > 0) p.set(x, y, ditherRamp(RAMP, v * 0.8, x, y));
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
  while (stars.length < 2300 && guard++ < 60000) {
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
  splat(p, SUN.az, SUN.el, 9, (dx, dy) => {
    const d = Math.hypot(dx, dy);
    if (d <= SUN.radius) return 0xfffbe6;
    if (d <= SUN.radius + 0.5) return 0xffe99a;
    let v = 1.05 * Math.pow(SUN.radius / d, 1.5) - 0.2;
    // thin horizontal / vertical diffraction spikes
    const sx = Math.max(0, 1 - Math.abs(dy) / 0.3) * Math.max(0, 1 - Math.abs(dx) / 8);
    const sy = Math.max(0, 1 - Math.abs(dx) / 0.3) * Math.max(0, 1 - Math.abs(dy) / 8);
    v = Math.max(v, 0.5 * Math.max(sx, sy));
    if (v <= 0.1) return null;
    return ditherRamp(GLARE, v, Math.round(dx * 9), Math.round(dy * 9));
  }, true);
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

const EARTH_VIEW = { lon: 8, lat: 14, tilt: 22 };   // sub-observer point of the globe, axis tilt (clockwise from up, degrees)

function paintEarth(p) {
  const fr = frame(EARTH.az, EARTH.el);
  const S = dir(SUN.az, SUN.el);
  // light in disc coordinates (x right, y up, z towards the viewer)
  const L = [dot(S, fr.r), dot(S, fr.u), -dot(S, fr.f)];
  const hl = Math.hypot(L[0], L[1], L[2] + 1), H = [L[0] / hl, L[1] / hl, (L[2] + 1) / hl];   // half vector Sun ↔ viewer
  const tilt = EARTH_VIEW.tilt * D2R, ct = Math.cos(tilt), st = Math.sin(tilt);
  const lat0 = EARTH_VIEW.lat * D2R, sl0 = Math.sin(lat0), cl0 = Math.cos(lat0);
  const Rtex = (EARTH.radius / 360) * SKY.w;   // radius in texels

  splat(p, EARTH.az, EARTH.el, EARTH.radius * 1.5, (dx, dy, x, y) => {
    const nx = dx / EARTH.radius, ny = dy / EARTH.radius, rr = Math.hypot(nx, ny);
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
    else if (lit < 0 && land && lat > 5 && lat < 58 && hash(x, y, 17) > 0.88 && hash(x >> 1, y >> 1, 18) > 0.25) col = CITY[Math.floor(hash(x, y, 19) * 3)];
    return col;
  });
}

// ── A tiny orbital station, in the black next to the Earth ──────────────────────────────────
function paintStation(p) {
  const rows = [
    'bBbB..a..bBbB',
    'bBbB.wMw.bBbB',
    'tttttwMwttttt',
    'bBbB.wMw.bBbB',
    'bBbB..a..bBbB',
  ];
  const pal = { b: 0x264e98, B: 0x5e98dc, M: 0xd2dae8, w: 0x9098aa, t: 0x646c80, a: 0x7c849a };
  const x0 = Math.round(azCol(EARTH.az + 12.5) - 6), y0 = Math.round(elRow(EARTH.el + 3.2) - 2);
  p.rect(x0 - 3, y0 - 3, 19, 11, 0x000000);   // no star in front of it
  p.grid(rows, pal, x0, y0);
}

// ── The lunar horizon: three skylines of angular ridges and crater rims ─────────────────────
// Each layer is a closed polyline (peaks and saddles, straight facets), so the silhouette stays jagged and
// crisp; the facets are lit or shadowed by the Sun's side and dither towards a dark foot.
function skyline(L, li, W) {
  const rand = rng(L.seed);
  const pts = [];
  let x = 0;
  while (x < W) {
    const az = colAz(x), calm = 0.2 + 0.8 * smooth(10, 55, Math.abs(wrapDeg(az - EARTH.az)));
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
    const calm = 0.2 + 0.8 * smooth(12, 55, Math.abs(wrapDeg(colAz(cx) - EARTH.az)));
    for (let k = -wd; k <= wd; k++) {
      const t = k / wd;
      hgt[(((cx + k) % W) + W) % W] += calm * (L.amp * 0.42 * Math.exp(-Math.pow((Math.abs(t) - 0.82) / 0.16, 2)) - L.amp * 0.14 * Math.exp(-Math.pow(t / 0.4, 2)));
    }
  });
  // rugged detail, bigger on the bigger mountains
  [[24, 3.2], [12, 2], [6, 1.2], [3, 0.7]].forEach(([sc, a], j) => {
    for (let xx = 0; xx < W; xx++) hgt[xx] += (noiseP(xx / sc, li * 7 + j, W / sc, 12, L.seed + 100 + j) - 0.5) * a * L.rough * (0.35 + hgt[xx] / L.amp);
  });
  // keep the sky under the Earth clear: the skyline climbs back up on either side of it
  for (let xx = 0; xx < W; xx++) hgt[xx] = clamp(hgt[xx], 0.6, 3.4 + 60 * smooth(7, 24, Math.abs(wrapDeg(colAz(xx) - EARTH.az))));
  return hgt;
}

function paintRidges(p) {
  const W = SKY.w, HZ = SKY.h / 2;   // row of the horizon (el 0)
  p.rect(0, HZ, W, SKY.h - HZ, HORIZON);
  const layers = [
    { seed: 71, base: 2.5, amp: 13, stepMin: 18, stepMax: 52, cliffs: 0.3, rough: 1, tone: 0.1, grain: 0.04, cluster: 160, rims: [[310, 80], [870, 70]] },
    { seed: 83, base: 1.5, amp: 17, stepMin: 10, stepMax: 34, cliffs: 0.4, rough: 1.2, tone: -0.02, grain: 0.06, cluster: 96, rims: [[40, 60], [560, 90]] },
    { seed: 97, base: 0.6, amp: 6, stepMin: 4, stepMax: 14, cliffs: 0.2, rough: 0.8, tone: -0.14, grain: 0.08, cluster: 48, rims: [] },
  ];
  layers.forEach((L, li) => {
    const hgt = skyline(L, li, W);
    for (let x = 0; x < W; x++) {
      const az = colAz(x), top = Math.max(1, Math.round(hgt[x]));
      const sl = (hgt[(x - 2 + W) % W] - hgt[(x + 2) % W]) / 4;   // + = descends to the right (a face looking right)
      const face = Math.cos((az + 180 - clamp(sl * 70, -75, 75) - SUN.az) * D2R);   // 1 = square to the Sun
      for (let d = 0; d < top; d++) {
        const y = HZ - 1 - d, f = top > 1 ? d / (top - 1) : 1;   // 0 at the foot, 1 at the crest
        let v = 0.4 + L.tone + 0.44 * face + 0.14 * f;
        v -= 0.22 * Math.pow(1 - clamp(d / 3), 2);                 // dark foot, where the ridge meets the plain
        v += (hash(x, y, L.seed) - 0.5) * L.grain * 2;
        if (d === top - 1) v += 0.2;                                // lit crest line
        p.set(x, y, ditherRamp(GREY, clamp(v), x, y));
      }
    }
  });
}

export function paintSky(p) {
  p.rect(0, 0, SKY.w, SKY.h, 0x000000);
  paintMilkyWay(p);
  paintStars(p);
  paintSun(p);
  paintEarth(p);
  paintStation(p);
  paintRidges(p);
}

// ── Regolith ─────────────────────────────────────────────────────────────────────────────────
export function paintGround(p) {
  const W = GROUND.w, H = GROUND.h, rand = rng(4242);
  const hm = new Float32Array(W * H), alb = new Float32Array(W * H);
  const idx = (x, y) => (((y % H) + H) % H) * W + (((x % W) + W) % W);

  // gentle undulation and broad albedo patches
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    hm[idx(x, y)] += (noiseP(x / 32, y / 32, W / 32, H / 32, 11) - 0.5) * 5 + (noiseP(x / 16, y / 16, W / 16, H / 16, 12) - 0.5) * 2.2;
    alb[idx(x, y)] += (noiseP(x / 64, y / 64, W / 64, H / 64, 13) - 0.5) * 0.16 + (noiseP(x / 16, y / 16, W / 16, H / 16, 14) - 0.5) * 0.1;
  }

  // craters of every size, wrapped on the torus
  const placed = [];
  const crater = (cx, cy, r, young) => {
    placed.push([cx, cy, r]);
    const depth = r * (r > 18 ? 0.13 : 0.2), rimH = r * 0.085, reach = Math.ceil(r * 2.6);
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const ccx = cx + ox * W, ccy = cy + oy * H;
      for (let y = Math.floor(ccy - reach); y <= ccy + reach; y++) for (let x = Math.floor(ccx - reach); x <= ccx + reach; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const d = Math.hypot(x + 0.5 - ccx, y + 0.5 - ccy) / r;
        let h = 0, a = 0;
        if (d < 1) { const b = 1 - d * d; h = -depth * (b > 0.4 ? 0.4 + (b - 0.4) * 0.8 : b); a = -0.05 * b; }
        h += rimH * Math.exp(-Math.pow((d - 1) / 0.17, 2));
        if (d >= 1) { h += rimH * 0.35 * Math.exp(-(d - 1) / 0.9); if (young) a += 0.16 * Math.exp(-Math.pow((d - 1.25) / 0.8, 2)); }
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
      const d = Math.hypot(dx, dy) / r;
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
