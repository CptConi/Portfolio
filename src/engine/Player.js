import { isWall, floorAt, STEP_MAX } from './Map.js';
import { PROPS3D } from './Props3D.js';
import { consoleAABBs } from './Screens.js';
import { spriteAABBs } from './Sprites2D.js';
import { ARMORY_RACK_AABBS } from './Decor.js';

const EYE_OFFSET = 0.5;   // camera height above the local floor

// Frame-rate independent: values are per second (the original per-frame constants
// were tuned at 60 fps: 0.05 / 0.04 / 0.165 per frame).
const MOVE_SPEED = 3.0;    // m/s
const ROT_SPEED  = 2.4;    // rad/s (keyboard turn)
const BOB_RATE   = 9.9;    // rad/s (head-bob phase)
const MAX_STEP   = 0.04;   // m per collision sub-step (keeps thin props from being skipped)
const COLLISION_MARGIN = 0.2;

// Exponential smoothing that behaves the same at any frame rate: `k60` is the
// per-frame blend factor at 60 fps.
const blend = (k60, dt) => 1 - Math.pow(1 - k60, dt * 60);

// Extra solid boxes registered by features (e.g. the DF dashboard console, the
// gallery dioramas). Same shape as PROP_AABBS entries; margins already applied.
const EXTRA_AABBS = [];
export function addSolidBox(box, margin = COLLISION_MARGIN) {
  EXTRA_AABBS.push({
    minX: box.minX - margin, maxX: box.maxX + margin,
    minZ: box.minZ - margin, maxZ: box.maxZ + margin,
  });
}

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
  for (const b of EXTRA_AABBS)
    if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return true;
  return false;
}

// True when a player standing at (x, z) is inside neither a wall nor a solid prop.
export function isFree(x, z) { return !isWall(x, z) && !hitsProp(x, z); }

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

  // Place the player instantly (warp menu, deep links, guided tour, debug harness).
  teleport(x, y, angle = this.angle) {
    this.x = x; this.y = y; this.angle = angle;
    this._eyeBase = floorAt(x, y) + EYE_OFFSET;
    this.eyeY = this._eyeBase;
  }

  update(input, dt = 1 / 60) {
    dt = Math.min(Math.max(dt, 0), 0.1);

    const dx = Math.cos(this.angle);
    const dy = Math.sin(this.angle);
    const rx = Math.cos(this.angle + Math.PI / 2);
    const ry = Math.sin(this.angle + Math.PI / 2);

    // Analog locomotion — magnitude from the axes (keyboard = ±1, touch stick =
    // fractional pull), so a half-pushed stick walks at half speed.
    const mvY = input.moveY, mvX = input.moveX;
    const steps = Math.max(1, Math.ceil(MOVE_SPEED * dt / MAX_STEP));
    const h = (MOVE_SPEED * dt) / steps;
    for (let i = 0; i < steps; i++) {
      if (mvY) this._move(dx * h * mvY, dy * h * mvY);
      if (mvX) this._move(rx * h * mvX, ry * h * mvX);
    }

    if (input.rotLeft)  this.angle -= ROT_SPEED * dt;
    if (input.rotRight) this.angle += ROT_SPEED * dt;

    if (input.mouseDX !== 0) {
      this.angle   += input.mouseDX * 0.002;
      input.mouseDX = 0;
    }

    this.angle = ((this.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

    // Head bob — advance phase while moving, ease the amplitude in/out.
    const moving = mvX !== 0 || mvY !== 0;
    if (moving) this._bob += BOB_RATE * dt;
    this._bobAmp += ((moving ? 1 : 0) - this._bobAmp) * blend(0.12, dt);

    // Camera eye smoothly follows the floor, plus the bob offset.
    const targetEye = floorAt(this.x, this.y) + EYE_OFFSET;
    this._eyeBase += (targetEye - this._eyeBase) * blend(0.25, dt);
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
