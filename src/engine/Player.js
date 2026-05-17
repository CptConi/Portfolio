import { isWall } from './Map.js';
import { PROPS3D } from './Props3D.js';

const MOVE_SPEED = 0.05;
const ROT_SPEED = 0.04;
const COLLISION_MARGIN = 0.2;

// Expanded AABBs for prop collision — computed once at load
const PROP_AABBS = PROPS3D.map(p => ({
  minX: p.x - p.w / 2 - COLLISION_MARGIN,
  maxX: p.x + p.w / 2 + COLLISION_MARGIN,
  minZ: p.y - p.d / 2 - COLLISION_MARGIN,
  maxZ: p.y + p.d / 2 + COLLISION_MARGIN,
}));

function hitsProp(x, z) {
  for (const b of PROP_AABBS)
    if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return true;
  return false;
}

export class Player {
  constructor() {
    // Spawn at bottom of corridor (cols 10-11, row 20), facing north
    this.x = 10.5;
    this.y = 20.5;
    this.angle = -Math.PI / 2; // facing north (up)
    this.fov = Math.PI / 3; // 60 degrees
  }

  update(input) {
    const dx = Math.cos(this.angle);
    const dy = Math.sin(this.angle);
    const rx = Math.cos(this.angle + Math.PI / 2);
    const ry = Math.sin(this.angle + Math.PI / 2);

    if (input.forward)  this._move( dx * MOVE_SPEED,  dy * MOVE_SPEED);
    if (input.backward) this._move(-dx * MOVE_SPEED, -dy * MOVE_SPEED);
    if (input.strafeLeft)  this._move(-rx * MOVE_SPEED, -ry * MOVE_SPEED);
    if (input.strafeRight) this._move( rx * MOVE_SPEED,  ry * MOVE_SPEED);

    if (input.rotLeft)  this.angle -= ROT_SPEED;
    if (input.rotRight) this.angle += ROT_SPEED;

    // Mouse look delta applied each frame then cleared
    if (input.mouseDX !== 0) {
      this.angle += input.mouseDX * 0.002;
      input.mouseDX = 0;
    }

    // Keep angle in [0, 2π]
    this.angle = ((this.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  }

  _move(dx, dy) {
    const nx = this.x + dx;
    const ny = this.y + dy;
    if (!isWall(nx + Math.sign(dx) * COLLISION_MARGIN, this.y) && !hitsProp(nx, this.y)) this.x = nx;
    if (!isWall(this.x, ny + Math.sign(dy) * COLLISION_MARGIN) && !hitsProp(this.x, ny)) this.y = ny;
  }
}
