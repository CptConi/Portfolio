const LOOK_SETTLE_MS = 150;   // mouse movement ignored this long after a pointer lock / window focus
const LOOK_SPIKE = 350;       // px: a single mouse event beyond this (0.7 rad, ~40°) is a glitch, not a gesture

export class Input {
  constructor(canvas) {
    this.forward = false;
    this.backward = false;
    this.rotLeft = false;
    this.rotRight = false;
    this.strafeLeft = false;
    this.strafeRight = false;
    this.moveX = 0;   // analog strafe  (-1 left … +1 right)
    this.moveY = 0;   // analog forward (-1 back … +1 forward)
    this.interact = false;
    this.escape = false;       // set by touch exit button; consumed by ScreenManager
    this.mouseDX = 0;
    this.mouseDY = 0;          // vertical look: down is +, like movementY (touch drags feed it too)
    this.lookUp = false;       // PageUp / PageDown look keys
    this.lookDown = false;
    this.autoLevel = false;    // touch screens: the view levels itself again when the finger rests (Touch.js)
    this._pointerLocked = false;
    this.lockOnClick = true;   // disabled while a screen is focused (mouse stays free)

    // Layout-aware one-shot keys (e.key, lower-cased): 'c', 'm', 'r', 'enter'…
    // Movement stays positional (e.code) so WASD and ZQSD share the same keys.
    this._edges = new Set();

    window.addEventListener('keydown', e => {
      if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) this._edges.add(e.key.toLowerCase());
      this._onKey(e, true);
    });
    window.addEventListener('keyup',   e => this._onKey(e, false));

    canvas.addEventListener('click', () => {
      if (this.lockOnClick) try { canvas.requestPointerLock()?.catch?.(() => {}); } catch {}
    });
    // Browsers (Chromium above all) can report a huge, erratic movementX: right after the pointer is
    // locked again (the cursor is re-centred, so the first event carries the distance it travelled),
    // when the window regains the focus, or at random. Applied as is, it spins the view, typically
    // each time a dialog or a console gives the pointer back. Such events are dropped.
    this._settleUntil = 0;
    this._dropNext = false;
    const settle = () => { this._settleUntil = performance.now() + LOOK_SETTLE_MS; this._dropNext = true; };
    document.addEventListener('pointerlockchange', () => {
      this._pointerLocked = document.pointerLockElement === canvas;
      if (this._pointerLocked) settle();
    });
    window.addEventListener('focus', settle);
    document.addEventListener('mousemove', e => {
      if (!this._pointerLocked) return;
      const dx = e.movementX, dy = e.movementY || 0, now = performance.now();
      const big = Math.max(Math.abs(dx), Math.abs(dy));
      const dropped = now < this._settleUntil || big > LOOK_SPIKE || this._dropNext;
      if (import.meta.env?.DEV && big > 120) {
        console.warn(`[input] mouse step ${dx},${dy}px ${dropped ? 'dropped' : 'kept'}, ${Math.round(now - (this._settleUntil - LOOK_SETTLE_MS))} ms after the last lock/focus`);
      }
      if (now >= this._settleUntil) this._dropNext = false;   // only the first event after the settle window goes
      if (!dropped) { this.mouseDX += dx; this.mouseDY += dy; }
    });
  }

  _onKey(e, down) {
    switch (e.code) {
      case 'ArrowUp':   case 'KeyW': this.forward    = down; break;
      case 'ArrowDown': case 'KeyS': this.backward   = down; break;
      case 'ArrowLeft':              this.rotLeft     = down; break;
      case 'ArrowRight':             this.rotRight    = down; break;
      case 'KeyA':                   this.strafeLeft  = down; break;
      case 'KeyD':                   this.strafeRight = down; break;
      case 'PageUp':                 this.lookUp      = down; break;
      case 'PageDown':               this.lookDown    = down; break;
      case 'KeyE': case 'Space':
        // A held key stays "down" without re-arming: its auto-repeat must not fire a second action
        // (a console would open and close in a loop for as long as E is held).
        if (down && !e.repeat && !this.interact) this.interact = true;
        if (!down) this.interact = false;
        break;
    }
    // Keyboard drives the analog axes at full magnitude; the touch stick
    // overwrites them with a fractional pull (see TouchControls).
    this.moveY = (this.forward ? 1 : 0) - (this.backward ? 1 : 0);
    this.moveX = (this.strafeRight ? 1 : 0) - (this.strafeLeft ? 1 : 0);
  }

  consumeInteract() {
    const v = this.interact;
    this.interact = false;
    return v;
  }

  // True once per physical press of `key` (e.key, lower-case); touch buttons call press().
  consumeKey(key) { return this._edges.delete(key); }
  press(key) { this._edges.add(key); }
  clearKeys() { this._edges.clear(); }
}
