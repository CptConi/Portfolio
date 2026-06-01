import { Player } from './engine/Player.js';
import { Input } from './engine/Input.js';
import { Renderer } from './engine/Renderer.js';
import { TextureManager } from './engine/TextureManager.js';
import { ScreenManager } from './engine/ScreenManager.js';
import { HUD } from './ui/HUD.js';

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
  const hud      = new HUD(container);
  const screens  = new ScreenManager(renderer.scene, textures);

  let prevT = 0;

  function loop(now) {
    const tSec = now / 1000;
    const dt   = prevT ? Math.min((now - prevT) / 1000, 0.1) : 0;
    prevT = now;

    const s = screens.update(player, input, dt, tSec);

    if (s.blockMovement) {
      input.mouseDX = 0;            // discard look accumulated while focused
    } else {
      player.update(input);
    }
    hud.update(player);
    hud.updatePrompt(s.prompt);

    renderer.render(player, s.cameraOverride);
    requestAnimationFrame(loop);
  }

  startScreen.addEventListener('click', () => {
    startScreen.style.display = 'none';
    canvas.requestPointerLock();
    requestAnimationFrame(loop);
  });
})();
