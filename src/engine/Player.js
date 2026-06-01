import { isWall } from './Map.js';
import { PROPS3D } from './Props3D.js';
import { consoleAABBs } from './Screens.js';

const MOVE_SPEED = 0.05;
const ROT_SPEED  = 0.04;
const COLLISION_MARGIN = 0.2;

// Expanded AABBs for prop + console collision — computed once at load
const PROP_AABBS = [
  ...PROPS3D.map(p => ({
    minX: p.x - p.w / 2 - COLLISION_MARGIN,
    maxX: p.x + p.w / 2 + COLLISION_MARGIN,
    minZ: p.y - p.d / 2 - COLLISION_MARGIN,
    maxZ: p.y + p.d / 2 + COLLISION_MARGIN,
  })),
  ...consoleAABBs(COLLISION_MARGIN),
];

function hitsProp(x, z) {
  for (const b of PROP_AABBS)
    if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return true;
  return false;
}

export class Player {
  constructor() {
    this.x     = 10.5;
    this.y     = 20.5;
    this.angle = -Math.PI / 2;
    this.fov   = Math.PI / 3;

    this.hitWall = false; // consumed by HUD.update()
  }

  update(input) {
    const dx = Math.cos(this.angle);
    const dy = Math.sin(this.angle);
    const rx = Math.cos(this.angle + Math.PI / 2);
    const ry = Math.sin(this.angle + Math.PI / 2);

    if (input.forward)     this._move( dx * MOVE_SPEED,  dy * MOVE_SPEED);
    if (input.backward)    this._move(-dx * MOVE_SPEED, -dy * MOVE_SPEED);
    if (input.strafeLeft)  this._move(-rx * MOVE_SPEED, -ry * MOVE_SPEED);
    if (input.strafeRight) this._move( rx * MOVE_SPEED,  ry * MOVE_SPEED);

    if (input.rotLeft)  this.angle -= ROT_SPEED;
    if (input.rotRight) this.angle += ROT_SPEED;

    if (input.mouseDX !== 0) {
      this.angle   += input.mouseDX * 0.002;
      input.mouseDX = 0;
    }

    this.angle = ((this.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  }

  _move(dx, dy) {
    const nx = this.x + dx;
    const ny = this.y + dy;
    const canX = !isWall(nx + Math.sign(dx) * COLLISION_MARGIN, this.y) && !hitsProp(nx, this.y);
    const canY = !isWall(this.x, ny + Math.sign(dy) * COLLISION_MARGIN) && !hitsProp(this.x, ny);
    if (canX) this.x = nx;
    if (canY) this.y = ny;
    // Ouch if any axis with meaningful intended movement was blocked
    if ((!canX && Math.abs(dx) > 0.001) || (!canY && Math.abs(dy) > 0.001))
      this.hitWall = true;
  }
}
