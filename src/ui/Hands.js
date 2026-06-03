// First-person viewmodel: a pixel-art coffee mug held in the right hand.
// The mug+hand is a sprite (white background already stripped to alpha).
// Steam is procedural — chunky square particles in the same style as the
// arcade-game explosions. A click "drinks" (raise + tilt, steam pauses).

const CW = 300, CH = 264;           // canvas backing size
const MUG_W = 258;                   // mug sprite drawn width (px in canvas)
const RIM_FX = 0.17, RIM_FY = 0.055; // rim centre as a fraction of the sprite
const SMOKE_COLS = ['#e6e6e6', '#c2c2c2', '#9a9a9a', '#787878'];

export class Hands {
  constructor(container) {
    const c = document.createElement('canvas');
    c.width = CW; c.height = CH;
    c.id = 'viewmodel';
    container.appendChild(c);
    this._ctx = c.getContext('2d');
    this._ctx.imageSmoothingEnabled = false;
    this._el = c;

    this._img = new Image();
    this._ready = false;
    this._img.onload = () => { this._ready = true; this._layout(); };
    this._img.src = '/hud/hand_mug.png';

    this._drink = 0;     // 0 = idle, else seconds into the drink animation
    this._parts = [];    // steam particles
    this._emit = 0;      // emitter accumulator
    this._seed = 1;      // deterministic-ish wobble
  }

  _layout() {
    const ar = this._img.height / this._img.width;
    this._mw = MUG_W;
    this._mh = MUG_W * ar;
    this._dx = CW - this._mw;          // anchored bottom-right
    this._dy = CH - this._mh;
    this._rimX = this._dx + RIM_FX * this._mw;
    this._rimY = this._dy + RIM_FY * this._mh;
  }

  drink() { if (this._drink === 0) this._drink = 0.0001; }

  _rnd() { this._seed = (this._seed * 1103515245 + 12345) & 0x7fffffff; return this._seed / 0x7fffffff; }

  update(player, dt, t) {
    // Drink animation (Punchy 3-phase sequence with massive zoom)
    let raise = 0, tilt = 0, shake = 0, zoom = 1;
    if (this._drink > 0) {
      this._drink += dt;
      const T_RAISE = 0.22; // Quick approach
      const T_HOLD  = 0.40; // Sip
      const T_DROP  = 0.35; // Return
      const TOTAL   = T_RAISE + T_HOLD + T_DROP;
      
      const p = this._drink;

      if (p < T_RAISE) {
        // Phase 1: Zoom in & Snap up
        const u = p / T_RAISE;
        const curve = u * (2 - u); // ease-out
        raise = curve;
        zoom = 1 + curve * 2.2; // 1x to 3.2x zoom
        tilt = curve * 5; // very slight tilt
      } else if (p < T_RAISE + T_HOLD) {
        // Phase 2: Sip & Shake
        const u = (p - T_RAISE) / T_HOLD;
        raise = 1.0;
        zoom = 3.2 + Math.sin(u * Math.PI) * 0.3; // breath-like zoom pulse
        tilt = 5 + Math.sin(u * Math.PI) * 8; // slight tilt during sip
        shake = Math.sin(t * 70) * 3; // micro-tremble
      } else if (p < TOTAL) {
        // Phase 3: Drop back
        const u = (p - (T_RAISE + T_HOLD)) / T_DROP;
        const curve = 1.0 - (u * u); // ease-in
        raise = curve;
        zoom = 1 + curve * 2.2;
        tilt = curve * 5;
      } else {
        this._drink = 0;
      }
    }

    // Centering logic: calculate translation to bring the rim to mouth level (center-ish)
    // Target is roughly center-x and 55% down the screen.
    const targetX = CW / 2;
    const targetY = CH * 0.55;
    const tx = (targetX - this._rimX) * raise;
    const ty = (targetY - this._rimY) * raise;

    // Head-bob sway
    const amp = player._bobAmp ?? 0;
    const bx = Math.sin(player._bob * 0.5) * 9 * amp + shake;
    const by = Math.abs(Math.sin(player._bob)) * -7 * amp;
    
    // transform-origin is set to the rim (see _layout)
    this._el.style.transformOrigin = `${RIM_FX * 100}% ${RIM_FY * 100}%`;

    // Translation (bob + centering) + Scale + Rotation
    this._el.style.transform =
      `translate(${bx + tx}px, ${by + ty}px) scale(${zoom}) rotate(${-tilt}deg)`;

    this._step(dt, raise);
    this._draw();
  }

  // Spawn + advance steam particles (chunky squares, arcade-explosion style).
  _step(dt, raise) {
    if (this._ready && raise < 0.25) {
      this._emit += dt;
      const period = 0.06;
      while (this._emit >= period) {
        this._emit -= period;
        const ox = (this._rnd() * 2 - 1) * 14;
        this._parts.push({
          x: this._rimX + ox,
          y: this._rimY,
          vx: ox * 0.4,                       // splay outward
          vy: -(18 + this._rnd() * 16),       // rise
          wob: this._rnd() * 6.28,
          life: 1.3 + this._rnd() * 0.7,
          max: 2.0,
          sz: 5 + (this._rnd() * 3 | 0),
          col: SMOKE_COLS[this._rnd() * SMOKE_COLS.length | 0],
        });
      }
    }
    for (const p of this._parts) {
      p.life -= dt;
      p.x += (p.vx + Math.sin(p.life * 3 + p.wob) * 8) * dt;
      p.y += p.vy * dt;
      p.vy *= (1 - dt * 0.4);                  // slow as it rises
    }
    this._parts = this._parts.filter(p => p.life > 0);
  }

  _draw() {
    const c = this._ctx;
    c.clearRect(0, 0, CW, CH);
    if (!this._ready) return;

    // Steam behind the mug rim — chunky squares, fade + shrink with life.
    for (const p of this._parts) {
      const k = p.life / p.max;
      c.globalAlpha = Math.max(0, Math.min(0.7, k * 0.7));
      c.fillStyle = p.col;
      const s = Math.max(2, p.sz * (0.5 + k * 0.5)) | 0;
      c.fillRect((p.x - s / 2) | 0, (p.y - s / 2) | 0, s, s);
    }
    c.globalAlpha = 1;

    c.drawImage(this._img, this._dx, this._dy, this._mw, this._mh);
  }
}
