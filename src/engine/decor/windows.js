import * as THREE from 'three';
import { floorAt, ceilAt, getCellType } from '../Map.js';
import { moodOf } from '../../features/mood.js';
import { prefs } from '../prefs.js';
import { Pix } from '../props/pixels.js';
import { Batch, xf } from '../props/kit.js';
import { SKY, GROUND, HORIZON, EARTH, paintSky, paintGround } from '../props/sky.js';
import { WINDOWS } from './windowSlots.js';

// Windows onto the lunar surface — PORTAL panes.
//
// A pane is a flat opaque quad laid on the wall (0.004 m proud of it). Its fragment shader ignores
// the quad: it casts the view ray `d = normalize(worldPos - cameraPosition)` and returns what that ray
// sees OUTSIDE the base. Nothing behind the wall exists, so a window can sit on any wall of any room,
// and the picture has real parallax with no geometry at all:
//   · the opening is a recessed prism (wall thickness): the ray is marched through it analytically, so
//     the reveals (the four inner faces) and the rim of the glass slide correctly when you move;
//   · past the glass, a ray going down meets the lunar ground plane (y = GROUND_Y) at a true distance
//     → tiled regolith with perspective and parallax; any other ray reads the equirect sky
//     (stars, the Earth, the ridge line) at infinity, so the Earth never moves as you walk by.
// The skylight is the same portal on the CEILING plane (rays going up, a deeper shaft).
//
// The sky and the ground are painted once, in pixel art (props/sky.js), and sampled with nearest
// filtering; the ground tile is mipmapped and its contrast fades to HORIZON toward the horizon (a hard,
// dithered step ladder), so the far ground never shimmers while the horizon line stays sharp. The filtered
// ground is then cut into a few grey steps and ordered-dithered, so it keeps the look of the sky's ramps.
// Every dither (ground, glass, light pools) works in game pixels: `uPx` screen pixels per game pixel.
//
// Draw calls: 3 for the whole feature (all panes · all frames and sills · all floor light pools).
// No light is added: the pools are additive, ordered-dithered decals on the floor.
// Output stays in the linear working space (the OutputPass converts), so texels read as painted.
//
// buildWindows(scene, tex?, slots = WINDOWS) → { update(t) }. `slots` is only there for tests.

const INTERNAL_W = 640;           // the retro buffer width (Renderer INTERNAL_W): one game pixel = canvas width / this
const GROUND_Y = -0.45;           // the base stands on the surface: floors are at -0.2 … 0
const PANE_OFF = 0.004;           // pane in front of the wall face (m)
const SKY_PANE_OFF = 0.02;        // skylight pane under the ceiling: in front of the ceiling decals (lamp panels 0.004, glows 0.015)
const WALL_DEPTH = 0.22;          // recess of a wall window: wall thickness down to the glass (m)
const SHAFT_DEPTH = 0.3;          // recess of the skylight (m): deeper and a pitched view sees mostly shaft wall, not sky
const RIM = 0.028;                // metal rim of the glass, seen at the end of the recess (m)

const FW = 0.07;                  // frame bar width (m)
const FD = 0.07;                  // frame bar projection from the wall (m)
const EPS = 0.002;                // frame clearance from the wall plane (m)
const SILL_D = 0.16, SILL_T = 0.04;
const MULL = 0.04;                // mullion thickness (m)

const FRAME_BASE = new THREE.Color(0x586069);
const SILL_BASE = new THREE.Color(0x7c848f);
const POOL_TINT = [0.58, 0.74, 1.0];      // cool white with a hint of Earth blue (linear)

// ── Shaders ───────────────────────────────────────────────────────────────────────────────────────

const PANE_VERT = /* glsl */`
  attribute vec3 aCtr;      // centre of the opening, on the wall (or ceiling) plane
  attribute vec3 aNrm;      // unit normal pointing into the room
  attribute vec3 aRight;    // unit vectors spanning the opening (aRight x aUp = aNrm)
  attribute vec3 aUp;
  attribute vec3 aTint;     // room mood (linear multiplier): the reveals take the wall's colour
  attribute vec4 aInfo;     // half width, half height, sky yaw (rad), kind (0 wall, 1 skylight)
  attribute vec4 aInfo2;    // ground offset x, z (m), recess depth (m), seed
  varying vec3 vWorld;
  varying vec3 vCtr, vNrm, vRight, vUp, vTint;
  varying vec4 vInfo, vInfo2;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vCtr = aCtr; vNrm = aNrm; vRight = aRight; vUp = aUp; vTint = aTint;
    vInfo = aInfo; vInfo2 = aInfo2;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const PANE_FRAG = /* glsl */`
  uniform sampler2D tSky;
  uniform sampler2D tGround;
  uniform vec2 uSky;            // sky texture size (texels)
  uniform float uGroundY;
  uniform float uGroundM;       // metres per ground tile
  uniform float uPx;            // size of one game pixel in screen pixels: the dither cell (1 at 640x360)
  uniform vec3 uHorizon;        // linear colour the far ground fades to
  uniform vec3 uEarthDir;       // unit vector of the Earth in sky space
  uniform float uEarthCos;      // cos of the keep-out cone around it (no twinkle there)
  uniform float uTime;
  uniform float uTwinkle;       // 0 when prefers-reduced-motion
  varying vec3 vWorld;
  varying vec3 vCtr, vNrm, vRight, vUp, vTint;
  varying vec4 vInfo, vInfo2;

  const float PI = 3.14159265359;
  const float RIM = ${RIM.toFixed(4)};
  const float B4[16] = float[16](0.5, 8.5, 2.5, 10.5, 12.5, 4.5, 14.5, 6.5, 3.5, 11.5, 1.5, 9.5, 15.5, 7.5, 13.5, 5.5);

  // 4x4 ordered-dither threshold of this game pixel, 0..1.
  float bayer() {
    ivec2 q = ivec2(mod(floor(gl_FragCoord.xy / uPx), 4.0));
    return B4[q.y * 4 + q.x] / 16.0;
  }
  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  float hash12(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  // Rotation of a direction (or a ground offset) about the vertical axis: the outside of this window
  // is the world turned by its sky yaw, so each window can look onto its own view.
  vec3 rotY(vec3 v, float yaw) {
    float c = cos(yaw), s = sin(yaw);
    return vec3(v.x * c - v.z * s, v.y, v.x * s + v.z * c);
  }

  ivec2 skyTexel(ivec2 p) {
    int w = int(uSky.x), h = int(uSky.y);
    return ivec2((p.x + w) % w, clamp(p.y, 0, h - 1));   // p.x >= -1: a % with a negative operand is undefined in GLSL ES
  }
  vec3 skyFetch(ivec2 p) { return texelFetch(tSky, skyTexel(p), 0).rgb; }

  // The sky: equirect, u = azimuth / 2pi (same convention as the player's heading), row 0 = zenith.
  // Read with texelFetch: nearest by construction, wrapped by hand, no mip or seam at az 0 / 360,
  // and no NaN straight up or down. A row of the map is a shrinking circle toward the poles, so a
  // pixel there spans several texels of it: those few taps are averaged (otherwise it shimmers).
  // pix = angle of one screen pixel (rad).
  vec3 skyAt(vec3 d, float pix) {
    float az = dot(d.xz, d.xz) > 1e-8 ? atan(d.z, d.x) : 0.0;
    float el = asin(clamp(d.y, -1.0, 1.0));
    float u = az / (2.0 * PI);
    float v = clamp(0.5 + el / PI, 0.5 + 0.5 / uSky.y, 1.0 - 0.5 / uSky.y);   // texture rows grow upward
    int row = int(floor(v * uSky.y));
    float foot = pix / max(cos(el), 0.02) * uSky.x / (2.0 * PI);              // texels of the row under one pixel
    if (foot > 1.0) {
      int n = int(clamp(ceil(foot), 2.0, 8.0));
      vec3 sum = vec3(0.0);
      for (int i = 0; i < 8; i++) {
        if (i >= n) break;
        float o = ((float(i) + 0.5) / float(n) - 0.5) * foot;
        sum += skyFetch(ivec2(int(floor(fract(u + o / uSky.x) * uSky.x)), row));
      }
      return sum / float(n);
    }
    ivec2 tc = ivec2(int(floor(fract(u) * uSky.x)), row);
    vec3 c = skyFetch(tc);
    // A few isolated stars dip now and then (never the Earth, the Sun, the ridges or any big feature).
    if (uTwinkle > 0.5 && el > 0.05 && dot(d, uEarthDir) < uEarthCos) {
      float l = luma(c);
      if (l > 0.15) {
        float nm = 0.0;
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) if (i != 0 || j != 0) nm += luma(skyFetch(tc + ivec2(i, j)));
        if (nm < 0.45 * l) {
          float h1 = hash12(vec2(tc));
          if (h1 > 0.4) {
            float k = 0.5 + 0.5 * sin(uTime * (0.7 + 1.3 * fract(h1 * 7.0)) + h1 * 31.0);
            c *= 1.0 - 0.55 * step(0.86, k);
          }
        }
      }
    }
    return c;
  }

  // The inside of the opening: wall thickness (or the shaft), lit by the light creeping in from outside.
  // f = 0 at the room end, 1 at the glass. Banded and ordered-dithered like everything else.
  vec3 revealColor(float f, bool sideFace, bool upFace, float kind) {
    float face = kind > 0.5 ? 0.45 : (sideFace ? 0.85 : (upFace ? 0.5 : 1.2));
    float v = face * (0.3 + 1.0 * f * f);
    v = floor(v * 5.0 + bayer()) / 5.0;
    return vTint * (0.24 * v) + vec3(0.04, 0.07, 0.11) * f * f * f;
  }

  void main() {
    vec3 d = normalize(vWorld - cameraPosition);
    float yaw = vInfo.z, kind = vInfo.w, depth = vInfo2.z;
    vec3 dS = rotY(d, yaw);                                  // ray in the window's sky space
    float pix = max(length(dFdx(d)), length(dFdy(d)));       // angle of one screen pixel, before any branch

    // Ground, sampled before any branch so that the mip level has valid screen-space derivatives.
    // t = H / -dy is the distance to the plane; below -0.002 the ray is ground, above it is sky.
    vec3 camS = rotY(cameraPosition - vCtr, yaw);
    float H = cameraPosition.y - uGroundY;
    float tG = H / -min(dS.y, -0.002);
    vec2 gp = camS.xz + dS.xz * tG + vInfo2.xy;
    vec3 gTex = texture(tGround, gp / uGroundM).rgb;

    // Where this ray crosses the opening plane (exact: the quad itself is 4 mm proud), in the
    // opening's own axes, and its direction in them. dz > 0: going into the wall.
    float dn = dot(d, vNrm);
    float dz = max(-dn, 1e-4);
    vec3 rel = cameraPosition + d * (dot(vCtr - cameraPosition, vNrm) / min(dn, -1e-4)) - vCtr;
    float a = dot(rel, vRight), b = dot(rel, vUp);
    float dr = dot(d, vRight), du = dot(d, vUp);
    float hw = vInfo.x, hh = vInfo.y;

    float tg = depth / dz;                                   // ray parameter at the glass
    float tx = dr > 1e-5 ? (hw - a) / dr : (dr < -1e-5 ? (-hw - a) / dr : 1e9);
    float ty = du > 1e-5 ? (hh - b) / du : (du < -1e-5 ? (-hh - b) / du : 1e9);
    float te = min(tx, ty);                                  // where the ray leaves the prism sideways

    vec3 col;
    if (te < tg) {
      // The ray hits a reveal before the glass.
      col = revealColor(clamp(te * dz / depth, 0.0, 1.0), tx < ty, du > 0.0, kind);
    } else {
      vec2 g = vec2(a + dr * tg, b + du * tg);               // where it crosses the glass
      vec2 e = vec2(hw, hh) - abs(g);
      if (min(e.x, e.y) < RIM) {
        col = vTint * 0.10 + vec3(0.02, 0.03, 0.04);         // dark metal rim of the glass
      } else {
        if (dS.y < -0.002) {
          // Regolith: contrast fades to the horizon colour in dithered steps (no haze, no shimmer).
          float fade = smoothstep(0.0, 0.04, -dS.y);
          fade = floor(fade * 6.0 + bayer()) / 6.0;
          col = mix(uHorizon, gTex, clamp(fade, 0.0, 1.0));
          // Pixel finish: the filtered tile is cut into a few grey steps and ordered-dithered, like the sky's ramps.
          float lg = max(luma(col), 1e-5);
          col *= pow(floor(pow(lg, 0.4545) * 10.0 + bayer()) / 10.0, 2.2) / lg;
        } else {
          col = skyAt(dS, pix);
        }
        // Faint glass: two diagonal glints of reflected room light, dithered, and a darker edge.
        float s = mod(a * 0.9 + b + 17.0 * vInfo2.w, 1.7);
        float glint = s < 0.05 ? 0.55 : (s > 0.11 && s < 0.13 ? 0.7 : 0.0);
        if (bayer() < glint) col = mix(col, vec3(0.62, 0.74, 0.9), 0.13);
        if (min(e.x, e.y) < RIM + 0.03 && bayer() < 0.5) col *= 0.7;
      }
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const POOL_VERT = /* glsl */`
  attribute vec2 aSt;       // s across (-1..1), t away from the wall (0..1) or across (-1..1) for a skylight
  attribute vec3 aPar;      // peak intensity, kind (0 wall, 1 skylight), seed
  varying vec2 vSt;
  varying vec3 vPar;
  void main() {
    vSt = aSt; vPar = aPar;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }`;

const POOL_FRAG = /* glsl */`
  uniform vec3 uTint;
  uniform float uPx;
  varying vec2 vSt;
  varying vec3 vPar;
  const float B4[16] = float[16](0.5, 8.5, 2.5, 10.5, 12.5, 4.5, 14.5, 6.5, 3.5, 11.5, 1.5, 9.5, 15.5, 7.5, 13.5, 5.5);
  void main() {
    ivec2 q = ivec2(mod(floor(gl_FragCoord.xy / uPx), 4.0));
    float bay = B4[q.y * 4 + q.x] / 16.0;
    float side = 1.0 - smoothstep(0.45, 1.0, abs(vSt.x));
    float I;
    if (vPar.y < 0.5) {
      I = side * pow(max(1.0 - vSt.y, 0.0), 1.2);                     // bright at the wall, gone at the far edge
    } else {
      float len = 1.0 - smoothstep(0.45, 1.0, abs(vSt.y));
      float bar = smoothstep(0.0, 0.07, min(abs(vSt.x), abs(vSt.y)));  // the glazing bars cast a cross
      I = side * len * (0.55 + 0.45 * bar);
    }
    float lvl = floor(I * vPar.x * 5.0 + bay) / 5.0;                  // 5 dithered steps, then stop
    if (lvl <= 0.0) discard;
    gl_FragColor = vec4(uTint * lvl, 1.0);
    #include <colorspace_fragment>
  }`;

// ── Geometry ──────────────────────────────────────────────────────────────────────────────────────

// Frame of the window as the room sees it (units: metres, y absolute). Opening = the lit rectangle.
function wallFrame(b, win, floor, color, sillColor, dim) {
  const [fx, fz] = win.facing, { w, h } = win;
  const yb = floor + win.sill, yt = yb + h, ym = (yb + yt) / 2;
  const base = (c) => c.clone().multiplyScalar(dim);
  b.push(xf({ pos: [win.x, 0, win.z], rot: [0, Math.atan2(fx, fz), 0] }));   // local +z = into the room, +x = right
  const bar = base(color), sill = base(sillColor);
  for (const s of [-1, 1]) b.box(FW, h, FD, { pos: [s * (w / 2 + FW / 2), ym, EPS + FD / 2], color: bar });
  b.box(w + 2 * FW, FW, FD, { pos: [0, yt + FW / 2, EPS + FD / 2], color: bar });
  b.box(w + 2 * FW + 0.08, SILL_T, SILL_D, { pos: [0, yb - SILL_T / 2, EPS + SILL_D / 2], color: sill });
  const cols = w > 2.0 ? 3 : (w > 0.95 ? 2 : 1);
  for (let k = 1; k < cols; k++) b.box(MULL, h, MULL, { pos: [-w / 2 + (w * k) / cols, ym, EPS + MULL / 2], color: bar });
  if (h > 1.0) b.box(w, MULL, MULL, { pos: [0, yb + h * 0.58, EPS + MULL / 2], color: bar });
  b.pop();
}

// Curb of a ceiling window: four beams hanging under the ceiling plane, plus a glazing cross.
function skyFrame(b, win, ceil, color) {
  const { x, z, w, d } = win;
  const y = ceil - FD / 2 - EPS;
  for (const s of [-1, 1]) {
    b.box(w + 2 * FW, FD, FW, { pos: [x, y, z + s * (d / 2 + FW / 2)], color });
    b.box(FW, FD, d, { pos: [x + s * (w / 2 + FW / 2), y, z], color });
  }
  // The glazing bars hang right under the hub's light: kept dark so they do not flare in the bloom.
  const yc = ceil - MULL / 2 - EPS, bar = color.clone().multiplyScalar(0.12);
  if (w > 1.8) b.box(MULL, MULL, d, { pos: [x, yc, z], color: bar });
  if (d > 1.8) b.box(w, MULL, MULL, { pos: [x, yc, z], color: bar });
}

// One window's pane quad, with the portal attributes repeated on its four corners.
function paneQuad(out, { ctr, n, r, u, hw, hh, tint, yaw, kind, off, depth, seed, proud }) {
  const base = out.pos.length / 3;
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    out.pos.push(ctr[0] + n[0] * proud + r[0] * hw * sx + u[0] * hh * sy,
      ctr[1] + n[1] * proud + r[1] * hw * sx + u[1] * hh * sy,
      ctr[2] + n[2] * proud + r[2] * hw * sx + u[2] * hh * sy);
    out.ctr.push(...ctr); out.nrm.push(...n); out.right.push(...r); out.up.push(...u); out.tint.push(...tint);
    out.info.push(hw, hh, yaw, kind);
    out.info2.push(off[0], off[1], depth, seed);
  }
  out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

// Floor light pool, in world metres on the floor plane.
function poolQuad(out, corners, st, peak, kind, seed) {
  const base = out.pos.length / 3;
  corners.forEach((c, i) => { out.pos.push(...c); out.st.push(...st[i]); out.par.push(peak, kind, seed); });
  out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

const hash01 = (s = '') => { s = String(s); let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };

export function buildWindows(scene, tex = null, slots = WINDOWS) {
  // ── Textures ──
  const skyPix = new Pix(SKY.w, SKY.h);
  paintSky(skyPix);
  const skyTex = skyPix.toTexture();                       // nearest, no mips: the shader reads it with texelFetch
  skyTex.wrapS = THREE.RepeatWrapping;
  skyTex.wrapT = THREE.ClampToEdgeWrapping;

  const groundPix = new Pix(GROUND.w, GROUND.h);
  paintGround(groundPix);
  const groundTex = groundPix.toTexture({ mip: true });    // nearest up close, trilinear far away
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
  groundTex.anisotropy = 4;

  // ── Buffers ──
  const panes = { pos: [], ctr: [], nrm: [], right: [], up: [], tint: [], info: [], info2: [], idx: [] };
  const pools = { pos: [], st: [], par: [], idx: [] };
  const frames = new Batch();

  const earthAz = (EARTH.az * Math.PI) / 180;
  const earthEl = (EARTH.el * Math.PI) / 180;

  for (const win of slots) {
    const seed = hash01(win.id);
    const yaw = ((win.skyYaw ?? 0) * Math.PI) / 180;
    const off = [(seed * 997 % 1) * GROUND.meters, (seed * 631 % 1) * GROUND.meters];

    if (win.kind === 'skylight') {
      const ceil = ceilAt(win.x, win.z), floor = floorAt(win.x, win.z);
      const mood = moodOf(getCellType(win.x, win.z));
      const tint = mood.wall;
      paneQuad(panes, { ctr: [win.x, ceil, win.z], n: [0, -1, 0], r: [1, 0, 0], u: [0, 0, 1], hw: win.w / 2, hh: win.d / 2,
        tint, yaw, kind: 1, off, depth: SHAFT_DEPTH, seed, proud: SKY_PANE_OFF });
      skyFrame(frames, win, ceil, FRAME_BASE.clone().multiply(new THREE.Color(...tint)));
      const px = win.w / 2 + 0.35, pz = win.d / 2 + 0.35, y = floor + 0.016;
      poolQuad(pools, [[win.x - px, y, win.z - pz], [win.x + px, y, win.z - pz], [win.x + px, y, win.z + pz], [win.x - px, y, win.z + pz]],
        [[-1, -1], [1, -1], [1, 1], [-1, 1]], 0.3, 1, seed);
      continue;
    }

    // Wall window.
    const [fx, fz] = win.facing;
    const floor = floorAt(win.x + fx * 0.3, win.z + fz * 0.3);
    const mood = moodOf(getCellType(win.x + fx * 0.25, win.z + fz * 0.25));
    const tint = mood.wall;
    const cy = floor + win.sill + win.h / 2;
    const r = [fz, 0, -fx];
    paneQuad(panes, { ctr: [win.x, cy, win.z], n: [fx, 0, fz], r, u: [0, 1, 0], hw: win.w / 2, hh: win.h / 2,
      tint, yaw, kind: 0, off, depth: WALL_DEPTH, seed, proud: PANE_OFF });
    const tintC = new THREE.Color(...tint);
    const dim = Math.abs(fx) > 0.5 ? 1.0 : 0.65;               // the same face dimming the renderer gives the walls
    wallFrame(frames, win, floor, FRAME_BASE.clone().multiply(tintC), SILL_BASE.clone().multiply(tintC), dim);

    // Light pool: the window's patch on the floor, bent toward where the light comes from.
    const ez = earthAz - yaw;                                  // world azimuth of the Earth seen through this window
    const L = [-Math.cos(ez), -Math.sin(ez)];                  // horizontal travel of its light
    const ln = L[0] * fx + L[1] * fz;
    const skew = ln > 0.3 ? THREE.MathUtils.clamp((L[0] * r[0] + L[1] * r[2]) / ln, -0.9, 0.9) : 0;
    const len = THREE.MathUtils.clamp(0.45 + win.h * 0.9, 0.8, 1.7);
    const high = win.sill >= 0.6;                              // a high window lands its light farther from the wall, and weaker
    const t0 = high ? win.sill * 0.45 : 0.01;
    const hwp = win.w / 2 * 1.05, y = floor + 0.016;
    const at = (s, t) => [win.x + fx * (t0 + t * len) + r[0] * (s * hwp + skew * t * len), y,
      win.z + fz * (t0 + t * len) + r[2] * (s * hwp + skew * t * len)];
    const peak = THREE.MathUtils.clamp((win.w * win.h) / 0.8, 0.5, 1.2) * (ln > 0.3 ? 0.3 : 0.23) * (high ? 0.7 : 1);
    poolQuad(pools, [at(-1, 0), at(1, 0), at(1, 1), at(-1, 1)], [[-1, 0], [1, 0], [1, 1], [-1, 1]], peak, 0, seed);
  }

  // ── Meshes ──
  const make = (geo, material, name) => {
    const m = new THREE.Mesh(geo, material);
    m.name = name;
    m.matrixAutoUpdate = false;                                 // static, already in world coordinates
    scene.add(m);
    return m;
  };

  // The dither cell is one game pixel: 1 screen pixel on the 640x360 desktop buffer, more on a phone, which
  // renders at device resolution (Renderer._resize). The canvas is the one the Renderer registered on the scene.
  const canvas = scene.userData?.canvas ?? null;
  const uPx = { value: 1 };
  const pixelSize = () => Math.max(1, Math.round((canvas?.width || INTERNAL_W) / INTERNAL_W));
  uPx.value = pixelSize();

  const uniforms = {
    tSky: { value: skyTex },
    tGround: { value: groundTex },
    uSky: { value: new THREE.Vector2(SKY.w, SKY.h) },
    uGroundY: { value: GROUND_Y },
    uGroundM: { value: GROUND.meters },
    uPx,
    uHorizon: { value: new THREE.Color(HORIZON) },
    uEarthDir: { value: new THREE.Vector3(Math.cos(earthEl) * Math.cos(earthAz), Math.sin(earthEl), Math.cos(earthEl) * Math.sin(earthAz)) },
    uEarthCos: { value: Math.cos(((EARTH.radius * 1.8 + 1) * Math.PI) / 180) },
    uTime: { value: 0 },
    uTwinkle: { value: prefs.reducedMotion ? 0 : 1 },
  };

  if (panes.idx.length) {
    const g = new THREE.BufferGeometry();
    const f32 = (a, n) => new THREE.Float32BufferAttribute(a, n);
    g.setAttribute('position', f32(panes.pos, 3));
    g.setAttribute('aCtr', f32(panes.ctr, 3));
    g.setAttribute('aNrm', f32(panes.nrm, 3));
    g.setAttribute('aRight', f32(panes.right, 3));
    g.setAttribute('aUp', f32(panes.up, 3));
    g.setAttribute('aTint', f32(panes.tint, 3));
    g.setAttribute('aInfo', f32(panes.info, 4));
    g.setAttribute('aInfo2', f32(panes.info2, 4));
    g.setIndex(panes.idx);
    g.computeBoundingSphere();
    make(g, new THREE.ShaderMaterial({ uniforms, vertexShader: PANE_VERT, fragmentShader: PANE_FRAG }), 'windows:panes');
  }

  if (frames.idx.length) {
    make(frames.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), 'windows:frames');
  }

  if (pools.idx.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pools.pos, 3));
    g.setAttribute('aSt', new THREE.Float32BufferAttribute(pools.st, 2));
    g.setAttribute('aPar', new THREE.Float32BufferAttribute(pools.par, 3));
    g.setIndex(pools.idx);
    g.computeBoundingSphere();
    const pm = make(g, new THREE.ShaderMaterial({
      uniforms: { uTint: { value: new THREE.Vector3(...POOL_TINT) }, uPx },
      vertexShader: POOL_VERT, fragmentShader: POOL_FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }), 'windows:pools');
    pm.renderOrder = 1;
  }

  return {
    update(t) {
      uPx.value = pixelSize();
      uniforms.uTime.value = t;
      uniforms.uTwinkle.value = prefs.reducedMotion ? 0 : 1;
    },
  };
}
