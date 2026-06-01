import * as THREE from 'three';
import { MAP, MAP_WIDTH, MAP_HEIGHT } from './Map.js';
import { PROPS3D } from './Props3D.js';

const INTERNAL_W = 640;
const INTERNAL_H = 360;

// Horizontal FOV = π/3 → convert to vertical FOV for Three.js
const H_FOV    = Math.PI / 3;
const ASPECT   = INTERNAL_W / INTERNAL_H;
const V_FOV_DEG = 2 * Math.atan(Math.tan(H_FOV / 2) / ASPECT) * (180 / Math.PI);

export class Renderer {
  constructor(canvas, textures) {
    this._tex = textures;

    // ── WebGL renderer ───────────────────────────────────────────────────
    this._renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this._renderer.setSize(INTERNAL_W, INTERNAL_H, false);
    this._renderer.setPixelRatio(1);

    // ── Camera ───────────────────────────────────────────────────────────
    this._camera = new THREE.PerspectiveCamera(V_FOV_DEG, ASPECT, 0.05, 50);
    this._camera.position.y = 0.5;

    // ── Scene ────────────────────────────────────────────────────────────
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x000000);
    this._scene.fog = new THREE.Fog(0x000000, 2, 14);

    // ── Minimap overlay canvas ────────────────────────────────────────────
    const mm = document.createElement('canvas');
    mm.width  = MAP_WIDTH  * 6;
    mm.height = MAP_HEIGHT * 6;
    Object.assign(mm.style, {
      position: 'absolute', top: '4px', right: '4px',
      imageRendering: 'pixelated', pointerEvents: 'none',
    });
    canvas.parentElement.appendChild(mm);
    this._mm    = mm;
    this._mmCtx = mm.getContext('2d');

    this._buildScene();
  }

  // ── Scene construction ─────────────────────────────────────────────────

  _buildScene() {
    this._buildFloorCeiling();
    this._buildWalls();
    this._buildProps();
  }

  _buildFloorCeiling() {
    const tex = this._tex;

    // Floor
    const floorGeo = new THREE.PlaneGeometry(MAP_WIDTH, MAP_HEIGHT)
      .rotateX(-Math.PI / 2);
    this._scene.add(new THREE.Mesh(
      floorGeo,
      new THREE.MeshBasicMaterial({ map: tex.tiled(40, MAP_WIDTH, MAP_HEIGHT) })
    ).translateX(MAP_WIDTH / 2).translateZ(MAP_HEIGHT / 2));

    // Ceiling base
    const ceilGeo = new THREE.PlaneGeometry(MAP_WIDTH, MAP_HEIGHT)
      .rotateX(Math.PI / 2);
    const ceil = new THREE.Mesh(
      ceilGeo,
      new THREE.MeshBasicMaterial({ map: tex.tiled(41, MAP_WIDTH, MAP_HEIGHT), color: 0x999999 })
    );
    ceil.position.set(MAP_WIDTH / 2, 1, MAP_HEIGHT / 2);
    this._scene.add(ceil);

    // Ceiling light panels (InstancedMesh — one quad per panel)
    const lightPos = [];
    for (let my = 0; my < MAP_HEIGHT; my++) {
      for (let mx = 0; mx < MAP_WIDTH; mx++) {
        if (MAP[my][mx] === 0 && mx % 4 === 1 && my % 4 === 1) {
          lightPos.push(mx + 0.5, my + 0.5);
        }
      }
    }
    if (lightPos.length) {
      const count   = lightPos.length / 2;
      const lightGeo = new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2);
      const lightMat = new THREE.MeshBasicMaterial({ map: tex.get(42) });
      const lightMesh = new THREE.InstancedMesh(lightGeo, lightMat, count);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < count; i++) {
        dummy.position.set(lightPos[i * 2], 1.002, lightPos[i * 2 + 1]);
        dummy.updateMatrix();
        lightMesh.setMatrixAt(i, dummy.matrix);
      }
      lightMesh.instanceMatrix.needsUpdate = true;
      this._scene.add(lightMesh);
    }
  }

  _buildWalls() {
    // Collect faces per texId — each face: {x, z, rotY, dim}
    const groups = new Map(); // texId → [{x, z, rotY, dim}]

    const addFace = (texId, x, z, rotY, dim) => {
      if (!groups.has(texId)) groups.set(texId, []);
      groups.get(texId).push({ x, z, rotY, dim });
    };

    // Determine texture for a wall face from the open-side neighbor
    const faceTexId = (mx, my, neighborVal) => {
      if (neighborVal >= 2 && neighborVal <= 4) return neighborVal; // room-themed face
      return 20 + ((mx * 7 + my * 13) % 14);                      // GRAYT variant
    };

    for (let my = 0; my < MAP_HEIGHT; my++) {
      for (let mx = 0; mx < MAP_WIDTH; mx++) {
        if (MAP[my][mx] !== 1) continue; // only solid walls get geometry

        const nE = MAP[my][mx + 1] ?? -1;
        const nW = MAP[my][mx - 1] ?? -1;
        const nS = MAP[my + 1]?.[mx] ?? -1;
        const nN = MAP[my - 1]?.[mx] ?? -1;

        // East face (normal +X, bright)
        if (nE === 0 || nE >= 2)
          addFace(faceTexId(mx, my, nE), mx + 1, my + 0.5,  Math.PI / 2,  1.0);
        // West face (normal -X, bright)
        if (nW === 0 || nW >= 2)
          addFace(faceTexId(mx, my, nW), mx,     my + 0.5, -Math.PI / 2,  1.0);
        // South face (normal +Z, dim)
        if (nS === 0 || nS >= 2)
          addFace(faceTexId(mx, my, nS), mx + 0.5, my + 1,  0,            0.65);
        // North face (normal -Z, dim)
        if (nN === 0 || nN >= 2)
          addFace(faceTexId(mx, my, nN), mx + 0.5, my,      Math.PI,      0.65);
      }
    }

    const wallGeo = new THREE.PlaneGeometry(1, 1);
    const dummy   = new THREE.Object3D();
    const col     = new THREE.Color();

    for (const [texId, faces] of groups) {
      const mat  = new THREE.MeshBasicMaterial({ map: this._tex.get(texId) });
      const mesh = new THREE.InstancedMesh(wallGeo, mat, faces.length);

      faces.forEach(({ x, z, rotY, dim }, i) => {
        dummy.position.set(x, 0.5, z);
        dummy.rotation.set(0, rotY, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        col.setScalar(dim);
        mesh.setColorAt(i, col);
      });

      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate  = true;
      this._scene.add(mesh);
    }
  }

  _buildProps() {
    const dummy = new THREE.Object3D();
    const col   = new THREE.Color();

    for (const prop of PROPS3D) {
      const sideMat = new THREE.MeshBasicMaterial({ map: this._tex.get(prop.texSide) });
      const topMat  = new THREE.MeshBasicMaterial({ map: this._tex.get(prop.texTop ?? prop.texSide) });

      // BoxGeometry face order: +X,-X,+Y,-Y,+Z,-Z
      const mats = [sideMat, sideMat, topMat, sideMat, sideMat, sideMat];
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(prop.w, prop.h, prop.d),
        mats
      );
      mesh.position.set(prop.x, prop.h / 2, prop.y);
      this._scene.add(mesh);
    }
  }

  // ── Minimap ────────────────────────────────────────────────────────────

  _drawMinimap(player) {
    const ctx   = this._mmCtx;
    const scale = 6;
    const COLORS = { 0: '#282828', 1: '#786450', 2: '#147814', 3: '#8C5014', 4: '#6414A0' };

    ctx.clearRect(0, 0, this._mm.width, this._mm.height);

    for (let my = 0; my < MAP_HEIGHT; my++) {
      for (let mx = 0; mx < MAP_WIDTH; mx++) {
        ctx.fillStyle = COLORS[MAP[my][mx]] ?? '#000';
        ctx.fillRect(mx * scale, my * scale, scale - 1, scale - 1);
      }
    }

    // Player dot
    const px = Math.floor(player.x * scale);
    const py = Math.floor(player.y * scale);
    ctx.fillStyle = '#FF0000';
    ctx.fillRect(px - 1, py - 1, 3, 3);

    // Direction arrow
    ctx.fillStyle = '#FFFF00';
    for (let i = 1; i < 5; i++) {
      ctx.fillRect(
        px + Math.round(Math.cos(player.angle) * i),
        py + Math.round(Math.sin(player.angle) * i),
        1, 1
      );
    }
  }

  // ── Render loop ────────────────────────────────────────────────────────

  get scene() { return this._scene; }

  render(player, camOverride = null) {
    if (camOverride) {
      const { pos, target } = camOverride;
      this._camera.position.set(pos.x, pos.y, pos.z);
      this._camera.lookAt(target.x, target.y, target.z);
    } else {
      this._camera.position.set(player.x, 0.5, player.y);
      this._camera.lookAt(
        player.x + Math.cos(player.angle),
        0.5,
        player.y + Math.sin(player.angle)
      );
    }

    this._renderer.render(this._scene, this._camera);
    this._drawMinimap(player);
  }
}
