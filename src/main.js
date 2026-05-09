import { Player } from './engine/Player.js';
import { Input } from './engine/Input.js';
import { Renderer } from './engine/Renderer.js';
import { TextureManager } from './engine/TextureManager.js';
import { getCellType, ROOMS } from './engine/Map.js';
import { HUD } from './ui/HUD.js';
import { RoomOverlay } from './ui/RoomOverlay.js';

const canvas = document.getElementById('game-canvas');
const container = document.getElementById('game-container');

const textures = new TextureManager();
const renderer = new Renderer(canvas, textures);
const player = new Player();
const input = new Input(canvas);
const hud = new HUD(container);
const overlay = new RoomOverlay(container);

let lastRoomType = 0;

function update() {
  if (overlay.isOpen()) return;
  player.update(input);

  const cellType = getCellType(player.x, player.y);

  if (cellType > 1) {
    // Player is in a trigger room
    if (cellType !== lastRoomType) {
      lastRoomType = cellType;
    }
    const room = ROOMS[cellType];
    hud.updatePrompt(`[ E ] CONSULTER — ${room.name}`);

    if (input.consumeInteract()) {
      overlay.open(cellType);
    }
  } else {
    lastRoomType = 0;
    hud.updatePrompt('');
  }
}

function loop() {
  update();
  renderer.render(player);
  requestAnimationFrame(loop);
}

// Start screen: click to begin
const startScreen = document.getElementById('start-screen');
startScreen.addEventListener('click', () => {
  startScreen.style.display = 'none';
  canvas.requestPointerLock();
  loop();
});
