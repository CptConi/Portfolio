export class HUD {
  constructor(container) {
    this.el = document.createElement('div');
    this.el.id = 'hud';
    this.el.innerHTML = `
      <div class="hud-panel hud-left">
        <div class="hud-stat">
          <span class="hud-label">SANTÉ</span>
          <span class="hud-value hud-health">100%</span>
        </div>
        <div class="hud-armor">
          <span class="hud-label">ARMURE</span>
          <span class="hud-value">100%</span>
        </div>
      </div>
      <div class="hud-center">
        <div class="hud-face" id="hud-face">
          <canvas id="face-canvas" width="48" height="48"></canvas>
        </div>
        <div class="hud-name">NICOLAS RENARD</div>
        <div class="hud-title">LEAD DEV // FULL STACK</div>
      </div>
      <div class="hud-panel hud-right">
        <div class="hud-stat">
          <span class="hud-label">MUNITIONS</span>
          <span class="hud-value">∞</span>
        </div>
        <div class="hud-keys">
          <span class="hud-label">DÉPLACER</span>
          <span class="hud-value hud-keys-value">WASD / ↑↓←→</span>
        </div>
      </div>
    `;
    container.appendChild(this.el);
    this._drawFace();
  }

  _drawFace() {
    const canvas = document.getElementById('face-canvas');
    const ctx = canvas.getContext('2d');
    const W = 48, H = 48;

    // Skin
    ctx.fillStyle = '#c8956c';
    ctx.fillRect(8, 6, 32, 32);

    // Eyes
    ctx.fillStyle = '#222';
    ctx.fillRect(14, 14, 6, 6);
    ctx.fillRect(28, 14, 6, 6);

    // Pupils
    ctx.fillStyle = '#fff';
    ctx.fillRect(15, 15, 2, 2);
    ctx.fillRect(29, 15, 2, 2);

    // Nose
    ctx.fillStyle = '#a0704a';
    ctx.fillRect(21, 20, 6, 4);

    // Mouth (neutral/determined)
    ctx.fillStyle = '#7a3a1e';
    ctx.fillRect(14, 28, 20, 3);

    // Hair
    ctx.fillStyle = '#3a2010';
    ctx.fillRect(8, 4, 32, 6);
    ctx.fillRect(8, 6, 4, 10);
    ctx.fillRect(36, 6, 4, 10);

    // Armor collar
    ctx.fillStyle = '#556';
    ctx.fillRect(4, 36, 40, 12);
    ctx.fillStyle = '#778';
    ctx.fillRect(10, 34, 28, 6);
  }

  updatePrompt(text) {
    let prompt = document.getElementById('hud-interact-prompt');
    if (!prompt) {
      prompt = document.createElement('div');
      prompt.id = 'hud-interact-prompt';
      this.el.appendChild(prompt);
    }
    prompt.textContent = text;
    prompt.style.display = text ? 'block' : 'none';
  }
}
