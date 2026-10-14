import * as THREE from 'three';
import { floorAt, ceilAt, getCellType } from '../Map.js';
import { moodOf } from '../../features/mood.js';
import { Batch, xf } from '../props/kit.js';
import { HORIZON, EARTH, SUN } from '../props/sky.js';
import { WINDOWS } from './windowSlots.js';

// Windows onto the lunar surface — panes onto a REAL exterior world.
//
// The outside is a second scene (src/engine/exterior/: the plain, the hulls of the base seen from outside, its props, a sky dome) that the
// Renderer draws with the player's OWN camera (same position, orientation, freelook shear and shake) into a render target the size of the
// composer's. A pane is a flat opaque quad laid on the wall (0.004 m proud of it); its fragment shader reads that target at its own screen
// pixel, `texture2D(uExterior, gl_FragCoord.xy / uRes)`, so what shows through the glass is exactly what the camera sees past it, pixel for
// pixel, with real parallax and no computation of any sky here. What the pane still does itself:
//   · the opening is a recessed prism (wall thickness): the view ray is marched through it analytically, so the reveals (the four inner
//     faces) and the rim of the glass slide correctly when you move;
//   · past the glass it adds the glass layer: two faint glints of reflected room light, a darker edge;
//   · the skylight is the same pane on the CEILING plane (rays going up, a deeper shaft): it looks up into the real exterior, the mast and
//     the dishes of the atrium's roof and the zenith sky.
//
// Cross-room views. The exterior shows a hull from OUTSIDE only (faces are FrontSide: seen from inside a hull you see through it). A pane
// seen through a door from another room has the hull of its own room between the eye and the glass, and the target would paint that wall
// over it. The exterior target carries a depth texture; where its depth is nearer than the glass the pane falls back to the bare sky (the
// equirect, by direction), so a far window never shows a wall painted on its glass. In the pane's own room nothing is ever nearer
// (exteriorLayout.js and check-windows.mjs prove it), so the fallback never fires there.
//
// Draw calls: 3 for the whole feature (all panes · all frames and sills · all floor light pools). The exterior pass is the Renderer's: it
// asks `anyVisible(camera)` and draws the exterior only when a pane is on screen. No light is added: the pools are additive, ordered-dithered
// decals on the floor. Every dither (glass, light pools) works in game pixels: `uPx` screen pixels per game pixel, the exterior's own cell.
// Output stays in the linear working space (the OutputPass converts).
//
// buildWindows(scene, exterior, slots = WINDOWS) → { update(t), anyVisible(camera), count }.
//   exterior  an ExteriorView (exterior/Exterior.js), or null: the panes then show flat horizon-coloured glass.
//   slots     only there for tests.

const INTERNAL_W = 640;           // the retro buffer width (Renderer INTERNAL_W): one game pixel = render width / this
const PANE_OFF = 0.004;           // pane in front of the wall face (m)
const PANE_LIFT = 0.03;           // a wall pane writes the depth of a plane this much nearer (m): the glass lies over the soft light washes that
                                  // the racks and the gallery frames lay on the wall (0.004–0.02 m proud), which would tint space green or amber.
                                  // Stays under the mullions' front face (0.042 m) and is no more than the wall decals' thickness.
const SKY_PANE_OFF = 0.02;        // skylight pane under the ceiling: in front of the ceiling decals (lamp panels 0.004, glows 0.015)
const WALL_DEPTH = 0.22;          // recess of a wall window: wall thickness down to the glass (m)
const SHAFT_DEPTH = 0.3;          // recess of the skylight (m): deeper and a pitched view sees mostly shaft wall, not sky
const RIM = 0.028;                // metal rim of the glass, seen at the end of the recess (m)
const OCCLUDED_BY = 0.02;         // an exterior surface this much nearer than the glass (m) is a hull in the way: fall back to the sky

const FW = 0.07;                  // frame bar width (m)
const FD = 0.07;                  // frame bar projection from the wall (m)
const EPS = 0.002;                // frame clearance from the wall plane (m)
const SILL_D = 0.16, SILL_T = 0.04;
const MULL = 0.04;                // mullion thickness (m)

const FRAME_BASE = new THREE.Color(0x586069);
const SILL_BASE = new THREE.Color(0x7c848f);

// Floor light pools: the patch of outside light a window lays on the floor (linear tints).
const POOL_SUN = [1.0, 0.8, 0.52];        // direct sunlight, warm
const POOL_EARTH = [0.58, 0.74, 1.0];     // earthshine: cool white with a hint of Earth blue
const POOL_STARS = [0.46, 0.58, 0.9];     // a window that faces neither: faint starlight

// ── Shaders ───────────────────────────────────────────────────────────────────────────────────────

const PANE_VERT = /* glsl */`
  attribute vec3 aCtr;      // centre of the opening, on the wall (or ceiling) plane
  attribute vec3 aNrm;      // unit normal pointing into the room
  attribute vec3 aRight;    // unit vectors spanning the opening (aRight x aUp = aNrm)
  attribute vec3 aUp;
  attribute vec3 aTint;     // room mood (linear multiplier): the reveals take the wall's colour
  attribute vec4 aInfo;     // half width, half height, kind (0 wall, 1 skylight), recess depth (m)
  attribute vec4 aGlint;    // glints: direction across the glass (x, y), period (m), phase (m)
  attribute vec3 aGlint2;   // glints: width of the first band, start and width of the second one (m; width 0 = none)
  varying vec3 vWorld;
  varying vec3 vCtr, vNrm, vRight, vUp, vTint;
  varying vec4 vInfo, vGlint;
  varying vec3 vGlint2;
  varying vec2 vZW;         // clip z and w of the plane the pane takes its depth from (affine in position: exact once interpolated)
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vCtr = aCtr; vNrm = aNrm; vRight = aRight; vUp = aUp; vTint = aTint;
    vInfo = aInfo; vGlint = aGlint; vGlint2 = aGlint2;
    gl_Position = projectionMatrix * viewMatrix * w;
    vec4 lifted = projectionMatrix * viewMatrix * vec4(w.xyz + aNrm * (aInfo.z > 0.5 ? 0.0 : ${PANE_LIFT.toFixed(3)}), 1.0);
    vZW = lifted.zw;
  }`;

const PANE_FRAG = /* glsl */`
  uniform sampler2D uExterior;  // the exterior world, drawn with this very camera: read at the pane's own pixel
  uniform sampler2D uExtDepth;  // its depth buffer
  uniform sampler2D tSky;       // the sky equirect: the fallback where a hull of another room stands in front of the glass
  uniform vec2 uRes;            // size of the exterior target (= the composer's)
  uniform vec2 uSky;            // sky texture size (texels)
  uniform float uHasDepth;      // 1 when uExtDepth is usable
  uniform float uHasSky;        // 1 when tSky is usable
  uniform float uNear, uFar;    // the camera's clip planes (linear depth)
  uniform float uPx;            // size of one game pixel in screen pixels: the dither cell (1 at 640x360)
  uniform vec3 uHorizon;        // linear colour of the bare horizon
  varying vec3 vWorld;
  varying vec3 vCtr, vNrm, vRight, vUp, vTint;
  varying vec4 vInfo, vGlint;
  varying vec3 vGlint2;
  varying vec2 vZW;

  const float PI = 3.14159265359;
  const float RIM = ${RIM.toFixed(4)};
  const float OCCLUDED_BY = ${OCCLUDED_BY.toFixed(4)};
  const float B4[16] = float[16](0.5, 8.5, 2.5, 10.5, 12.5, 4.5, 14.5, 6.5, 3.5, 11.5, 1.5, 9.5, 15.5, 7.5, 13.5, 5.5);

  // 4x4 ordered-dither threshold of this game pixel, 0..1.
  float bayer() {
    ivec2 q = ivec2(mod(floor(gl_FragCoord.xy / uPx), 4.0));
    return B4[q.y * 4 + q.x] / 16.0;
  }

  // The bare sky in a direction, nearest (the rows under the horizon are the horizon colour). Same convention as the exterior's dome:
  // u = azimuth / 2pi (0 east, 90 south), row 0 = zenith, read with texelFetch and wrapped by hand.
  vec3 skyFallback(vec3 d) {
    if (uHasSky < 0.5) return uHorizon;
    float az = dot(d.xz, d.xz) > 1e-8 ? atan(d.z, d.x) : 0.0;
    float el = asin(clamp(d.y, -1.0, 1.0));
    float v = clamp(0.5 + el / PI, 0.5 / uSky.y, 1.0 - 0.5 / uSky.y);
    int w = int(uSky.x);
    ivec2 tc = ivec2(int(floor(fract(az / (2.0 * PI)) * uSky.x)) % w, int(floor(v * uSky.y)));
    return texelFetch(tSky, tc, 0).rgb;
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
    float kind = vInfo.z, depth = vInfo.w;

    // The exterior, at this very pixel (before any branch). Same camera, same size: it is what the ray sees past the wall.
    vec2 uv = gl_FragCoord.xy / uRes;
    vec3 ext = texture2D(uExterior, uv).rgb;
    float zExt = 1e9;
    if (uHasDepth > 0.5) {
      float dz01 = texture2D(uExtDepth, uv).r;
      zExt = 2.0 * uNear * uFar / (uFar + uNear - (2.0 * dz01 - 1.0) * (uFar - uNear));   // distance along the view axis
    }

    // Where this ray crosses the opening plane (exact: the quad itself is 4 mm proud), in the
    // opening's own axes, and its direction in them. dz > 0: going into the wall.
    float dn = dot(d, vNrm);
    float dz = max(-dn, 1e-4);
    float t0 = dot(vCtr - cameraPosition, vNrm) / min(dn, -1e-4);          // distance to the opening plane
    vec3 rel = cameraPosition + d * t0 - vCtr;
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
        // A surface of the exterior nearer than the glass is the hull of another room seen through a door: the sky instead.
        vec3 camFwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
        float zGlass = (t0 + tg) * dot(d, camFwd);
        col = zExt < zGlass - OCCLUDED_BY ? skyFallback(d) : ext;
        // Faint glass: glints of reflected room light (their own angle, period and width on every window: identical ones read as
        // scratches), dithered, and a darker edge.
        float s = mod(a * vGlint.x + b * vGlint.y + vGlint.w, vGlint.z);
        float glint = s < vGlint2.x ? 0.55 : ((s > vGlint2.y && s < vGlint2.y + vGlint2.z) ? 0.7 : 0.0);
        if (bayer() < glint) col = mix(col, vec3(0.62, 0.74, 0.9), 0.13);
        if (min(e.x, e.y) < RIM + 0.03 && bayer() < 0.5) col *= 0.7;
      }
    }
    gl_FragColor = vec4(col, 1.0);
    gl_FragDepth = clamp(vZW.x / vZW.y * 0.5 + 0.5, 0.0, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const POOL_VERT = /* glsl */`
  attribute vec2 aSt;       // s across (-1..1), t away from the wall (0..1) or across (-1..1) for a skylight
  attribute vec3 aPar;      // peak intensity, kind (0 wall, 1 skylight), seed
  attribute vec3 aCol;      // tint of the light (linear)
  varying vec2 vSt;
  varying vec3 vPar, vCol;
  void main() {
    vSt = aSt; vPar = aPar; vCol = aCol;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }`;

const POOL_FRAG = /* glsl */`
  uniform float uPx;
  varying vec2 vSt;
  varying vec3 vPar, vCol;
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
    gl_FragColor = vec4(vCol * lvl, 1.0);
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

// FNV-1a then the murmur3 finalizer (FNV alone barely moves the high bits when only the last characters differ: '#glint1' … '#glint8' would agree).
const hash01 = (s = '') => {
  s = String(s);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

// The glints of one window's glass, in metres across it (a to the right, b up): bands of reflected light along lines of a
// per-window angle, spacing and width, so no two windows scratch the same way. The band is placed to cross the glass.
function glintOf(win) {
  const u = k => hash01(`${win.id}#glint${k}`);
  const ang = (u(1) < 0.5 ? -1 : 1) * (0.3 + 0.95 * u(2));                      // 17° … 72°, leaning either way
  const dir = [Math.cos(ang), Math.sin(ang)];
  const hw = (win.w ?? 1) / 2, hh = (win.kind === 'skylight' ? win.d : win.h) / 2;
  const span = hw * Math.abs(dir[0]) + hh * Math.abs(dir[1]);                   // half the glass' extent along the glint axis
  const at = (u(3) - 0.5) * 1.3 * span;                                         // where band 1 starts
  const w1 = 0.03 + 0.05 * u(4);
  const two = u(5) < 0.6;
  return { dir, period: 1.4 + 1.3 * u(6), phase: -at, w1, off2: w1 + 0.04 + 0.12 * u(7), w2: two ? 0.014 + 0.03 * u(8) : 0 };
}

// One window's pane quad, with the opening's attributes (frame of the opening, recess, glints) repeated on its four corners.
function paneQuad(out, { ctr, n, r, u, hw, hh, tint, kind, depth, glint, proud }) {
  const base = out.pos.length / 3;
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    out.pos.push(ctr[0] + n[0] * proud + r[0] * hw * sx + u[0] * hh * sy,
      ctr[1] + n[1] * proud + r[1] * hw * sx + u[1] * hh * sy,
      ctr[2] + n[2] * proud + r[2] * hw * sx + u[2] * hh * sy);
    out.ctr.push(...ctr); out.nrm.push(...n); out.right.push(...r); out.up.push(...u); out.tint.push(...tint);
    out.info.push(hw, hh, kind, depth);
    out.glint.push(glint.dir[0], glint.dir[1], glint.period, glint.phase);
    out.glint2.push(glint.w1, glint.off2, glint.w2);
  }
  out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

// Floor light pool, in world metres on the floor plane.
function poolQuad(out, corners, st, peak, kind, color) {
  const base = out.pos.length / 3;
  corners.forEach((c, i) => { out.pos.push(...c); out.st.push(...st[i]); out.par.push(peak, kind, 0); out.col.push(...color); });
  out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

// What the visibility test needs of one pane: its centre, its normal (into the room) and its four corners, in world metres.
function paneBounds(ctr, n, r, u, hw, hh) {
  const corner = (sx, sy) => new THREE.Vector3(ctr[0] + r[0] * hw * sx + u[0] * hh * sy, ctr[1] + r[1] * hw * sx + u[1] * hh * sy, ctr[2] + r[2] * hw * sx + u[2] * hh * sy);
  return { ctr: new THREE.Vector3(...ctr), n: new THREE.Vector3(...n), corners: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)] };
}

const D2R = Math.PI / 180;
const SUN_H = [Math.cos(SUN.az * D2R), Math.sin(SUN.az * D2R)];       // horizontal heading TO the sun / the Earth
const EARTH_H = [Math.cos(EARTH.az * D2R), Math.sin(EARTH.az * D2R)];

export function buildWindows(scene, exterior = null, slots = WINDOWS) {
  // ── Buffers ──
  const panes = { pos: [], ctr: [], nrm: [], right: [], up: [], tint: [], info: [], glint: [], glint2: [], idx: [] };
  const pools = { pos: [], st: [], par: [], col: [], idx: [] };
  const frames = new Batch();
  const bounds = [];   // one per pane: { ctr, n, corners } for the visibility test

  for (const win of slots) {
    const glint = glintOf(win);

    if (win.kind === 'skylight') {
      const ceil = ceilAt(win.x, win.z), floor = floorAt(win.x, win.z);
      const mood = moodOf(getCellType(win.x, win.z));
      const tint = mood.wall;
      paneQuad(panes, { ctr: [win.x, ceil, win.z], n: [0, -1, 0], r: [1, 0, 0], u: [0, 0, 1], hw: win.w / 2, hh: win.d / 2,
        tint, kind: 1, depth: SHAFT_DEPTH, glint, proud: SKY_PANE_OFF });
      bounds.push(paneBounds([win.x, ceil - SKY_PANE_OFF, win.z], [0, -1, 0], [1, 0, 0], [0, 0, 1], win.w / 2, win.d / 2));
      skyFrame(frames, win, ceil, FRAME_BASE.clone().multiply(new THREE.Color(...tint)));
      const px = win.w / 2 + 0.35, pz = win.d / 2 + 0.35, y = floor + 0.016;
      poolQuad(pools, [[win.x - px, y, win.z - pz], [win.x + px, y, win.z - pz], [win.x + px, y, win.z + pz], [win.x - px, y, win.z + pz]],
        [[-1, -1], [1, -1], [1, 1], [-1, 1]], 0.3, 1, POOL_STARS);
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
      tint, kind: 0, depth: WALL_DEPTH, glint, proud: PANE_OFF });
    bounds.push(paneBounds([win.x + fx * PANE_OFF, cy, win.z + fz * PANE_OFF], [fx, 0, fz], r, [0, 1, 0], win.w / 2, win.h / 2));
    const tintC = new THREE.Color(...tint);
    const dim = Math.abs(fx) > 0.5 ? 1.0 : 0.65;               // the same face dimming the renderer gives the walls
    wallFrame(frames, win, floor, FRAME_BASE.clone().multiply(tintC), SILL_BASE.clone().multiply(tintC), dim);

    // Light pool: the window's patch on the floor, bent toward where the light comes from. Light that comes in travels against the
    // heading of its source. A window that stares at a wall of the base (`dress`) is in the shadow of the tower: no direct sun.
    const lnSun = -(SUN_H[0] * fx + SUN_H[1] * fz), lnEarth = -(EARTH_H[0] * fx + EARTH_H[1] * fz);
    const sunny = !win.dress && lnSun > 0.3;
    const earthy = !sunny && lnEarth > 0.3;
    const ln = sunny ? lnSun : (earthy ? lnEarth : 0);
    const L = sunny ? [-SUN_H[0], -SUN_H[1]] : (earthy ? [-EARTH_H[0], -EARTH_H[1]] : [0, 0]);
    const skew = ln > 0.3 ? THREE.MathUtils.clamp((L[0] * r[0] + L[1] * r[2]) / ln, -0.9, 0.9) : 0;
    const len = THREE.MathUtils.clamp(0.45 + win.h * 0.9, 0.8, 1.7) * (sunny ? 1.2 : 1);
    const high = win.sill >= 0.6;                              // a high window lands its light farther from the wall, and weaker
    const t0 = high ? win.sill * 0.45 : 0.01;
    const hwp = win.w / 2 * 1.05, y = floor + 0.016;
    const at = (s, t) => [win.x + fx * (t0 + t * len) + r[0] * (s * hwp + skew * t * len), y,
      win.z + fz * (t0 + t * len) + r[2] * (s * hwp + skew * t * len)];
    const peak = THREE.MathUtils.clamp((win.w * win.h) / 0.8, 0.5, 1.2) * (sunny ? 0.36 : (earthy ? 0.3 : 0.2)) * (high ? 0.7 : 1);
    poolQuad(pools, [at(-1, 0), at(1, 0), at(1, 1), at(-1, 1)], [[-1, 0], [1, 0], [1, 1], [-1, 1]], peak, 0,
      sunny ? POOL_SUN : (earthy ? POOL_EARTH : POOL_STARS));
  }

  // ── What the panes read ──
  // The exterior's depth: the pane's gate against a hull of another room in front of the glass. Attached here, before the exterior's first
  // frame (a render target takes its depth texture on first use); an exterior that brings its own keeps it.
  const target = exterior?.target ?? null;
  if (target && !target.depthTexture) target.depthTexture = new THREE.DepthTexture(target.width, target.height);
  const sky = exterior?.parts?.sky?.uniforms?.tSky?.value ?? null;   // the dome's equirect (fallback only)
  const blank = new THREE.DataTexture(new Uint8Array([0x34, 0x31, 0x2e, 255]), 1, 1, THREE.RGBAFormat);   // no exterior: a bare horizon
  blank.needsUpdate = true;

  // ── Meshes ──
  const make = (geo, material, name) => {
    const m = new THREE.Mesh(geo, material);
    m.name = name;
    m.matrixAutoUpdate = false;                                 // static, already in world coordinates
    scene.add(m);
    return m;
  };

  // The dither cell is one game pixel: 1 screen pixel on the 640x360 buffer, more on a phone, which renders at device resolution. It is
  // the exterior's own cell (max(1, round(width / 640))), so the glass and the plain it shows dither on the same grid.
  const canvas = scene.userData?.canvas ?? null;
  const uPx = { value: 1 };
  const renderW = () => target?.width || canvas?.width || INTERNAL_W;
  const uRes = { value: new THREE.Vector2(target?.width || INTERNAL_W, target?.height || 360) };
  const sync = () => {
    uPx.value = Math.max(1, Math.round(renderW() / INTERNAL_W));
    if (target) uRes.value.set(target.width, target.height);
  };
  sync();

  const uniforms = {
    uExterior: { value: exterior?.texture ?? blank },
    uExtDepth: { value: target?.depthTexture ?? blank },
    tSky: { value: sky ?? blank },
    uRes,
    uSky: { value: new THREE.Vector2(sky?.image?.width ?? 1, sky?.image?.height ?? 1) },
    uHasDepth: { value: target?.depthTexture ? 1 : 0 },
    uHasSky: { value: sky ? 1 : 0 },
    uNear: { value: 0.05 },
    uFar: { value: 50 },
    uPx,
    uHorizon: { value: new THREE.Color(HORIZON) },
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
    g.setAttribute('aGlint', f32(panes.glint, 4));
    g.setAttribute('aGlint2', f32(panes.glint2, 3));
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
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(pools.col, 3));
    g.setIndex(pools.idx);
    g.computeBoundingSphere();
    const pm = make(g, new THREE.ShaderMaterial({
      uniforms: { uPx },
      vertexShader: POOL_VERT, fragmentShader: POOL_FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }), 'windows:pools');
    pm.renderOrder = 1;
  }

  // ── Visibility ──
  // True when at least one pane can be on screen: its quad is not wholly outside one plane of the camera's frustum (the freelook shear is in
  // the projection matrix, so it counts) and the camera is on the room side of the glass (a pane is one-sided). The Renderer draws the
  // exterior only then. `camera.matrixWorldInverse` must be current (camera.updateMatrixWorld() after the pose, the shear and the shake).
  // It does not look for walls in between: a pane behind a wall counts. No allocation.
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), eye = new THREE.Vector3(), to = new THREE.Vector3();
  const inFrustum = (corners) => {
    for (let k = 0; k < 6; k++) {
      const plane = frustum.planes[k];
      let out = true;
      for (let i = 0; i < 4; i++) if (plane.distanceToPoint(corners[i]) >= 0) { out = false; break; }
      if (out) return false;
    }
    return true;
  };

  return {
    count: bounds.length,

    update() {
      sync();
    },

    anyVisible(camera) {
      uniforms.uNear.value = camera.near;
      uniforms.uFar.value = camera.far;
      pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(pv);
      eye.setFromMatrixPosition(camera.matrixWorld);
      for (let i = 0; i < bounds.length; i++) {
        const b = bounds[i];
        if (to.subVectors(eye, b.ctr).dot(b.n) <= 0) continue;
        if (inFrustum(b.corners)) return true;
      }
      return false;
    },
  };
}
