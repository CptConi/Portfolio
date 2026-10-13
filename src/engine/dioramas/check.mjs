// Dev check for the mission dioramas — plain node, no GPU, no browser:
//   node src/engine/dioramas/check.mjs
// Proves, for every kind and every animation pose sampled over a minute, that the
// geometry stays inside 0.40 × 0.38 × 0.40 m with its origin at the bottom centre and
// within 24 cm of the axis (so a diorama never overhangs a 0.5 m plinth, whatever its yaw),
// that nothing moves faster at t = 1 h or 11 days than at t = 5 s (animations are periodic,
// never driven by raw uptime), that reduced motion freezes the pose, that fixed culling
// bounds really contain the animated geometry, that point sprites keep their true size on
// any camera, that every text fits its canvas and stays legible from 1.5 m, and that
// dispose() frees everything. Exits non-zero on any failure. Text textures are skipped (no
// DOM) in the first pass and exercised with a stub canvas in the second.
import * as THREE from 'three';
import { prefs } from '../prefs.js';
import { DIORAMA_KINDS, createDiorama, dioramaFor } from './index.js';
import { poolSize, trueSize } from './kit.js';

const LIMIT = { half: 0.20, height: 0.38, radius: 0.24, meshes: 40, drawCalls: 14 };
const SPEED_LIMIT = 400;                 // cm/s that no vertex may sustain (legit peak is ~110)
const MIN_GLYPH_PX = 8;                  // 640×360 px height of one glyph cell at 1.5 m
const EYE = { dist: 1.5, vfov: 2 * Math.atan(Math.tan(Math.PI / 6) / (16 / 9)) };
const EPS = 1e-6;
let failures = 0;
const fail = msg => { failures++; console.log(`  FAIL ${msg}`); };
const ok = (cond, msg) => { if (!cond) fail(msg); };

// ── world-space bounds of everything that renders (vertex-exact; sprites by half size) ──
const v = new THREE.Vector3();
const s = new THREE.Vector3();
const m = new THREE.Matrix4();
const inst = new THREE.Matrix4();

const isShown = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
const isRenderable = o => o.isMesh || o.isLine || o.isPoints || o.isSprite;

function renderables(group) {
  const list = [];
  group.traverse(o => { if (isRenderable(o) && isShown(o)) list.push(o); });
  return list;
}

function measure(group) {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3();
  let tris = 0, radius2 = 0;
  for (const o of renderables(group)) {
    if (o.isSprite) {
      o.getWorldPosition(v);
      o.getWorldScale(s);
      const r = Math.max(s.x, s.y) / 2;
      box.expandByPoint(new THREE.Vector3(v.x - r, v.y - r, v.z - r));
      box.expandByPoint(new THREE.Vector3(v.x + r, v.y + r, v.z + r));
      continue;
    }
    const pos = o.geometry.attributes.position;
    const copies = o.isInstancedMesh ? o.count : 1;
    tris += (o.geometry.index ? o.geometry.index.count : pos.count) / 3 * copies;
    for (let c = 0; c < copies; c++) {
      m.copy(o.matrixWorld);
      if (o.isInstancedMesh) { o.getMatrixAt(c, inst); m.multiply(inst); }
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m);
        box.expandByPoint(v);
        if (!o.isPoints) radius2 = Math.max(radius2, v.x * v.x + v.z * v.z);
      }
    }
  }
  return { box, calls: renderables(group).length, tris, radius: Math.sqrt(radius2) };
}

// Numeric fingerprint of everything that can move: transforms, instances, point clouds, opacities.
function signature(group) {
  group.updateMatrixWorld(true);
  let sum = 0;
  group.traverse(o => {
    for (let i = 0; i < 16; i++) sum += o.matrixWorld.elements[i] * (i + 1);
    if (o.isInstancedMesh) for (let i = 0; i < o.instanceMatrix.array.length; i++) sum += o.instanceMatrix.array[i] * ((i % 7) + 1);
    if (o.geometry && o.geometry.attributes.position && (o.isPoints || o.geometry.attributes.position.usage === THREE.DynamicDrawUsage)) {
      for (const a of Object.values(o.geometry.attributes)) for (let i = 0; i < a.array.length; i++) sum += a.array[i] * ((i % 5) + 1);
    }
    for (const mat of [].concat(o.material || [])) sum += (mat.opacity ?? 0) * 13 + (mat.color ? mat.color.r + 2 * mat.color.g + 3 * mat.color.b : 0);
    sum += o.visible ? 1 : 0;
  });
  return sum;
}

// World positions of a few probe points per object: a pose-to-pose comparison of these
// measures how fast anything moves, rotations included (box corners swing with the object).
const corner = new THREE.Vector3();
function probes(group, out) {
  group.updateMatrixWorld(true);
  let n = 0;
  const put = p => { if (n + 3 > out.length) throw new RangeError('probe buffer too small'); out[n++] = p.x; out[n++] = p.y; out[n++] = p.z; };
  group.traverse(o => {
    if (o.isSprite) { put(o.getWorldPosition(corner)); return; }
    if (!o.geometry) return;
    if (o.isPoints) {
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) put(corner.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
      return;
    }
    if (!isRenderable(o)) return;
    const g = o.geometry;
    if (g.attributes.position.usage === THREE.DynamicDrawUsage) {      // streaming geometry (the IRUN beam)
      for (let i = 0; i < g.attributes.position.count; i++) put(corner.fromBufferAttribute(g.attributes.position, i).applyMatrix4(o.matrixWorld));
      return;
    }
    if (!g.boundingBox) g.computeBoundingBox();
    const b = g.boundingBox;
    const copies = o.isInstancedMesh ? o.count : 1;
    for (let c = 0; c < copies; c++) {
      m.copy(o.matrixWorld);
      if (o.isInstancedMesh) { o.getMatrixAt(c, inst); m.multiply(inst); }
      for (let k = 0; k < 8; k++) put(corner.set(k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.y : b.min.y, k & 4 ? b.max.z : b.min.z).applyMatrix4(m));
    }
  });
  return n;
}

// Fastest speed (cm/s) any probe sustains over two consecutive 1 ms steps, over `bursts`
// random-ish instants of a 12 s window starting at t0. A scrolling item that wraps around is a
// single-step teleport and is ignored; a runaway rotation keeps moving step after step.
function sustainedSpeed(d, t0, bursts = 900) {
  const DT = 0.001;
  const a = new Float64Array(8192), b = new Float64Array(8192), c = new Float64Array(8192);
  let worst = 0;
  for (let k = 0; k < bursts; k++) {
    const t = t0 + (k + 0.37) * 12 / bursts;
    d.update(t, DT); const n = probes(d.group, a);
    d.update(t + DT, DT); probes(d.group, b);
    d.update(t + 2 * DT, DT); probes(d.group, c);
    for (let i = 0; i < n; i += 3) {
      const v1 = Math.hypot(b[i] - a[i], b[i + 1] - a[i + 1], b[i + 2] - a[i + 2]);
      const v2 = Math.hypot(c[i] - b[i], c[i + 1] - b[i + 1], c[i + 2] - b[i + 2]);
      worst = Math.max(worst, Math.min(v1, v2) / DT * 100);
    }
  }
  return worst;
}

// Animated geometry must sit inside the fixed culling sphere it was given (in its own frame).
function boundsHold(group) {
  group.updateMatrixWorld(true);
  let worst = 0;
  group.traverse(o => {
    const dynamic = o.isInstancedMesh || o.isPoints || (o.isMesh && o.geometry.attributes.position.usage === THREE.DynamicDrawUsage);
    if (!dynamic) return;
    const sphere = o.isInstancedMesh ? o.boundingSphere : o.geometry.boundingSphere;
    if (!sphere) { worst = Infinity; return; }
    const pos = o.geometry.attributes.position;
    const copies = o.isInstancedMesh ? o.count : 1;
    for (let c = 0; c < copies; c++) {
      if (o.isInstancedMesh) o.getMatrixAt(c, inst); else inst.identity();
      for (let i = 0; i < pos.count; i++) worst = Math.max(worst, corner.fromBufferAttribute(pos, i).applyMatrix4(inst).distanceTo(sphere.center) - sphere.radius);
    }
  });
  return worst;
}

// ── pass 1: no DOM at all ───────────────────────────────────────────────────────
console.log('dioramaFor');
for (const [name, kind] of [
  ['PHENIX FORMATION', 'phenix'], ['neemba thebridge', 'neemba'], ['TBE', 'tbe'], ['Irun', 'irun'],
  ['PARFUMERIE PRIVÉE', 'parfumerie'], ['parfumerie privée', 'parfumerie'], ['PARFUMERIE PRIVÉE', 'parfumerie'],
  ['OVIEPRO', 'oviepro'], ['HEARTSIDE', 'heartside'], ['1001TAXIS', 'taxis'],
  ['LOOT LURKER', null], ['', null], [undefined, null], [42, null],
]) ok(dioramaFor(name) === kind, `dioramaFor(${JSON.stringify(name)}) → ${dioramaFor(name)}, expected ${kind}`);
ok(DIORAMA_KINDS.length === 8, 'DIORAMA_KINDS has 8 entries');
try { createDiorama('nope'); fail('createDiorama(unknown) should throw'); } catch { /* expected */ }

const T_END = 60, T_STEP = 0.07;
console.log('\nkind        meshes  calls  tris   size cm (x y z)         min.y   max|x|  max|z|  radius  update µs');
for (const kind of DIORAMA_KINDS) {
  const d = createDiorama(kind);
  let worst = { x: 0, y: 0, z: 0, minY: Infinity, absX: 0, absZ: 0, calls: 0, tris: 0, radius: 0, outside: -Infinity };
  for (let t = 0; t < T_END; t += T_STEP) {
    d.update(t, T_STEP);
    const { box, calls, tris, radius } = measure(d.group);
    worst.x = Math.max(worst.x, box.max.x - box.min.x);
    worst.y = Math.max(worst.y, box.max.y);
    worst.z = Math.max(worst.z, box.max.z - box.min.z);
    worst.minY = Math.min(worst.minY, box.min.y);
    worst.absX = Math.max(worst.absX, Math.abs(box.min.x), Math.abs(box.max.x));
    worst.absZ = Math.max(worst.absZ, Math.abs(box.min.z), Math.abs(box.max.z));
    worst.calls = Math.max(worst.calls, calls);
    worst.tris = Math.max(worst.tris, tris);
    worst.radius = Math.max(worst.radius, radius);
    worst.outside = Math.max(worst.outside, boundsHold(d.group));
  }
  // pure update cost: no measuring
  const u0 = process.hrtime.bigint();
  for (let t = 0; t < 20; t += 0.016) d.update(t, 0.016);
  const per = Number(process.hrtime.bigint() - u0) / 1e3 / Math.ceil(20 / 0.016);

  let meshes = 0;
  d.group.traverse(o => { if (isRenderable(o)) meshes++; });
  console.log(`${kind.padEnd(11)} ${String(meshes).padStart(6)} ${String(worst.calls).padStart(6)} ${String(Math.round(worst.tris)).padStart(6)}  ${[worst.x, worst.y, worst.z].map(n => (n * 100).toFixed(1).padStart(5)).join(' ')}   ${(Math.abs(worst.minY) < EPS ? 0 : worst.minY * 100).toFixed(2).padStart(8)} ${(worst.absX * 100).toFixed(1).padStart(8)} ${(worst.absZ * 100).toFixed(1).padStart(7)} ${(worst.radius * 100).toFixed(1).padStart(7)}  ${per.toFixed(1).padStart(8)}`);

  ok(worst.absX <= LIMIT.half + EPS, `${kind}: |x| reaches ${(worst.absX * 100).toFixed(2)} cm (limit 20)`);
  ok(worst.absZ <= LIMIT.half + EPS, `${kind}: |z| reaches ${(worst.absZ * 100).toFixed(2)} cm (limit 20)`);
  ok(worst.radius <= LIMIT.radius + EPS, `${kind}: solid geometry reaches ${(worst.radius * 100).toFixed(2)} cm from the axis (limit 24)`);
  ok(worst.y <= LIMIT.height + EPS, `${kind}: height reaches ${(worst.y * 100).toFixed(2)} cm (limit 38)`);
  ok(worst.minY >= -EPS, `${kind}: goes below the plinth top (${(worst.minY * 100).toFixed(2)} cm)`);
  ok(meshes <= LIMIT.meshes, `${kind}: ${meshes} meshes (limit ${LIMIT.meshes})`);
  ok(worst.calls <= LIMIT.drawCalls, `${kind}: ${worst.calls} draw calls (budget ${LIMIT.drawCalls})`);
  ok(worst.outside <= EPS, `${kind}: animated geometry leaves its fixed culling bound by ${(worst.outside * 100 | 0) / 100} cm`);
  ok(d.group.parent === null, `${kind}: group must not be attached by createDiorama`);
  d.group.traverse(o => { if (isRenderable(o)) ok(o.frustumCulled !== false, `${kind}: ${o.type} has frustum culling switched off`); });

  // reduced motion: frozen on one identical pose, whatever t is; motion resumes afterwards
  prefs.reducedMotion = true;
  d.update(1.234, 0.016);
  const still = signature(d.group);
  d.update(97.5, 0.016);
  d.update(3.3, 0.016);
  ok(signature(d.group) === still, `${kind}: reduced motion must freeze the pose`);
  prefs.reducedMotion = false;
  d.update(5, 0.016);
  const moving = signature(d.group);
  d.update(5.4, 0.016);
  ok(signature(d.group) !== moving, `${kind}: motion must resume after reduced motion is switched off`);
  d.dispose();
}
ok(poolSize() === 0, `pool must be empty after disposing everything (${poolSize()} left)`);

// ── uptime: speeds at t = 5 s, 1 h and 11 days must be the same kind of speed ─────
console.log('\nsustained speed (cm/s) at t0 =     5 s        1 h     11 days');
for (const kind of DIORAMA_KINDS) {
  const d = createDiorama(kind);
  const speeds = [5, 3600.3, 1e6 + 0.7].map(t0 => sustainedSpeed(d, t0));
  console.log(`  ${kind.padEnd(11)} ${speeds.map(x => x.toFixed(1).padStart(18)).join('')}`);
  speeds.forEach((x, i) => ok(x <= SPEED_LIMIT, `${kind}: something sustains ${x.toFixed(0)} cm/s at t0 = ${[5, 3600, 1e6][i]} s (limit ${SPEED_LIMIT}): an angle or amplitude grows with the uptime`));
  d.dispose();
}

// ── point sprites: the patched shader must scale with the projection ──────────────
const shader = { vertexShader: THREE.ShaderLib.points.vertexShader };
trueSize(shader);
ok(shader.vertexShader.includes('projectionMatrix[ 1 ][ 1 ] / - mvPosition.z'), 'trueSize no longer finds three\'s point attenuation line (three upgrade?)');

// ── pass 2: stub DOM (canvas textures, fonts), text, dispose accounting ─────────────
const texts = [];
const stubContext = canvas => new Proxy({ canvas }, {
  get: (t, p) => {
    if (p in t) return t[p];
    if (p === 'fillText') return (str, x, y) => {
      const size = parseInt(/(\d+)px/.exec(t.font)[1], 10);
      const w = str.length * size;                       // Press Start 2P: advance = glyph cell = 1 em
      const left = t.textAlign === 'center' ? x - w / 2 : t.textAlign === 'right' ? x - w : x;
      texts.push({ canvas, str, size, left, right: left + w, top: y, bottom: y + size });
    };
    return p === 'createRadialGradient' || p === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {};
  },
  set: (t, p, val) => { t[p] = val; return true; },
});
let fontLoads = 0;
globalThis.document = {
  createElement: () => {
    const canvas = { width: 0, height: 0, style: {} };
    const context = stubContext(canvas);
    canvas.getContext = () => context;
    return canvas;
  },
  fonts: { load: () => { fontLoads++; return Promise.resolve([]); } },
};

console.log('\nwith canvas stub + text + dispose accounting');
const live = DIORAMA_KINDS.map(createDiorama);
const resources = new Map();     // object → disposed?
const track = (obj, owner) => {
  if (!obj || resources.has(obj)) return;
  resources.set(obj, { owner, disposed: false });
  obj.addEventListener('dispose', () => { resources.get(obj).disposed = true; });
};
live.forEach(d => {
  d.group.traverse(o => {
    if (o.isSprite) { track(o.material, d.kind); track(o.material.map, d.kind); return; }
    if (o.geometry) track(o.geometry, d.kind);
    if (o.isInstancedMesh) track(o, d.kind);
    for (const mat of [].concat(o.material || [])) { track(mat, d.kind); track(mat.map, d.kind); }
  });
});
const texCount = [...resources.keys()].filter(o => o.isTexture).length;
ok(texCount > 0, 'canvas stub should have produced textures');
ok(fontLoads > 0, 'a font load should have been requested');

// run every counter through its values, then judge each text against its canvas and panel
for (let t = 0; t < 40; t += 0.1) live.forEach(d => d.update(t, 0.016));
live.forEach(d => d.group.updateMatrixWorld(true));
const panelWidth = new Map();    // canvas → widest panel showing it (m)
live.forEach(d => d.group.traverse(o => {
  const img = o.isMesh && o.material.map && o.material.map.image;
  if (!img) return;
  o.getWorldScale(s);
  panelWidth.set(img, Math.max(panelWidth.get(img) || 0, s.x));
}));
const pxPerM = 360 / (2 * EYE.dist * Math.tan(EYE.vfov / 2));
const seen = new Map();
for (const e of texts) seen.set(`${e.canvas.width}x${e.canvas.height} ${e.size}px`, e);
for (const e of texts) {
  ok(e.left >= 0 && e.right <= e.canvas.width && e.top >= 0 && e.bottom <= e.canvas.height,
    `text "${e.str}" (${e.size}px) overflows its ${e.canvas.width}×${e.canvas.height} canvas: x ${e.left}..${e.right}, y ${e.top}..${e.bottom}`);
}
for (const e of seen.values()) {
  const width = panelWidth.get(e.canvas);
  ok(width !== undefined, `text canvas ${e.canvas.width}×${e.canvas.height} is not shown on any panel`);
  const px = e.size / e.canvas.width * width * pxPerM;
  console.log(`  text ${e.canvas.width}×${e.canvas.height} ${String(e.size).padStart(2)} px glyphs: ${px.toFixed(1)} screen px per glyph cell at 1.5 m`);
  ok(px >= MIN_GLYPH_PX, `text "${e.str}" is ${px.toFixed(1)} px per glyph at 1.5 m (min ${MIN_GLYPH_PX})`);
}

// disposing all but the last must leave every resource the survivor still uses alive
live.slice(0, -1).forEach(d => d.dispose());
const survivor = live[live.length - 1];
const used = [];
survivor.group.traverse(o => {
  if (o.isSprite) used.push(o.material, o.material.map);
  else if (o.geometry) used.push(o.geometry);
  for (const mat of [].concat(!o.isSprite && o.material || [])) used.push(mat, mat.map);
});
ok(used.filter(Boolean).every(o => !resources.get(o).disposed), `survivor (${survivor.kind}) lost a resource while the others were disposed`);
survivor.update(2, 0.016);
ok(measure(survivor.group).calls > 0, 'survivor still renders');
survivor.dispose();

const leaks = [...resources].filter(([, r]) => !r.disposed).map(([o, r]) => `${r.owner}:${o.type || o.constructor.name}`);
ok(leaks.length === 0, `undisposed resources: ${leaks.join(', ')}`);
ok(poolSize() === 0, `pool must be empty after disposal (${poolSize()} left)`);
ok(live.every(d => d.group.parent === null), 'groups detached');
console.log(`  ${resources.size} tracked GPU objects (${texCount} textures), all freed; pool empty`);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
