// Doom-style status bar — canvas 320×32 (native STBAR resolution), CSS-scaled.
// Sprites from Freedoom (CC0).

const W = 320, H = 32;

const HP_X  = 90;   // health right-aligned
const ARM_X = 221;  // armor  right-aligned
const NUM_Y = 3;
const NUM_W = 13, NUM_H = 16;
const FACE_X = 143, FACE_Y = 0;

const SPRITES = [
  'STBAR', 'STFB0',
  'STFST00', 'STFST01', 'STFST02', 'STFGOD0', 'STFOUCH0',
  ...Array.from({ length: 10 }, (_, i) => `STTNUM${i}`),
];

export class HUD {
  constructor(container) {
    this._canvas = document.createElement('canvas');
    this._canvas.width  = W;
    this._canvas.height = H;
    this._canvas.id = 'hud-canvas';
    container.appendChild(this._canvas);

    const ctx = this._canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    this._ctx = ctx;

    const info = document.createElement('div');
    info.id = 'hud-info';
    info.innerHTML = `
      <span class="hud-name">NICOLAS RENARD</span>
      <span class="hud-sep">—</span>
      <span class="hud-title">LEAD DEV // FULL STACK</span>`;
    container.appendChild(info);

    this._prompt = document.createElement('div');
    this._prompt.id = 'hud-interact-prompt';
    this._prompt.style.display = 'none';
    container.appendChild(this._prompt);

    this._imgs        = {};
    this._face        = 'STFST00';
    this._mode        = 'auto'; // 'auto' | 'ouch'
    this._ouchTimer = null;
    this._idleTimer = null;

    this._load();
  }

  // ── Asset loading ──────────────────────────────────────────────────────────

  async _load() {
    await Promise.all(SPRITES.map(name => new Promise(resolve => {
      const img = new Image();
      img.onload  = () => { this._imgs[name] = img; resolve(); };
      img.onerror = resolve;
      img.src = `/hud/${name}.png`;
    })));
    this._draw();
    this._scheduleIdle();
  }

  // ── Public update — call each frame from game loop ─────────────────────────

  update(player) {
    if (player.hitWall) {
      player.hitWall = false;
      if (this._mode !== 'ouch') this._triggerOuch();
    }
  }

  // ── Ouch state ─────────────────────────────────────────────────────────────

  _triggerOuch() {
    this._mode = 'ouch';
    this._face = 'STFOUCH0';
    this._draw();
    clearTimeout(this._ouchTimer);
    this._ouchTimer = setTimeout(() => {
      this._mode = 'auto';
      this._face = 'STFST00';
      this._draw();
      this._scheduleIdle();
    }, 150);
  }

  // ── Idle animation — random look when player inactive ──────────────────────

  _scheduleIdle() {
    clearTimeout(this._idleTimer);
    this._idleTimer = setTimeout(() => {
      if (this._mode !== 'auto' || this._face !== 'STFST00') { this._scheduleIdle(); return; }
      this._face = Math.random() < 0.5 ? 'STFST01' : 'STFST02';
      this._draw();
      setTimeout(() => {
        if (this._mode === 'auto') { this._face = 'STFST00'; this._draw(); }
        this._scheduleIdle();
      }, 500);
    }, 3000 + Math.random() * 3000);
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  _drawNum(value, rightX, y) {
    const str = String(value);
    let x = rightX - str.length * (NUM_W + 1) + 1;
    for (const ch of str) {
      const img = this._imgs[`STTNUM${ch}`];
      if (img) this._ctx.drawImage(img, x, y, NUM_W, NUM_H);
      x += NUM_W + 1;
    }
  }

  _draw() {
    const ctx = this._ctx;
    ctx.clearRect(0, 0, W, H);

    const bar = this._imgs.STBAR;
    if (bar) ctx.drawImage(bar, 0, 0, W, H);

    const fb = this._imgs.STFB0;
    if (fb) ctx.drawImage(fb, FACE_X, FACE_Y, 35, 31);
    const face = this._imgs[this._face];
    if (face) ctx.drawImage(face, FACE_X + 6, FACE_Y + 1, 24, 29);

    this._drawNum(100, HP_X,  NUM_Y);
    this._drawNum(100, ARM_X, NUM_Y);
  }

  // ── Prompt ─────────────────────────────────────────────────────────────────

  updatePrompt(text) {
    this._prompt.textContent  = text;
    this._prompt.style.display = text ? 'block' : 'none';
  }
}
