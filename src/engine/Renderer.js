import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { MAP, MAP_WIDTH, MAP_HEIGHT, PUSH_WALL, floorAt, ceilAt } from './Map.js';
import { PROPS3D } from './Props3D.js';
import { SCREENS, ARCADE } from './Screens.js';
import { buildSprites } from './Sprites2D.js';
import { buildDecor } from './Decor.js';

const INTERNAL_W = 640;
const INTERNAL_H = 360;

// Horizontal FOV = π/3 → convert to vertical FOV for Three.js
const H_FOV    = Math.PI / 3;
const ASPECT   = INTERNAL_W / INTERNAL_H;
// Vertical FOV that preserves a fixed horizontal FOV at a given aspect ratio.
const vFovDeg  = aspect => 2 * Math.atan(Math.tan(H_FOV / 2) / aspect) * (180 / Math.PI);
const V_FOV_DEG = vFovDeg(ASPECT);

const IS_MOBILE = typeof window !== 'undefined' &&
  ('ontouchstart' in window || navigator.maxTouchPoints > 0);

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
    this._scene.fog = new THREE.Fog(0x000000, 2, 18);

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

    // ── Post-processing (cheap at 640×360): bloom ───────────────────────────
    this._composer = new EffectComposer(this._renderer);
    this._composer.addPass(new RenderPass(this._scene, this._camera));

    this._bloom = new UnrealBloomPass(
      new THREE.Vector2(INTERNAL_W, INTERNAL_H),
      0.5,   // strength
      0.5,   // radius
      0.72,  // threshold — only bright pixels (screens, holos, spots, neon) bloom
    );
    this._composer.addPass(this._bloom);
    this._composer.addPass(new OutputPass());

    // Mobile: render at the real device resolution with a viewport-matched
    // aspect (horizontal FOV stays fixed) instead of upscaling the 640×360
    // retro buffer with object-fit:cover — keeps console text crisp, no crop.
    if (IS_MOBILE) {
      this._resize();
      window.addEventListener('resize', () => this._resize());
      window.addEventListener('orientationchange', () => this._resize());
    }
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this._renderer.setPixelRatio(dpr);
    this._renderer.setSize(w, h, false);
    this._composer.setPixelRatio(dpr);
    this._composer.setSize(w, h);   // resizes all passes (incl. bloom) to w*dpr
    const aspect = w / h;
    this._camera.aspect = aspect;
    this._camera.fov = vFovDeg(aspect);
    this._camera.updateProjectionMatrix();
  }

  // Quality level: 1 = bloom, 0 = none.
  setQuality(level) {
    this._bloom.enabled = level >= 1;
  }

  // ── Scene construction ─────────────────────────────────────────────────

  _buildScene() {
    this._buildLights();
    this._buildFloorCeiling();
    this._buildWalls();
    this._buildProps();
    this._sprites = buildSprites(this._scene, this._tex);
    this._decor = buildDecor(this._scene, this._tex);
  }

  // Low ambient + a coloured point light at each ceiling spot (consoles, atrium,
  // arcade) → real pools of light on the Lambert surfaces.
  _buildLights() {
    this._scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const spots = [
      ...SCREENS.map(s => ({ x: s.x, z: s.z, c: new THREE.Color(s.color) })),
      { x: ARCADE.x, z: ARCADE.z, c: new THREE.Color(0xff2a9d) },
      { x: 12.5, z: 12, c: new THREE.Color(0x37c0ff) },   // atrium hub
    ];
    for (const sp of spots) {
      const L = new THREE.PointLight(sp.c, 12, 8, 2);
      L.position.set(sp.x, ceilAt(sp.x, sp.z) - 0.3, sp.z);
      this._scene.add(L);
    }

    // Secret flickering pink light behind the push-wall (Portal style)
    // - distance: 3.5 (very short range to avoid bleeding into the atrium/rooms)
    // - decay: 3 (sharp falloff)
    this._secretLight = new THREE.PointLight(0xff2a9d, 0, 3.5, 3);
    this._secretLight.position.set(PUSH_WALL.mx + 0.5, ceilAt(PUSH_WALL.mx + 0.5, 17.5) - 0.1, 17.5);
    this._scene.add(this._secretLight);
  }

  _isPush(mx, my) { return mx === PUSH_WALL.mx && my === PUSH_WALL.my; }
  _isOpen(mx, my) {
    if (mx < 0 || mx >= MAP_WIDTH || my < 0 || my >= MAP_HEIGHT) return false;
    const v = MAP[my][mx];
    return v === 0 || v >= 2 || this._isPush(mx, my);
  }

  _buildFloorCeiling() {
    const tex = this._tex;
    const dummy = new THREE.Object3D();

    // Every walkable cell (incl. the push-wall slot) gets its own floor + ceiling.
    const cells = [];
    for (let my = 0; my < MAP_HEIGHT; my++)
      for (let mx = 0; mx < MAP_WIDTH; mx++)
        if (this._isOpen(mx, my)) cells.push([mx, my]);

    const place = (mesh, yFn) => {
      cells.forEach(([mx, my], i) => {
        dummy.position.set(mx + 0.5, yFn(mx, my), my + 0.5);
        dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1);
        dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this._scene.add(mesh);
    };

    const floorGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    place(new THREE.InstancedMesh(floorGeo, new THREE.MeshLambertMaterial({ map: tex.get(40), color: 0x9a9a9a }), cells.length),
      (mx, my) => floorAt(mx + 0.5, my + 0.5));

    const ceilGeo = new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2);
    place(new THREE.InstancedMesh(ceilGeo, new THREE.MeshLambertMaterial({ map: tex.get(41), color: 0x707070 }), cells.length),
      (mx, my) => ceilAt(mx + 0.5, my + 0.5));

    // Ceiling light panels — across all rooms & corridors, just below the local
    // ceiling, so high (cathedral) ceilings are actually lit and read as volume.
    const lit = cells.filter(([mx, my]) => mx % 3 === 1 && my % 3 === 1);
    if (lit.length) {
      const lightGeo = new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2);
      const lightMesh = new THREE.InstancedMesh(lightGeo, new THREE.MeshBasicMaterial({ map: tex.get(42) }), lit.length);
      lit.forEach(([mx, my], i) => {
        dummy.position.set(mx + 0.5, ceilAt(mx + 0.5, my + 0.5) - 0.004, my + 0.5);
        dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1);
        dummy.updateMatrix(); lightMesh.setMatrixAt(i, dummy.matrix);
      });
      lightMesh.instanceMatrix.needsUpdate = true;
      this._scene.add(lightMesh);
    }
  }

  _buildWalls() {
    const groups = new Map(); // texId → [{x, z, rotY, dim, h, cy}]
    const addFace = (texId, x, z, rotY, dim, h, cy) => {
      if (!groups.has(texId)) groups.set(texId, []);
      groups.get(texId).push({ x, z, rotY, dim, h, cy });
    };
    const cellVal = (mx, my) => (mx < 0 || mx >= MAP_WIDTH || my < 0 || my >= MAP_HEIGHT) ? 1 : MAP[my][mx];
    const faceTexId = (mx, my, nv) => (nv >= 2 && nv <= 4) ? nv : 20 + ((mx * 7 + my * 13) % 14);
    const fAt = (mx, my) => floorAt(mx + 0.5, my + 0.5);
    const cAt = (mx, my) => ceilAt(mx + 0.5, my + 0.5);
    const STEP_TEX = 26, EPS = 0.001;
    // [dx, dy, faceX, faceZ, rotY, dim]
    const DIRS = [
      [ 1, 0, 1, 0.5,  Math.PI / 2, 1.0], [-1, 0, 0, 0.5, -Math.PI / 2, 1.0],
      [ 0, 1, 0.5, 1,  0,           0.65], [ 0, -1, 0.5, 0, Math.PI,      0.65],
    ];

    for (let my = 0; my < MAP_HEIGHT; my++) {
      for (let mx = 0; mx < MAP_WIDTH; mx++) {
        const v = MAP[my][mx];
        const solid = v === 1 && !this._isPush(mx, my);

        if (solid) {
          // Wall faces toward open neighbours, spanning that neighbour's [floor, ceil].
          for (const [dx, dy, ox, oz, rotY, dim] of DIRS) {
            const nx = mx + dx, ny = my + dy;
            if (!this._isOpen(nx, ny)) continue;
            const nf = fAt(nx, ny), nc = cAt(nx, ny);
            addFace(faceTexId(mx, my, cellVal(nx, ny)), mx + ox, my + oz, rotY, dim, nc - nf, (nf + nc) / 2);
          }
        } else if (this._isOpen(mx, my)) {
          // Risers (floor steps) + soffits (ceiling drops) toward LOWER neighbours.
          const f = fAt(mx, my), c = cAt(mx, my);
          for (const [dx, dy, ox, oz, rotY] of DIRS) {
            const nx = mx + dx, ny = my + dy;
            if (!this._isOpen(nx, ny)) continue;
            const nf = fAt(nx, ny), nc = cAt(nx, ny);
            if (nf < f - EPS) addFace(STEP_TEX, mx + ox, my + oz, rotY, 0.8, f - nf, (f + nf) / 2);
            if (nc > c + EPS) addFace(STEP_TEX, mx + ox, my + oz, rotY, 0.6, nc - c, (c + nc) / 2);
          }
        }
      }
    }

    const wallGeo = new THREE.PlaneGeometry(1, 1);
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    for (const [texId, faces] of groups) {
      const mesh = new THREE.InstancedMesh(wallGeo, new THREE.MeshLambertMaterial({ map: this._tex.get(texId), color: 0xb0b0b0 }), faces.length);
      faces.forEach(({ x, z, rotY, dim, h, cy }, i) => {
        dummy.position.set(x, cy, z);
        dummy.rotation.set(0, rotY, 0);
        dummy.scale.set(1, h, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        col.setScalar(dim);
        mesh.setColorAt(i, col);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      this._scene.add(mesh);
    }
  }

  _buildProps() {
    for (const prop of PROPS3D) {
      const sideMat = new THREE.MeshLambertMaterial({ map: this._tex.get(prop.texSide) });
      const topMat  = new THREE.MeshLambertMaterial({ map: this._tex.get(prop.texTop ?? prop.texSide) });
      // BoxGeometry face order: +X,-X,+Y,-Y,+Z,-Z
      const mats = [sideMat, sideMat, topMat, sideMat, sideMat, sideMat];
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(prop.w, prop.h, prop.d), mats);
      mesh.position.set(prop.x, floorAt(prop.x, prop.y) + prop.h / 2, prop.y);
      this._scene.add(mesh);
    }
  }

  // ── Minimap ────────────────────────────────────────────────────────────

  _drawMinimap(player) {
    const ctx   = this._mmCtx;
    const scale = 6;
    const COLORS = { 0: '#282828', 1: '#786450', 2: '#147814', 3: '#8C5014', 4: '#6414A0', 5: '#786450', 6: '#2a2a40' };

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

  render(player, camOverride = null, tSec = 0) {
    this._decor?.update(tSec);
    this._sprites?.update(tSec);

    // Flicker logic for the secret backroom light
    if (this._secretLight) {
      const isOpening = PUSH_WALL.mx !== undefined && !this._isPushHidden; // checking if secret is revealed
      // In this engine, we don't have easy access to the secretOpen state directly here without importing,
      // but we can check the MAP or just let it flicker if it's near.
      // Actually, let's just make it flicker always but it's hidden by the wall.
      const baseIntensity = 15;
      const flicker = Math.random() > 0.93 ? Math.random() * 0.5 : 0.9 + Math.random() * 0.1;
      this._secretLight.intensity = baseIntensity * flicker;
    }

    if (camOverride) {
      const { pos, target } = camOverride;
      this._camera.position.set(pos.x, pos.y, pos.z);
      this._camera.lookAt(target.x, target.y, target.z);
    } else {
      const eye = player.eyeY;
      this._camera.position.set(player.x, eye, player.y);
      this._camera.lookAt(
        player.x + Math.cos(player.angle),
        eye,
        player.y + Math.sin(player.angle)
      );
    }

    this._composer.render();
    this._drawMinimap(player);
  }
}
