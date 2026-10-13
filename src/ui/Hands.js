// First-person viewmodel: a pixel-art coffee mug held in the right hand.
// The mug+hand is a sprite (white background already stripped to alpha).
// Steam is procedural — chunky square particles in the same style as the
// arcade-game explosions. A click "drinks" (raise + tilt, steam pauses).
// Turning gives the mug a little inertia: it lags behind (slight slide + roll about the
// wrist) and settles back, like a heavy object held at arm's length.

import { prefs } from '../engine/prefs.js';
import { events } from '../engine/Events.js';

const CW = 300, CH = 264;           // canvas backing size
const MUG_W = 258;                   // mug sprite drawn width (px in canvas)
const RIM_FX = 0.17, RIM_FY = 0.055; // rim centre as a fraction of the sprite
const SMOKE_COLS = ['#e6e6e6', '#c2c2c2', '#9a9a9a', '#787878'];

// Turn inertia. The sway is a damped spring (normalised -1..1) chasing the turn rate;
// slide and roll are tiny on purpose, and the roll pivots on the wrist (bottom right of
// the canvas) so the arm stays anchored off-screen and no gap can show on small screens.
const TURN_REF   = 2.6;            // rad/s that gives full lag (keyboard turn is 2.4)
const SWAY_K     = 150;            // spring stiffness (ω ≈ 12 rad/s)
const SWAY_C     = 13;             // damping (ζ ≈ 0.55: one gentle overshoot, then settled)
const LAG_X      = 0.8;            // slide at full lag, % of the viewmodel width
const LAG_ROLL   = 0.9;            // roll at full lag, degrees
const WRIST_X    = 91, WRIST_Y = 100;   // roll pivot, % of the canvas

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
    this._focusY = 0;    // vertical offset for focus (0 = visible, 1 = hidden)

    this._lastAngle = null;
    this._turn = 0;      // smoothed turn rate (rad/s, + = turning right)
    this._sway = 0;      // spring position (- = mug trails to the left)
    this._swayV = 0;
    this._wristX = 0;    // roll pivot relative to the transform origin (% of canvas)
    this._wristY = 0;
  }

  _layout() {
    const ar = this._img.height / this._img.width;
    this._mw = MUG_W;
    this._mh = MUG_W * ar;
    this._dx = CW - this._mw;          // anchored bottom-right
    this._dy = CH - this._mh;
    this._rimX = this._dx + RIM_FX * this._mw;
    this._rimY = this._dy + RIM_FY * this._mh;
    this._wristX = WRIST_X - (this._rimX / CW) * 100;
    this._wristY = WRIST_Y - (this._rimY / CH) * 100;
  }

  // Emits 'sip' (no payload) each time a drink actually starts: a click during the animation does not count.
  drink() {
    if (this._drink !== 0) return;
    this._drink = 0.0001;
    events.emit('sip');
  }

  // Spring chasing the (smoothed) turn rate; reduced motion keeps the mug rigid.
  _inertia(player, dt) {
    const a = player.angle;
    let da = this._lastAngle === null ? 0 : a - this._lastAngle;
    this._lastAngle = a;
    if (da > Math.PI) da -= Math.PI * 2; else if (da < -Math.PI) da += Math.PI * 2;
    if (prefs.reducedMotion) { this._turn = this._sway = this._swayV = 0; return; }

    if (dt <= 0) return;
    const rate = Math.max(-2 * TURN_REF, Math.min(2 * TURN_REF, da / dt));   // a teleport must not kick the spring
    const h = Math.min(dt, 0.05);                      // keeps the explicit spring stable
    this._turn += (rate - this._turn) * (1 - Math.exp(-h * 18));
    const target = -Math.max(-1, Math.min(1, this._turn / TURN_REF));
    this._swayV += (SWAY_K * (target - this._sway) - SWAY_C * this._swayV) * h;
    this._sway += this._swayV * h;
  }

  _rnd() { this._seed = (this._seed * 1103515245 + 12345) & 0x7fffffff; return this._seed / 0x7fffffff; }

  update(player, dt, t, focused = false) {
    // Smooth transition for focus hiding (lower the mug when focused)
    const targetFocus = focused ? 1 : 0;
    this._focusY += (targetFocus - this._focusY) * (1 - Math.pow(0.001, dt)); // dt-independent smoothing

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
        zoom = 1 + curve * 1.2; // 1x to 2.2x zoom (reduced from 3.2x)
        tilt = curve * 5;
      } else if (p < T_RAISE + T_HOLD) {
        // Phase 2: Sip & Shake (Ultra-smooth subtle breathing)
        const u = (p - T_RAISE) / T_HOLD;
        const sips = Math.sin(u * Math.PI * 2.0); 
        raise = 1.0 + sips * 0.01;
        zoom = 2.2 + sips * 0.02; // max zoom 2.2x
        tilt = 13 + sips * 1;
        shake = Math.sin(t * 70) * 2;
      } else if (p < TOTAL) {
        // Phase 3: Drop back
        const u = (p - (T_RAISE + T_HOLD)) / T_DROP;
        const curve = 1.0 - (u * (2 - u)); 
        raise = curve;
        zoom = 1 + curve * 1.2;
        tilt = curve * 5;
      } else {
        this._drink = 0;
      }
    }

    // Correct transform-origin: rim position as percentage of the total canvas (300x264)
    const rimXpct = (this._rimX / CW) * 100;
    const rimYpct = (this._rimY / CH) * 100;
    this._el.style.transformOrigin = `${rimXpct}% ${rimYpct}%`;

    // Centering logic: calculate translation to bring the rim towards screen center.
    const tx = -240 * raise; 
    const ty = -40 * raise; 
    const tz = 300 * raise; // Reduced depth (300 instead of 450)

    // Turn inertia, faded out while the mug is raised or lowered for a console.
    this._inertia(player, dt);
    const calm = Math.max(0, 1 - raise) * (1 - this._focusY);
    const lag  = this._sway * calm;

    // Head-bob sway
    const amp = player._bobAmp ?? 0;
    const bx = Math.sin(player._bob * 0.5) * 9 * amp + shake;
    const by = Math.abs(Math.sin(player._bob)) * -7 * amp + (this._focusY * 250); // Translate down when focused
    
    // Final transform with inverted and subtler 3D perspective
    // - rotateX(tilt * 1.5): tilts the bottom of the mug AWAY from the camera (inverse)
    // - translate3d: uses tz for real depth
    // - translateX / the wrist-pivoted rotateZ at both ends carry the turn inertia
    this._el.style.transform =
      `translateX(${lag * LAG_X}%) translate3d(${bx + tx}px, ${by + ty}px, ${tz}px) scale(${zoom}) rotateZ(${-tilt}deg) rotateX(${tilt * 1.5}deg) skewX(${-tilt * 0.1}deg) ` +
      `translate(${this._wristX}%, ${this._wristY}%) rotateZ(${lag * LAG_ROLL}deg) translate(${-this._wristX}%, ${-this._wristY}%)`;

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
