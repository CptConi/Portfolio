import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PostFX } from './PostFX.js';
import { MAP, MAP_WIDTH, MAP_HEIGHT, PUSH_WALL, floorAt, ceilAt, isSecretOpen } from './Map.js';
import { PROPS3D } from './Props3D.js';
import { SCREENS, ARCADE } from './Screens.js';
import { buildSprites } from './Sprites2D.js';
import { buildDecor } from './Decor.js';
import { moodOf } from '../features/mood.js';

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

const lerp = (a, b, u) => a + (b - a) * u;

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
    this._lookK = 1;   // how much of the player's freelook shows (eased to 0 under a camera override)

    // ── Scene ────────────────────────────────────────────────────────────
    this._scene = new THREE.Scene();
    this._scene.userData.canvas = canvas;
    this._scene.background = new THREE.Color(0x000000);
    this._scene.fog = new THREE.Fog(0x000000, 2, 18);

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
    // Feel pass (vignette, chromatic aberration, flash) + camera shake; public as `renderer.fx`.
    this._postfx = new PostFX();
    this.fx = this._postfx.api;
    this._composer.addPass(this._postfx.pass);
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

  // Quality level: 1 = bloom + feel pass, 0 = neither (the camera shake stays).
  setQuality(level) {
    this._bloom.enabled = level >= 1;
    this._postfx.setQuality(level);
  }

  // Compiles every shader of the scene as built so far and pushes one throw-away frame through the
  // composer (render targets, passes), so the first visible frame does not hitch. Call it once, before
  // the first render, behind the title screen.
  warmUp() {
    this._renderer.compile(this._scene, this._camera);
    this._composer.render();
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
    this._ambient = new THREE.AmbientLight(0xffffff, 0.6);   // eased per room by features/mood.js
    this._scene.add(this._ambient);
    const spots = [
      // A console can opt out of its ceiling spot with `light: false` (keeps the light budget).
      ...SCREENS.filter(s => s.light !== false).map(s => ({ x: s.x, z: s.z, c: new THREE.Color(s.color) })),
      { x: ARCADE.x, z: ARCADE.z, c: new THREE.Color(0xff2a9d) },
      { x: 12.5, z: 12, c: new THREE.Color(0x37c0ff) },   // atrium hub
    ];
    for (const sp of spots) {
      const L = new THREE.PointLight(sp.c, 12, 8, 2);
      L.position.set(sp.x, ceilAt(sp.x, sp.z) - 0.3, sp.z);
      this._scene.add(L);
    }

    // --- Level Design : Wayfinding Lights (Spill into Atrium) ---
    // Armurerie (West) - Green
    const L_West = new THREE.PointLight(0x00ff41, 2.5, 5, 2.0);
    L_West.position.set(8.5, 0.5, 12.5); // Inside West vestibule
    this._scene.add(L_West);

    // Trophées (East) - Orange
    const L_East = new THREE.PointLight(0xff8c00, 2.5, 5, 2.0);
    L_East.position.set(16.5, 0.5, 12.5); // Inside East vestibule
    this._scene.add(L_East);

    // Quartiers (North) - Violet
    const L_North = new THREE.PointLight(0xcc44ff, 2.5, 5, 2.0);
    L_North.position.set(12.5, 0.5, 8.5); // Inside North vestibule
    this._scene.add(L_North);

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
    const tint = new THREE.Color();

    // Every walkable cell (incl. the push-wall slot) gets its own floor + ceiling.
    const cells = [];
    for (let my = 0; my < MAP_HEIGHT; my++)
      for (let mx = 0; mx < MAP_WIDTH; mx++)
        if (this._isOpen(mx, my)) cells.push([mx, my]);

    // One InstancedMesh per material. A room's mood (features/mood.js) rides on the per-instance
    // colour, so only a different floor texture costs another draw call.
    const place = (geo, material, list, yFn, tintOf) => {
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach(([mx, my], i) => {
        dummy.position.set(mx + 0.5, yFn(mx, my), my + 0.5);
        dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1);
        dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
        const [r, g, b] = tintOf(moodOf(MAP[my][mx]));
        mesh.setColorAt(i, tint.setRGB(r, g, b));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      this._scene.add(mesh);
    };

    // Floors: the atrium, the vestibules and the secret room share FLOOR78; each room brings its own.
    const floorGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const floorsByTex = new Map();
    for (const cell of cells) {
      const id = moodOf(MAP[cell[1]][cell[0]]).floorTex;
      if (!floorsByTex.has(id)) floorsByTex.set(id, []);
      floorsByTex.get(id).push(cell);
    }
    for (const [id, list] of floorsByTex)
      place(floorGeo, new THREE.MeshLambertMaterial({ map: tex.get(id), color: 0x9a9a9a }), list,
        (mx, my) => floorAt(mx + 0.5, my + 0.5), m => m.floor);

    // Secret room floor override with METLT02 (id 61)
    // Starts at my=18 to cover the room threshold
    const secretFloorCells = cells.filter(([mx, my]) => my >= 18 && mx >= 9 && mx <= 16);
    if (secretFloorCells.length) {
      const sFloorGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      const sFloorMesh = new THREE.InstancedMesh(sFloorGeo, new THREE.MeshLambertMaterial({ map: tex.get(61) }), secretFloorCells.length);
      secretFloorCells.forEach(([mx, my], i) => {
        dummy.position.set(mx + 0.5, floorAt(mx + 0.5, my + 0.5) + 0.002, my + 0.5);
        dummy.updateMatrix(); sFloorMesh.setMatrixAt(i, dummy.matrix);
      });
      sFloorMesh.instanceMatrix.needsUpdate = true;
      this._scene.add(sFloorMesh);
    }

    // Secret hallway grate floor (Environmental storytelling)
    // Adjusted to fix the Z-glitch and avoid doubling the floor plane
    const grateGeo = new THREE.PlaneGeometry(0.99, 1.98).rotateX(-Math.PI / 2);
    const grateMesh = new THREE.Mesh(grateGeo, new THREE.MeshLambertMaterial({ map: tex.get(2), transparent: true, alphaTest: 0.5 }));
    // Placed slightly lower to avoid z-fighting but high enough to be seen as the only floor
    grateMesh.position.set(12.5, floorAt(12.5, 16.5) + 0.01, 16.5);
    this._scene.add(grateMesh);

    const ceilGeo = new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2);
    place(ceilGeo, new THREE.MeshLambertMaterial({ map: tex.get(41), color: 0x707070 }), cells,
      (mx, my) => ceilAt(mx + 0.5, my + 0.5), m => m.ceil);

    // Secret room ceiling panels (MIDBRN09 id 85)
    const ceilP1 = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ map: tex.get(85) }));
    ceilP1.position.set(10.5, ceilAt(10.5, 20.5) - 0.005, 20.5); this._scene.add(ceilP1);
    const ceilP2 = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ map: tex.get(85) }));
    ceilP2.position.set(14.5, ceilAt(14.5, 19.5) - 0.005, 19.5); this._scene.add(ceilP2);

    // Ceiling light panels — across all rooms & corridors, just below the local
    // ceiling, so high (cathedral) ceilings are actually lit and read as volume.
    const lit = cells.filter(([mx, my]) => mx % 3 === 1 && my % 3 === 1);
    if (lit.length) {
      const lightGeo = new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2);
      place(lightGeo, new THREE.MeshBasicMaterial({ map: tex.get(42) }), lit,
        (mx, my) => ceilAt(mx + 0.5, my + 0.5) - 0.004, m => m.lamp);
    }
  }

  _buildWalls() {
    const groups = new Map(); // texId → [{x, z, rotY, dim, h, cy, tint}]
    const addFace = (texId, x, z, rotY, dim, h, cy, tint) => {
      if (!groups.has(texId)) groups.set(texId, []);
      groups.get(texId).push({ x, z, rotY, dim, h, cy, tint });
    };
    const cellVal = (mx, my) => (mx < 0 || mx >= MAP_WIDTH || my < 0 || my >= MAP_HEIGHT) ? 1 : MAP[my][mx];
    // Every face looks into an open neighbour: it takes that room's mood (features/mood.js).
    const tintAt = (nx, ny) => moodOf(cellVal(nx, ny)).wall;
    const faceTexId = (mx, my, nv) => {
      if (nv >= 2 && nv <= 4) return nv;
      // Secret area texture overrides (by world coordinates)
      // Transition starts at Z=18 (threshold of the dark room)
      if (my >= 18 && mx >= 9 && mx <= 16) {
        if (my === 22) return (mx === 12 || mx === 13) ? 81 : 80; // Back wall: PIPEWAL mix
        return 70 + ((mx + my) % 3); // Side and entry-facing walls: COMPSP mix
      }
      if (my >= 16 && my <= 17 && mx === 12) return 60; // Secret hallway: concrete with wires
      return 20 + ((mx * 7 + my * 13) % 14);
    };
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
            addFace(faceTexId(mx, my, cellVal(nx, ny)), mx + ox, my + oz, rotY, dim, nc - nf, (nf + nc) / 2, tintAt(nx, ny));
          }
        } else if (this._isOpen(mx, my)) {
          // Risers (floor steps) + soffits (ceiling drops) toward LOWER neighbours.
          const f = fAt(mx, my), c = cAt(mx, my);
          for (const [dx, dy, ox, oz, rotY] of DIRS) {
            const nx = mx + dx, ny = my + dy;
            if (!this._isOpen(nx, ny)) continue;
            const nf = fAt(nx, ny), nc = cAt(nx, ny);
            if (nf < f - EPS) addFace(STEP_TEX, mx + ox, my + oz, rotY, 0.8, f - nf, (f + nf) / 2, tintAt(nx, ny));
            if (nc > c + EPS) addFace(STEP_TEX, mx + ox, my + oz, rotY, 0.6, nc - c, (c + nc) / 2, tintAt(nx, ny));
          }
        }
      }
    }

    const wallGeo = new THREE.PlaneGeometry(1, 1);
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    for (const [texId, faces] of groups) {
      const mesh = new THREE.InstancedMesh(wallGeo, new THREE.MeshLambertMaterial({ map: this._tex.get(texId), color: 0xb0b0b0 }), faces.length);
      faces.forEach(({ x, z, rotY, dim, h, cy, tint }, i) => {
        dummy.position.set(x, cy, z);
        dummy.rotation.set(0, rotY, 0);
        dummy.scale.set(1, h, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, col.setRGB(dim * tint[0], dim * tint[1], dim * tint[2]));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      this._scene.add(mesh);
    }
  }

  _buildProps() {
    // --- Level Design : Chaotic 3D Cable Loops (Hanging from ceiling) ---
    const cableMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
    const cablePositions = [
      { x: 12.3, z: 17.1, r: 0.18, ry: 0.2 }, { x: 12.7, z: 17.5, r: 0.25, ry: -0.4 }, // Hallway
      { x: 12.1, z: 17.9, r: 0.12, ry: 0.8 }, 
      { x: 11.0, z: 20.2, r: 0.35, ry: 1.1 }, { x: 14.0, z: 19.5, r: 0.22, ry: -0.9 }, // Inside room (moved to avoid console)
      { x: 13.5, z: 21.0, r: 0.40, ry: 0.3 }, 
    ];
    for (const cp of cablePositions) {
      const arcGeo = new THREE.TorusGeometry(cp.r, 0.01, 6, 12, Math.PI * 0.98); // tighter arc to ceiling
      const loop = new THREE.Mesh(arcGeo, cableMat);
      // Anchor precisely to ceiling.
      loop.position.set(cp.x, ceilAt(cp.x, cp.z), cp.z);
      loop.rotation.z = Math.PI; // hang DOWN
      loop.rotation.y = cp.ry;
      // loop.rotation.x = 0; // Removed chaotic X tilt to ensure it stays flush with ceiling
      loop.scale.set(1.0 + Math.random() * 0.4, 0.8 + Math.random() * 0.6, 1.0); // stretch to make them OVAL and hang at different depths
      this._scene.add(loop);
    }

    // --- Level Design : Oblique Pipes (DOSPI1B) ---
    // Darkened color (0x666666) and reduced width (0.9)
    const pipeMat = new THREE.MeshLambertMaterial({ map: this._tex.get(86), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, color: 0x666666 });
    const pipeGeo = new THREE.PlaneGeometry(0.9, 0.8); 
    
    const p1 = new THREE.Mesh(pipeGeo, pipeMat);
    p1.position.set(9.15, ceilAt(9.1, 18.1) - 0.25, 18.1); // NW Corner (further from wall)
    p1.rotation.set(Math.PI / 4, Math.PI / 4, 0); 
    this._scene.add(p1);

    const p2 = new THREE.Mesh(pipeGeo, pipeMat);
    p2.position.set(15.85, ceilAt(15.9, 18.1) - 0.25, 18.1); // NE Corner (further from wall)
    p2.rotation.set(Math.PI / 4, -Math.PI / 4, 0); 
    this._scene.add(p2);

    for (const prop of PROPS3D) {
      const isSecret = prop.y >= 18 || (prop.x >= 9 && prop.x <= 16 && prop.y >= 18);
      const tint = isSecret ? 0x444444 : 0xffffff; // Even darker tint for props in secret area
      const sideMat = new THREE.MeshLambertMaterial({ map: this._tex.get(prop.texSide), color: tint });
      const topMat  = new THREE.MeshLambertMaterial({ map: this._tex.get(prop.texTop ?? prop.texSide), color: tint });
      // BoxGeometry face order: +X,-X,+Y,-Y,+Z,-Z
      const mats = [sideMat, sideMat, topMat, sideMat, sideMat, sideMat];
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(prop.w, prop.h, prop.d), mats);
      mesh.position.set(prop.x, floorAt(prop.x, prop.y) + prop.h / 2, prop.y);
      this._scene.add(mesh);
    }
  }

  // ── Render loop ────────────────────────────────────────────────────────

  get scene() { return this._scene; }
  get ambient() { return this._ambient; }

  render(player, camOverride = null, tSec = 0) {
    this._decor?.update(tSec);
    this._sprites?.update(tSec);

    // Flicker + Ease-in logic for the secret backroom light
    if (this._secretLight) {
      // Base intensity reduced to ~20% of previous (from 15 to 3).
      // We also ease it in if the secret is open/opening.
      const targetIntensity = isSecretOpen() ? 3.5 : 0.0;
      
      // Smoothly approach the target intensity (ease out)
      this._secretLight.intensity = lerp(this._secretLight.intensity, targetIntensity, 0.05);

      if (this._secretLight.intensity > 0.1) {
        // High-contrast electric short-circuit flicker
        const chance = Math.random();
        let flicker = 1.0;
        if (chance > 0.96) flicker = 0.0; // Total blackout
        else if (chance > 0.85) flicker = 0.2 + Math.random() * 0.3; // Low light
        else flicker = 0.9 + Math.random() * 0.2; // Normal-ish
        
        this._secretLight.intensity *= flicker;
      }
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

    // Freelook is a vertical SHEAR of the projection (as in Build / Duke 3D), not a tilt of the camera:
    // walls stay vertical, nothing keystones. A camera override (console glide, tour, intro) owns the
    // view, so the shear eases out while one is active and back in when it ends.
    const dt = this._lookT === undefined ? 0 : Math.min(0.1, Math.max(0, tSec - this._lookT));
    this._lookT = tSec;
    this._lookK += ((camOverride ? 0 : 1) - this._lookK) * (1 - Math.exp(-dt * 10));
    const pitch = (player.pitch ?? 0) * this._lookK;
    this._camera.updateProjectionMatrix();
    if (Math.abs(pitch) > 1e-4) {
      const e = this._camera.projectionMatrix.elements;
      e[9] = Math.tan(pitch) * e[5];   // the horizon (elevation 0) lands at −tan(pitch) × the half-height
      this._camera.projectionMatrixInverse.copy(this._camera.projectionMatrix).invert();
    }

    // After lookAt so the shake also rides on a console's camera override.
    this._postfx.update(tSec);
    this._postfx.applyToCamera(this._camera);

    this._composer.render();
  }
}
