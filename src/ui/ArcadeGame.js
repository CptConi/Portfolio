import * as THREE from 'three';
import { events } from '../engine/Events.js';
import { prefs } from '../engine/prefs.js';

// "BUG HUNTER" — vertical shoot-'em-up rendered onto a CanvasTexture, played in
// focus mode on the secret-room arcade (a mainframe console). You are a
// bespectacled dev (🤓) shooting incoming bugs; the final boss is THE CLIENT
// PROJECT (👔) hurling lightbulbs 💡 (ideas). Beat the boss before the DEADLINE.
//
// The "prod version": once the bug quota is met, the boss is announced (LE CLIENT ARRIVE) and
// taunts from the free left panel; a lost deadline can be extended once per run (a "continue?"
// countdown, +1 life, +15 s, a small penalty); the hi-score survives the visit in localStorage.
//
// Events emitted: 'arcade:end' { won, score } — once per finished run (delivered, out of lives,
// or deadline missed and not extended). Leaving the arcade mid-play ends nothing, but a run that
// was only waiting for its outcome (the unanswered "continue?" or the delivery bar) is settled at
// once: ScreenManager keeps calling drawAttract() after an exit, and never the game itself.
// Language: French. The client is fictional: its lines are about scope and timing, never a real person.

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
const INTRO_T   = 1.5;             // "LE CLIENT ARRIVE" banner; the deadline waits for it
const OFFER_T   = 9;               // seconds the "continue?" offer stays on
const OFFER_LOCK = 0.8;            // a button mashed when the clock ran out must not accept it
const END_LOCK  = 0.7;             // same, before an end screen can be replayed
const EXTENSION_S = 15;
const EXTENSION_PENALTY = 100;
const HI_KEY = 'portfolio.bughunter.hi';

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

// What the client says (guillemets, French). One line each time the boss fires a radial volley,
// and a fixed one at 75 / 50 / 25 % of its health. All about scope and deadlines.
const TAUNTS = {
  arrive: '« Bonjour. J\'ai quelques retours. »',
  volley: [
    '« Juste pour la démo. On le jettera après. »',
    '« C\'est le même écran, avec tout dedans. »',
    '« Ça marchait hier. Qu\'avez-vous touché ? »',
    '« Un petit bouton. Un seul. Par écran. »',
    '« En rouge. Pas ce rouge-là. »',
    '« On voit ça en recette. »',
    '« Vous avez cinq minutes ? Asseyez-vous. »',
    '« Rien d\'urgent. Pour ce soir. »',
  ],
  hp: [
    [0.75, '« Le périmètre a légèrement évolué. »'],
    [0.5, '« Pour hier, si possible. »'],
    [0.25, '« Et si on repartait de zéro ? Même budget. »'],
  ],
  delivered: '« Parfait. Juste un dernier détail. »',
};

// Greedy word wrap with French typography: « and » stay glued to their word, and so do the
// punctuation marks written after a space (« ça ? »).
function wrap(ctx, text, maxW) {
  const words = [];
  for (const w of text.split(' ')) {
    const prev = words[words.length - 1];
    if (prev !== undefined && (w === '»' || w === '?' || w === '!' || w === ':' || prev === '«')) words[words.length - 1] = prev + ' ' + w;
    else words.push(w);
  }
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (line && ctx.measureText(test).width > maxW) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

// The hi-score survives the visit; storage may be missing or refuse (private window, blocked data).
function loadHi() {
  try {
    const v = parseInt(localStorage.getItem(HI_KEY), 10);
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch { return 0; }
}
function saveHi(v) {
  try { localStorage.setItem(HI_KEY, String(v)); } catch { /* the record then lives for this visit only */ }
}

// Blinking prompts (1.5 Hz); steady under prefers-reduced-motion.
const blink = t => prefs.reducedMotion || Math.floor(t * 1.5) % 2 === 0;

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

    // The action button is [E] on a keyboard and TIR on the touch screen; the exit is ESC or the ✕ button.
    const touch = !!document.body?.classList.contains('is-touch');
    this._hint = touch
      ? { act: 'TIR', exit: '✕', coin: 'INSÉRER PIÈCE', move: 'STICK  BOUGER', fire: 'TIR  TIRER', quit: '✕  SORTIR' }
      : { act: '[E]', exit: '[ESC]', coin: 'INSÉRER PIÈCE  [ E ]', move: '← → BOUGER', fire: 'ESPACE TIRER', quit: 'ESC SORTIR' };

    this.hi = loadHi();

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

  // Walking away from a run that was only waiting for its outcome still finishes it: a missed
  // deadline nobody answered, or a boss already down while the delivery bar was filling.
  _settle() {
    if (this.state === 'offer') this._finish(false, 'deadline');
    else if (this.state === 'delivering') this._finish(true);
  }

  reset() {
    this._settle();
    this.state = 'ready';          // 'ready' | 'play' | 'boss' | 'delivering' | 'offer' | 'win' | 'over'
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
    this.extUsed = false;           // one deadline extension per run
    this.offerT = 0;                // "continue?" countdown
    this.offerLock = 0;
    this.endLock = 0;
    this.newRecord = false;
    this.notice = null;             // { text, t }: a one-line message across the screen
    this.taunt = null;              // { lines, hold, firm }: what the client is saying
    this._tauntI = -1;
    this._resume = 'play';
    this._fireCd = 0;
    this._spawnCd = 0.5;
    this._firePrev = true;   // require a release before the first shot can start play
    this._flash = 0;
  }

  _explode(x, y, col, n = 12) {
    for (let i = 0; i < n; i++) {
      const a = this._rnd() * Math.PI * 2, sp = 40 + this._rnd() * 120;
      this.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.4 + this._rnd() * 0.3, max: 0.7, col });
    }
  }

  _hit() {
    if (this.state === 'over') return;
    this.hp--; this._flash = 0.25;
    if (this.hp <= 0) this._finish(false, 'bugs');
  }

  // A run is over: record the score, tell the world once.
  _finish(won, reason = '') {
    if (this.state === 'win' || this.state === 'over') return;
    this.state = won ? 'win' : 'over';
    this.overReason = reason;
    this.endLock = END_LOCK;
    this.newRecord = this.hi > 0 && this.score > this.hi;
    if (this.score > this.hi) { this.hi = this.score; saveHi(this.hi); }
    events.emit('arcade:end', { won, score: this.score });
  }

  // The client speaks. `firm` lines (the health thresholds) are not talked over for a while.
  _say(text, { hold = 3, firm = false } = {}) {
    if (!firm && this.taunt?.firm && this.taunt.hold > 0) return;
    const c = this._ctx;
    c.font = '8px ' + FONT;
    this.taunt = { lines: wrap(c, text, PF_X - 22), hold, firm };
  }

  _sayVolley() {
    const n = TAUNTS.volley.length;
    this._tauntI = (this._tauntI + 1 + Math.floor(this._rnd() * (n - 1))) % n;
    this._say(TAUNTS.volley[this._tauntI]);
  }

  // The bug quota is met: whatever is still on screen scatters, the client walks in.
  _announceBoss() {
    this.state = 'boss';
    for (const bug of this.bugs) this._explode(bug.x, bug.y, bug.ty.col, 7);
    this.bugs = [];
    this.boss = { x: PF_X + PF_W / 2, y: -30, vx: 84, hp: BOSS_HP, shootCd: 0.8, burstCd: 1.6, intro: INTRO_T, said: 0 };
    this._tauntI = 0;
    this._say(TAUNTS.arrive, { hold: INTRO_T + 1.5 });
  }

  // The deadline ran out. The first time, the client grants a "continue?".
  _deadline() {
    if (this.extUsed) { this._finish(false, 'deadline'); return; }
    this._resume = this.state;
    this.state = 'offer';
    this.offerT = OFFER_T;
    this.offerLock = OFFER_LOCK;
  }

  _extend() {
    const penalty = Math.min(this.score, EXTENSION_PENALTY);
    this.extUsed = true;
    this.hp++;
    this.time = EXTENSION_S;
    this.score -= penalty;
    this.bulbs = [];
    this.shield = Math.max(this.shield, 2.5);          // a moment to get back into the game
    this.state = this._resume;
    this._explode(this.px, this.py, '#ffffff', 16);
    this.notice = { text: `PÉNALITÉ DE REPORT : -${penalty} PTS`, t: 2.6 };
  }

  // ── Active gameplay ───────────────────────────────────────────────────────
  update(input, dt, t) {
    dt = Math.min(dt, 0.05);
    const held = input.interact;
    const fireEdge = held && !this._firePrev;
    this._firePrev = held;

    // Particles always animate (used by end screens too).
    for (const p of this.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    this.parts = this.parts.filter(p => p.life > 0);
    if (this.notice && (this.notice.t -= dt) <= 0) this.notice = null;
    if (this.taunt) this.taunt.hold -= dt;

    if (this.state === 'ready') {
      if (fireEdge) this.state = 'play';
      this._draw(t);
      return;
    }

    if (this.state === 'win' || this.state === 'over') {
      this.endLock = Math.max(0, this.endLock - dt);
      if (fireEdge && this.endLock <= 0) this.reset();
      this._draw(t);
      return;
    }

    if (this.state === 'offer') {
      this.offerT -= dt;
      this.offerLock = Math.max(0, this.offerLock - dt);
      if (fireEdge && this.offerLock <= 0) this._extend();
      else if (this.offerT <= 0) this._finish(false, 'deadline');
      this._draw(t);
      return;
    }

    if (this.state === 'delivering') {
      this.deliverP = Math.min(1, this.deliverP + dt / DELIVER_T);
      if (this.deliverP >= 1) this._finish(true);
      this._draw(t);
      return;
    }

    // Deadline (it waits while the client makes its entrance)
    if (!(this.boss && this.boss.intro > 0)) {
      this.time -= dt;
      if (this.time <= 0) { this.time = 0; this._deadline(); this._draw(t); return; }
    }

    // Move + fire
    // Support analog movement from touch joystick (moveX/moveY) or fallback to discrete keys
    let dx = input.moveX;
    let dy = -input.moveY; // moveY is +forward in engine, -up in arcade canvas

    if (Math.abs(dx) < 0.01) {
      const left  = input.rotLeft  || input.strafeLeft;
      const right = input.rotRight || input.strafeRight;
      dx = (right ? 1 : 0) - (left ? 1 : 0);
    }
    if (Math.abs(dy) < 0.01) {
      const up    = input.forward;
      const down  = input.backward;
      dy = (down ? 1 : 0) - (up ? 1 : 0);
    }

    this.px += dx * 160 * dt;
    this.py += dy * 150 * dt;

    this.px = Math.max(PF_X + 14, Math.min(PF_R - 14, this.px));
    this.py = Math.max(PLAYER_MIN_Y, Math.min(PLAYER_Y, this.py));

    // Auto-scroll background (top→bottom) + parallax that drifts with the player.
    this.bgY += 72 * dt;
    this.bgX += ((dx * 10) - this.bgX) * Math.min(1, dt * 4);

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

    // Spawn bugs until the quota is met, then the boss walks in (the bugs left on screen scatter)
    if (this.state === 'play') {
      if (this.killed >= KILL_TARGET) {
        this._announceBoss();
      } else {
        this._spawnCd -= dt;
        if (this._spawnCd <= 0) {
          const ty = pickType(this._rnd());
          this.bugs.push({ x: PF_X + 18 + this._rnd() * (PF_W - 36), y: -10, ty, hp: ty.hp,
            vx: (this._rnd() * 2 - 1) * 40 });
          this._spawnCd = 0.5 + this._rnd() * 0.5;
        }
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
      if (bo.intro > 0) {
        // Making its entrance: slides in from above, can neither shoot nor be shot.
        bo.intro = Math.max(0, bo.intro - dt);
        const u = 1 - bo.intro / INTRO_T;
        bo.y = -30 + 76 * (1 - (1 - u) * (1 - u));
      } else {
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
        // Periodic radial fan downward — the bullet-hell moment (and a new line from the client).
        bo.burstCd -= dt;
        if (bo.burstCd <= 0) {
          const n = 13;
          for (let i = 0; i < n; i++) {
            const a = Math.PI * 0.13 + Math.PI * 0.74 * (i / (n - 1));
            this.bulbs.push({ x: bo.x, y: bo.y + 14, vx: Math.cos(a) * 58, vy: Math.sin(a) * 58 + 18 });
          }
          bo.burstCd = 2.6;
          this._sayVolley();
        }
        for (const b of this.bullets) if (!b.dead && Math.abs(b.x - bo.x) < 24 && Math.abs(b.y - bo.y) < 20) {
          b.dead = true; bo.hp--; this.score += 5;
        }
        if (bo.said < TAUNTS.hp.length && bo.hp / BOSS_HP <= TAUNTS.hp[bo.said][0]) this._say(TAUNTS.hp[bo.said++][1], { hold: 3.2, firm: true });
        if (bo.hp <= 0) {
          this.state = 'delivering'; this.deliverP = 0; this.score += 250; this._explode(bo.x, bo.y, '#ffb52e', 28); this.boss = null;
          this._say(TAUNTS.delivered, { hold: 99, firm: true });
        }
      }
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
    this._settle();
    const c = this._ctx;
    c.fillStyle = '#05060a'; c.fillRect(0, 0, W, H);
    this._stars(t);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#ff2a9d'; c.font = '26px ' + FONT;
    c.fillText('BUG HUNTER', W / 2, 95);
    c.font = '34px serif';
    c.fillText('🤓  🐞 🪲 🤯 🧠', W / 2, 150);
    if (blink(t)) {
      c.fillStyle = '#37ffe0'; c.font = '12px ' + FONT;
      c.fillText(this._hint.coin, W / 2, 215);
    }
    if (this.hi > 0) {
      c.fillStyle = '#ffd23a'; c.font = '9px ' + FONT;
      c.fillText('RECORD  ' + this.hi, W / 2, 252);
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

    // Rainbow shield (blinks during its final 2 s before fading; steady and not cycling under reduced motion)
    const calm = prefs.reducedMotion;
    if (this.shield > 0 && (calm || this.shield > 2 || Math.floor(t * 10) % 2 === 0)) {
      const off = calm ? 0 : Math.floor(t * 6);
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

    // Overlays for the boss entrance, delivery, the "continue?" offer and the end states
    if (this.boss && this.boss.intro > 0) this._bossBanner(c, t);
    if (this.notice) this._noticeStrip(c);
    if (this.state === 'delivering') this._delivering(c, t);
    else if (this.state === 'offer') this._offerScreen(c, t);
    else if (this.state === 'win' || this.state === 'over') this._endScreen(c, t);
    else if (this.state === 'ready') this._readyScreen(c, t);

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

  // Side panels — deadline + client (left), score + record + lives (right).
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
    if (this.taunt && (this.state === 'boss' || this.state === 'delivering' || this.state === 'win')) this._clientSays(c);

    // Right
    const rx = PF_R + (W - PF_R) / 2;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#888'; c.font = '8px ' + FONT;
    c.fillText('SCORE', rx, 40);
    c.fillStyle = '#fff'; c.font = '15px ' + FONT;
    c.fillText(this.score, rx, 64);
    if (this.hi > 0) {
      c.fillStyle = '#8a7a2a'; c.font = '7px ' + FONT;
      c.fillText('RECORD', rx, 90);
      c.fillStyle = '#ffd23a'; c.font = '9px ' + FONT;
      c.fillText(Math.max(this.hi, this.score), rx, 104);
    }
    c.fillStyle = '#888'; c.font = '8px ' + FONT;
    c.fillText('VIES', rx, 130);
    c.fillStyle = '#ff2a9d'; c.font = '16px serif';
    c.fillText('❤'.repeat(Math.max(0, this.hp)) || '—', rx, 150);
    c.fillStyle = '#444'; c.font = '6px ' + FONT;
    c.fillText(this._hint.move, rx, H - 48);
    c.fillText(this._hint.fire, rx, H - 34);
    c.fillText(this._hint.quit, rx, H - 20);
  }

  // The client's speech box, in the free part of the left panel.
  _clientSays(c) {
    const bx = 5, by = 220, bw = PF_X - 10, bh = 76;     // below the overlay bands (which end at H/2 + 62)
    c.fillStyle = 'rgba(40,18,0,0.88)'; c.fillRect(bx, by, bw, bh);
    c.strokeStyle = '#ff8c00'; c.lineWidth = 1; c.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillStyle = '#ff8c00'; c.font = '7px ' + FONT;
    c.fillText('LE CLIENT', bx + 7, by + 7);
    c.fillStyle = '#ffd9a0'; c.font = '8px ' + FONT;
    this.taunt.lines.forEach((line, i) => c.fillText(line, bx + 7, by + 25 + i * 13));
    c.textAlign = 'center'; c.textBaseline = 'middle';
  }

  // "LE CLIENT ARRIVE": a hazard-striped band across the screen while the boss slides in.
  _bossBanner(c, t) {
    const y0 = H / 2 - 34, h = 68;
    c.fillStyle = 'rgba(0,0,0,0.82)'; c.fillRect(0, y0, W, h);
    const shift = prefs.reducedMotion ? 0 : (t * 40) % 24;
    c.fillStyle = '#ff8c00';
    for (const sy of [y0, y0 + h - 5]) {
      for (let x = -24 + shift; x < W; x += 24) { c.fillRect(x, sy, 12, 5); }
    }
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#ff8c00'; c.font = '20px ' + FONT;
    c.fillText('LE CLIENT ARRIVE', W / 2, H / 2 - 6);
    c.fillStyle = '#ffd9a0'; c.font = '8px ' + FONT;
    c.fillText('UNE PETITE MODIF EN APPROCHE', W / 2, H / 2 + 20);
  }

  // A one-line message across the middle (the extension's penalty).
  _noticeStrip(c) {
    c.fillStyle = 'rgba(0,0,0,0.82)'; c.fillRect(0, H / 2 - 14, W, 28);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#ffdd33'; c.font = '9px ' + FONT;
    c.fillText(this.notice.text, W / 2, H / 2);
  }

  _readyScreen(c, t) {
    c.fillStyle = 'rgba(0,0,0,0.8)'; c.fillRect(0, H / 2 - 62, W, 124);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#ffdd33'; c.font = '13px ' + FONT;
    c.fillText('CORRIGEZ TOUS LES BUGS', W / 2, H / 2 - 36);
    c.fillText('AVANT LA DEADLINE', W / 2, H / 2 - 14);
    if (blink(t)) {
      c.fillStyle = '#37ffe0'; c.font = '10px ' + FONT;
      c.fillText('TIREZ POUR COMMENCER', W / 2, H / 2 + 16);
    }
    if (this.hi > 0) {
      c.fillStyle = '#ffd23a'; c.font = '8px ' + FONT;
      c.fillText('RECORD  ' + this.hi, W / 2, H / 2 + 42);
    }
  }

  _delivering(c, t) {
    c.fillStyle = 'rgba(0,0,0,0.78)'; c.fillRect(0, H / 2 - 46, W, 92);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#37ffe0'; c.font = '11px ' + FONT;
    const dots = '.'.repeat(prefs.reducedMotion ? 3 : 1 + (Math.floor(t * 3) % 3));
    c.fillText('LIVRAISON DU PROJET EN COURS' + dots, W / 2, H / 2 - 18);
    const bw = 300, bx = (W - bw) / 2, by = H / 2 + 6;
    c.strokeStyle = '#37ffe0'; c.lineWidth = 2; c.strokeRect(bx, by, bw, 16);
    c.fillStyle = '#37ffe0'; c.fillRect(bx + 2, by + 2, (bw - 4) * this.deliverP, 12);
    c.fillStyle = '#fff'; c.font = '8px ' + FONT;
    c.fillText(Math.round(this.deliverP * 100) + '%', W / 2, by + 30);
  }

  // "Continue?": the deadline has passed; one extension is on offer, with a countdown.
  _offerScreen(c, t) {
    c.fillStyle = 'rgba(0,0,0,0.84)'; c.fillRect(0, H / 2 - 62, W, 124);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#ff2a9d'; c.font = '16px ' + FONT;
    c.fillText('DEADLINE DÉPASSÉE', W / 2, H / 2 - 40);
    const ready = this.offerLock <= 0;
    if (ready && blink(t)) {
      c.fillStyle = '#37ffe0'; c.font = '11px ' + FONT;
      c.fillText(`${this._hint.act} DEMANDER UN REPORT`, W / 2, H / 2 - 14);
    }
    c.fillStyle = '#ffdd33'; c.font = '8px ' + FONT;
    c.fillText(`+1 VIE   +${EXTENSION_S} S   -${Math.min(this.score, EXTENSION_PENALTY)} PTS`, W / 2, H / 2 + 8);
    c.fillStyle = '#fff'; c.font = '9px ' + FONT;
    c.fillText('SCORE  ' + this.score, W / 2, H / 2 + 28);
    c.fillStyle = '#666'; c.font = '7px ' + FONT;
    c.fillText(`${this._hint.exit} POUR ABANDONNER`, W / 2, H / 2 + 48);
    c.fillStyle = '#ff8c00'; c.font = '22px ' + FONT;
    c.fillText(Math.max(0, Math.ceil(this.offerT)), W - 48, H / 2 - 14);
  }

  _endScreen(c, t) {
    const win = this.state === 'win';
    c.fillStyle = 'rgba(0,0,0,0.78)'; c.fillRect(0, H / 2 - 62, W, 124);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = win ? '#37ffe0' : '#ff2a9d'; c.font = '16px ' + FONT;
    c.fillText(win ? 'PROJET LIVRÉ !' : (this.overReason === 'deadline' ? 'DEADLINE DÉPASSÉE' : 'GAME OVER'), W / 2, H / 2 - 38);
    c.fillStyle = '#fff'; c.font = '10px ' + FONT;
    c.fillText('SCORE  ' + this.score, W / 2, H / 2 - 12);
    if (this.newRecord) {
      c.fillStyle = '#ffd23a'; c.font = '10px ' + FONT;
      if (blink(t)) c.fillText('NOUVEAU RECORD !', W / 2, H / 2 + 12);
    } else {
      c.fillStyle = '#ffd23a'; c.font = '8px ' + FONT;
      c.fillText('RECORD  ' + this.hi, W / 2, H / 2 + 12);
    }
    if (blink(t)) {
      c.fillStyle = '#888'; c.font = '8px ' + FONT;
      c.fillText(`${this._hint.act} REJOUER    ${this._hint.exit} SORTIR`, W / 2, H / 2 + 42);
    }
  }
}
