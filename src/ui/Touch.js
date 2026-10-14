// Touch controls — a virtual movement stick (lower-left), drag-to-look on the
// right half, and a contextual action button (lower-right) plus an exit button
// while a screen is focused. Shown only on touch devices. It writes into the
// shared Input object using the very same flags the keyboard/mouse set, so the
// rest of the engine stays unaware that a finger — not a key — drove it.

const isTouch = typeof window !== 'undefined' &&
  ('ontouchstart' in window || navigator.maxTouchPoints > 0);

const STICK_R   = 56;     // max knob travel from the base (px)
const DEAD      = 0.22;   // deadzone as a fraction of the stick radius
const LOOK_SENS = 2.5;    // drag px → yaw
const LOOK_SENS_Y = 1.6;  // drag px → pitch (the vertical field of view is narrow: gentler)

export class TouchControls {
  constructor(container, input) {
    this.enabled = isTouch;
    this.input = input;
    if (!this.enabled) return;

    document.body.classList.add('is-touch');

    const root = document.createElement('div');
    root.id = 'touch-controls';
    container.appendChild(root);
    this._root = root;

    // Dynamic joystick — base appears where the finger lands in the left half.
    this._base = document.createElement('div'); this._base.className = 'tc-stick-base';
    this._knob = document.createElement('div'); this._knob.className = 'tc-stick-knob';
    this._base.appendChild(this._knob);
    root.appendChild(this._base);
    this._base.style.display = 'none';

    // Lower-right action (tap = interact / hold = fire) and top-right exit.
    this._action = this._mkButton('tc-action', () => this._setInteract(true), () => this._setInteract(false), null, 'Interagir');
    this._exit   = this._mkButton('tc-exit', () => this._sendEscape(), null, '✕', 'Quitter');
    // Console paging — rotLeft/rotRight are unused by the stick and edge-detected
    // by the console, so each tap flips exactly one page.
    this._prev = this._mkButton('tc-page tc-prev', () => this._setPage('prev', true), () => this._setPage('prev', false), '◂', 'Page précédente');
    this._next = this._mkButton('tc-page tc-next', () => this._setPage('next', true), () => this._setPage('next', false), '▸', 'Page suivante');
    // Opens the outbound link of the console page on screen (store, site, mail…).
    this._open = this._mkButton('tc-open', () => this.input.press('enter'), null, 'OUVRIR ↗', 'Ouvrir le lien');
    for (const b of [this._action, this._exit, this._prev, this._next, this._open]) b.style.display = 'none';

    this._state  = -1;     // last state applied by update() (it runs every frame)
    this._moveId = null;   // touch identifier driving the joystick
    this._lookId = null;   // touch identifier driving look
    this._lookX  = 0;
    this._lookY  = 0;
    input.autoLevel = true;   // no Home key on a phone: the view levels itself when the finger rests

    root.addEventListener('touchstart',  e => this._onStart(e), { passive: false });
    root.addEventListener('touchmove',   e => this._onMove(e),  { passive: false });
    root.addEventListener('touchend',    e => this._onEnd(e),   { passive: false });
    root.addEventListener('touchcancel', e => this._onEnd(e),   { passive: false });
    root.addEventListener('contextmenu', e => e.preventDefault());   // long-press on the stick

    // The OS does not always deliver touchend when the page is backgrounded or a
    // system dialog takes over mid-drag: without this the stick would stay pulled.
    window.addEventListener('blur', () => this._release());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this._release(); });
  }

  _mkButton(cls, onDown, onUp, label, aria) {
    const b = document.createElement('button');
    b.className = 'tc-btn ' + cls;
    b.setAttribute('aria-label', aria);
    if (label) b.textContent = label;
    b.addEventListener('touchstart', e => {
      e.preventDefault(); e.stopPropagation(); b.classList.add('on'); onDown && onDown();
    }, { passive: false });
    const up = e => { e.preventDefault(); e.stopPropagation(); b.classList.remove('on'); onUp && onUp(); };
    b.addEventListener('touchend', up, { passive: false });
    b.addEventListener('touchcancel', up, { passive: false });
    this._root.appendChild(b);
    return b;
  }

  // Drop every held control (stick, look, buttons) as if all fingers were lifted.
  _release() {
    this._moveId = null;
    this._lookId = null;
    this._base.style.display = 'none';
    this._applyMove(0, 0);
    this._setInteract(false);
    this._setPage('prev', false);
    this._setPage('next', false);
    for (const b of this._root.querySelectorAll('.tc-btn.on')) b.classList.remove('on');
  }

  _setInteract(v) { this.input.interact = v; }
  _setPage(which, v) { if (which === 'prev') this.input.rotLeft = v; else this.input.rotRight = v; }

  // Raise the escape flag ScreenManager consumes to leave a focused screen.
  _sendEscape() { this.input.escape = true; }

  _onStart(e) {
    e.preventDefault();
    const w = window.innerWidth;
    for (const t of e.changedTouches) {
      if (t.clientX < w / 2 && this._moveId === null) {
        this._moveId = t.identifier;
        this._baseX = t.clientX; this._baseY = t.clientY;
        this._base.style.left = t.clientX + 'px';
        this._base.style.top  = t.clientY + 'px';
        this._base.style.display = 'block';
        this._knob.style.transform = 'translate(-50%, -50%)';
      } else if (this._lookId === null) {
        this._lookId = t.identifier;
        this._lookX = t.clientX;
        this._lookY = t.clientY;
      }
    }
  }

  _onMove(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === this._moveId) {
        const dx = t.clientX - this._baseX, dy = t.clientY - this._baseY;
        const len = Math.hypot(dx, dy) || 1;
        const cl = Math.min(len, STICK_R);
        const ux = dx / len, uy = dy / len;            // direction
        this._knob.style.transform = `translate(calc(-50% + ${ux * cl}px), calc(-50% + ${uy * cl}px))`;
        // Pull fraction past the deadzone, rescaled to 0→1 → analog speed.
        const pull = cl / STICK_R;
        const mag = pull < DEAD ? 0 : (pull - DEAD) / (1 - DEAD);
        this._applyMove(ux * mag, uy * mag);
      } else if (t.identifier === this._lookId) {
        this.input.mouseDX += (t.clientX - this._lookX) * LOOK_SENS;
        this.input.mouseDY += (t.clientY - this._lookY) * LOOK_SENS_Y;
        this._lookX = t.clientX;
        this._lookY = t.clientY;
      }
    }
  }

  _onEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === this._moveId) {
        this._moveId = null;
        this._base.style.display = 'none';
        this._applyMove(0, 0);
      } else if (t.identifier === this._lookId) {
        this._lookId = null;
      }
    }
  }

  // nx, ny are direction × analog magnitude (already deadzoned), screen-space.
  _applyMove(nx, ny) {
    const i = this.input;
    i.moveX = nx;          // strafe  (+ right)
    i.moveY = -ny;         // forward (+ forward); screen-down (+y) = backward
    // Boolean mirrors for systems that read on/off (arcade ship, console paging).
    const d = 0.04;
    i.strafeLeft  = nx < -d;
    i.strafeRight = nx >  d;
    i.forward     = ny < -d;
    i.backward    = ny >  d;
  }

  // Called each frame with the current interaction context; touches the DOM only when
  // that context changed.
  update({ prompt, focused, kind, hasLink = false }) {
    if (!this.enabled) return;
    const inConsole = focused && kind === 'console';
    const inArcade = focused && kind === 'arcade';
    // Show action button if: arcade is active, or we have an interaction prompt.
    // Hide it on data consoles as requested.
    const showAction = inArcade || (!focused && !!prompt);

    const state = (focused ? 1 : 0) | (inConsole ? 2 : 0) | (inArcade ? 4 : 0) | (showAction ? 8 : 0) | (hasLink ? 16 : 0);
    if (state === this._state) return;
    this._state = state;

    this._exit.style.display   = focused ? 'flex' : 'none';
    this._action.style.display = showAction ? 'flex' : 'none';
    this._prev.style.display   = inConsole ? 'flex' : 'none';
    this._next.style.display   = inConsole ? 'flex' : 'none';
    this._open.style.display   = inConsole && hasLink ? 'flex' : 'none';

    if (showAction) {
      this._action.textContent = inArcade ? 'TIR' : '🖐️';
      this._action.setAttribute('aria-label', inArcade ? 'Tirer' : 'Interagir');
    }
  }
}
