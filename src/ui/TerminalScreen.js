import * as THREE from 'three';
import { skills } from '../data/skills.js';
import { projects } from '../data/projects.js';
import { passions } from '../data/passions.js';

// Native canvas resolution for the screen texture (4:3-ish, matches plane ratio).
const CW = 480, CH = 304;
const FONT = '"Press Start 2P", monospace';

const DATA = { skills, projects, passions };

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
    const body = { skills: this._skills, projects: this._projects, passions: this._passions }[this.def.type];
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
    c.fillText(focused ? '▲▼ NAVIGUER   ESC SORTIR ' + cursor : 'E POUR ACCÉDER ' + cursor, 150, CH - 14);

    // Scanlines
    c.fillStyle = 'rgba(0,0,0,0.28)';
    for (let y = 0; y < CH; y += 3) c.fillRect(0, y, CW, 1);

    this.texture.needsUpdate = true;
  }

  // ── Text helpers ─────────────────────────────────────────────────────────

  _wrap(c, text, maxW) {
    const words = text.split(' ');
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

  // ── Per-type bodies ────────────────────────────────────────────────────

  _skills(c, _col, cat) {
    c.textBaseline = 'middle';
    c.fillStyle = cat.color;
    c.font = '12px ' + FONT;
    c.fillText('> ' + cat.category, 18, 58);
    this._chips(c, cat.items, 18, 92, CW - 36, cat.color, 20);
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

    y = this._chips(c, p.stack, 18, y + 10, CW - 36, '#888', 18);
    if (p.url) {
      c.fillStyle = col; c.font = '8px ' + FONT;
      c.fillText('→ ' + p.tags.join(' / '), 18, y + 2);
    }
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
}
