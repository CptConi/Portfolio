import * as THREE from 'three';

// "BUG HUNTER" — vertical shoot-'em-up rendered onto a CanvasTexture, played in
// focus mode on the secret-room arcade (a mainframe console). You are a
// bespectacled dev (🤓) shooting incoming bugs; the final boss is THE CLIENT
// PROJECT (👔) hurling lightbulbs 💡 (ideas). Beat the boss before the DEADLINE.

const W = 480, H = 304;            // landscape, matches the mainframe screen aspect
const FONT = '"Press Start 2P", monospace';

const PF_X = 152, PF_W = 176;      // central portrait playfield
const PF_R = PF_X + PF_W;
const PLAYER_Y = H - 28;
const PLAYER_MIN_Y = 108;        // highest the player can rise
const SHIELD_R = 26;             // rainbow shield radius
const SHIELD_TIME = 8;
const RAINBOW = ['#ff3b3b', '#ff9e3b', '#ffe83b', '#5bff5b', '#3bd0ff', '#9e6bff'];

const KILL_TARGET = 16;
const BOSS_HP   = 28;
const DEADLINE  = 55;              // seconds — tight but reachable
const DELIVER_T = 2.6;             // end "delivery" loading bar duration

// Bug roster — emoji, pixel size, hit points, fall speed, score, hit radius, spawn weight.
const TYPES = [
  { e: '🐞', sz: 18, hp: 1, vy: 74, sc: 10, r: 10, w: 5, col: '#ff5555' },
  { e: '🪲', sz: 22, hp: 2, vy: 54, sc: 18, r: 12, w: 4, col: '#7bd64a' },
  { e: '🤯', sz: 24, hp: 3, vy: 46, sc: 30, r: 13, w: 2, col: '#ffb52e' },
  { e: '🧠', sz: 30, hp: 5, vy: 34, sc: 55, r: 16, w: 1, col: '#ff2a9d' },
];
const WEIGHT_SUM = TYPES.reduce((s, t) => s + t.w, 0);
function pickType(rnd) {
  let r = rnd * WEIGHT_SUM;
  for (const t of TYPES) { if ((r -= t.w) < 0) return t; }
  return TYPES[0];
}

export class ArcadeGame {
  constructor() {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    this._ctx = c.getContext('2d');
    this._ctx.imageSmoothingEnabled = false;
    this.texture = new THREE.CanvasTexture(c);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this._seed = 1;

    // Parallax starfield (two depths) — generated once.
    this._field = [];
    for (let i = 0; i < 70; i++) {
      const far = i < 46;
      this._field.push({
        x: this._rnd() * PF_W, y: this._rnd() * H,
        d: far ? 0.4 : 1.0, s: far ? 1 : 2,
        c: far ? '#33455f' : '#6a8cc4',
      });
    }

    this.reset();
  }

  // Deterministic-ish RNG (Math.random fine in the browser, but keep it local).
  _rnd() { this._seed = (this._seed * 1103515245 + 12345) & 0x7fffffff; return this._seed / 0x7fffffff; }

  reset() {
    this.state = 'play';            // 'play' | 'boss' | 'delivering' | 'win' | 'over'
    this.overReason = '';
    this.px = PF_X + PF_W / 2;
    this.py = PLAYER_Y;
    this.shield = 0;                // seconds of rainbow shield remaining
    this.coffee = null;            // { x, y, t }
    this.coffeeCd = 15;            // seconds until next coffee
    this.hp = 3;
    this.score = 0;
    this.killed = 0;
    this.time = DEADLINE;
    this.deliverP = 0;
    this.bgY = 0; this.bgX = 0;
    this.bullets = [];
    this.bugs = [];
    this.bulbs = [];
    this.parts = [];
    this.boss = null;
    this._fireCd = 0;
    this._spawnCd = 0.5;
    this._firePrev = false;
    this._flash = 0;
  }

  _explode(x, y, col, n = 12) {
    for (let i = 0; i < n; i++) {
      const a = this._rnd() * Math.PI * 2, sp = 40 + this._rnd() * 120;
      this.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.4 + this._rnd() * 0.3, max: 0.7, col });
    }
  }

  _hit() { this.hp--; this._flash = 0.25; if (this.hp <= 0) { this.state = 'over'; this.overReason = 'bugs'; } }

  // ── Active gameplay ───────────────────────────────────────────────────────
  update(input, dt, t) {
    dt = Math.min(dt, 0.05);
    const held = input.interact;
    const fireEdge = held && !this._firePrev;
    this._firePrev = held;

    // Particles always animate (used by end screens too).
    for (const p of this.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    this.parts = this.parts.filter(p => p.life > 0);

    if (this.state === 'win' || this.state === 'over') {
      if (fireEdge) this.reset();
      this._draw(t);
      return;
    }

    if (this.state === 'delivering') {
      this.deliverP = Math.min(1, this.deliverP + dt / DELIVER_T);
      if (this.deliverP >= 1) this.state = 'win';
      this._draw(t);
      return;
    }

    // Deadline
    this.time -= dt;
    if (this.time <= 0) { this.time = 0; this.state = 'over'; this.overReason = 'deadline'; this._draw(t); return; }

    // Move + fire
    const left  = input.rotLeft  || input.strafeLeft;
    const right = input.rotRight || input.strafeRight;
    const up    = input.forward;
    const down  = input.backward;
    if (left)  this.px -= 160 * dt;
    if (right) this.px += 160 * dt;
    if (up)    this.py -= 150 * dt;
    if (down)  this.py += 150 * dt;
    this.px = Math.max(PF_X + 14, Math.min(PF_R - 14, this.px));
    this.py = Math.max(PLAYER_MIN_Y, Math.min(PLAYER_Y, this.py));

    // Auto-scroll background (top→bottom) + parallax that drifts with the player.
    const dir = (right ? 1 : 0) - (left ? 1 : 0);
    this.bgY += 72 * dt;
    this.bgX += ((dir * 10) - this.bgX) * Math.min(1, dt * 4);

    this._fireCd -= dt;
    if (held && this._fireCd <= 0) { this.bullets.push({ x: this.px, y: this.py - 14 }); this._fireCd = 0.15; }

    // Coffee power-up (every 15 s) — zig-zags down; grabbing it raises a shield.
    this.coffeeCd -= dt;
    if (this.coffeeCd <= 0 && !this.coffee) {
      this.coffee = { x: PF_X + 24 + this._rnd() * (PF_W - 48), y: -10, t: 0 };
      this.coffeeCd = 15;
    }
    if (this.coffee) {
      const cf = this.coffee;
      cf.t += dt; cf.y += 68 * dt; cf.x += Math.sin(cf.t * 5) * 75 * dt;
      cf.x = Math.max(PF_X + 12, Math.min(PF_R - 12, cf.x));
      if (Math.hypot(cf.x - this.px, cf.y - this.py) < 18) {
        this.shield = SHIELD_TIME; this.score += 15; this.coffee = null; this._explode(this.px, this.py, '#ffffff', 16);
      } else if (cf.y > H + 8) this.coffee = null;
    }
    this.shield = Math.max(0, this.shield - dt);

    for (const b of this.bullets) b.y -= 380 * dt;
    this.bullets = this.bullets.filter(b => b.y > -8 && !b.dead);

    // Spawn bugs until the boss
    if (this.state === 'play') {
      this._spawnCd -= dt;
      if (this._spawnCd <= 0) {
        const ty = pickType(this._rnd());
        this.bugs.push({ x: PF_X + 18 + this._rnd() * (PF_W - 36), y: -10, ty, hp: ty.hp,
          vx: (this._rnd() * 2 - 1) * 40 });
        this._spawnCd = 0.5 + this._rnd() * 0.5;
      }
      if (this.killed >= KILL_TARGET && this.bugs.length === 0) {
        this.state = 'boss';
        this.boss = { x: PF_X + PF_W / 2, y: 46, vx: 84, hp: BOSS_HP, shootCd: 0.8, burstCd: 1.6 };
      }
    }

    // Bugs fall + weave horizontally (bounce off the playfield walls)
    for (const bug of this.bugs) {
      bug.y += bug.ty.vy * dt;
      bug.x += bug.vx * dt;
      if (bug.x < PF_X + 12 || bug.x > PF_R - 12) {
        bug.vx *= -1;
        bug.x = Math.max(PF_X + 12, Math.min(PF_R - 12, bug.x));
      }
      const d = Math.hypot(bug.x - this.px, bug.y - this.py);
      if (this.shield > 0 && d < SHIELD_R) { bug.dead = true; this.score += 2; this._explode(bug.x, bug.y, bug.ty.col, 7); }
      else if (d < bug.ty.r + 9) { this._hit(); bug.dead = true; }
      else if (bug.y > H - 4) { this._hit(); bug.dead = true; }   // slipped past
    }
    // Bullet ↔ bug
    for (const b of this.bullets) for (const bug of this.bugs) {
      if (bug.dead || b.dead) continue;
      if (Math.abs(b.x - bug.x) < bug.ty.r && Math.abs(b.y - bug.y) < bug.ty.r) {
        b.dead = true; bug.hp--;
        if (bug.hp <= 0) { bug.dead = true; this.killed++; this.score += bug.ty.sc; this._explode(bug.x, bug.y, bug.ty.col); }
        else this._explode(bug.x, bug.y, bug.ty.col, 4);
      }
    }

    // Boss
    if (this.boss) {
      const bo = this.boss;
      bo.x += bo.vx * dt;
      if (bo.x < PF_X + 26 || bo.x > PF_R - 26) bo.vx *= -1;

      // Aimed 3-way spread at the player.
      bo.shootCd -= dt;
      if (bo.shootCd <= 0) {
        const ang = Math.atan2(PLAYER_Y - bo.y, this.px - bo.x);
        for (const da of [-0.34, 0, 0.34])
          this.bulbs.push({ x: bo.x, y: bo.y + 16, vx: Math.cos(ang + da) * 72, vy: Math.max(48, Math.sin(ang + da) * 100) });
        bo.shootCd = 0.58;
      }
      // Periodic radial fan downward — the bullet-hell moment.
      bo.burstCd -= dt;
      if (bo.burstCd <= 0) {
        const n = 13;
        for (let i = 0; i < n; i++) {
          const a = Math.PI * 0.13 + Math.PI * 0.74 * (i / (n - 1));
          this.bulbs.push({ x: bo.x, y: bo.y + 14, vx: Math.cos(a) * 58, vy: Math.sin(a) * 58 + 18 });
        }
        bo.burstCd = 2.6;
      }
      for (const b of this.bullets) if (!b.dead && Math.abs(b.x - bo.x) < 24 && Math.abs(b.y - bo.y) < 20) {
        b.dead = true; bo.hp--; this.score += 5;
      }
      if (bo.hp <= 0) { this.state = 'delivering'; this.deliverP = 0; this.score += 250; this._explode(bo.x, bo.y, '#ffb52e', 28); this.boss = null; }
    }

    // Bulbs
    for (const bl of this.bulbs) { bl.x += bl.vx * dt; bl.y += bl.vy * dt; }
    for (const b of this.bullets) for (const bl of this.bulbs)
      if (!bl.dead && Math.abs(b.x - bl.x) < 11 && Math.abs(b.y - bl.y) < 11) { bl.dead = true; b.dead = true; this.score += 4; this._explode(bl.x, bl.y, '#ffee66', 5); }
    for (const bl of this.bulbs) {
      const d = Math.hypot(bl.x - this.px, bl.y - this.py);
      if (this.shield > 0 && d < SHIELD_R) { bl.dead = true; this.score += 1; this._explode(bl.x, bl.y, '#ffee66', 4); }
      else if (d < 15) { this._hit(); bl.dead = true; }
      else if (bl.y > H + 8) bl.dead = true;
    }

    this.bullets = this.bullets.filter(b => !b.dead);
    this.bugs    = this.bugs.filter(b => !b.dead);
    this.bulbs   = this.bulbs.filter(b => !b.dead);
    this._flash  = Math.max(0, this._flash - dt);

    this._draw(t);
  }

  // ── Attract mode (passive) ────────────────────────────────────────────────
  drawAttract(t) {
    const c = this._ctx;
    c.fillStyle = '#05060a'; c.fillRect(0, 0, W, H);
    this._stars(t);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#ff2a9d'; c.font = '26px ' + FONT;
    c.fillText('BUG HUNTER', W / 2, 95);
    c.font = '34px serif';
    c.fillText('🤓  🐞 🪲 🤯 🧠', W / 2, 150);
    if (Math.floor(t * 1.5) % 2 === 0) {
      c.fillStyle = '#37ffe0'; c.font = '12px ' + FONT;
      c.fillText('INSÉRER PIÈCE  [ E ]', W / 2, 215);
    }
    this.texture.needsUpdate = true;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  _stars(t) {
    const c = this._ctx;
    c.fillStyle = '#1b2233';
    for (let i = 0; i < 50; i++) c.fillRect((i * 53) % W, (i * 97 + t * 40) % H, 1, 1);
  }

  _draw(t) {
    const c = this._ctx;
    c.fillStyle = '#020306'; c.fillRect(0, 0, W, H);

    // Playfield bg + bezels
    c.fillStyle = '#05070c'; c.fillRect(PF_X, 0, PF_W, H);
    this._bg();
    c.strokeStyle = '#2a2f3a'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(PF_X, 0); c.lineTo(PF_X, H); c.moveTo(PF_R, 0); c.lineTo(PF_R, H); c.stroke();

    c.textAlign = 'center'; c.textBaseline = 'middle';

    // Bullets
    c.fillStyle = '#37ffe0';
    for (const b of this.bullets) c.fillRect(b.x - 1.5, b.y - 6, 3, 10);

    // Bugs / bulbs / boss
    for (const bug of this.bugs) { c.font = bug.ty.sz + 'px serif'; c.fillText(bug.ty.e, bug.x, bug.y); }
    c.font = '18px serif';
    for (const bl of this.bulbs) c.fillText('💡', bl.x, bl.y);
    if (this.boss) {
      c.font = '40px serif'; c.fillText('👔', this.boss.x, this.boss.y);
      c.fillStyle = '#330'; c.fillRect(PF_X + 14, 14, PF_W - 28, 6);
      c.fillStyle = '#ff8c00'; c.fillRect(PF_X + 14, 14, (PF_W - 28) * (this.boss.hp / BOSS_HP), 6);
      c.fillStyle = '#ff8c00'; c.font = '7px ' + FONT; c.fillText('LE PROJET CLIENT', PF_X + PF_W / 2, 28);
    }

    // Coffee power-up
    if (this.coffee) { c.font = '20px serif'; c.fillText('☕', this.coffee.x, this.coffee.y); }

    // Particles (explosions)
    for (const p of this.parts) { c.globalAlpha = Math.max(0, p.life / p.max); c.fillStyle = p.col; c.fillRect(p.x - 1.5, p.y - 1.5, 3, 3); }
    c.globalAlpha = 1;

    // Rainbow shield (blinks during its final 2 s before fading)
    if (this.shield > 0 && (this.shield > 2 || Math.floor(t * 10) % 2 === 0)) {
      const off = Math.floor(t * 6);
      for (let i = 0; i < RAINBOW.length; i++) {
        c.strokeStyle = RAINBOW[(i + off) % RAINBOW.length];
        c.globalAlpha = 0.85 - i * 0.1;
        c.lineWidth = 2;
        c.beginPath(); c.arc(this.px, this.py, SHIELD_R - i * 2.4, 0, Math.PI * 2); c.stroke();
      }
      c.globalAlpha = 1;
    }

    // Player
    c.font = '26px serif'; c.fillText('🤓', this.px, this.py);

    if (this._flash > 0) { c.fillStyle = `rgba(255,0,40,${this._flash})`; c.fillRect(PF_X, 0, PF_W, H); }

    this._panels();

    // Overlays for delivering / end states
    if (this.state === 'delivering') this._delivering(c, t);
    else if (this.state === 'win' || this.state === 'over') this._endScreen(c, t);

    this.texture.needsUpdate = true;
  }

  // Parallax background scrolling top→bottom, drifting on bgX with the player.
  _bg() {
    const c = this._ctx, mod = (v, m) => ((v % m) + m) % m;
    c.save();
    c.beginPath(); c.rect(PF_X, 0, PF_W, H); c.clip();
    // Scrolling motion grid (moves downward, motion cue).
    c.strokeStyle = 'rgba(72,98,150,0.22)'; c.lineWidth = 1;
    const gap = 34, off = mod(this.bgY * 0.6, gap);
    for (let y = off; y < H; y += gap) { c.beginPath(); c.moveTo(PF_X, y); c.lineTo(PF_R, y); c.stroke(); }
    // Two-depth starfield (moves downward).
    for (const s of this._field) {
      const x = PF_X + mod(s.x + this.bgX * s.d, PF_W);
      const y = mod(s.y + this.bgY * s.d, H);
      c.fillStyle = s.c; c.fillRect(x, y, s.s, s.s);
    }
    c.restore();
  }

  // Side panels — deadline (left), score + lives (right).
  _panels(c = this._ctx) {
    // Left
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#888'; c.font = '8px ' + FONT;
    c.fillText('DEADLINE', PF_X / 2, 40);
    const low = this.time < 10;
    c.fillStyle = low ? '#ff2a2a' : '#ffdd33';
    c.font = '26px ' + FONT;
    c.fillText(Math.ceil(this.time), PF_X / 2, 72);
    c.fillStyle = '#555'; c.font = '7px ' + FONT;
    c.fillText('BUGS', PF_X / 2, 150);
    c.fillStyle = '#7bd64a'; c.font = '13px ' + FONT;
    c.fillText(`${Math.min(this.killed, KILL_TARGET)}/${KILL_TARGET}`, PF_X / 2, 170);

    // Right
    const rx = PF_R + (W - PF_R) / 2;
    c.fillStyle = '#888'; c.font = '8px ' + FONT;
    c.fillText('SCORE', rx, 40);
    c.fillStyle = '#fff'; c.font = '15px ' + FONT;
    c.fillText(this.score, rx, 64);
    c.fillStyle = '#888'; c.font = '8px ' + FONT;
    c.fillText('VIES', rx, 120);
    c.fillStyle = '#ff2a9d'; c.font = '16px serif';
    c.fillText('❤'.repeat(Math.max(0, this.hp)) || '—', rx, 142);
    c.fillStyle = '#444'; c.font = '6px ' + FONT;
    c.fillText('← → BOUGER', rx, H - 48);
    c.fillText('ESPACE TIRER', rx, H - 34);
    c.fillText('ESC SORTIR', rx, H - 20);
  }

  _delivering(c, t) {
    c.fillStyle = 'rgba(0,0,0,0.78)'; c.fillRect(0, H / 2 - 46, W, 92);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#37ffe0'; c.font = '11px ' + FONT;
    const dots = '.'.repeat(1 + (Math.floor(t * 3) % 3));
    c.fillText('LIVRAISON DU PROJET EN COURS' + dots, W / 2, H / 2 - 18);
    const bw = 300, bx = (W - bw) / 2, by = H / 2 + 6;
    c.strokeStyle = '#37ffe0'; c.lineWidth = 2; c.strokeRect(bx, by, bw, 16);
    c.fillStyle = '#37ffe0'; c.fillRect(bx + 2, by + 2, (bw - 4) * this.deliverP, 12);
    c.fillStyle = '#fff'; c.font = '8px ' + FONT;
    c.fillText(Math.round(this.deliverP * 100) + '%', W / 2, by + 30);
  }

  _endScreen(c, t) {
    const win = this.state === 'win';
    c.fillStyle = 'rgba(0,0,0,0.78)'; c.fillRect(0, H / 2 - 52, W, 104);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = win ? '#37ffe0' : '#ff2a9d'; c.font = '16px ' + FONT;
    c.fillText(win ? 'PROJET LIVRÉ !' : (this.overReason === 'deadline' ? 'DEADLINE DÉPASSÉE' : 'GAME OVER'), W / 2, H / 2 - 22);
    c.fillStyle = '#fff'; c.font = '9px ' + FONT;
    c.fillText('SCORE  ' + this.score, W / 2, H / 2 + 4);
    if (Math.floor(t * 1.5) % 2 === 0) { c.fillStyle = '#888'; c.font = '8px ' + FONT; c.fillText('[E] REJOUER    [ESC] SORTIR', W / 2, H / 2 + 30); }
  }
}
