export class Input {
  constructor(canvas) {
    this.forward = false;
    this.backward = false;
    this.rotLeft = false;
    this.rotRight = false;
    this.strafeLeft = false;
    this.strafeRight = false;
    this.interact = false;
    this.mouseDX = 0;
    this._pointerLocked = false;

    window.addEventListener('keydown', e => this._onKey(e, true));
    window.addEventListener('keyup',   e => this._onKey(e, false));

    canvas.addEventListener('click', () => canvas.requestPointerLock());
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
        if (down && !this.interact) this.interact = true;
        if (!down) this.interact = false;
        break;
    }
  }

  consumeInteract() {
    const v = this.interact;
    this.interact = false;
    return v;
  }
}
