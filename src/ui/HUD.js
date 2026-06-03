// Minimal portfolio HUD — a thin bottom banner: identity (left), current sector
// (right), and a centred interaction prompt. No Doom status bar.

const SECTORS = {
  0: 'COULOIR', 1: '—', 2: 'ARMURERIE', 3: 'TROPHÉES',
  4: 'QUARTIERS', 5: 'SECRET PLACE', 6: 'ATRIUM',
};

export class HUD {
  constructor(container) {
    const bar = document.createElement('div');
    bar.id = 'hud-bar';
    bar.innerHTML = `
      <div class="hud-id">
        <span class="hud-name">NICOLAS RENARD</span>
        <span class="hud-role">LEAD DEV // FULL STACK</span>
      </div>
      <div class="hud-sector" id="hud-sector">▸ ATRIUM</div>`;
    container.appendChild(bar);
    this._sector = bar.querySelector('#hud-sector');

    this._prompt = document.createElement('div');
    this._prompt.id = 'hud-interact-prompt';
    this._prompt.style.display = 'none';
    container.appendChild(this._prompt);

    this._lastType = -1;
  }

  // Kept for game-loop compatibility (no Doom face to animate anymore).
  update() {}

  setSector(type) {
    if (type === this._lastType) return;
    this._lastType = type;
    this._sector.textContent = '▸ ' + (SECTORS[type] ?? '—');
  }

  updatePrompt(text) {
    const isTouch = document.body.classList.contains('is-touch');
    const label = isTouch ? text.replace('[ E ] ', '') : text;
    this._prompt.textContent = label;
    this._prompt.style.display = text ? 'block' : 'none';
  }
}
