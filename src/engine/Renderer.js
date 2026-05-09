import { castRay } from './Raycaster.js';
import { MAP, MAP_WIDTH, MAP_HEIGHT } from './Map.js';

const INTERNAL_W = 640;
const INTERNAL_H = 360;

// Distance-based brightness falloff
function applyFog(r, g, b, dist, side) {
  const fog = Math.max(0, 1 - dist * 0.12);
  const sideDim = side === 1 ? 0.65 : 1.0;
  return [
    Math.floor(r * fog * sideDim),
    Math.floor(g * fog * sideDim),
    Math.floor(b * fog * sideDim),
  ];
}

export class Renderer {
  constructor(canvas, textures) {
    this.canvas = canvas;
    this.canvas.width = INTERNAL_W;
    this.canvas.height = INTERNAL_H;
    this.ctx = canvas.getContext('2d');
    this.textures = textures;
    this.imgData = this.ctx.createImageData(INTERNAL_W, INTERNAL_H);
    this.buf = this.imgData.data;
  }

  setPixel(x, y, r, g, b) {
    const i = (y * INTERNAL_W + x) * 4;
    this.buf[i]   = r;
    this.buf[i+1] = g;
    this.buf[i+2] = b;
    this.buf[i+3] = 255;
  }

  drawCeilingFloor() {
    const halfH = INTERNAL_H >> 1;
    for (let y = 0; y < INTERNAL_H; y++) {
      const isCeiling = y < halfH;
      // gradient: darker at top/bottom, slightly lighter at horizon
      const distFromHorizon = Math.abs(y - halfH) / halfH;
      if (isCeiling) {
        const v = Math.floor(12 + distFromHorizon * 8);
        for (let x = 0; x < INTERNAL_W; x++) this.setPixel(x, y, v, v, v + 8);
      } else {
        const v = Math.floor(8 + distFromHorizon * 16);
        for (let x = 0; x < INTERNAL_W; x++) this.setPixel(x, y, v, v - 2, v - 4);
      }
    }
  }

  drawWalls(player) {
    const halfH = INTERNAL_H >> 1;
    for (let col = 0; col < INTERNAL_W; col++) {
      const rayAngle = player.angle - player.fov / 2 + (col / INTERNAL_W) * player.fov;
      const hit = castRay(player.x, player.y, rayAngle);

      const lineH = Math.min(INTERNAL_H, Math.floor(INTERNAL_H / Math.max(hit.perpWallDist, 0.01)));
      const drawStart = halfH - (lineH >> 1);
      const drawEnd   = halfH + (lineH >> 1);

      const texX = Math.floor(hit.wallX * 64);

      for (let row = drawStart; row < drawEnd; row++) {
        if (row < 0 || row >= INTERNAL_H) continue;
        const texY = Math.floor(((row - drawStart) / lineH) * 64);
        const [r, g, b] = this.textures.getPixel(hit.wallType, texX, texY);
        const [fr, fg, fb] = applyFog(r, g, b, hit.perpWallDist, hit.side);
        this.setPixel(col, row, fr, fg, fb);
      }
    }
  }

  drawMinimap(player) {
    const scale = 6;
    const offX = INTERNAL_W - MAP_WIDTH * scale - 4;
    const offY = 4;

    for (let my = 0; my < MAP_HEIGHT; my++) {
      for (let mx = 0; mx < MAP_WIDTH; mx++) {
        const cell = MAP[my][mx];
        let r, g, b;
        switch (cell) {
          case 0: r = 40;  g = 40;  b = 40;  break;
          case 1: r = 120; g = 100; b = 80;  break;
          case 2: r = 20;  g = 120; b = 20;  break;
          case 3: r = 140; g = 80;  b = 20;  break;
          case 4: r = 100; g = 20;  b = 160; break;
          default: r = g = b = 0;
        }
        for (let dy = 0; dy < scale - 1; dy++) {
          for (let dx = 0; dx < scale - 1; dx++) {
            const px = offX + mx * scale + dx;
            const py = offY + my * scale + dy;
            if (px >= 0 && px < INTERNAL_W && py >= 0 && py < INTERNAL_H) {
              this.setPixel(px, py, r, g, b);
            }
          }
        }
      }
    }

    // Player dot
    const pdx = offX + Math.floor(player.x * scale);
    const pdy = offY + Math.floor(player.y * scale);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const px = pdx + dx, py = pdy + dy;
        if (px >= 0 && px < INTERNAL_W && py >= 0 && py < INTERNAL_H) {
          this.setPixel(px, py, 255, 0, 0);
        }
      }
    }

    // Direction indicator
    const dlen = 4;
    const fx = Math.cos(player.angle);
    const fy = Math.sin(player.angle);
    for (let i = 0; i < dlen; i++) {
      const px = pdx + Math.round(fx * i);
      const py = pdy + Math.round(fy * i);
      if (px >= 0 && px < INTERNAL_W && py >= 0 && py < INTERNAL_H) {
        this.setPixel(px, py, 255, 255, 0);
      }
    }
  }

  render(player) {
    this.drawCeilingFloor();
    this.drawWalls(player);
    this.drawMinimap(player);
    this.ctx.putImageData(this.imgData, 0, 0);
  }
}
