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
    document.addEventListener('pointerlockchange', () => {
      this._pointerLocked = document.pointerLockElement === canvas;
    });
    document.addEventListener('mousemove', e => {
      if (this._pointerLocked) this.mouseDX += e.movementX;
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
