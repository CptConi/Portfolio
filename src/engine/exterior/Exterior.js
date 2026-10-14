import * as THREE from 'three';
import { BLOCKS, LINKS, SKYLIGHT, GROUND_Y, WORLD_RADIUS } from './exteriorLayout.js';
import { SUN, EARTH, HORIZON } from '../props/sky.js';
import { prefs } from '../prefs.js';
import { buildSkyDome } from './skyDome.js';
import { buildTerrain, buildBerms, pixelFog } from './terrain.js';
import { buildHulls } from './hulls.js';

// The EXTERIOR WORLD seen through the windows: a second scene (the lunar plain, the base's hulls seen from outside, its props, a sky dome),
// drawn from the player's own camera into a render target that the window panes (decor/windows.js) sample. Same camera = same position,
// orientation, sheared projection and shake, so the picture through a pane is exact by construction and parallax is real.
//
//   buildExterior({ tex, deferred }) → { scene, target, texture, setSize(w, h), render(renderer, camera, t), warmUp(renderer, camera), flush(), addProps(fn), dispose() }
//   setSize(w, h)   the composer's render size (the panes read the target at gl_FragCoord / size: same pixels as the main pass)
//   render(…)       draws with `camera` into `target`; restores the render target, autoClear and shadowMap.enabled it touched
//   warmUp(…)       paints the sky if it is still to do, compiles and renders one frame (which also renders the shadow map): call it once, behind the title screen
//   flush()         runs every deferred job now (the proofs, a screenshot tool)
//
// What is in it (5 draw calls of its own: sky, plain, drifts, hulls, glass + beacons; the props module's six come on top: its dressing of the base and,
// poured later, its plain):
//   sky dome       skyDome.js · props/sky.js painted once, read by direction; drawn first, without depth
//   plain          terrain.js · one quad that follows the camera, regolith tile × a non-repeating macro map, dithered fog into HORIZON
//   drifts         terrain.js · low skirts of regolith at the foot of the outer walls (sides that face an alley stay clear)
//   hulls          hulls.js · the blocks and tubes of exteriorLayout.js at their real height, each with its own identity (colour, lit glass at
//                  the real places of the level's windows), the alleys' walkway
//   props          ./props.js (buildExteriorProps(scene, ctx)): names, equipment, roofs and masts, the plain; absent = skipped, silently
//
// STARTUP: what the first frame needs is built at once (the hulls and their sheet, the props that dress them: names, equipment, roofs, the tower); the rest
// waits for the browser's idle time, one job per slice (about 5 to 60 ms each): the ground's textures, then the plain's props (antennas, solar field, lander,
// rocks), and the sky at the latest in warmUp(). `deferred: false` (or a build outside a browser) does it all at once. parts.timing says where the time goes.
//
// Light: ONE directional sun (props/sky.js SUN: the Sun of the sky is the Sun that lights the plain) with a REAL, hard shadow map that is
// rendered once (the world is static) and a weak bluish hemisphere, the Earth's light ("earthshine"). No point light.
// The colour pipeline is linear (HalfFloat target on desktop, 8 bit on touch devices); the panes output linear, the OutputPass converts.
// Bloom (threshold 0.72) catches the Sun disc and the beacons (HDR); the plain, the hulls and the lit glass, all lit by the Sun at most, stay well under it.

const IS_TOUCH = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

const INTERNAL_W = 640, INTERNAL_H = 360;
const CENTER = { x: 12.5, z: 12.5 };   // the middle of the base
const FOG_NEAR = 22, FOG_FAR = 46;
const MAX_SHADOW = IS_TOUCH ? 2048 : 4096;

// Light levels. Three's directional light is in "π units": intensity π gives a surface square to it exactly its albedo.
const SUN_COLOR = 0xfff1de;
const SUN_I = Math.PI * 1.0;
const HEMI_SKY = 0x7084b4, HEMI_GROUND = 0x6a5e54;
const HEMI_I = Math.PI * 0.32;
const GROUND_GAIN = 0.85;   // the painted tile × this when the sun is on it

const D2R = Math.PI / 180;
const sunDirection = () => {
  const c = Math.cos(SUN.el * D2R);
  return new THREE.Vector3(c * Math.cos(SUN.az * D2R), Math.sin(SUN.el * D2R), c * Math.sin(SUN.az * D2R));
};

// The props dresser's module, when it exists. An eager glob: bundled by Vite (dev and build) when ./props.js is there, an empty object
// when it is not; in plain node `import.meta.glob` is not a function and the catch gives the same empty object.
let OPTIONAL = {};
try { OPTIONAL = import.meta.glob('./props.js', { eager: true }); } catch { OPTIONAL = {}; }
const DEFAULT_PROPS = Object.values(OPTIONAL)[0]?.buildExteriorProps ?? null;

// `buildProps` replaces the props module (check-exterior.mjs passes it directly: plain node has no import.meta.glob).
// `deferred` (default: in a browser) hands the sky, the ground's textures and the plain's props to the idle queue; false builds everything now.
export function buildExterior({ tex = null, type = null, buildProps = DEFAULT_PROPS, deferred = typeof window !== 'undefined' } = {}) {
  const timing = {};
  let _t = typeof performance !== 'undefined' ? performance.now() : 0;
  const lap = k => { if (typeof performance === 'undefined') return; const n = performance.now(); timing[k] = +(n - _t).toFixed(1); _t = n; };
  const look = { uPx: { value: 1 } };
  const scene = new THREE.Scene();
  scene.name = 'exterior';
  scene.fog = new THREE.Fog(HORIZON, FOG_NEAR, FOG_FAR);
  const sunDir = sunDirection();
  const center = new THREE.Vector3(CENTER.x, 0, CENTER.z);

  // ── Render target ──
  const targetType = type ?? (IS_TOUCH ? THREE.UnsignedByteType : THREE.HalfFloatType);
  const target = new THREE.WebGLRenderTarget(INTERNAL_W, INTERNAL_H, {
    type: targetType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
    generateMipmaps: false,
  });
  target.texture.name = 'exterior';
  // 8 bit: the target is sRGB, so the hardware encodes what the exterior writes (linear) and decodes it again when a pane samples it: the
  // dark plain keeps its steps instead of a handful of linear 1/255 levels. The panes see linear values either way.
  if (targetType === THREE.UnsignedByteType) target.texture.colorSpace = THREE.SRGBColorSpace;

  // ── Deferred work ──
  // What the first frame does not need is made later, in slices of the browser's idle time (one job per slice, cheapest first of what is needed soonest):
  // the sky (painted in warmUp() at the latest: behind the title screen), the ground's textures, the plain's props (antennas, solar field, lander, rocks).
  // Until a job has run the panes show a black sky, a flat grey ground, a bare plain: nothing a visitor reaches that early can tell. flush() runs them all.
  const queue = [];
  let disposed = false;
  timing.deferred = {};
  const idle = deferred ? (typeof requestIdleCallback === 'function' ? cb => requestIdleCallback(cb, { timeout: 500 }) : cb => setTimeout(cb, 30)) : null;
  const defer = (label, fn) => { queue.push({ label, fn }); };
  const runJob = job => {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    let r = null;
    try { r = job.fn(); } catch (e) { console.warn(`[exterior] ${job.label} failed:`, e); }
    timing.deferred[job.label] = typeof performance !== 'undefined' ? +(performance.now() - t0).toFixed(1) : 0;
    if (r && typeof r === 'object') info.props.push(r);
    if (job.label.startsWith('props')) dirty = true;   // meshes were added: refit the shadow frustum, render the shadow map again
  };
  const pump = () => {
    if (disposed || !queue.length) return;
    runJob(queue.shift());
    if (queue.length) idle(pump);
  };
  const flush = () => { while (queue.length) runJob(queue.shift()); };
  const runFirst = label => { const i = queue.findIndex(j => j.label === label); if (i >= 0) runJob(queue.splice(i, 1)[0]); };

  // ── Parts ──
  const sky = buildSkyDome({ reducedMotion: prefs.reducedMotion, defer: !!idle });
  scene.add(sky.dome);
  if (idle) defer('sky', () => sky.paint());
  lap('sky');

  const hulls = buildHulls({ tex });
  lap('hulls');
  const keep = hulls.footprints.map(f => ({ x0: f.x0 - 2, x1: f.x1 + 2, z0: f.z0 - 2, z1: f.z1 + 2 }));
  const terrain = buildTerrain({ look, sunDir, groundY: GROUND_Y, center, keep, defer: !!idle });
  if (idle) defer('terrain', () => terrain.paint());
  terrain.material.color.setScalar(GROUND_GAIN);
  scene.add(terrain.plain);
  const driftMesh = buildBerms({ berms: hulls.berms, groundY: GROUND_Y, material: terrain.material });
  if (driftMesh) scene.add(driftMesh);
  lap('terrain');

  const hullMat = pixelFog(new THREE.MeshLambertMaterial({ map: hulls.texture, vertexColors: true }), look);
  const hullMesh = new THREE.Mesh(hulls.lit.geometry(), hullMat);
  hullMesh.name = 'exterior:hulls';
  hullMesh.matrixAutoUpdate = false;
  scene.add(hullMesh);

  const glowMat = pixelFog(new THREE.MeshBasicMaterial({ vertexColors: true }), look);
  let glowMesh = null;

  // ── Lights ──
  const sun = new THREE.DirectionalLight(SUN_COLOR, SUN_I);
  sun.position.copy(center).addScaledVector(sunDir, 120);
  sun.target.position.copy(center);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);   // refitted in finalize()
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.03;
  sun.shadow.autoUpdate = false;        // the world is static: the shadow map is rendered once (and again when props are added)
  sun.shadow.needsUpdate = true;
  scene.add(sun, sun.target);
  // Earthshine: the hemisphere's "up" leans toward the Earth (props/sky.js EARTH, south): faces that look toward it get the cool sky colour,
  // faces that look away from the Earth the warm bounce of the sunlit regolith.
  const hemi = new THREE.HemisphereLight(HEMI_SKY, HEMI_GROUND, HEMI_I);
  const ce = Math.cos(EARTH.el * D2R);
  hemi.position.set(0, 0.8, 0).addScaledVector(new THREE.Vector3(ce * Math.cos(EARTH.az * D2R), Math.sin(EARTH.el * D2R), ce * Math.sin(EARTH.az * D2R)), 0.6).normalize();
  scene.add(hemi);

  // ── Props ──
  const addBeacon = (x, y, z, color = 0xff3a2a, size = 0.14) => {
    const c = new THREE.Color(color);
    hulls.glow.octa(x, y, z, size / 2, [c.r * 3, c.g * 3, c.b * 3]);   // HDR (×3): the bloom pass catches it
    dirty = true;
  };
  const clear = (x, z, r = 0) => !hulls.footprints.some(f => x + r > f.x0 && x - r < f.x1 && z + r > f.z0 && z - r < f.z1);
  const ctx = {
    tex, GROUND_Y, BLOCKS, LINKS, SKYLIGHT, WORLD_RADIUS, sunDir: sunDir.clone(), addBeacon,
    // extras (not in the spec): the middle of the base, hull + drift footprints, a test for "is this ground point free", the lit windows of
    // the hulls (every window of the level, on its face), and the dithered fog of the exterior for any Lambert / Basic material the props
    // create (no gradient, six ordered-dithered steps).
    center: { x: CENTER.x, z: CENTER.z }, footprints: hulls.footprints, clear, windows: hulls.windowsOnHulls, pixelFog: m => pixelFog(m, look),
    // defer(label, fn): the props module hands its slices to the builder's idle queue (fn may return its description, kept in parts.info.props)
    defer: idle ? defer : undefined,
  };

  let dirty = true;
  const info = { props: [] };   // what the props modules return (props.js: its described objects, for the proofs)
  const runProps = fn => {
    try { info.props.push(fn(scene, ctx)); } catch (e) { console.warn('[exterior] props failed:', e); }
    dirty = true;
  };
  lap('lights');
  if (buildProps) runProps(buildProps);
  lap('props');
  timing.detail = { terrain: terrain.timing, hulls: hulls.timing, props: info.props[0]?.timing };
  if (queue.length && idle) idle(pump);

  // Shadow flags, the unlit mesh, and the shadow frustum fitted on what can cast: run once, and again after props are added.
  const _box = new THREE.Box3(), _b = new THREE.Box3(), _v = new THREE.Vector3(), _inv = new THREE.Matrix4();
  function finalize() {
    dirty = false;
    if (glowMesh) { scene.remove(glowMesh); glowMesh.geometry.dispose(); glowMesh = null; }
    if (!hulls.glow.empty) {
      glowMesh = new THREE.Mesh(hulls.glow.geometry(), glowMat);
      glowMesh.name = 'exterior:glow';
      glowMesh.matrixAutoUpdate = false;
      glowMesh.userData.noCast = true;
      scene.add(glowMesh);
    }
    scene.updateMatrixWorld(true);
    _box.makeEmpty();
    scene.traverse(o => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      const m = o.material;
      const lambertish = !!m && !Array.isArray(m) && (m.isMeshLambertMaterial || m.isMeshStandardMaterial || m.isMeshPhongMaterial || m.isMeshToonMaterial);
      o.receiveShadow = lambertish;
      o.castShadow = lambertish && !m.transparent && !o.userData.noCast;
      if (o.castShadow) _box.union(_b.setFromObject(o));
    });
    if (_box.isEmpty()) return;
    // fit the sun's orthographic frustum around the casters (in the light's own frame); the far plane reaches past them so a long shadow
    // still falls on the plain behind a tall thing
    const cam = sun.shadow.camera;
    sun.position.copy(center).addScaledVector(sunDir, 120);
    sun.updateMatrixWorld(true); sun.target.updateMatrixWorld(true);
    cam.position.copy(sun.position);
    cam.lookAt(center);
    cam.updateMatrixWorld(true);
    _inv.copy(cam.matrixWorld).invert();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const x of [_box.min.x, _box.max.x]) for (const y of [_box.min.y, _box.max.y]) for (const z of [_box.min.z, _box.max.z]) {
      _v.set(x, y, z).applyMatrix4(_inv);
      x0 = Math.min(x0, _v.x); x1 = Math.max(x1, _v.x); y0 = Math.min(y0, _v.y); y1 = Math.max(y1, _v.y); z0 = Math.min(z0, _v.z); z1 = Math.max(z1, _v.z);
    }
    const pad = 1.5;
    cam.left = x0 - pad; cam.right = x1 + pad; cam.bottom = y0 - pad; cam.top = y1 + pad;
    cam.near = Math.max(1, -z1 - pad); cam.far = -z0 + pad + 70;
    cam.updateProjectionMatrix();
    // texel ≈ 2 cm: as sharp as the pixels need (a game pixel is 1.6 cm at 10 m); a map of the bare base is a quarter of the one of the whole world
    const pow2 = v => 2 ** Math.round(Math.log2(Math.max(512, Math.min(v, MAX_SHADOW))));   // nearest power of two: a 4096² map would be 64 MB for a 1 cm texel nobody sees
    const w = pow2((cam.right - cam.left) / 0.02), h = pow2((cam.top - cam.bottom) / 0.02);
    if (sun.shadow.mapSize.x !== w || sun.shadow.mapSize.y !== h) {
      sun.shadow.mapSize.set(w, h);
      if (sun.shadow.map) { sun.shadow.map.depthTexture?.dispose(); sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    sun.shadow.needsUpdate = true;
  }

  // ── Frame ──
  let shadowTypeSet = new WeakSet();
  function prepare(renderer) {
    if (!shadowTypeSet.has(renderer)) {
      renderer.shadowMap.type = THREE.BasicShadowMap;   // hard, nearest-filtered edges: the pixel look (set once: changing it recompiles)
      shadowTypeSet.add(renderer);
    }
  }
  const _saved = {};
  function enter(renderer) {
    _saved.target = renderer.getRenderTarget();
    _saved.autoClear = renderer.autoClear;
    _saved.shadow = renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = true;
    renderer.autoClear = true;
  }
  function leave(renderer) {
    renderer.setRenderTarget(_saved.target);
    renderer.autoClear = _saved.autoClear;
    renderer.shadowMap.enabled = _saved.shadow;
  }

  return {
    scene, target, texture: target.texture,
    // the parts, for the preview page and the proofs
    parts: { sky, terrain, hulls, sun, hemi, ctx, look, timing, info, finalize, flush, queue },
    // where the cold build time goes (ms): the stages above and, inside them, terrain / hulls / props

    setSize(w, h) {
      target.setSize(w, h);
      look.uPx.value = Math.max(1, Math.round(w / INTERNAL_W));
    },

    render(renderer, camera, t = 0) {
      if (dirty) finalize();
      prepare(renderer);
      const p = camera.position;
      sky.dome.position.copy(p);
      sky.dome.scale.setScalar(camera.far * 0.8);
      terrain.follow(p.x, p.z);
      sky.uniforms.uTime.value = t;
      sky.uniforms.uTwinkle.value = prefs.reducedMotion ? 0 : 1;
      enter(renderer);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      leave(renderer);
    },

    // Compiles the exterior's shaders and renders one frame (which also renders the shadow map): call it once, behind the title screen.
    warmUp(renderer, camera) {
      runFirst('sky');   // behind the title screen: the first frame that shows the sky has its stars
      if (dirty) finalize();
      prepare(renderer);
      enter(renderer);
      renderer.compile(scene, camera);
      leave(renderer);
      this.render(renderer, camera, 0);
    },

    // fn(scene, ctx) adds meshes to the exterior scene (same ctx the props module gets).
    addProps(fn) { runProps(fn); },

    // runs every deferred job now (the proofs, a screenshot tool); nothing to do once they have all run
    flush,

    dispose() {
      disposed = true; queue.length = 0;
      target.dispose();
      sky.dispose(); terrain.dispose(); hulls.dispose();
      hullMat.dispose(); glowMat.dispose();
      sun.shadow.map?.depthTexture?.dispose();
      sun.shadow.dispose();
      // everything the props module added too
      scene.traverse(o => {
        o.geometry?.dispose?.();
        for (const m of [].concat(o.material ?? [])) { m.map?.dispose?.(); m.dispose?.(); }
      });
    },
  };
}
