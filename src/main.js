import { Player } from './engine/Player.js';
import { Input } from './engine/Input.js';
import { Renderer } from './engine/Renderer.js';
import { TextureManager } from './engine/TextureManager.js';
import { ScreenManager } from './engine/ScreenManager.js';
import { PushWall } from './engine/PushWall.js';
import { getCellType } from './engine/Map.js';
import { HUD } from './ui/HUD.js';
import { Hands } from './ui/Hands.js';
import { TouchControls } from './ui/Touch.js';

const canvas = document.getElementById('game-canvas');
const container = document.getElementById('game-container');
const startScreen = document.getElementById('start-screen');

(async () => {
  const textures = new TextureManager();
  await textures.load();
  // Ensure the pixel font is ready before screens render their first frame.
  if (document.fonts?.ready) { try { await document.fonts.load('10px "Press Start 2P"'); } catch {} }

  const renderer = new Renderer(canvas, textures);
  const player   = new Player();
  const input    = new Input(canvas);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      container.requestFullscreen()?.catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  const hud      = new HUD(container, toggleFullscreen);
  const hands    = new Hands(container);
  const touch    = new TouchControls(container, input);
  const screens  = new ScreenManager(renderer.scene, textures, canvas);
  const pushwall = new PushWall(renderer.scene, textures);

  document.addEventListener('fullscreenchange', () => {
    const isFS = !!document.fullscreenElement;
    document.body.classList.toggle('is-fullscreen', isFS);
    hud.updateFsIcon(isFS);
    // On desktop, we need to trigger a resize manually if not IS_MOBILE
    // because the renderer normally only resizes on mobile.
    if (!document.body.classList.contains('is-touch')) {
      renderer._resize();
    }
  });

  // Pointer lock rejects on touch devices — swallow the promise so it's quiet.
  const lock = () => { try { canvas.requestPointerLock()?.catch?.(() => {}); } catch {} };

  // Click drinks the coffee (only while exploring / pointer locked).
  document.addEventListener('mousedown', () => {
    if (!screens.focused && document.pointerLockElement) hands.drink();
  });

  // Desktop cursor hint (top-left) — shown only while the pointer is locked.
  const cursorHint = document.createElement('div');
  cursorHint.id = 'cursor-hint';
  cursorHint.textContent = 'ESC POUR LIBÉRER LE CURSEUR';
  cursorHint.style.display = 'none';
  container.appendChild(cursorHint);

  // FPS overlay (toggle with the ` key) — hidden by default.
  const fpsEl = document.createElement('div');
  fpsEl.id = 'fps-overlay';
  fpsEl.style.display = 'none';
  container.appendChild(fpsEl);
  let fpsVisible = false;
  window.addEventListener('keydown', e => {
    if (e.code === 'Backquote') { fpsVisible = !fpsVisible; fpsEl.style.display = fpsVisible ? 'block' : 'none'; }
  });

  // Adaptive quality: degrade (AO → bloom) if the framerate stays low.
  let prevT = 0, fps = 60, quality = 1, lastCheck = 0;
  const QNAME = ['BASIQUE', 'BLOOM'];

  // Pointer-lock around focus: release it on entering a console/arcade (so ESC is
  // delivered to the page in one press), re-acquire it on exit (no re-click).
  let wasFocused = false;

  function loop(now) {
    const tSec = now / 1000;
    const dt   = prevT ? Math.min((now - prevT) / 1000, 0.1) : 0;
    prevT = now;

    if (dt > 0) fps += (1 / dt - fps) * 0.08;   // smoothed FPS
    if (tSec > 2.5 && tSec - lastCheck >= 1) {   // skip startup, check ~1/s
      lastCheck = tSec;
      if (quality === 1 && fps < 48) renderer.setQuality(quality = 0);
    }
    if (fpsVisible) fpsEl.textContent = `${fps | 0} FPS · ${QNAME[quality]}`;

    const s = screens.update(player, input, dt, tSec);

    // Manage pointer lock across focus transitions.
    const focused = screens.focused;
    if (focused && !wasFocused) document.exitPointerLock();
    else if (!focused && wasFocused) lock();
    input.lockOnClick = !focused;
    wasFocused = focused;

    let prompt = s.prompt;
    if (s.blockMovement) {
      input.mouseDX = 0;            // discard look accumulated while focused
    } else {
      player.update(input);
      const pw = pushwall.update(player, input, dt);
      if (pw) prompt = pw;
    }
    hud.update(player);
    hud.updatePrompt(prompt);
    hud.setSector(getCellType(player.x, player.y));
    hands.update(player, dt, tSec, focused);
    touch.update({ prompt, focused, kind: screens.activeKind });
    cursorHint.style.display = document.pointerLockElement === canvas ? 'block' : 'none';

    renderer.render(player, s.cameraOverride, tSec);
    requestAnimationFrame(loop);
  }

  // Enter the game on any input — click/tap or any keyboard key.
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    startScreen.style.display = 'none';
    lock();
    requestAnimationFrame(loop);
  };
  startScreen.addEventListener('click', start);
  window.addEventListener('keydown', start);
})();
