import * as THREE from 'three';
import { floorAt, ceilAt } from '../Map.js';
import { flatGlow, softPool, hex } from './helpers.js';

export const FONT = '"Press Start 2P", monospace';
export const CAP = 0.875;   // cap height of Press Start 2P, in em

// Per-room theme. Rectangles are inclusive map ranges → world spans.
// `sign` is the soffite sign above the doorway, in the system voice, straight from the final copy:
// line 1 names what the room tests (the cas de test of the recette report: CAPACITÉS, SUCCÈS, and
// IDENTITÉ + CONTACT for the Quartiers, which hold two of them), line 2 names the room. ≤ 17 characters
// per line: the longest, IDENTITÉ, CONTACT, still sets at 32 px (see paintSign).
const ROOMS = [
  { name: 'QUARTIERS', color: 0xcc44ff, floor: [8, 17, 2, 7],
    door: { axis: 'z', line: 8.5, span: [11, 14], facing: [0, 1] }, console: [12.5, 2.6],
    sign: { line1: 'IDENTITÉ, CONTACT', line2: 'QUARTIERS' } },
  { name: 'TROPHÉES', color: 0xff8c00, floor: [17, 23, 9, 16],
    door: { axis: 'x', line: 16.5, span: [11, 14], facing: [-1, 0] }, console: [22.4, 12.5],
    sign: { line1: 'SUCCÈS', line2: 'TROPHÉES' } },
  { name: 'ARMURERIE', color: 0x00ff41, floor: [2, 8, 9, 16],
    door: { axis: 'x', line: 8.5, span: [11, 14], facing: [1, 0] }, console: [2.6, 12.5],
    sign: { line1: 'CAPACITÉS', line2: 'ARMURERIE' } },
];

// ── Signage toolkit (shared with atrium.js) ─────────────────────────────────────────────────────

// Canvas texture for signage: chunky when magnified, mipmapped (and anisotropic) when minified,
// so glyphs do not shimmer from across the hall.
export function mipTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
}

// Largest font size, in whole 8 px steps from `size` down, at which `text` fits `maxW` (the pixel
// font stays crisp on its 8 px grid). Sets the font on `g`.
export function fitFont(g, text, size, maxW) {
  for (; ; size -= 8) {
    g.font = `${size}px ${FONT}`;
    if (size <= 8 || g.measureText(text).width <= maxW) return size;
  }
}

// White soft-edged glow; the quad stretches it into an ellipse and its vertex colour tints it, so
// one texture (and one draw call) serves every colour.
let _wash = null;
export function washTexture() {
  if (_wash) return _wash;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 1, 32, 32, 32);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.5, '#ffffff8c');
  grad.addColorStop(1, '#ffffff00');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  _wash = new THREE.CanvasTexture(c);
  _wash.colorSpace = THREE.SRGBColorSpace;
  return _wash;
}

// One BufferGeometry from upright quads. Each quad: centre x,y,z; `facing` [fx, fz] (the side that
// shows the texture); w, h; `uv` [u0, v0, u1, v1] (v0 = bottom edge); optional vertex `color`.
export function quadsGeometry(quads) {
  const pos = [], uv = [], col = [], idx = [];
  quads.forEach(({ x, y, z, facing: [fx, fz], w, h, uv: [u0, v0, u1, v1], color }, i) => {
    const rx = fz, rz = -fx;   // what a viewer in front of the quad sees as +u
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pos.push(x + rx * (w / 2) * sx, y + (h / 2) * sy, z + rz * (w / 2) * sx);
      uv.push(sx < 0 ? u0 : u1, sy < 0 ? v0 : v1);
      if (color) col.push(color.r, color.g, color.b);
    }
    idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (col.length) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  return geo;
}

// ── Soffite signs ───────────────────────────────────────────────────────────────────────────────

// The soffite is the wall plane above a doorway, between the header (the vestibule ceiling) and the
// atrium ceiling. The sign hangs right on the header: the camera never pitches and sees only 0.32 m
// of height per metre of distance, so the lower the sign, the closer it can be read from and the
// less of it a wide window's top crop (object-fit: cover) takes away.
const SIGN = { w: 2.52, h: 0.616, gap: 0.03, off: 0.02, washOff: 0.01 };

// World rectangles of a room's sign and of the colour wash behind it, both on the soffite plane and
// facing the atrium. Pure geometry (no DOM), so it can be proven in node.
export function soffiteLayout({ door: d }) {
  const [fx, fz] = d.facing, [a, b] = d.span, mid = (a + b) / 2;
  const px = d.axis === 'x' ? d.line + fx * 0.5 : mid;   // the wall plane
  const pz = d.axis === 'z' ? d.line + fz * 0.5 : mid;
  const header = ceilAt(px - fx * 0.5, pz - fz * 0.5);
  const top = ceilAt(px + fx * 0.5, pz + fz * 0.5);
  const h = Math.min(SIGN.h, top - header - SIGN.gap - 0.1);
  const at = (off, y, w, hh) => ({ x: px + fx * off, y, z: pz + fz * off, facing: d.facing, w, h: hh });
  return {
    sign: at(SIGN.off, header + SIGN.gap + h / 2, SIGN.w, h),
    wash: at(SIGN.washOff, (header + top) / 2, b - a, top - header),
  };
}

const PX = { w: 720, h: 176 };   // sign texture: ~286 px per metre, same aspect as the sign

// Airport-gate sign: the case name large in the room colour, the room on an inverted band under it
// (dark on colour). Pixel-font sizes stay on the 8 px grid and both lines are centred, so a short word
// and a long one sit equally well on their plate.
function paintSign(g, y0, { color, sign }) {
  const { w, h } = PX, col = hex(color), dark = '#070a0e';
  g.save();
  g.translate(0, y0);
  g.fillStyle = dark;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = col;
  g.lineWidth = 6;
  g.strokeRect(3, 3, w - 6, h - 6);
  g.globalAlpha = 0.3;
  g.lineWidth = 2;
  g.strokeRect(12, 12, w - 24, h - 24);
  g.globalAlpha = 1;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';

  const inner = 24;                                      // clear of both frames
  const band = { x: inner, y: h - inner - 56, w: w - 2 * inner, h: 56 };
  g.fillStyle = col;
  g.fillRect(band.x, band.y, band.w, band.h);
  g.fillStyle = dark;
  const roomSize = fitFont(g, sign.line2, 48, band.w - 32), roomH = roomSize * CAP;   // 48 px: the Quartiers name must read from the spawn
  g.fillText(sign.line2, w / 2, Math.round(band.y + (band.h - roomH) / 2 + roomH));   // whole pixels keep the pixel font crisp

  // The case name takes the largest size that fits, centred between the frame and the band.
  const top = inner, bottom = band.y - 12;
  const size = fitFont(g, sign.line1, 48, w - 2 * (inner + 4)), capH = size * CAP;
  g.fillStyle = col;
  g.fillText(sign.line1, w / 2, Math.round(top + (bottom - top - capH) / 2 + capH));
  g.restore();
}

// Three signs in one atlas texture and one geometry (1 draw call), plus their colour wash on the
// soffite wall (1 draw call, additive). Offsets from the wall plus a polygon offset keep both clear
// of the wall faces at any distance.
function buildSoffiteSigns(scene) {
  const canvas = document.createElement('canvas');
  canvas.width = PX.w;
  canvas.height = PX.h * ROOMS.length;
  const g = canvas.getContext('2d');

  const signs = [], washes = [];
  ROOMS.forEach((room, i) => {
    paintSign(g, i * PX.h, room);
    const { sign, wash } = soffiteLayout(room);
    signs.push({ ...sign, uv: [0, 1 - (i + 1) / ROOMS.length, 1, 1 - i / ROOMS.length] });
    washes.push({ ...wash, uv: [0, 0, 1, 1], color: new THREE.Color(room.color) });
  });

  scene.add(new THREE.Mesh(quadsGeometry(signs), new THREE.MeshBasicMaterial({
    map: mipTexture(canvas), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
  scene.add(new THREE.Mesh(quadsGeometry(washes), new THREE.MeshBasicMaterial({
    map: washTexture(), vertexColors: true, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })));
}

// Per-room palette: floor glow, console light pool, lit door threshold and lintel, soffite sign.
export function buildThresholds(scene) {
  for (const room of ROOMS) {
    const [minX, maxX, minZ, maxZ] = room.floor;
    const cxr = (minX + maxX) / 2, czr = (minZ + maxZ) / 2;
    const rf = floorAt(cxr, czr);
    flatGlow(scene, room.color, cxr, czr, maxX - minX, maxZ - minZ, { y: rf + 0.02, opacity: 0.1 });

    const [px, pz] = room.console;
    softPool(scene, room.color, px, pz, 2.0, { y: floorAt(px, pz) + 0.03, opacity: 0.32 });
    softPool(scene, room.color, px, pz, 1.2, { y: ceilAt(px, pz) - 0.015, opacity: 0.45, down: true });

    const d = room.door, [fx, fz] = d.facing, [a, b] = d.span, span = b - a, mid = (a + b) / 2;
    const dx = d.axis === 'x' ? d.line : mid, dz = d.axis === 'z' ? d.line : mid;
    // facing points toward the atrium (player side); room side is the opposite.
    const bandF = floorAt(dx - fx * 0.5, dz - fz * 0.5);
    // Header sits at the top of the opening = the LOWER of the two ceilings.
    const corrC = Math.min(ceilAt(dx + fx * 0.5, dz + fz * 0.5), ceilAt(dx - fx * 0.5, dz - fz * 0.5));
    flatGlow(scene, room.color, dx, dz, d.axis === 'x' ? 0.3 : span, d.axis === 'x' ? span : 0.3, { y: bandF + 0.03, opacity: 0.4 });

    const lintel = new THREE.Mesh(new THREE.PlaneGeometry(span, 0.1),
      new THREE.MeshBasicMaterial({ color: room.color, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
    lintel.position.set(dx + fx * 0.02, corrC - 0.06, dz + fz * 0.02);
    lintel.lookAt(dx + fx, corrC - 0.06, dz + fz);
    scene.add(lintel);
  }
  buildSoffiteSigns(scene);
}
