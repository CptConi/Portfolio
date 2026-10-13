import * as THREE from 'three';
import { xf } from './kit.js';

// The electric guitar standing on its stand against the Quartiers' east wall.
//
// One silhouette (double-cut body + neck + headstock) extruded to a real thickness; the playing
// face is a painted pixel-art texture (sunburst, pickguard, pickups, frets, strings) so the
// detail sits on the vertical face the visitor actually sees. Authored in centimetres in a
// frame whose origin is the bottom centre of the body, +y up, the front facing +z.

const CM = 0.01;

// Body outline, clockwise from the end pin (x to the right, y up, cm). The bass-side horn is
// the longer one.
const BODY = [
  [0, 0], [5.5, 0.3], [9.2, 2.5], [10.8, 6.5], [10.4, 11], [8.4, 14.2], [7.4, 16.6], [8.6, 19.6],
  [9.9, 23.4], [9.7, 26.9], [7.7, 28.1], [5.0, 26.3], [1.9, 24.5], [-1.9, 24.5], [-5.4, 27.2],
  [-8.2, 30.2], [-10.3, 28.9], [-10.9, 25.4], [-9.7, 21.7], [-8.1, 18.2], [-8.7, 14.6],
  [-10.9, 10.6], [-11.4, 6.6], [-9.8, 2.6], [-5.5, 0.3],
];

// Neck + headstock, overlapping the body from the neck pickup up to the nut.
const NECK_FROM = 21.5, NUT = 52, TOP = 62.5, NECK_HALF = 1.7;
const NECK = [
  [-NECK_HALF, NECK_FROM], [NECK_HALF, NECK_FROM], [NECK_HALF, NUT], [2.5, NUT + 1.5], [3.0, 58.4],
  [2.2, 61.4], [0, TOP], [-2.4, 61.2], [-3.0, 58.0], [-2.4, NUT + 1.5], [-NECK_HALF, NUT],
];

const BODY_DEPTH = 4.2, NECK_DEPTH = 2.1, NECK_LIFT = 0.4;

// Texture space: 2 px per cm, covering x ∈ [X0, X0 + W], y ∈ [Y0, Y0 + H].
const PX = 2, X0 = -12.5, Y0 = -1.5, W = 25, H = 65;
export const GUITAR_TEX = { w: W * PX, h: H * PX };

const SUNBURST = [[1.1, 0x3b0b0d], [2.6, 0x8c1a1d], [4.8, 0xc4401e], [7.4, 0xe0701f], [99, 0xf2a73a]];
const CREAM = 0xefe6cf, PEARL_SHADE = 0xcfc4a8, CHROME = 0xd5d9e2, DARK = 0x16110f;

const inside = (pts, x, y) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

const edgeDistance = (pts, x, y) => {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
    const dx = bx - ax, dy = by - ay;
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(x - ax - u * dx, y - ay - u * dy));
  }
  return best;
};

// Paints the playing face (guitar-local centimetres → pixels).
export function paintGuitar(p) {
  const px = x => (x - X0) * PX;
  const py = y => (H - (y - Y0)) * PX;          // image rows run top-down
  const rect = (x0, y0, x1, y1, c) => p.rect(Math.round(px(x0)), Math.round(py(y1)), Math.max(1, Math.round((x1 - x0) * PX)), Math.max(1, Math.round((y1 - y0) * PX)), c);
  const poly = (pts, c) => p.poly(pts.map(([x, y]) => [px(x), py(y)]), c);

  // Sunburst body, banded for the pixel look.
  for (let j = 0; j < p.h; j++) {
    for (let i = 0; i < p.w; i++) {
      const x = X0 + (i + 0.5) / PX, y = Y0 + H - (j + 0.5) / PX;
      if (!inside(BODY, x, y)) continue;
      const d = edgeDistance(BODY, x, y);
      p.set(i, j, SUNBURST.find(([lim]) => d < lim)[1]);
    }
  }

  // Cream pickguard with three single-coils and the bridge plate.
  poly([[-7.4, 5.2], [-3.4, 3.4], [4.6, 3.6], [8.4, 7.4], [8.2, 14.6], [6.0, 17.4], [3.0, 20.6], [-1.6, 21.4], [-3.4, 18.4], [-6.2, 13.4]], CREAM);
  p.line(Math.round(px(-7.2)), Math.round(py(5.4)), Math.round(px(-6.0)), Math.round(py(13.2)), PEARL_SHADE);
  for (const [y, tilt] of [[19.2, 0.0], [15.0, 0.0], [11.0, 0.0]]) {
    rect(-4.4 + tilt, y - 1.0, 4.4 + tilt, y + 1.0, DARK);
    for (let k = 0; k < 6; k++) p.set(Math.round(px(-3.4 + k * 1.36)), Math.round(py(y)), CHROME);
  }
  rect(-4.6, 5.4, 4.6, 8.4, CHROME);
  rect(-4.6, 5.4, 4.6, 5.9, 0x8c92a0);
  for (let k = 0; k < 6; k++) p.set(Math.round(px(-3.0 + k * 1.2)), Math.round(py(7.9)), 0x6e7482);

  // Knobs and the selector, upper bout side.
  for (const [x, y] of [[5.6, 12.2], [6.9, 9.6], [5.2, 9.2]]) p.disc(px(x), py(y), 1.7, 0x14110f).disc(px(x), py(y), 1.0, 0xd5d9e2);

  // Neck: rosewood board, frets, position dots, strings.
  rect(-NECK_HALF, NECK_FROM, NECK_HALF, NUT, 0x3a2114);
  rect(-NECK_HALF, NECK_FROM, -NECK_HALF + 0.35, NUT, 0x24140b);
  let y = NECK_FROM + 2.6, gap = 2.9;
  const fretYs = [];
  while (y < NUT - 0.5) { fretYs.push(y); rect(-NECK_HALF, y, NECK_HALF, y + 0.35, 0xc3c7d0); y += gap; gap *= 0.945; }
  [2, 4, 6, 8].forEach(k => { if (fretYs[k]) p.set(Math.round(px(0)), Math.round(py(fretYs[k] - 1.2)), 0xf1e8cf); });
  if (fretYs[11]) { p.set(Math.round(px(-0.6)), Math.round(py(fretYs[11] - 1.2)), 0xf1e8cf); p.set(Math.round(px(0.6)), Math.round(py(fretYs[11] - 1.2)), 0xf1e8cf); }
  rect(-NECK_HALF, NUT - 0.5, NECK_HALF, NUT, 0xf1ead3);
  for (const sx of [-0.9, 0, 0.9].map(x => Math.round(px(x)))) p.line(sx, Math.round(py(NUT)), sx, Math.round(py(7.9)), 0x8a8e9a);

  // Headstock: maple, six tuning pegs, a dark logo bar.
  poly(NECK.slice(2), 0xd9a45b);
  rect(-NECK_HALF, NUT, NECK_HALF, NUT + 0.6, 0xf1ead3);
  for (let k = 0; k < 3; k++) {
    p.rect(Math.round(px(-2.7)), Math.round(py(55 + k * 2.6)), 2, 2, CHROME);
    p.rect(Math.round(px(2.1)), Math.round(py(55 + k * 2.6)), 2, 2, CHROME);
  }
  rect(-1.0, 57.2, 1.0, 58.0, 0x7a4a1a);
}

// ExtrudeGeometry whose front cap carries the painted texture (uvs into the given atlas rect)
// and everything else the white texel. Front face at z = 0 (+ lift), volume behind it.
function silhouette(pts, depth, lift, atlasUV, whiteUV) {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x * CM, y * CM)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: depth * CM, bevelEnabled: false, curveSegments: 1 });
  geo.translate(0, 0, (lift - depth) * CM);
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    if (nor.getZ(i) > 0.9) {
      uv[i * 2] = atlasUV.u0 + ((pos.getX(i) / CM - X0) / W) * (atlasUV.u1 - atlasUV.u0);
      uv[i * 2 + 1] = atlasUV.v0 + ((pos.getY(i) / CM - Y0) / H) * (atlasUV.v1 - atlasUV.v0);
    } else {
      uv[i * 2] = whiteUV.u0;
      uv[i * 2 + 1] = whiteUV.v0;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

// Adds the guitar and its stand to `L.solid`. `rect` is the atlas region holding paintGuitar().
//   at    { x, z, y }   point on the floor under the end pin
//   pin   height of the end pin above the floor (the stand's cradle)
//   yaw   rotation about the vertical axis (front faces +z at 0)
//   lean  how far the top leans back toward the wall, radians
//   scale overall size factor
export function addGuitar(L, { rect, at, pin = 0.13, yaw = 0, lean = 0.16, scale = 1 }) {
  const { solid, atlas } = L;
  const uv = atlas.uv(rect);
  const white = atlas.whiteUV;
  const place = xf({ pos: [at.x, at.y + pin, at.z], rot: [0, yaw, 0], scale: [scale, scale, scale] });
  solid.push(place);

  // Guitar proper, hinged on the end pin so the top can lean against the wall.
  solid.push(xf({ rot: [-lean, 0, 0] }));
  solid.add(silhouette(BODY, BODY_DEPTH, 0, uv, white), { keepUV: true, color: 0xffffff });
  solid.add(silhouette(NECK, NECK_DEPTH, NECK_LIFT, uv, white), { keepUV: true, color: 0xffffff });
  solid.pop();

  // Stand: three splayed legs from a hub just under the body, two cradle arms with rubber pads.
  const hub = [0, -0.03, -0.02];
  const rod = (from, to, r, color) => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r, r, len, 6).translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    solid.add(g, { matrix: new THREE.Matrix4().compose(a, q, new THREE.Vector3(1, 1, 1)), color });
  };
  const floor = -pin / scale + 0.003;
  for (const [lx, lz] of [[-0.14, 0.12], [0.14, 0.12], [0, -0.17]]) rod(hub, [lx, floor, lz], 0.0065, 0x2a2b31);
  rod(hub, [-0.065, 0.015, 0.0], 0.006, 0x2a2b31);
  rod(hub, [0.065, 0.015, 0.0], 0.006, 0x2a2b31);
  for (const sx of [-1, 1]) solid.box(0.02, 0.02, 0.028, { pos: [sx * 0.066, 0.016, 0.0], color: 0x7a1f1a });
  solid.pop();
}

// World axis-aligned footprint of the stand's legs (they reach 0.14 to each side, 0.12 toward
// the front and 0.17 behind, in guitar space) for a guitar standing at `at`.
export function guitarFootprint(at, yaw, scale = 1) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const pts = [[-0.14, 0.12], [0.14, 0.12], [0, -0.17]].map(([x, z]) => [x * scale, z * scale]);
  const xs = [], zs = [];
  for (const [lx, lz] of pts) { xs.push(at.x + lx * c + lz * s); zs.push(at.z - lx * s + lz * c); }
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}
