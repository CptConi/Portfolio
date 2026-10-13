import * as THREE from 'three';
import { Pix } from './pixels.js';

// Building blocks shared by the lounge props and the Quartiers dressing.
//
//   Atlas  one small texture holding every painted surface of a mesh (plus a white texel
//          that untextured geometry samples), so a whole room of props is a single draw call.
//   Batch  accumulates transformed primitives (position, normal, uv, vertex colour) into one
//          BufferGeometry. Vertex colours are linear, as three.js expects.

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _n = new THREE.Matrix3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();

// Matrix4 from a position, a rotation (x, y, z radians; Euler order YXZ, so the yaw is the
// outermost turn) and a scale.
export function xf({ pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  _e.set(rot[0], rot[1], rot[2], 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(pos[0], pos[1], pos[2]), _q, _s.set(scale[0], scale[1], scale[2]));
}

export class Atlas {
  constructor(size = 256) {
    this.size = size;
    this.pix = new Pix(size, size);
    this.pix.rect(0, 0, 2, 2, 0xffffff);          // white texel: plain geometry samples it
    this._x = 3; this._y = 0; this._rowH = 2;
    this._tex = null;
  }

  // Reserves a w × h pixel region (1 px of padding all round) and returns it.
  alloc(w, h) {
    if (this._x + w + 1 > this.size) { this._x = 0; this._y += this._rowH + 1; this._rowH = 0; }
    if (this._y + h > this.size) throw new RangeError('atlas full');
    const r = { x: this._x, y: this._y, w, h };
    this._x += w + 1;
    this._rowH = Math.max(this._rowH, h);
    return r;
  }

  // Reserves a region, lets `fn` paint it with local pixel coordinates, returns the region.
  paint(w, h, fn) {
    const rect = this.alloc(w, h);
    const p = new Pix(w, h);
    fn(p);
    this.pix.copy(p, rect.x, rect.y);
    return rect;
  }

  // Normalised uv rectangle of a region (v is flipped: texture row 0 is the top of the image).
  uv(r, inset = 0.02) {
    const S = this.size;
    return { u0: (r.x + inset) / S, u1: (r.x + r.w - inset) / S, v0: 1 - (r.y + r.h - inset) / S, v1: 1 - (r.y + inset) / S };
  }

  get whiteUV() { return { u0: 1 / this.size, u1: 1 / this.size, v0: 1 - 1 / this.size, v1: 1 - 1 / this.size }; }

  texture({ mip = false } = {}) {
    if (!this._tex) this._tex = this.pix.toTexture({ mip });
    return this._tex;
  }
}

export const FULL_UV = { u0: 0, v0: 0, u1: 1, v1: 1 };

// `atlas` may be null for meshes that sample one whole texture (glows): geometry uvs are kept.
export class Batch {
  constructor(atlas = null) {
    this.atlas = atlas;
    this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = [];
    this._stack = [new THREE.Matrix4()];
  }

  // Everything added between push() and pop() is moved by `matrix` (composed with outer pushes).
  push(matrix) {
    this._stack.push(new THREE.Matrix4().multiplyMatrices(this._stack[this._stack.length - 1], matrix));
    return this;
  }

  pop() {
    if (this._stack.length > 1) this._stack.pop();
    return this;
  }

  // Appends `geo` transformed by `matrix`.
  //   color  hex / THREE.Color, or a function (x, y, z) => hex | THREE.Color of the final position
  //   uv     an Atlas uv rectangle: the geometry's own 0..1 uvs are remapped into it. Default = white texel.
  //   keepUV copy the geometry's own uvs untouched (the caller already mapped them into the atlas)
  add(geo, { matrix, color = 0xffffff, uv = null, keepUV = false } = {}) {
    const base = this.pos.length / 3;
    _m.copy(this._stack[this._stack.length - 1]);
    if (matrix) _m.multiply(matrix);
    _n.getNormalMatrix(_m);
    const P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv;
    const rect = uv ?? (this.atlas ? this.atlas.whiteUV : FULL_UV);
    const remap = !keepUV && (uv || !this.atlas);
    const flat = typeof color === 'function' ? null : _c.set(color);
    const fr = flat ? flat.r : 0, fg = flat ? flat.g : 0, fb = flat ? flat.b : 0;
    for (let i = 0; i < P.count; i++) {
      _v.set(P.getX(i), P.getY(i), P.getZ(i)).applyMatrix4(_m);
      this.pos.push(_v.x, _v.y, _v.z);
      let nx = 0, ny = 1, nz = 0;
      if (N) {
        _v.set(N.getX(i), N.getY(i), N.getZ(i)).applyMatrix3(_n).normalize();
        nx = _v.x; ny = _v.y; nz = _v.z;
      }
      this.nor.push(nx, ny, nz);
      if (keepUV) this.uv.push(U.getX(i), U.getY(i));
      else if (remap && U) this.uv.push(rect.u0 + U.getX(i) * (rect.u1 - rect.u0), rect.v0 + U.getY(i) * (rect.v1 - rect.v0));
      else this.uv.push(rect.u0, rect.v0);
      if (flat) this.col.push(fr, fg, fb);
      else {
        const k = _c.set(color(this.pos[this.pos.length - 3], this.pos[this.pos.length - 2], this.pos[this.pos.length - 1]));
        this.col.push(k.r, k.g, k.b);
      }
    }
    const I = geo.index;
    if (I) for (let i = 0; i < I.count; i++) this.idx.push(base + I.getX(i));
    else for (let i = 0; i < P.count; i++) this.idx.push(base + i);
    return this;
  }

  box(w, h, d, opts = {}) {
    const { pos, rot, scale, ...rest } = opts;
    return this.add(new THREE.BoxGeometry(w, h, d), { matrix: xf({ pos, rot, scale }), ...rest });
  }

  // Upright cylinder / cone frustum along y, base at y = 0 of its own frame.
  cyl(rTop, rBot, h, seg = 12, opts = {}) {
    const { pos, rot, scale, open = false, ...rest } = opts;
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open).translate(0, h / 2, 0);
    return this.add(g, { matrix: xf({ pos, rot, scale }), ...rest });
  }

  // Single quad of w × h facing +z in its own frame; uv fills the given region.
  quad(w, h, opts = {}) {
    const { pos, rot, scale, ...rest } = opts;
    return this.add(new THREE.PlaneGeometry(w, h), { matrix: xf({ pos, rot, scale }), ...rest });
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }

  mesh(material, renderOrder = 0) {
    const m = new THREE.Mesh(this.geometry(), material);
    m.renderOrder = renderOrder;
    m.matrixAutoUpdate = false;   // static: everything is already in world coordinates
    return m;
  }
}

// The same geometry seen from the inside: reversed winding and normals (hollow shells, lid dishes).
export function flipped(geo) {
  const g = geo.clone();
  if (g.index) {
    const a = g.index.array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
  }
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}
