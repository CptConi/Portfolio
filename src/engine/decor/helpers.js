import * as THREE from 'three';
import { floorAt } from '../Map.js';

// Shared drawing / geometry helpers for the decor modules (previously private to Decor.js).

// Load a logo SVG into a CanvasTexture (rasterised, contained with padding).
// Async: the texture starts blank and refreshes once the image decodes.
const _logoCache = {};
export function logoTexture(name) {
  if (_logoCache[name]) return _logoCache[name];
  const S = 128, pad = 14;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const img = new Image();
  img.onload = () => {
    const iw = img.naturalWidth, ih = img.naturalHeight;
    if (iw && ih) {
      const sc = Math.min((S - 2 * pad) / iw, (S - 2 * pad) / ih);
      const w = iw * sc, h = ih * sc;
      ctx.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
    } else {
      ctx.drawImage(img, pad, pad, S - 2 * pad, S - 2 * pad);  // SVG w/o intrinsic size
    }
    tex.needsUpdate = true;
  };
  img.src = '/logos/' + name + '.svg';
  return (_logoCache[name] = tex);
}

export const hex = c => '#' + c.toString(16).padStart(6, '0');

export function textTexture(lines, color, { w = 256, h = 64, font = 16, border = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, w, h);
  if (border) { ctx.strokeStyle = hex(color); ctx.lineWidth = 3; ctx.strokeRect(3, 3, w - 6, h - 6); }
  ctx.fillStyle = hex(color);
  ctx.font = `${font}px "Press Start 2P", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const step = h / (lines.length + 1);
  lines.forEach((l, i) => ctx.fillText(l, w / 2, step * (i + 1)));
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Soft radial-gradient texture (bright centre → transparent edge), cached per colour.
const _radCache = {};
export function radialTex(color) {
  if (_radCache[color]) return _radCache[color];
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 32);
  g.addColorStop(0, hex(color));
  g.addColorStop(0.45, hex(color) + '99');
  g.addColorStop(1, hex(color) + '00');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return (_radCache[color] = t);
}

// Additive wall-wash texture for the LED strip: bright at the bottom (the tube)
// fading up, AND tapering to transparent at the left/right ends so the band
// doesn't cut off with a hard vertical edge. Cached per colour.
const _gradCache = {};
export function gradTex(color) {
  if (_gradCache[color]) return _gradCache[color];
  const W = 128, H = 64;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const vg = ctx.createLinearGradient(0, 0, 0, H);
  vg.addColorStop(0, hex(color) + '00');   // top (toward ceiling) → transparent
  vg.addColorStop(0.55, hex(color) + '55');
  vg.addColorStop(1, hex(color));          // bottom (at the tube) → bright
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
  // Horizontal taper — keep centre, fade the two ends.
  ctx.globalCompositeOperation = 'destination-in';
  const hg = ctx.createLinearGradient(0, 0, W, 0);
  hg.addColorStop(0, '#00000000');
  hg.addColorStop(0.16, '#000000ff');
  hg.addColorStop(0.84, '#000000ff');
  hg.addColorStop(1, '#00000000');
  ctx.fillStyle = hg;
  ctx.fillRect(0, 0, W, H);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return (_gradCache[color] = t);
}

// Soft circular light pool on floor (or ceiling) — radial falloff, not a hard aplat.
export function softPool(scene, color, cx, cz, size, { y = 0.03, opacity = 0.4, down = false } = {}) {
  const geo = new THREE.PlaneGeometry(size, size).rotateX(down ? Math.PI / 2 : -Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: radialTex(color), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  mesh.position.set(cx, y, cz);
  scene.add(mesh);
}

// Split a project name across (up to) two lines so labels never get truncated.
export function wrapName(name) {
  const w = name.split(' ');
  if (w.length === 1) return [name];
  let best = null, score = Infinity;
  for (let k = 1; k < w.length; k++) {
    const l0 = w.slice(0, k).join(' '), l1 = w.slice(k).join(' ');
    const s = Math.max(l0.length, l1.length);
    if (s < score) { score = s; best = [l0, l1]; }
  }
  return best;
}

// Black plane (normal blend) to dim a region's floor or ceiling.
export function darkPanel(scene, cx, cz, w, d, y, down, op) {
  const geo = new THREE.PlaneGeometry(w, d).rotateX(down ? Math.PI / 2 : -Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: op, depthWrite: false }));
  m.position.set(cx, y, cz);
  scene.add(m);
}

// Upright black plane (normal blend) to dim a wall face, spanning [fl, cl].
export function darkWall(scene, cx, cz, w, facing, fl = 0, cl = 1, op = 0.55) {
  const cy = (fl + cl) / 2;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, cl - fl),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false }));
  m.position.set(cx + facing[0] * 0.02, cy, cz + facing[1] * 0.02);
  m.lookAt(cx + facing[0], cy, cz + facing[1]);
  scene.add(m);
}

// Faint painted floor guidance line (Half-Life style). One axis-aligned segment;
// semi-transparent + polygonOffset so it reads as paint and never z-fights.
export function paintSeg(scene, color, ax, az, bx, bz, w = 0.1) {
  const horiz = Math.abs(bx - ax) >= Math.abs(bz - az);
  const len = Math.hypot(bx - ax, bz - az) + w;   // +w so corners overlap cleanly
  const geo = new THREE.PlaneGeometry(horiz ? len : w, horiz ? w : len).rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.25, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  m.position.set(mx, floorAt(mx, mz) + 0.012, mz);
  scene.add(m);
}

// Painted polyline through a list of [x,z] points.
export function paintPath(scene, color, pts) {
  for (let i = 1; i < pts.length; i++)
    paintSeg(scene, color, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
}

// Flat plane on floor (or ceiling), additive-blended.
export function flatGlow(scene, color, cx, cz, w, d, { y = 0.02, opacity = 0.1, down = false } = {}) {
  const geo = new THREE.PlaneGeometry(w, d).rotateX(down ? Math.PI / 2 : -Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  mesh.position.set(cx, y, cz);
  scene.add(mesh);
}

// Upright additive glow strip (wall niche / rack light) facing `facing`.
export function glowBar(scene, color, x, y, z, w, h, facing) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
  m.position.set(x + facing[0] * 0.02, y, z + facing[1] * 0.02);
  m.lookAt(x + facing[0], y, z + facing[1]);
  scene.add(m);
}

// Upright text panel readable (non-mirrored) from BOTH sides: two front-facing
// planes back-to-back, each oriented toward its own side.
export function textPanel(scene, tex, x, y, z, w, h, facing) {
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  for (const s of [1, -1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x + facing[0] * 0.02 * s, y, z + facing[1] * 0.02 * s);
    m.lookAt(x + facing[0] * s, y, z + facing[1] * s);
    scene.add(m);
  }
}
