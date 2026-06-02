import * as THREE from 'three';
import { skills } from '../data/skills.js';
import { projects } from '../data/projects.js';
import { passions } from '../data/passions.js';
import { contact } from '../data/contact.js';
import { techOf } from '../data/tech.js';

// Native canvas resolution for the screen texture (4:3-ish, matches plane ratio).
const CW = 480, CH = 304;
const FONT = '"Press Start 2P", monospace';

const DATA = { skills, projects, passions, contact };

// Shared logo <img> cache (devicon SVGs in public/logos). Returns an Image that
// may still be decoding — callers draw it only once `complete && naturalWidth`.
const _logoImgs = {};
function logoImg(f, path = '/logos/') {
  let im = _logoImgs[f];
  if (!im) { 
    im = new Image(); 
    im.src = path + f + (f.endsWith('.svg') || f.endsWith('.png') ? '' : '.svg'); 
    _logoImgs[f] = im; 
  }
  return im;
}

export class TerminalScreen {
  constructor(def) {
    this.def   = def;
    this.color = def.color;
    this.page  = 0;
    this.count = DATA[def.type].length;

    const canvas = document.createElement('canvas');
    canvas.width = CW; canvas.height = CH;
    this._ctx = canvas.getContext('2d');
    this._ctx.imageSmoothingEnabled = false;

    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.colorSpace = THREE.SRGBColorSpace;

    // Preload this console's tech logos so they're decoded before the player reads.
    const names = def.type === 'skills' ? DATA.skills.flatMap(c => c.items)
      : def.type === 'projects' ? DATA.projects.flatMap(p => p.stack) : [];
    for (const n of names) { const m = techOf(n); if (m.f) logoImg(m.f); }

    // Preload contact logos from resources
    if (def.type === 'contact') {
      for (const c of DATA.contact) logoImg(c.icon, '/ressources/');
    }

    this.draw({ focused: false, t: 0 });
  }

  next() { this.page = (this.page + 1) % this.count; }
  prev() { this.page = (this.page - 1 + this.count) % this.count; }

  // ── Drawing ────────────────────────────────────────────────────────────

  draw({ focused, t }) {
    // Skip redraw when nothing visible changed (blink phase / page / focus).
    const phase = Math.floor(t * 2) % 2;
    if (phase === this._phase && this.page === this._lastPage && focused === this._lastFocused) return;
    this._phase = phase; this._lastPage = this.page; this._lastFocused = focused;

    const c = this._ctx, col = this.color;

    // Background — slightly tinted near-black
    c.fillStyle = '#050805';
    c.fillRect(0, 0, CW, CH);

    // Soft inner glow when focused
    if (focused) {
      const g = c.createRadialGradient(CW / 2, CH / 2, 40, CW / 2, CH / 2, CW * 0.7);
      g.addColorStop(0, col + '18');
      g.addColorStop(1, '#00000000');
      c.fillStyle = g;
      c.fillRect(0, 0, CW, CH);
    }

    // Header bar
    c.fillStyle = col;
    c.fillRect(10, 10, CW - 20, 22);
    c.fillStyle = '#050805';
    c.font = '10px ' + FONT;
    c.textBaseline = 'middle';
    c.fillText(this.def.title, 18, 22);

    // Body
    const body = { 
      skills: this._skills, 
      projects: this._projects, 
      passions: this._passions,
      contact: this._contact 
    }[this.def.type];
    body.call(this, c, col, DATA[this.def.type][this.page]);

    // Footer — pagination + nav hint + blinking cursor
    c.fillStyle = col;
    c.fillRect(10, CH - 30, CW - 20, 2);
    c.font = '9px ' + FONT;
    c.fillStyle = col;
    const label = `[<]  ${this.page + 1}/${this.count}  [>]`;
    c.fillText(label, 18, CH - 14);
    const cursor = (Math.floor(t * 2) % 2) === 0 ? '_' : ' ';
    c.fillStyle = '#888';
    
    let hint = focused ? '▲▼ NAVIGUER   ESC SORTIR ' + cursor : 'E POUR ACCÉDER ' + cursor;
    if (focused && this.def.type === 'contact') {
      hint = 'ENTRÉE OUVRIR   ▲▼ NAVIGUER   ESC SORTIR ' + cursor;
    }
    c.fillText(hint, 150, CH - 14);

    // Scanlines
    c.fillStyle = 'rgba(0,0,0,0.28)';
    for (let y = 0; y < CH; y += 3) c.fillRect(0, y, CW, 1);

    this.texture.needsUpdate = true;
  }

  // ── Text helpers ─────────────────────────────────────────────────────────

  _wrap(c, text, maxW) {
    const words = String(text).split(' ');
    const lines = []; let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (c.measureText(test).width > maxW && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  _chips(c, items, x, y, maxW, col, lh = 18) {
    c.font = '8px ' + FONT;
    let cx = x, cy = y;
    for (const item of items) {
      const w = c.measureText(item).width + 12;
      if (cx + w > x + maxW) { cx = x; cy += lh; }
      c.strokeStyle = col + '88';
      c.strokeRect(cx, cy - 9, w, 14);
      c.fillStyle = col;
      c.fillText(item, cx + 6, cy);
      cx += w + 6;
    }
    return cy + lh;
  }

  // Tech grid — each cell is a brand logo on top + the name below; cells without
  // a known logo just leave the top empty. Returns the y below the last row.
  _techGrid(c, items, x, y, maxW, col, { cols = 4, logoSz = 32, cellH = 56, nameFont = 7 } = {}) {
    const cellW = maxW / cols;
    items.forEach((item, i) => {
      const meta = techOf(item);
      const cx = x + (i % cols) * cellW + cellW / 2;
      const top = y + Math.floor(i / cols) * cellH;

      const im = meta.f ? logoImg(meta.f) : null;
      if (im && im.complete && im.naturalWidth) {
        c.imageSmoothingEnabled = true;
        const s = Math.min(logoSz / im.naturalWidth, logoSz / im.naturalHeight);
        const w = im.naturalWidth * s, h = im.naturalHeight * s;
        c.drawImage(im, cx - w / 2, top + (logoSz - h) / 2, w, h);
        c.imageSmoothingEnabled = false;
      } else if (im && im.complete) {
        c.imageSmoothingEnabled = true;
        c.drawImage(im, cx - logoSz / 2, top, logoSz, logoSz);   // SVG w/o intrinsic size
        c.imageSmoothingEnabled = false;
      }

      c.fillStyle = col;
      c.font = nameFont + 'px ' + FONT;
      c.textAlign = 'center';
      this._wrap(c, item, cellW - 8).slice(0, 2)
        .forEach((ln, li) => c.fillText(ln, cx, top + logoSz + 12 + li * (nameFont + 4)));
      c.textAlign = 'left';
    });
    return y + Math.ceil(items.length / cols) * cellH;
  }

  // ── Per-type bodies ────────────────────────────────────────────────────

  _skills(c, _col, cat) {
    c.textBaseline = 'middle';
    c.fillStyle = cat.color;
    c.font = '12px ' + FONT;
    c.fillText('> ' + cat.category, 18, 56);
    const cols = cat.items.length > 8 ? 5 : 4;
    this._techGrid(c, cat.items, 18, 80, CW - 36, cat.color, { cols, logoSz: 30, cellH: 58, nameFont: 7 });
  }

  _projects(c, col, p) {
    c.textBaseline = 'middle';
    c.fillStyle = col;
    c.font = '13px ' + FONT;
    c.fillText(p.name, 18, 56);

    c.fillStyle = '#777';
    c.font = '8px ' + FONT;
    c.fillText(`${p.client} · ${p.year} · ${p.role}`, 18, 78);

    c.fillStyle = '#bbb';
    c.font = '9px ' + FONT;
    let y = 100;
    for (const line of this._wrap(c, p.description, CW - 40)) { c.fillText(line, 18, y); y += 16; }

    y = this._techGrid(c, p.stack, 18, y + 12, CW - 36, col, { cols: 4, logoSz: 38, cellH: 64, nameFont: 8 });
    c.fillStyle = '#888'; c.font = '8px ' + FONT;
    c.fillText('→ ' + p.tags.join(' / '), 18, y + 4);
  }

  _passions(c, col, p) {
    c.textBaseline = 'middle';
    c.font = '34px ' + FONT;
    c.fillText(p.icon, 18, 64);

    c.fillStyle = col; c.font = '13px ' + FONT;
    c.fillText(p.name, 70, 60);

    c.fillStyle = '#bbb'; c.font = '9px ' + FONT;
    let y = 100;
    for (const line of this._wrap(c, p.description, CW - 40)) { c.fillText(line, 18, y); y += 16; }

    y += 6;
    c.fillStyle = '#888';
    for (const d of p.details) { c.fillText('> ' + d, 18, y); y += 16; }
  }

  _contact(c, col, p) {
    c.textBaseline = 'middle';
    
    // Icon
    const im = logoImg(p.icon, '/ressources/');
    if (im && im.complete && im.naturalWidth) {
      c.imageSmoothingEnabled = true;
      const logoSz = 64;
      const s = Math.min(logoSz / im.naturalWidth, logoSz / im.naturalHeight);
      const w = im.naturalWidth * s, h = im.naturalHeight * s;
      c.drawImage(im, 20, 50, w, h);
      c.imageSmoothingEnabled = false;
    }

    c.fillStyle = col; c.font = '16px ' + FONT;
    c.fillText(p.name, 100, 65);

    c.fillStyle = '#bbb'; c.font = '10px ' + FONT;
    c.fillText(p.value, 100, 95);

    c.fillStyle = '#888'; c.font = '9px ' + FONT;
    let y = 130;
    for (const line of this._wrap(c, p.description, CW - 40)) { c.fillText(line, 20, y); y += 18; }

    // CTA
    y += 40;
    c.strokeStyle = p.color;
    c.lineWidth = 2;
    c.strokeRect(CW/2 - 100, y, 200, 40);
    c.fillStyle = p.color;
    c.textAlign = 'center';
    c.font = '10px ' + FONT;
    c.fillText('OUVRIR LE LIEN', CW/2, y + 20);
    c.textAlign = 'left';
  }
}
