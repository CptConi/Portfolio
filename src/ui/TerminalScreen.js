import * as THREE from 'three';
import { skills } from '../data/skills.js';
import { projects, periodLabel, badgesOf } from '../data/projects.js';
import { passions } from '../data/passions.js';
import { contact } from '../data/contact.js';
import { techOf } from '../data/tech.js';
import { events } from '../engine/Events.js';
import { prefs } from '../engine/prefs.js';

// Every outbound link goes through here: no opener leak, and the analytics
// wiring (Analytics.js) hears about it through the event bus.
export function openLink(url, label) {
  if (!url) return;
  window.open(url, '_blank', 'noopener');
  events.emit('link:open', { url, label });
}

// Native canvas resolution for the screen texture (4:3-ish, matches plane ratio).
const CW = 480, CH = 304;
const FONT = '"Press Start 2P", monospace';

// Layout: text margin, and the band between the header bar and the footer where
// page bodies are drawn (and scrolled).
const MARGIN = 18, RIGHT = CW - MARGIN;
const BODY_BOTTOM = CH - 30, BODY_PAD = 8;

// Mission thumbnail (16:9), top-right of the page.
const THUMB_W = 112, THUMB_H = 63, THUMB_X = RIGHT - THUMB_W, THUMB_Y = 39;

// Digital Factory lifecycle, shared by the STATUS rows and the legend. Missions carry a
// `status.phase` key (data/projects.js). `label` names the phase in the legend, `tag` is
// the word on a row; order = conception → build → run, then the end of life.
const PHASES = {
  conception: { label: 'CONCEPTION', tag: 'CONCEPTION', color: '#ffb000', pulse: false,
    hint: 'Cadrer le besoin, documenter, dessiner l\'architecture.' },
  build: { label: 'BUILD', tag: 'BUILD', color: '#37c0ff', pulse: true,
    hint: 'Développer jusqu\'à la première mise en production.' },
  run: { label: 'RUN', tag: 'EN PROD', color: '#39ff6e', pulse: false,
    hint: 'En production : évolutions, montées de version, suivi.' },
  archive: { label: 'ARCHIVE', tag: 'DÉCOMMISSIONNÉ', color: '#8a8a8a', pulse: false,
    hint: 'Décommissionné : retiré de la prod.' },
};
const LIFECYCLE = ['conception', 'build', 'run'];   // the steps of the row gauge
const LOCKED = '#ff5a4a';

// The board lists the Digital Factory missions (`df: true`), whatever their number.
const DF_MISSIONS = projects.filter(p => p.df);
const missionsIn = (...phases) => DF_MISSIONS.filter(p => phases.includes(p.status?.phase));
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

const FACTORY_INTRO = 'Centre de service build et run de Guaraní : des squads de 1 à 4 personnes conçoivent et développent les applications des clients.';
const COUNTS = { run: missionsIn('run').length, build: missionsIn('conception', 'build').length, archive: missionsIn('archive').length };
const FACTORY_NOTE = [
  '> ' + [
    `${plural(COUNTS.run, 'mission')} en prod`,
    `${COUNTS.build} en build`,
    COUNTS.archive && `${COUNTS.archive} archivée${COUNTS.archive > 1 ? 's' : ''}`,
  ].filter(Boolean).join(', ') + '.',
  'Le build a une fin ; le run, presque jamais.',
];

// Splits `rows` into evenly filled pages of at most `max` rows (9 rows → 5 + 4).
function paginate(rows, max) {
  const parts = Math.ceil(rows.length / max);
  const size = Math.ceil(rows.length / (parts || 1));
  return Array.from({ length: parts }, (_, i) => rows.slice(i * size, (i + 1) * size));
}

// A group of missions as one or more `rows` pages (`total` = size of the whole group).
function missionPages(name, rows, max, extra) {
  const parts = paginate(rows, max);
  return parts.map((part, i) => ({
    name: parts.length > 1 ? `${name} ${i + 1}/${parts.length}` : name,
    view: 'rows', rows: part, total: rows.length, ...extra,
  }));
}

// One page per view of the DIGITAL FACTORY // STATUS.LOG console: production first, then
// what is still being built, the retired services, the definition and the PROD teaser.
const DASHBOARD_PAGES = [
  ...missionPages('EN PRODUCTION', missionsIn('run'), 5, {}),
  ...missionPages('EN BUILD', missionsIn('conception', 'build'), 4,
    { sub: 'Avant la mise en production.', gauge: true }),
  ...missionPages('ARCHIVE', missionsIn('archive'), 2,
    { sub: 'Services retirés de la production.', remarks: true }),
  { name: 'LA DIGITAL FACTORY', view: 'factory' },
  { name: 'ACCÈS', view: 'access' },
];

const DATA = { skills, projects, passions, contact, dashboard: DASHBOARD_PAGES };

// Shared <img> cache (devicon SVGs in public/logos, mission thumbnails). Returns an
// Image that may still be decoding or may have failed — callers draw it only once
// `isReady`.
const _imgs = {};
function loadImg(src) {
  let im = _imgs[src];
  if (!im) { im = new Image(); im.src = src; _imgs[src] = im; }
  return im;
}
const logoImg = (f, path = '/logos/') =>
  loadImg(path + f + (f.endsWith('.svg') || f.endsWith('.png') ? '' : '.svg'));
const isReady = im => !!im && im.complete && im.naturalWidth > 0;

// A block [y, y + h) that the clip edge `cut` would slice in two starts just below the
// edge instead: scrolling reveals it whole, whereas a sliver above the footer rule
// reads as a rendering glitch.
const clearCut = (y, h, cut) => (y < cut && y + h > cut ? cut + 4 : y);

// Wheel / touch scrolling for whichever console is focused. One set of window listeners
// for all terminals (they used to be added per instance and never removed).
const _terminals = new Set();
let _scrollInstalled = false;
const focusedTerminal = () => { for (const t of _terminals) if (t._lastFocused && t._maxScroll > 0) return t; return null; };
function installScrollListeners() {
  if (_scrollInstalled) return;
  _scrollInstalled = true;
  let touchY = 0;
  window.addEventListener('wheel', e => {
    const t = focusedTerminal();
    if (t) t.scroll = Math.max(0, Math.min(t._maxScroll, t.scroll + (e.deltaY > 0 ? 20 : -20)));
  }, { passive: true });
  window.addEventListener('touchstart', e => {
    if (focusedTerminal()) touchY = e.touches[0].clientY;
  }, { passive: true });
  window.addEventListener('touchmove', e => {
    const t = focusedTerminal();
    if (!t) return;
    const dy = e.touches[0].clientY - touchY;
    touchY = e.touches[0].clientY;
    t.scroll = Math.max(0, Math.min(t._maxScroll, t.scroll - dy));
    e.preventDefault(); // stop page scroll while a console is being scrolled
  }, { passive: false });
}

export class TerminalScreen {
  constructor(def) {
    this.def   = def;
    this.color = def.color;
    this.page  = 0;
    this.count = DATA[def.type].length;
    this.scroll = 0;
    this._maxScroll = 0;
    this._clickables = []; // { id, x, y, w, h, action }
    this._hoveredId = null;
    this._body = {
      skills: this._skills, projects: this._projects, passions: this._passions,
      contact: this._contact, dashboard: this._dashboard,
    }[def.type];

    const canvas = document.createElement('canvas');
    canvas.width = CW; canvas.height = CH;
    this._ctx = canvas.getContext('2d');
    this._ctx.imageSmoothingEnabled = false;

    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.colorSpace = THREE.SRGBColorSpace;

    // Preload this console's tech logos (and mission thumbnails) so they're
    // decoded before the player reads.
    const names = def.type === 'skills' ? DATA.skills.flatMap(c => c.items)
      : def.type === 'projects' ? DATA.projects.flatMap(p => p.stack) : [];
    for (const n of names) { const m = techOf(n); if (m.f) logoImg(m.f); }
    if (def.type === 'projects') {
      for (const p of DATA.projects) if (p.image) loadImg(p.image);
    }

    // Preload contact logos
    if (def.type === 'contact') {
      for (const c of DATA.contact) logoImg(c.icon);
    }

    _terminals.add(this);
    installScrollListeners();

    this.draw({ focused: false, t: 0 });
  }

  // Outbound link of the page on screen, if any: { url, label }.
  get link() {
    const item = DATA[this.def.type][this.page];
    return item?.url ? { url: item.url, label: item.name } : null;
  }

  // Jump straight to a page (deep links, guided tour). Returns false if out of range.
  goTo(page) {
    if (!(page >= 0 && page < this.count)) return false;
    this.page = page; this.scroll = 0; this._hoveredId = null;
    return true;
  }

  next() { this.page = (this.page + 1) % this.count; this.scroll = 0; this._hoveredId = null; }
  prev() { this.page = (this.page - 1 + this.count) % this.count; this.scroll = 0; this._hoveredId = null; }

  handleInput(cx, cy, isClick = true) {
    // cx, cy are in terminal canvas space (0-CW, 0-CH)
    const scrolledY = cy + this.scroll;
    let found = null;
    for (const btn of this._clickables) {
      if (cx >= btn.x && cx <= btn.x + btn.w && scrolledY >= btn.y && scrolledY <= btn.y + btn.h) {
        found = btn.id;
        if (isClick) btn.action();
        break;
      }
    }

    if (this._hoveredId !== found) {
      this._hoveredId = found;
      return true; // Needs redraw
    }
    return false;
  }

  scrollUp() { this.scroll = Math.max(0, this.scroll - 16); }
  scrollDown() { this.scroll = Math.min(this._maxScroll, this.scroll + 16); }

  // ── Drawing ────────────────────────────────────────────────────────────

  draw({ focused, t }) {
    // Skip redraw when nothing visible changed.
    const phase = Math.floor(t * 2) % 2;
    if (phase === this._phase && this.page === this._lastPage && focused === this._lastFocused && this.scroll === this._lastScroll && this._hoveredId === this._lastHoveredId) return;
    this._phase = phase; this._lastPage = this.page; this._lastFocused = focused; this._lastScroll = this.scroll; this._lastHoveredId = this._hoveredId;

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

    // Body content — each body returns the y just below its last element.
    this._clickables = []; // Clear old clickables before redraw
    const contentH = this._body(c, col, DATA[this.def.type][this.page]);
    this._maxScroll = Math.max(0, contentH + BODY_PAD - BODY_BOTTOM);

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
    if (focused && this.link) {
      hint = 'ENTRÉE OUVRIR  ▲▼ ◀▶  ESC SORTIR ' + cursor;
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

  // Like _wrap, but `parts` stay whole and are joined with `sep` (a part wider than
  // a line still breaks on its spaces).
  _wrapParts(c, parts, sep, maxW) {
    const lines = []; let line = '';
    for (const part of parts) {
      if (line && c.measureText(line + sep + part).width <= maxW) { line += sep + part; continue; }
      if (line) lines.push(line);
      const own = this._wrap(c, part, maxW);
      lines.push(...own.slice(0, -1));
      line = own[own.length - 1];
    }
    if (line) lines.push(line);
    return lines;
  }

  // Draws text (a string to wrap, or ready-made lines) in the current font/colour.
  // Returns the baseline of the last line.
  _paragraph(c, text, x, y, maxW, lh) {
    const lines = Array.isArray(text) ? text : this._wrap(c, text, maxW);
    lines.forEach((ln, i) => c.fillText(ln, x, y + i * lh));
    return y + (lines.length - 1) * lh;
  }

  // Row of outlined 8 px labels, wrapping at `maxW`; `solid` names the one drawn
  // filled. `y` is the text baseline of the first row. Returns the baseline of the last.
  _chips(c, items, x, y, maxW, col, { lh = 18, solid = null } = {}) {
    c.font = '8px ' + FONT;
    c.lineWidth = 1;
    let cx = x, cy = y;
    for (const item of items) {
      const w = Math.ceil(c.measureText(item).width) + 12;
      if (cx + w > x + maxW && cx > x) { cx = x; cy += lh; }
      if (item === solid) {
        c.fillStyle = col;
        c.fillRect(cx, cy - 7, w, 14);
        c.fillStyle = '#050805';
      } else {
        c.strokeStyle = col + '88';
        c.strokeRect(cx + 0.5, cy - 6.5, w - 1, 13);
        c.fillStyle = col;
      }
      c.fillText(item, cx + 6, cy);
      cx += w + 5;
    }
    return cy;
  }

  // Tech grid — each cell is a brand logo on top + the name below; cells without
  // a known logo just leave the top empty. `cut` (optional) is a clip edge that no row
  // after the first may straddle (see clearCut); the first row is the page's main
  // content and always stays put. Returns the y below the last row.
  _techGrid(c, items, x, y, maxW, col, { cols = 4, logoSz = 32, cellH = 56, nameFont = 7, cut = Infinity } = {}) {
    const cellW = maxW / cols;
    const tops = [];
    let ry = y;
    for (let r = 0, rows = Math.ceil(items.length / cols); r < rows; r++) {
      if (r > 0) ry = clearCut(ry, cellH, cut);
      tops.push(ry);
      ry += cellH;
    }
    items.forEach((item, i) => {
      const meta = techOf(item);
      const cx = x + (i % cols) * cellW + cellW / 2;
      const top = tops[Math.floor(i / cols)];

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
    return ry;
  }

  // Square status LED, `y` = its top. `dim` shows the off half of a blink.
  // `color` must be a 6-digit hex: alpha suffixes are appended to it.
  _led(c, x, y, color, dim = false) {
    c.fillStyle = color + '30';
    c.fillRect(x - 2, y - 2, 12, 12);
    c.fillStyle = dim ? color + '55' : color;
    c.fillRect(x, y, 8, 8);
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

  // Mission page. The vertical rhythm is tight on purpose: with a description of up
  // to ~7 lines the first row of stack logos still fits above the footer.
  _projects(c, col, p) {
    const img = p.image ? loadImg(p.image) : null;
    const thumb = isReady(img) ? img : null;      // a missing/broken file just never shows
    const textW = thumb ? THUMB_X - MARGIN - 12 : CW - 2 * MARGIN;
    c.textBaseline = 'middle';

    c.fillStyle = col;
    c.font = '13px ' + FONT;
    c.fillText(p.name, MARGIN, 47);

    // [ OUVRIR ] shares the name row, or hangs under the thumbnail when there is one.
    let top = 0;
    if (thumb) {
      c.imageSmoothingEnabled = true;
      c.drawImage(thumb, THUMB_X, THUMB_Y, THUMB_W, THUMB_H);
      c.imageSmoothingEnabled = false;
      c.lineWidth = 1;
      c.strokeStyle = col + '88';
      c.strokeRect(THUMB_X - 0.5, THUMB_Y - 0.5, THUMB_W + 1, THUMB_H + 1);
      top = THUMB_Y + THUMB_H + 6;
    }
    if (p.url) {
      const btnY = thumb ? top + 10 : 47;
      this._openButton(c, col, p, btnY);
      if (thumb) top = btnY + 10;
    }

    c.fillStyle = '#9a9a9a';
    c.font = '9px ' + FONT;
    let y = this._paragraph(c, p.tagline, MARGIN, 62, textW, 12);

    const badges = badgesOf(p);
    if (badges.length) y = this._chips(c, badges, MARGIN, y + 15, textW, col, { solid: 'EN COURS' });

    c.fillStyle = '#858585';
    c.font = '8px ' + FONT;
    y = this._paragraph(c, this._wrapParts(c, [p.client, periodLabel(p), p.role], ' · ', textW), MARGIN, y + 15, textW, 11);

    c.fillStyle = '#bbb';
    c.font = '9px ' + FONT;
    y = this._paragraph(c, p.description, MARGIN, Math.max(y, top) + 15, CW - 2 * MARGIN, 14);

    y = this._techGrid(c, p.stack, MARGIN, y + 14, CW - 2 * MARGIN, col,
      { cols: 4, logoSz: 38, cellH: 64, nameFont: 8, cut: BODY_BOTTOM });
    c.fillStyle = '#888';
    c.font = '8px ' + FONT;
    const tags = this._wrap(c, '→ ' + p.tags.join(' / '), CW - 2 * MARGIN);
    const tagsY = clearCut(y + 3, (tags.length - 1) * 11 + 10, BODY_BOTTOM) + 5;   // glyphs span baseline ± 5
    return this._paragraph(c, tags, MARGIN, tagsY, CW - 2 * MARGIN, 11) + 6;
  }

  _openButton(c, col, p, y) {
    const id = 'url_' + this.page;
    const text = '[ OUVRIR ]';
    c.font = '8px ' + FONT;
    const tw = c.measureText(text).width;
    const x = RIGHT - 4 - tw;
    if (this._hoveredId === id) {
      c.fillStyle = col;
      c.fillRect(x - 4, y - 10, tw + 8, 20);
      c.fillStyle = '#050805'; // Force black text on hover
    } else {
      c.fillStyle = col;
    }
    c.fillText(text, x, y);
    this._clickables.push({ id, x: x - 4, y: y - 10, w: tw + 8, h: 20, action: () => openLink(p.url, p.name) });
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
    return y;
  }

  _contact(c, col, p) {
    c.textBaseline = 'middle';

    // Icon
    const im = logoImg(p.icon);
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
    const btnId = 'contact_btn_' + this.page;
    const isHovered = this._hoveredId === btnId;

    y += 40;
    c.strokeStyle = p.color;
    c.lineWidth = 2;

    if (isHovered) {
      c.fillStyle = p.color;
      c.fillRect(CW/2 - 100, y, 200, 40);
      c.fillStyle = '#050805'; // Contrast fix for GitHub white button
    } else {
      c.strokeRect(CW/2 - 100, y, 200, 40);
      c.fillStyle = p.color;
    }

    c.textAlign = 'center';
    c.font = '10px ' + FONT;
    c.fillText('OUVRIR LE LIEN', CW/2, y + 20);
    c.textAlign = 'left';

    this._clickables.push({
      id: btnId, x: CW/2 - 100, y: y, w: 200, h: 40,
      action: () => p.url && openLink(p.url, p.name)
    });

    return y + 40;
  }

  // ── DIGITAL FACTORY // STATUS.LOG ──────────────────────────────────────

  _dashboard(c, col, page) {
    c.textBaseline = 'middle';
    c.fillStyle = col;
    c.font = '12px ' + FONT;
    c.fillText('> ' + page.name, MARGIN, 50);
    if (page.total) {
      c.fillStyle = '#8a8a8a';
      c.font = '8px ' + FONT;
      c.textAlign = 'right';
      c.fillText(plural(page.total, 'mission').toUpperCase(), RIGHT, 50);
      c.textAlign = 'left';
    }
    if (page.sub) {
      c.fillStyle = '#8a8a8a';
      c.font = '8px ' + FONT;
      c.fillText(page.sub, MARGIN, 66);
    }
    if (page.view === 'rows') return this._dashRows(c, page);
    if (page.view === 'factory') return this._dashFactory(c, col);
    return this._dashAccess(c);
  }

  // One row per mission: LED, name, short note and the phase tag. `page.gauge` adds a
  // 3-step conception → build → run gauge, `page.remarks` boxes the dry line of a
  // retired mission under its row.
  _dashRows(c, page) {
    const ROW = 38;
    let y = page.sub ? 80 : 68;
    for (const p of page.rows) {
      this._dashRow(c, p, y, page.gauge);
      y += ROW;
      if (page.remarks && p.status.line) y = this._dashRemark(c, p.status.line, y - 4) + 14;
      else {
        c.fillStyle = '#ffffff12';
        c.fillRect(MARGIN, y - 7, RIGHT - MARGIN, 1);
      }
    }
    return y;
  }

  // `y` = top of the row. A retired mission is drawn greyed out, its tag in a stamp frame.
  _dashRow(c, p, y, gauge) {
    const ph = PHASES[p.status.phase];
    const retired = p.status.phase === 'archive';
    const blinkOff = !prefs.reducedMotion && this._phase === 1;   // blink only when motion is welcome
    this._led(c, MARGIN, y + 4, ph.color, ph.pulse && blinkOff);

    c.fillStyle = retired ? '#9a9a9a' : '#e6e6e6';
    c.font = '10px ' + FONT;
    c.textAlign = 'left';
    c.fillText(p.name, 36, y + 8);

    c.fillStyle = '#8a8a8a';
    c.font = '8px ' + FONT;
    c.fillText(p.status.note ?? '', 36, y + 22);

    c.fillStyle = ph.color;
    c.font = '8px ' + FONT;
    c.textAlign = 'right';
    c.fillText(ph.tag, RIGHT - (retired ? 5 : 0), y + 8);
    c.textAlign = 'left';
    if (retired) {
      const w = Math.ceil(c.measureText(ph.tag).width) + 10;
      c.lineWidth = 1;
      c.strokeStyle = ph.color + '99';
      c.strokeRect(RIGHT - w + 0.5, y + 0.5, w - 1, 15);
    }

    if (gauge) {
      const SEG = 24, GAP = 3, step = LIFECYCLE.indexOf(p.status.phase);
      LIFECYCLE.forEach((_, i) => {
        c.fillStyle = i <= step ? ph.color : ph.color + '33';
        c.fillRect(RIGHT - (LIFECYCLE.length - i) * SEG - (LIFECYCLE.length - 1 - i) * GAP, y + 19, SEG, 5);
      });
    }
  }

  // Dry remark in a quiet box with a left rule. Returns the y below the box.
  _dashRemark(c, text, y) {
    c.font = '9px ' + FONT;
    const lines = this._wrap(c, text, RIGHT - MARGIN - 22);
    const h = lines.length * 14 + 8;
    c.fillStyle = '#ffffff0c';
    c.fillRect(MARGIN, y, RIGHT - MARGIN, h);
    c.fillStyle = PHASES.archive.color;
    c.fillRect(MARGIN, y, 2, h);
    c.fillStyle = '#bbb';
    this._paragraph(c, lines, MARGIN + 12, y + 12, RIGHT - MARGIN - 22, 14);
    return y + h;
  }

  // What the Digital Factory is, a legend of its phases, and one dry note.
  _dashFactory(c, col) {
    c.fillStyle = '#bbb';
    c.font = '9px ' + FONT;
    let y = this._paragraph(c, FACTORY_INTRO, MARGIN, 72, CW - 2 * MARGIN, 14) + 24;

    const HINT_X = 134;
    for (const ph of Object.values(PHASES)) {
      this._led(c, MARGIN, y - 4, ph.color);
      c.fillStyle = ph.color;
      c.font = '9px ' + FONT;
      c.fillText(ph.label, 36, y);
      c.fillStyle = '#9a9a9a';
      c.font = '8px ' + FONT;
      y = this._paragraph(c, ph.hint, HINT_X, y, RIGHT - HINT_X, 11) + 18;
    }

    c.fillStyle = col + '55';
    c.fillRect(MARGIN, y - 6, RIGHT - MARGIN, 1);
    c.fillStyle = col;
    c.font = '9px ' + FONT;
    return this._paragraph(c, FACTORY_NOTE, MARGIN, y + 10, CW - 2 * MARGIN, 13) + 8;
  }

  // Locked-down PROD notice — a teasing hint only.
  _dashAccess(c) {
    const lit = prefs.reducedMotion || this._phase === 0;
    c.fillStyle = LOCKED + '1c';
    c.fillRect(MARGIN, 66, RIGHT - MARGIN, 34);
    c.lineWidth = 2;
    c.strokeStyle = lit ? LOCKED : LOCKED + '88';
    c.strokeRect(MARGIN + 1, 67, RIGHT - MARGIN - 2, 32);
    c.fillStyle = LOCKED;
    c.font = '11px ' + FONT;
    c.textAlign = 'center';
    c.fillText('ACCÈS PRODUCTION : RESTREINT', CW / 2, 83);
    c.textAlign = 'left';

    const VALUE_X = 150;
    let y = 122;
    for (const [key, value] of [['ENVIRONNEMENT', 'PRODUCTION'], ['HABILITATION', 'REQUISE'],
      ['JOURNAL', 'ACTIF'], ['STATUT', 'VERROUILLÉ']]) {
      c.font = '8px ' + FONT;
      c.fillStyle = '#777';
      c.fillText(key, MARGIN, y);
      c.fillStyle = key === 'STATUT' ? LOCKED : '#ddd';
      c.fillText(value, VALUE_X, y);
      y += 16;
    }

    c.font = '9px ' + FONT;
    c.fillStyle = '#bbb';
    y = this._paragraph(c, 'Toute tentative d\'accès est journalisée.', MARGIN, y + 16, CW - 2 * MARGIN, 14);
    c.fillStyle = '#8a8a8a';
    y = this._paragraph(c, 'Aucune commande d\'accès sur cette façade. Procédure d\'exception : hors affichage.', MARGIN, y + 20, CW - 2 * MARGIN, 14);
    return y + 6;
  }
}
