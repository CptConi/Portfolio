// Minimal portfolio HUD — a thin bottom banner: identity (left), current sector
// (right), and a centred interaction prompt. No Doom status bar.

const SECTORS = {
  0: 'COULOIR', 1: '—', 2: 'ARMURERIE', 3: 'TROPHÉES',
  4: 'QUARTIERS', 5: '??? Secret Place', 6: 'ATRIUM',
};

const SVG_FS_ENTER = `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>`;
const SVG_FS_EXIT  = `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor"><path d="M240-120v-120H120v-80h200v200h-80Zm400 0v-200h200v80H720v120h-80ZM120-640v-80h120v-120h80v200H120Zm520 0v-200h80v120h120v80H640Z"/></svg>`;

export class HUD {
  constructor(container, onFullscreenToggle) {
    // Top-left sector indicator
    this._sector = document.createElement('div');
    this._sector.id = 'hud-sector';
    this._sector.textContent = '▸ ATRIUM';
    container.appendChild(this._sector);

    // Bottom-right fullscreen button
    this._fsBtn = document.createElement('button');
    this._fsBtn.id = 'hud-fs-btn';
    this._fsBtn.title = 'Plein écran';
    this._fsBtn.innerHTML = SVG_FS_ENTER;
    this._fsBtn.onclick = () => onFullscreenToggle && onFullscreenToggle();
    container.appendChild(this._fsBtn);

    // Identity bar (bottom-left)
    const bar = document.createElement('div');
    bar.id = 'hud-bar';
    bar.innerHTML = `
      <div class="hud-left">
        <div class="hud-id">
          <span class="hud-name">NICOLAS RENARD</span>
          <span class="hud-role">LEAD DEV // FULL STACK</span>
        </div>
      </div>`;
    container.appendChild(bar);

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

  updateFsIcon(isFS) {
    this._fsBtn.innerHTML = isFS ? SVG_FS_EXIT : SVG_FS_ENTER;
    this._fsBtn.title = isFS ? 'Quitter le plein écran' : 'Plein écran';
  }

  updatePrompt(text) {
    const isTouch = document.body.classList.contains('is-touch');
    const label = isTouch ? text.replace('[ E ] ', '') : text;
    this._prompt.textContent = label;
    this._prompt.style.display = text ? 'block' : 'none';
  }
}
