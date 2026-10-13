import * as THREE from 'three';
import { PUSH_WALL, setSecretOpen, isSecretOpen } from './Map.js';
import { prefs } from './prefs.js';
import { radialTex } from './decor/helpers.js';

const OPEN_TIME = 1.3;          // seconds to fully retract
const OPEN_TIME_CALM = 0.7;     // same, with prefers-reduced-motion
const RANGE     = 1.4;          // legacy mode: how close the player must be to push
const CX = PUSH_WALL.mx + 0.5;
const CZ = PUSH_WALL.my + 0.5;

// ── Dust: a one-shot pool of soft puffs shaken loose from the top edge of the wall
// as it slides up. One THREE.Points draw call, preallocated typed arrays.
const DUST_N = 56;
const DUST_X0 = CX - 0.44, DUST_X1 = CX + 0.44;   // wall width, minus a margin
const DUST_Y  = 1.97;                             // just under the atrium ceiling (2.0)
const DUST_Z0 = PUSH_WALL.my - 0.06;              // thin slab right in front of the face
const DUST_Z1 = PUSH_WALL.my + 0.02;

function dustTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 1, 16, 16, 16);
  g.addColorStop(0, '#ffffffff');
  g.addColorStop(0.5, '#ffffff66');
  g.addColorStop(1, '#ffffff00');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

class Dust {
  constructor(scene) {
    this._pos = new Float32Array(DUST_N * 3);
    this._col = new Float32Array(DUST_N * 4);
    this._vel = new Float32Array(DUST_N * 3);
    this._age = new Float32Array(DUST_N).fill(Infinity);
    this._life = new Float32Array(DUST_N).fill(1);
    this._alive = 0;
    this._spawnDebt = 0;
    this._rate = 0;
    this._burst = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this._pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this._col, 4));
    this._points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.11, map: dustTexture(), vertexColors: true, transparent: true, depthWrite: false,
    }));
    this._points.frustumCulled = false;
    this._points.visible = false;
    scene.add(this._points);
  }

  // Puffs per second until stop(); a heavier burst when the slab first breaks loose.
  start() { this._rate = 70; this._burst = 0.35; }
  stop()  { this._rate = 0; }

  _spawn(i) {
    const p = this._pos, v = this._vel, o = i * 3;
    p[o] = DUST_X0 + Math.random() * (DUST_X1 - DUST_X0);
    p[o + 1] = DUST_Y;
    p[o + 2] = DUST_Z0 + Math.random() * (DUST_Z1 - DUST_Z0);
    v[o] = (Math.random() - 0.5) * 0.08;
    v[o + 1] = -0.05 - Math.random() * 0.2;
    v[o + 2] = -Math.random() * 0.07;               // drifts out toward the atrium
    this._age[i] = 0;
    this._life[i] = 1.4 + Math.random() * 1.2;
    this._alive++;
  }

  update(dt) {
    if (this._rate === 0 && this._alive === 0) return;
    if (this._rate > 0) {
      this._burst -= dt;
      this._spawnDebt += dt * (this._burst > 0 ? this._rate : this._rate * 0.45);
    }
    const pos = this._pos, col = this._col, vel = this._vel;
    for (let i = 0; i < DUST_N; i++) {
      if (this._age[i] === Infinity) {
        if (this._spawnDebt >= 1) { this._spawnDebt--; this._spawn(i); } else continue;
      }
      const o = i * 3, a = (this._age[i] += dt);
      if (a >= this._life[i]) {
        this._age[i] = Infinity; this._alive--;
        col[i * 4 + 3] = 0;
        continue;
      }
      vel[o + 1] = Math.max(-0.7, vel[o + 1] - 0.4 * dt);   // light grains: slow, drag-limited fall
      pos[o] += vel[o] * dt; pos[o + 1] += vel[o + 1] * dt; pos[o + 2] += vel[o + 2] * dt;
      const k = a / this._life[i];
      const fade = Math.min(1, a / 0.15) * (1 - k * k);     // quick fade-in, slow fade-out
      col[i * 4] = 0.64; col[i * 4 + 1] = 0.58; col[i * 4 + 2] = 0.5; col[i * 4 + 3] = 0.5 * fade;
    }
    this._spawnDebt = Math.min(this._spawnDebt, 4);
    const on = this._alive > 0;
    this._points.visible = on;
    if (on) {
      this._points.geometry.attributes.position.needsUpdate = true;
      this._points.geometry.attributes.color.needsUpdate = true;
    }
  }
}

// Doom-style push-wall: looks like a normal corridor wall and slides up into the
// ceiling to reveal the secret room. Rendered as its own movable mesh (excluded
// from the static wall InstancedMesh in Renderer).
//
// By default the wall is `sealed`: it ignores the player and stays shut until
// someone calls open() (the PROD panel does, see features/secret.js). Setting
// `sealed = false` restores the original behaviour (walk up, press [E] on "???").
export class PushWall {
  constructor(scene, tex) {
    this.sealed = true;
    this._p = 0;
    this._opening = false;
    this._done = false;
    this._calm = false;
    this._spillA = 0;

    // Texture matches the GRAYT variant the static builder picks for this cell:
    // 20 + ((mx*7 + my*13) % 14) = 20 + ((84+208)%14) = 32.
    const mat = new THREE.MeshLambertMaterial({ map: tex.get(32), color: 0xb0b0b0, vertexColors: true });
    const geo = new THREE.BoxGeometry(0.94, 2, 0.94);

    // Apply per-face shading to match the corridor's orientation-based lighting.
    // In Renderer.js, north/south walls (Z-facing) are dimmed to 0.65.
    const nor = geo.attributes.normal;
    const colors = new Float32Array(geo.attributes.position.count * 3);
    for (let i = 0; i < geo.attributes.position.count; i++) {
      // In Renderer: DIRS[2,3] are Z-facing (rotY 0/PI) and have dim 0.65.
      const dim = Math.abs(nor.getZ(i)) > 0.5 ? 0.65 : 1.0;
      colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = dim;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(CX, 1.0, CZ);
    scene.add(this.mesh);

    this._dust = new Dust(scene);

    // Pink light spilling on the atrium floor once the way is open — an additive pool,
    // not a PointLight — so the reveal reads from across the hall.
    this._spill = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: radialTex(0xff2a9d), transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false }));
    this._spill.position.set(CX, 0.022, PUSH_WALL.my - 0.45);
    this._spill.visible = false;
    scene.add(this._spill);
  }

  // True once the wall has started to slide (it cannot be closed again).
  get opening() { return this._opening; }

  // Start sliding up. Idempotent. The slide itself is driven by update().
  open() {
    if (this._opening) return;
    this._opening = true;
    this._calm = prefs.reducedMotion;
    if (!this._calm) this._dust.start();
  }

  _updateSpill(dt) {
    const target = isSecretOpen() ? 0.4 : 0;
    if (target === 0 && this._spillA === 0) return;
    this._spillA += (target - this._spillA) * Math.min(1, dt * 3);
    const flicker = this._calm ? 1 : 0.8 + 0.2 * Math.random();
    this._spill.material.opacity = this._spillA * flicker;
    this._spill.visible = this._spillA > 0.01;
  }

  // Call each frame while the player is free. Returns an interaction prompt.
  update(player, input, dt) {
    this._dust.update(dt);
    this._updateSpill(dt);
    if (this._done) return '';

    if (!this._opening) {
      if (this.sealed) return '';
      const dx = CX - player.x;
      const dz = CZ - player.y;
      const d = Math.hypot(dx, dz);
      const facing = d < RANGE &&
        (Math.cos(player.angle) * dx + Math.sin(player.angle) * dz) / (d || 1) > 0.4;
      if (facing && input.consumeInteract()) this.open();
      return !this._opening && facing ? '[ E ] ???' : '';
    }

    // Retract upward into the ceiling; passage opens once it has risen enough.
    this._p = Math.min(1, this._p + dt / (this._calm ? OPEN_TIME_CALM : OPEN_TIME));
    this.mesh.position.y = 1.0 + this._p * 2.0;
    if (!this._calm) {
      // Rumble: the slab trembles in its frame, settling as it clears the opening.
      const k = 0.012 * (1 - this._p);
      this.mesh.position.x = CX + (Math.random() - 0.5) * k;
      this.mesh.position.z = CZ + (Math.random() - 0.5) * k;
    }
    if (this._p > 0.35) setSecretOpen(true);
    if (this._p >= 1) {
      this._done = true;
      this.mesh.visible = false;
      this._dust.stop();
    }
    return '';
  }
}
