// Shared toolbox for the mission dioramas (see index.js).
//
// Builders work in CENTIMETRES: every diorama group holds a `root` scaled by 0.01, so
// a builder never converts units. Exceptions (they live in world space): PointsMaterial
// sizes, which `Kit.sparks` converts for you.
//
// Look: flat unlit MeshBasicMaterial with the face shading BAKED into vertex colours
// (top bright, front mid, sides dark), which keeps cubes readable as cubes without any
// light. Static geometry is merged per frame of reference into one vertex-coloured mesh
// (`Batch`); only things that move get their own mesh. All geometry templates, textures
// and flat-colour materials are pooled and reference-counted across dioramas; anything
// a diorama mutates (opacity, colour, texture) is private to it. `dispose()` frees both.
//
// Nothing here touches `document` at import time and every canvas texture is created
// lazily and tolerates a missing DOM, so the geometry can be unit-tested in plain node.
import * as THREE from 'three';

const CM = 0.01;
export const G = 1.2;                   // top of the base pad (cm); builders stand on it
export const TAU = Math.PI * 2;

export const ORANGE = 0xff8c00;          // gallery accent
const FONT = 'Press Start 2P';

// ── Small math helpers shared by the builders ────────────────────────────────
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a, b, u) => a + (b - a) * u;
export const smooth = (a, b, x) => { const u = clamp01((x - a) / (b - a)); return u * u * (3 - 2 * u); };
export const frac = x => x - Math.floor(x);
export const wrap = (x, n) => ((x % n) + n) % n;
// 0 → 1 → 0 bump centred on `c` with half-width `w`.
export const pulse = (x, c, w) => { const d = (x - c) / w; return d * d >= 1 ? 0 : (1 - d * d) * (1 - d * d); };

// ── Colour / shading ─────────────────────────────────────────────────────────
const srgbToLinear = c => (c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4));

// Fixed key light from above/front/right, only used to bake shading.
const LX = 0.327, LY = 0.794, LZ = 0.513;
const SHADE_TOP = 0.42 + 0.58 * LY;
// 1.0 on top faces, ~0.82 front (+z), ~0.69 right (+x), ~0.48 left/back/bottom.
const shadeFor = (nx, ny, nz) => (0.42 + 0.58 * Math.max(0, nx * LX + ny * LY + nz * LZ)) / SHADE_TOP;

// ── Reference-counted pool ───────────────────────────────────────────────────
const pool = new Map();
function acquire(key, make) {
  let e = pool.get(key);
  if (!e) { e = { value: make(), refs: 0 }; pool.set(key, e); }
  e.refs++;
  return e.value;
}
function release(key) {
  const e = pool.get(key);
  if (e && --e.refs === 0) { e.value?.dispose?.(); pool.delete(key); }
}
/** Number of live pooled resources (tests: must be 0 once every diorama is disposed). */
export const poolSize = () => pool.size;

// ── Canvas helpers (lazy, DOM-tolerant) ──────────────────────────────────────
const hasDOM = () => typeof document !== 'undefined' && typeof document.createElement === 'function';

function makeCanvas(w, h) {
  if (!hasDOM()) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c.getContext && c.getContext('2d') ? c : null;
}

// Press Start 2P arrives through a stylesheet and may not be ready when a surface is
// first drawn: request it once, then repaint every live surface.
const surfaces = new Set();
let fontRequested = false;
function ensureFont() {
  if (fontRequested || !hasDOM() || !document.fonts || !document.fonts.load) return;
  fontRequested = true;
  document.fonts.load(`8px "${FONT}"`).then(() => surfaces.forEach(s => s.repaint()), () => {});
}

// Crisp pixels when magnified, mip-filtered when minified: at 640×360 a label seen from
// 1.5 m is well under one pixel per texel, where plain nearest sampling shimmers and drops strokes.
function pixelTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  return t;
}

function softTexture(size, paint) {
  const c = makeCanvas(size, size);
  if (!c) return null;
  paint(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const TEXTURES = {
  glow: () => softTexture(64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 1, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  }),
  ring: () => softTexture(64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.7, 'rgba(255,255,255,0)');
    g.addColorStop(0.86, 'rgba(255,255,255,1)');
    g.addColorStop(0.96, 'rgba(255,255,255,0.25)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  }),
  // Four-point pixel star for sparkles.
  star: () => {
    const c = makeCanvas(16, 16);
    if (!c) return null;
    const ctx = c.getContext('2d');
    for (const [a, x, y, w, h] of [[0.55, 7, 1, 2, 14], [0.55, 1, 7, 14, 2], [0.9, 5, 5, 6, 6], [1, 6, 6, 4, 4]]) {
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.fillRect(x, y, w, h);
    }
    return pixelTexture(c);
  },
};

// Bound for objects that animate their own vertices/instances (see Kit.bound): centre and
// radius in cm, roomy enough for every pose and for the car-frame offsets of the taxi hubs.
const CULL = new THREE.Sphere(new THREE.Vector3(0, 19, 0), 40);

// three scales a point's size by `renderer height / 2 / -z`, which is exact only for a 90°
// vertical FOV. Multiplying in the projection's 1 / tan(fov / 2) makes `size` a true world
// width for every camera: the game's landscape view is 36° (stock points would be ~3x too
// small) and a portrait phone is ~100°.
export function trueSize(shader) {
  shader.vertexShader = shader.vertexShader.replace(
    'gl_PointSize *= ( scale / - mvPosition.z );',
    'gl_PointSize *= ( scale * projectionMatrix[ 1 ][ 1 ] / - mvPosition.z );');
}

// ── Geometry templates ───────────────────────────────────────────────────────
let boxTemplate = null;
function getBoxTemplate() {
  if (!boxTemplate) {
    const g = new THREE.BoxGeometry(1, 1, 1);
    boxTemplate = { pos: g.attributes.position.array, nor: g.attributes.normal.array, idx: g.index.array };
  }
  return boxTemplate;
}

// Unit box with grayscale shading baked in: tint it with a material colour.
function makeShadedBox() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const n = g.attributes.normal;
  const col = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const s = srgbToLinear(shadeFor(n.getX(i), n.getY(i), n.getZ(i)));
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = s;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('normal');
  return g;
}

// Two unit quads back to back at z = ±0.5 (scale z = the gap), each reading correctly from
// its own side: a label on both faces of a solid, in a single draw call.
function makeDualPlane() {
  const front = new THREE.PlaneGeometry(1, 1).translate(0, 0, 0.5);
  const back = new THREE.PlaneGeometry(1, 1).rotateY(Math.PI).translate(0, 0, -0.5);
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = front.attributes[name], b = back.attributes[name];
    const arr = new Float32Array(a.array.length + b.array.length);
    arr.set(a.array); arr.set(b.array, a.array.length);
    g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  g.setIndex([...front.index.array, ...Array.from(back.index.array, i => i + 4)]);
  front.dispose(); back.dispose();
  return g;
}

const GEOS = {
  box: makeShadedBox,
  plane: () => new THREE.PlaneGeometry(1, 1),
  dual: makeDualPlane,
  edges: () => new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
  ring: () => new THREE.RingGeometry(0.86, 1, 32),
};

// ── Static batch: many boxes/cylinders merged into one vertex-coloured mesh ──
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _x = new THREE.Vector3(1, 0, 0);
const _d = new THREE.Vector3();

class Batch {
  constructor() {
    this.pos = [];
    this.col = [];
    this.idx = [];
  }

  get empty() { return this.idx.length === 0; }

  _add(pos, nor, idx, matrix, hex) {
    _nm.getNormalMatrix(matrix);
    const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
    const base = this.pos.length / 3;
    for (let i = 0; i < pos.length; i += 3) {
      _v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(matrix);
      _n.set(nor[i], nor[i + 1], nor[i + 2]).applyMatrix3(_nm).normalize();
      const s = shadeFor(_n.x, _n.y, _n.z);
      this.pos.push(_v.x, _v.y, _v.z);
      this.col.push(srgbToLinear(r * s), srgbToLinear(g * s), srgbToLinear(b * s));
    }
    if (idx) for (let i = 0; i < idx.length; i++) this.idx.push(base + idx[i]);
    else for (let i = 0; i < pos.length / 3; i++) this.idx.push(base + i);
  }

  /** Box of size w×h×d, centred on x/z with its BOTTOM at y0. `rot` = {rx, ry, rz} about its centre. */
  box(cx, y0, cz, w, h, d, hex, rot) {
    const t = getBoxTemplate();
    _p.set(cx, y0 + h / 2, cz);
    _s.set(w, h, d);
    if (rot) _q.setFromEuler(_e.set(rot.rx || 0, rot.ry || 0, rot.rz || 0)); else _q.identity();
    this._add(t.pos, t.nor, t.idx, _m.compose(_p, _q, _s), hex);
    return this;
  }

  /** Vertical cylinder (axis y) with its bottom at y0. `rot` as for box() (e.g. {rx: π/2} lays it along z). */
  cyl(cx, y0, cz, rTop, rBot, h, hex, seg = 8, rot) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1);
    _p.set(cx, y0 + h / 2, cz);
    _s.set(1, 1, 1);
    if (rot) _q.setFromEuler(_e.set(rot.rx || 0, rot.ry || 0, rot.rz || 0)); else _q.identity();
    this._add(g.attributes.position.array, g.attributes.normal.array, g.index.array, _m.compose(_p, _q, _s), hex);
    g.dispose();
    return this;
  }

  /** Prism over a polygon given as [x, z] points (any winding), bottom at y0. */
  prism(points, y0, h, hex) {
    const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    _p.set(0, y0, 0);
    _q.identity();
    _s.set(1, 1, 1);
    this._add(g.attributes.position.array, g.attributes.normal.array, g.index ? g.index.array : null, _m.compose(_p, _q, _s), hex);
    g.dispose();
    return this;
  }

  /** Square-section beam between two points. */
  beam(x1, y1, z1, x2, y2, z2, thick, hex) {
    _d.set(x2 - x1, y2 - y1, z2 - z1);
    const len = _d.length();
    const t = getBoxTemplate();
    _p.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
    _q.setFromUnitVectors(_x, _d.divideScalar(len || 1));
    _s.set(len, thick, thick);
    this._add(t.pos, t.nor, t.idx, _m.compose(_p, _q, _s), hex);
    return this;
  }

  /** Voxel sprite in the xy plane: rows of chars top→bottom, centred on cx, bottom at y0. `legend` maps a char to a colour; unmapped chars are empty. */
  voxels(rows, cx, y0, cz, size, depth, legend) {
    const cols = rows[0].length;
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < cols; c++) {
        const hex = legend[rows[r][c]];
        if (hex === undefined) continue;
        this.box(cx + (c - (cols - 1) / 2) * size, y0 + (rows.length - 1 - r) * size, cz, size, size, depth, hex);
      }
    }
    return this;
  }

  /** Builds the merged geometry (in cm). */
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    g.setIndex(new THREE.BufferAttribute(new (this.pos.length / 3 > 65535 ? Uint32Array : Uint16Array)(this.idx), 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

export class Kit {
  constructor(kind) {
    this.kind = kind;
    this.group = new THREE.Group();
    this.group.name = `diorama:${kind}`;
    this.root = new THREE.Group();
    this.root.scale.setScalar(CM);
    this.group.add(this.root);

    this._held = [];        // pool keys to release
    this._owned = [];       // private disposables
    this._batches = [];     // { batch, parent, tint }
    this._surfaces = [];
    this.main = this.batch(this.root);
  }

  // ── pooled resources ──────────────────────────────────────────────────────
  _pooled(key, make) {
    this._held.push(key);
    return acquire(key, make);
  }

  geo(name) { return this._pooled(`geo:${name}`, GEOS[name]); }

  texture(name) { return this._pooled(`tex:${name}`, TEXTURES[name]); }

  /** Shared opaque material: vertex-coloured geometry tinted by `hex`. */
  shared(hex) {
    return this._pooled(`mat:${hex}`, () => new THREE.MeshBasicMaterial({ color: hex, vertexColors: true }));
  }

  /** Private material the diorama may mutate. */
  own(hex, props = {}) {
    const m = new THREE.MeshBasicMaterial({ color: hex, ...props });
    this._owned.push(m);
    return m;
  }

  /** Private additive/translucent material. */
  glowMat(hex, opacity, props = {}) {
    return this.own(hex, { transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, ...props });
  }

  track(disposable) {
    this._owned.push(disposable);
    return disposable;
  }

  // ── static batches ────────────────────────────────────────────────────────
  /** A merged static mesh living under `parent` (default: the diorama root). Returns the Batch to fill. */
  batch(parent = this.root, tint = 0xffffff) {
    const entry = { batch: new Batch(), parent, tint };
    this._batches.push(entry);
    return entry.batch;
  }

  /** Builds every batch into a mesh. Called once by createDiorama after the builder ran. */
  finish() {
    for (const { batch, parent, tint } of this._batches) {
      if (batch.empty) continue;
      const geo = this.track(batch.build());
      parent.add(new THREE.Mesh(geo, this.shared(tint)));
    }
    this._batches.length = 0;
  }

  /** Merged geometry for a mesh the builder animates itself (instancing, pawns…). */
  geometryOf(batch) {
    const i = this._batches.findIndex(e => e.batch === batch);
    if (i >= 0) this._batches.splice(i, 1);
    return this.track(batch.build());
  }

  /**
   * The common stage: a dark tile with chamfered corners (so a diorama swaying on a
   * 0.5 m plinth never overhangs it, whatever its yaw) and an orange band running round its
   * side; top face at y = G. The camera sits at plinth-top height and never pitches, so the
   * accent must be on the vertical faces: nothing lying on a top face is ever seen.
   */
  base(b = this.main, tile = 0x1a1b27) {
    const h = 19, c = 4.5;
    const outline = [[h, -(h - c)], [h, h - c], [h - c, h], [-(h - c), h], [-h, h - c], [-h, -(h - c)], [-(h - c), -h], [h - c, -h]];
    b.prism(outline, 0, 0.45, tile);
    b.prism(outline, 0.45, 0.4, ORANGE);
    b.prism(outline, 0.85, G - 0.85, tile);
    return b;
  }

  // ── dynamic parts ─────────────────────────────────────────────────────────
  /**
   * Shaded box mesh, centred, sized w×h×d, tinted `hex`. `priv` (true, or extra material
   * props such as {transparent, opacity}) gives it a private material to animate.
   */
  part(w, h, d, hex, parent = this.root, priv = false) {
    const mat = priv ? this.own(hex, { vertexColors: true, ...(priv === true ? null : priv) }) : this.shared(hex);
    const m = new THREE.Mesh(this.geo('box'), mat);
    m.scale.set(w, h, d);
    parent.add(m);
    return m;
  }

  /** Mesh from a merged Batch geometry, tinted `hex` (white = keep the baked colours). */
  mesh(geometry, hex = 0xffffff, parent = this.root) {
    const m = new THREE.Mesh(geometry, this.shared(hex));
    parent.add(m);
    return m;
  }

  /** Flat plane w×h with a private material. */
  plane(w, h, material, parent = this.root) {
    const m = new THREE.Mesh(this.geo('plane'), material);
    m.scale.set(w, h, 1);
    parent.add(m);
    return m;
  }

  /** Wire box (12 edges), size w×h×d. */
  edges(w, h, d, hex, opacity = 1, parent = this.root) {
    const mat = this.track(new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity }));
    const l = new THREE.LineSegments(this.geo('edges'), mat);
    l.scale.set(w, h, d);
    parent.add(l);
    return l;
  }

  /** Camera-facing additive glow (or ring when `tex` = 'ring'), `size` cm across. */
  glow(hex, size, opacity, parent = this.root, tex = 'glow') {
    const mat = this.track(new THREE.SpriteMaterial({
      map: this.texture(tex), color: hex, transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    mat.name = tex;
    const s = new THREE.Sprite(mat);
    s.scale.set(size, size, 1);
    parent.add(s);
    return s;
  }

  /**
   * Cloud of camera-facing pixel sparkles in ONE draw call. Fill `pos` (cm) and `col`
   * (rgb 0..1, black = invisible) every frame and call `s.touch()`. `size` is the sprite
   * width in cm at any distance and for any camera (see trueSize).
   */
  sparks(n, size, parent = this.root) {
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const geo = this.track(new THREE.BufferGeometry());
    const pa = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    const ca = new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', pa);
    geo.setAttribute('color', ca);
    const mat = this.track(new THREE.PointsMaterial({
      size: size * CM, sizeAttenuation: true, vertexColors: true, transparent: true,
      map: this.texture('star'), depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    mat.onBeforeCompile = trueSize;
    mat.customProgramCacheKey = () => 'diorama-points';
    const points = new THREE.Points(geo, mat);
    this.bound(points);
    parent.add(points);
    return { points, pos, col, n, touch() { pa.needsUpdate = true; ca.needsUpdate = true; } };
  }

  /** Instanced copies of a merged geometry (ONE draw call). Matrices are in cm like everything else. */
  instances(geometry, count, hex = 0xffffff, parent = this.root) {
    const im = new THREE.InstancedMesh(geometry, this.shared(hex), count);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bound(im);
    this.track(im);
    parent.add(im);
    return im;
  }

  /**
   * Fixed frustum-culling bound for geometry the builder rewrites every pose (instances,
   * points, a streaming beam), whose computed bounds would otherwise go stale. It covers the
   * whole 0.40 × 0.38 × 0.40 m volume, in the object's own frame (root or one of its children).
   */
  bound(object) {
    const sphere = CULL.clone();
    if (object.isInstancedMesh) object.boundingSphere = sphere;
    else object.geometry.boundingSphere = sphere;
    return object;
  }

  // ── text ──────────────────────────────────────────────────────────────────
  /**
   * Canvas texture painted by `draw(ctx, w, h, ...args)` (crisp texels up close, mip-filtered
   * from afar: see pixelTexture). Returns null without a DOM. `s.paint(...args)` repaints
   * (and remembers the arguments for the font-ready repaint). Size the PANEL for the eye: a
   * glyph needs ~8 screen px at 1.5 m, i.e. ~2.2 cm per glyph cell.
   */
  surface(w, h, draw, ...initial) {
    const canvas = makeCanvas(w, h);
    if (!canvas) return null;
    ensureFont();
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const texture = pixelTexture(canvas);
    let last = initial;
    const s = {
      texture,
      paint(...args) { last = args; s.repaint(); },
      repaint() { draw(ctx, w, h, ...last); texture.needsUpdate = true; },
    };
    s.repaint();
    surfaces.add(s);
    this._surfaces.push(s);
    this.track(texture);
    return s;
  }

  /**
   * Opaque plane carrying a surface (solid `fallback` colour when there is no DOM). With
   * `gap` > 0 it becomes a pair of quads `gap` cm apart along z (centred on the mesh), one
   * facing each way: a label on both faces of a solid, in one draw call.
   */
  panel(w, h, surf, fallback, parent = this.root, gap = 0) {
    const mat = this.own(surf ? 0xffffff : fallback, surf ? { map: surf.texture } : {});
    const m = new THREE.Mesh(this.geo(gap > 0 ? 'dual' : 'plane'), mat);
    m.scale.set(w, h, gap > 0 ? gap : 1);
    parent.add(m);
    return m;
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────
  dispose() {
    this.group.removeFromParent();
    for (const s of this._surfaces) surfaces.delete(s);
    this._surfaces.length = 0;
    for (const o of this._owned) o.dispose();
    this._owned.length = 0;
    for (const k of this._held) release(k);
    this._held.length = 0;
  }
}

/** Bitmap-font text helper for surfaces: crisp-ish Press Start 2P, `size` px. */
export function drawText(ctx, str, x, y, size, color, align = 'left') {
  ctx.font = `${size}px "${FONT}", monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

export const hexCss = c => '#' + c.toString(16).padStart(6, '0');
