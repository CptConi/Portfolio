import * as THREE from 'three';
import { PUSH_WALL, setSecretOpen } from './Map.js';

const OPEN_TIME = 1.3;   // seconds to fully retract
const RANGE     = 1.4;   // how close the player must be to push

// Doom-style push-wall: looks like a normal corridor wall, slides up into the
// ceiling on [E] to reveal the secret room. Rendered as its own movable mesh
// (excluded from the static wall InstancedMesh in Renderer).
export class PushWall {
  constructor(scene, tex) {
    this._p = 0;
    this._opening = false;
    this._done = false;

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
    this.mesh.position.set(PUSH_WALL.mx + 0.5, 1.0, PUSH_WALL.my + 0.5);
    scene.add(this.mesh);
  }

  // Call each frame while the player is free. Returns an interaction prompt.
  update(player, input, dt) {
    if (this._done) return '';

    if (!this._opening) {
      const dx = (PUSH_WALL.mx + 0.5) - player.x;
      const dz = (PUSH_WALL.my + 0.5) - player.y;
      const d = Math.hypot(dx, dz);
      const facing = d < RANGE &&
        (Math.cos(player.angle) * dx + Math.sin(player.angle) * dz) / (d || 1) > 0.4;
      if (facing && input.consumeInteract()) this._opening = true;
      return facing ? '[ E ] ???' : '';
    }

    // Retract upward into the ceiling; passage opens once it has risen enough.
    this._p = Math.min(1, this._p + dt / OPEN_TIME);
    this.mesh.position.y = 1.0 + this._p * 2.0;
    if (this._p > 0.35) setSecretOpen(true);
    if (this._p >= 1) { this._done = true; this.mesh.visible = false; }
    return '';
  }
}
