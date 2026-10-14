import { Player } from './engine/Player.js';
import { Input } from './engine/Input.js';
import { Renderer } from './engine/Renderer.js';
import { TextureManager } from './engine/TextureManager.js';
import { ScreenManager } from './engine/ScreenManager.js';
import { PushWall } from './engine/PushWall.js';
import { getCellType } from './engine/Map.js';
import { events } from './engine/Events.js';
import { track, wireAnalytics } from './engine/Analytics.js';
import { HUD } from './ui/HUD.js';
import { Hands } from './ui/Hands.js';
import { Toast } from './ui/Toast.js';
import { TouchControls } from './ui/Touch.js';
import { buildFeatures } from './features/index.js';

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

  // Fullscreen is unavailable on iPhone Safari (and some webviews): hide the button there.
  const fsTarget = container.requestFullscreen ? container : null;
  const toggleFullscreen = () => {
    if (!fsTarget) return;
    if (!document.fullscreenElement) {
      fsTarget.requestFullscreen()?.catch?.(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  const hud      = new HUD(container, toggleFullscreen);
  if (!fsTarget || document.fullscreenEnabled === false) document.getElementById('hud-fs-btn')?.setAttribute('hidden', '');
  const hands    = new Hands(container);
  const touch    = new TouchControls(container, input);
  const toast    = new Toast(container);
  const screens  = new ScreenManager(renderer.scene, textures, canvas);
  const pushwall = new PushWall(renderer.scene, textures);

  wireAnalytics(events);
  events.on('toast', ({ text, ms, kind }) => toast.show(text, { ms, kind }));

  const features = buildFeatures({
    scene: renderer.scene, textures, renderer, player, input, hud, hands, screens, pushwall, events, toast, track,
  });

  renderer.warmUp?.();     // compile every shader (features included) once, before the first visible frame

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
  let lastSector = -1;

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

    // Features: merge their contributions with the console state.
    const frame = { dt, t: tSec, player, input, focused };
    let prompt = s.prompt;
    let cameraOverride = s.cameraOverride;
    let blockMovement = s.blockMovement;
    for (const f of features) {
      const r = f.update?.(frame, s);
      if (!r) continue;
      if (r.cameraOverride && !cameraOverride) cameraOverride = r.cameraOverride;
      if (r.blockMovement) blockMovement = true;
      if (r.prompt && !prompt) prompt = r.prompt;
    }
    if (!cameraOverride) {
      // A feature opened a console during this frame: start its glide from where the camera was.
      cameraOverride = screens.openingCamera();
      if (cameraOverride) blockMovement = true;
    }

    if (blockMovement) {
      input.mouseDX = 0;            // discard look accumulated while focused
    } else {
      player.update(input, dt);
      const pw = pushwall.update(player, input, dt);
      if (pw) prompt = pw;
    }
    input.clearKeys();              // one-shot keys live for exactly one frame

    const sector = getCellType(player.x, player.y);
    if (sector !== lastSector) { lastSector = sector; events.emit('sector:enter', { type: sector }); }

    hud.update(player);
    hud.updatePrompt(prompt);
    hud.setSector(sector);
    hands.update(player, dt, tSec, focused);
    touch.update({ prompt, focused, kind: screens.activeKind, hasLink: !!screens.activeLink });
    cursorHint.style.display = document.pointerLockElement === canvas ? 'block' : 'none';

    renderer.render(player, cameraOverride, tSec);
    requestAnimationFrame(loop);
  }

  // Enter the game on any input — click/tap or any keyboard key.
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    startScreen.style.display = 'none';
    lock();
    events.emit('game:start');
    requestAnimationFrame(loop);
  };
  startScreen.addEventListener('click', start);
  window.addEventListener('keydown', e => {
    // Only "intentional" keys start the game: a Tab to reach a link, or a lone
    // modifier, must not.
    if (['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Escape'].includes(e.key) || /^F\d+$/.test(e.key)) return;
    start();
  });

  // ── Development only: a handle on the running game for precise testing ──
  // Tree-shaken out of production builds. Usage (browser console):
  //   __game.tp(12.5, 12.5, 270)    teleport (x, z, heading in degrees; 270 = north)
  //   __game.open('projects', 3)    focus a console on a given page
  //   __game.key('c')               inject a one-shot key press
  //   http://localhost:3000/?autostart&at=12.5,12.5,270   skip the title screen
  if (import.meta.env.DEV) {
    window.__game = {
      player, input, screens, pushwall, renderer, hud, hands, toast, events, features,
      tp: (x, z, deg = 270) => player.teleport(x, z, (deg * Math.PI) / 180),
      open: (id, page = null) => screens.focusConsole(player, id, page),
      key: k => input.press(k),
      start,
    };
    const q = new URLSearchParams(location.search);
    if (q.has('autostart')) {
      const at = q.get('at');
      if (at) { const [x, z, deg = 270] = at.split(',').map(Number); window.__game.tp(x, z, deg); }
      start();
    }
  }
})();
