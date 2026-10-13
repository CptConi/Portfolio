import * as THREE from 'three';

// Tiny RGBA painter on a plain byte array. No canvas, so the pixel art builds in node as
// well as in the browser (and the scratch previews can read it back). Row 0 is the TOP row;
// colours are 0xRRGGBB integers, alpha is 0-255.
export class Pix {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 4);
  }

  set(x, y, c, a = 255) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return this;
    const i = (y * this.w + x) * 4;
    this.data[i] = (c >> 16) & 255;
    this.data[i + 1] = (c >> 8) & 255;
    this.data[i + 2] = c & 255;
    this.data[i + 3] = a;
    return this;
  }

  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    const i = (y * this.w + x) * 4;
    return (this.data[i] << 16) | (this.data[i + 1] << 8) | this.data[i + 2];
  }

  alpha(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.data[(y * this.w + x) * 4 + 3];
  }

  rect(x, y, w, h, c, a = 255) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c, a);
    return this;
  }

  // 1 px frame, inside the given rectangle.
  frame(x, y, w, h, c) {
    this.rect(x, y, w, 1, c).rect(x, y + h - 1, w, 1, c).rect(x, y, 1, h, c).rect(x + w - 1, y, 1, h, c);
    return this;
  }

  // Filled ellipse centred on (cx, cy) in pixel coordinates (pixel centres at +0.5).
  ellipse(cx, cy, rx, ry, c, a = 255) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, c, a);
      }
    }
    return this;
  }

  disc(cx, cy, r, c, a = 255) { return this.ellipse(cx, cy, r, r, c, a); }

  // Bresenham, 1 px wide.
  line(x0, y0, x1, y1, c, a = 255) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c, a);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return this;
  }

  // Even-odd scanline fill of a polygon given as [[x, y], …] in pixel coordinates.
  poly(pts, c, a = 255) {
    let minY = Infinity, maxY = -Infinity;
    for (const [, y] of pts) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(this.h - 1, Math.ceil(maxY)); y++) {
      const py = y + 0.5, xs = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= py) !== (by <= py)) xs.push(ax + ((py - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.ceil(xs[k] - 0.5); x < xs[k + 1] - 0.5; x++) this.set(x, y, c, a);
      }
    }
    return this;
  }

  // Paints a palette-indexed picture: `rows` are strings, `pal` maps a character to a colour
  // (or null / missing = leave untouched). Handy for tiny sprites such as glyphs.
  grid(rows, pal, ox = 0, oy = 0) {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const c = pal[row[i]];
        if (c !== undefined && c !== null) this.set(ox + i, oy + j, c);
      }
    });
    return this;
  }

  // 1 px outline drawn on the transparent pixels that touch an opaque one (4-neighbourhood).
  outline(c) {
    const mark = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.alpha(x, y) > 0) continue;
        if (this.alpha(x - 1, y) > 0 || this.alpha(x + 1, y) > 0 || this.alpha(x, y - 1) > 0 || this.alpha(x, y + 1) > 0) mark.push([x, y]);
      }
    }
    for (const [x, y] of mark) this.set(x, y, c);
    return this;
  }

  // Copies `src` over this image at (ox, oy), alpha included (no blending).
  copy(src, ox, oy) {
    for (let y = 0; y < src.h; y++) {
      const from = y * src.w * 4;
      this.data.set(src.data.subarray(from, from + src.w * 4), ((oy + y) * this.w + ox) * 4);
    }
    return this;
  }

  // GPU texture, crisp up close (Nearest magnification). `mip` adds mipmaps so that fine detail
  // (weave, frets, stripes) melts instead of shimmering when seen from far; power-of-two or not.
  // DataTexture rows start at the bottom, hence the flip.
  toTexture({ mip = false } = {}) {
    const flipped = new Uint8Array(this.data.length);
    const stride = this.w * 4;
    for (let y = 0; y < this.h; y++) flipped.set(this.data.subarray(y * stride, (y + 1) * stride), (this.h - 1 - y) * stride);
    const t = new THREE.DataTexture(flipped, this.w, this.h, THREE.RGBAFormat);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter;
    t.generateMipmaps = mip;
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }
}

// Soft radial glow (alpha falls from the centre), as a texture for additive halos.
export function glowTexture(size = 32, { core = 0.18, power = 2 } = {}) {
  const p = new Pix(size, size);
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - r, y + 0.5 - r) / r;
      const k = d <= core ? 1 : Math.max(0, 1 - (d - core) / (1 - core));
      p.set(x, y, 0xffffff, Math.round(255 * Math.pow(k, power)));
    }
  }
  const t = p.toTexture();
  t.magFilter = THREE.LinearFilter;   // glows are meant to be smooth
  t.minFilter = THREE.LinearFilter;
  return t;
}
