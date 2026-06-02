import { isWall, floorAt, STEP_MAX } from './Map.js';
import { PROPS3D } from './Props3D.js';
import { consoleAABBs } from './Screens.js';
import { spriteAABBs } from './Sprites2D.js';
import { ARMORY_RACK_AABBS } from './Decor.js';

const EYE_OFFSET = 0.5;   // camera height above the local floor

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
  ...spriteAABBs(COLLISION_MARGIN),
  ...ARMORY_RACK_AABBS.map(b => ({
    minX: b.minX - COLLISION_MARGIN, maxX: b.maxX + COLLISION_MARGIN,
    minZ: b.minZ - COLLISION_MARGIN, maxZ: b.maxZ + COLLISION_MARGIN,
  })),
];

function hitsProp(x, z) {
  for (const b of PROP_AABBS)
    if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return true;
  return false;
}

export class Player {
  constructor() {
    this.x     = 12.5;   // inside the atrium, near the south wall
    this.y     = 15.4;
    this.angle = -Math.PI / 2;   // facing north → landmark + quartiers hall
    this.fov   = Math.PI / 3;

    this._eyeBase = floorAt(this.x, this.y) + EYE_OFFSET; // smoothed floor follow
    this._bob     = 0;   // head-bob phase
    this._bobAmp  = 0;   // eases in/out with movement
    this.eyeY     = this._eyeBase;
    this.hitWall  = false; // consumed by HUD.update()
  }

  update(input) {
    const dx = Math.cos(this.angle);
    const dy = Math.sin(this.angle);
    const rx = Math.cos(this.angle + Math.PI / 2);
    const ry = Math.sin(this.angle + Math.PI / 2);

    // Analog locomotion — magnitude from the axes (keyboard = ±1, touch stick =
    // fractional pull), so a half-pushed stick walks at half speed.
    const mvY = input.moveY, mvX = input.moveX;
    if (mvY) this._move(dx * MOVE_SPEED * mvY, dy * MOVE_SPEED * mvY);
    if (mvX) this._move(rx * MOVE_SPEED * mvX, ry * MOVE_SPEED * mvX);

    if (input.rotLeft)  this.angle -= ROT_SPEED;
    if (input.rotRight) this.angle += ROT_SPEED;

    if (input.mouseDX !== 0) {
      this.angle   += input.mouseDX * 0.002;
      input.mouseDX = 0;
    }

    this.angle = ((this.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

    // Head bob — advance phase while moving, ease the amplitude in/out.
    const moving = mvX !== 0 || mvY !== 0;
    if (moving) this._bob += 0.165;
    this._bobAmp += ((moving ? 1 : 0) - this._bobAmp) * 0.12;

    // Camera eye smoothly follows the floor, plus the bob offset.
    const targetEye = floorAt(this.x, this.y) + EYE_OFFSET;
    this._eyeBase += (targetEye - this._eyeBase) * 0.25;
    this.eyeY = this._eyeBase + Math.sin(this._bob) * 0.022 * this._bobAmp;
  }

  _move(dx, dy) {
    const nx = this.x + dx;
    const ny = this.y + dy;
    const here = floorAt(this.x, this.y);
    // Block walls, props, and floor steps too high to climb.
    const canX = !isWall(nx + Math.sign(dx) * COLLISION_MARGIN, this.y) && !hitsProp(nx, this.y)
      && floorAt(nx, this.y) - here <= STEP_MAX;
    const canY = !isWall(this.x, ny + Math.sign(dy) * COLLISION_MARGIN) && !hitsProp(this.x, ny)
      && floorAt(this.x, ny) - here <= STEP_MAX;
    if (canX) this.x = nx;
    if (canY) this.y = ny;
    // Ouch if any axis with meaningful intended movement was blocked
    if ((!canX && Math.abs(dx) > 0.001) || (!canY && Math.abs(dy) > 0.001))
      this.hitWall = true;
  }
}
