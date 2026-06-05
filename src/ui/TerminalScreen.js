import * as THREE from 'three';
import { skills } from '../data/skills.js';
import { projects } from '../data/projects.js';
import { passions } from '../data/passions.js';
import { contact } from '../data/contact.js';
import { techOf } from '../data/tech.js';

// Native canvas resolution for the screen texture (4:3-ish, matches plane ratio).
const CW = 480, CH = 304;
const FONT = '"Press Start 2P", monospace';

const DATA = { 
  skills, 
  projects: [...projects].sort((a, b) => {
    const yearA = parseInt(String(a.year).split('-').pop());
    const yearB = parseInt(String(b.year).split('-').pop());
    return yearB - yearA;
  }), 
  passions, 
  contact 
};

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
    this.scroll = 0;
    this._maxScroll = 0;
    this._clickables = []; // { x, y, w, h, action }

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

    // Mouse wheel listener for scrolling
    window.addEventListener('wheel', e => {
      if (this._lastFocused && this._maxScroll > 0) {
        this.scroll = Math.max(0, Math.min(this._maxScroll, this.scroll + (e.deltaY > 0 ? 20 : -20)));
      }
    }, { passive: true });

    // Touch scroll handling
    let touchY = 0;
    window.addEventListener('touchstart', e => {
      if (this._lastFocused) touchY = e.touches[0].clientY;
    }, { passive: false });
    window.addEventListener('touchmove', e => {
      if (this._lastFocused && this._maxScroll > 0) {
        const dy = e.touches[0].clientY - touchY;
        touchY = e.touches[0].clientY;
        this.scroll = Math.max(0, Math.min(this._maxScroll, this.scroll - dy));
        e.preventDefault(); // Stop page scroll
      }
    }, { passive: false });

    this.draw({ focused: false, t: 0 });
  }

  next() { this.page = (this.page + 1) % this.count; this.scroll = 0; }
  prev() { this.page = (this.page - 1 + this.count) % this.count; this.scroll = 0; }
  
  handleInput(cx, cy) {
    // cx, cy are in terminal canvas space (0-CW, 0-CH)
    const scrolledY = cy + this.scroll;
    for (const btn of this._clickables) {
      if (cx >= btn.x && cx <= btn.x + btn.w && scrolledY >= btn.y && scrolledY <= btn.y + btn.h) {
        btn.action();
        return true;
      }
    }
    return false;
  }

  scrollUp() { this.scroll = Math.max(0, this.scroll - 16); }
  scrollDown() { this.scroll = Math.min(this._maxScroll, this.scroll + 16); }

  // ── Drawing ────────────────────────────────────────────────────────────

  draw({ focused, t }) {
    // Skip redraw when nothing visible changed (blink phase / page / focus / scroll).
    const phase = Math.floor(t * 2) % 2;
    if (phase === this._phase && this.page === this._lastPage && focused === this._lastFocused && this.scroll === this._lastScroll) return;
    this._phase = phase; this._lastPage = this.page; this._lastFocused = focused; this._lastScroll = this.scroll;

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

    // Body clip area (between header and footer)
    c.save();
    c.beginPath();
    c.rect(0, 32, CW, CH - 62);
    c.clip();

    c.translate(0, -this.scroll);

    // Body content
    this._clickables = []; // Clear old clickables before redraw
    const body = { 
      skills: this._skills, 
      projects: this._projects, 
      passions: this._passions,
      contact: this._contact 
    }[this.def.type];
    const contentH = body.call(this, c, col, DATA[this.def.type][this.page]);
    this._maxScroll = Math.max(0, contentH - (CH - 82)); // 82 is total non-content height approx

    c.restore();

    // Header bar (drawn after body so it's on top of clipped content)
    c.fillStyle = col;
    c.fillRect(10, 10, CW - 20, 22);
    c.fillStyle = '#050805';
    c.font = '10px ' + FONT;
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    c.fillText(this.def.title, 18, 22);

    // Footer — pagination + nav hint + blinking cursor
    c.fillStyle = '#050805';
    c.fillRect(0, CH - 30, CW, 30); // Opaque footer bg
    c.fillStyle = col;
    c.fillRect(10, CH - 30, CW - 20, 2);
    c.font = '9px ' + FONT;
    c.fillStyle = col;
    c.textAlign = 'left';
    const label = `[<]  ${this.page + 1}/${this.count}  [>]`;
    c.fillText(label, 18, CH - 14);
    const cursor = (Math.floor(t * 2) % 2) === 0 ? '_' : ' ';
    
    let hint = focused ? '▲▼ SCROLL  ◀▶ NAVIGUER  ESC SORTIR ' + cursor : 'E POUR ACCÉDER ' + cursor;
    if (focused && this.def.type === 'contact') {
      hint = 'ENTRÉE OUVRIR  ◀▶ NAVIGUER  ESC SORTIR ' + cursor;
    }
    c.fillStyle = '#888';
    c.textAlign = 'right';
    c.fillText(hint, CW - 18, CH - 14);
    c.textAlign = 'left';

    // Scrollbar if needed
    if (this._maxScroll > 0) {
      const h = CH - 62;
      const barH = Math.max(10, h * (h / (this._maxScroll + h)));
      const barY = 32 + (this.scroll / this._maxScroll) * (h - barH);
      c.fillStyle = col + '44';
      c.fillRect(CW - 8, 32, 4, h);
      c.fillStyle = col;
      c.fillRect(CW - 8, barY, 4, barH);
    }

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
    return this._techGrid(c, cat.items, 18, 80, CW - 36, cat.color, { cols, logoSz: 30, cellH: 58, nameFont: 7 });
  }

  _projects(c, col, p) {
    c.textBaseline = 'middle';
    c.fillStyle = col;
    c.font = '13px ' + FONT;
    c.fillText(p.name, 18, 56);

    // Add clickable URL if exists
    if (p.url) {
      const urlText = '[ OUVRIR ]';
      c.font = '8px ' + FONT;
      const tw = c.measureText(urlText).width;
      const ux = CW - 40 - tw;
      const uy = 56;
      c.fillStyle = col;
      c.fillText(urlText, ux, uy);
      this._clickables.push({ x: ux - 4, y: uy - 8, w: tw + 8, h: 16, action: () => window.open(p.url, '_blank') });
    }

    c.fillStyle = '#777';
    c.font = '8px ' + FONT;
    const meta = `${p.client} · ${p.year} · ${p.role}`;
    let my = 78;
    for (const line of this._wrap(c, meta, CW - 40)) { c.fillText(line, 18, my); my += 14; }

    c.fillStyle = '#bbb';
    c.font = '9px ' + FONT;
    let y = my + 8;
    for (const line of this._wrap(c, p.description, CW - 40)) { c.fillText(line, 18, y); y += 16; }

    y = this._techGrid(c, p.stack, 18, y + 16, CW - 36, col, { cols: 4, logoSz: 38, cellH: 64, nameFont: 8 });
    c.fillStyle = '#888'; c.font = '8px ' + FONT;
    c.fillText('→ ' + p.tags.join(' / '), 18, y + 20);
    return y + 44;
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
    return y + 10;
  }

  _contact(c, col, p) {
    c.textBaseline = 'middle';
    
    // Icon
    const im = logoImg(p.icon, '/ressources/');
    let logoH = 0;
    if (im && im.complete && im.naturalWidth) {
      c.imageSmoothingEnabled = true;
      const logoSz = 64;
      const s = Math.min(logoSz / im.naturalWidth, logoSz / im.naturalHeight);
      const w = im.naturalWidth * s, h = im.naturalHeight * s;
      c.drawImage(im, 20, 50, w, h);
      c.imageSmoothingEnabled = false;
      logoH = h;
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

    this._clickables.push({ 
      x: CW/2 - 100, y: y, w: 200, h: 40, 
      action: () => p.url && window.open(p.url, '_blank') 
    });

    return y + 60;
  }
}
