// Dev lab for the three cats (lab/cats.html, served by `vite` only: it is not an entry of the
// production build). Top: the game's view, a 640×360 canvas with the game's optics (horizontal camera,
// 36° vertical field, nearest filtering), the three cats side by side on their own surfaces:
// the loaf on the Armurerie workbench, the sleeper on the Quartiers crate, the eyes in the PROD dark.
// Then each cat large, and a sheet of every image the painters produce.
//
//   ?cam=eye         the game camera (the only one: kept for parity with lab/dioramas.html)
//   &dist=2          distance to the cats, metres (the game sees them from 1.5 to 3.5 m)
//   &at=loaf|sleeping|eyes   centre the game view on one cat (below ~1.9 m the three no longer fit side by side)
//   &t=3.3           freeze the clock (3.3 = slow blink, 5.9 = tail flick, 9.1 = ear twitch of the loaf)
//   &reduced=1|0     force reduced motion on/off (still, eyes open, no "z")
//   &react=1         trigger the loaf's happy squint (what finding it does in the game)
//   &only=loaf|sleeping|eyes   a single cat in the large views
//
// Console handle: window.__cats = { cats, setTime(t|null), setReduced(bool), react() }.
import * as THREE from 'three';
import { prefs } from '../src/engine/prefs.js';
import {
  createCat, CAT_KINDS, paintLoaf, paintSleepingCat, paintEyes, paintZ,
  LOAF_TEX, SLEEPING_TEX, EYES_TEX, Z_TEX,
} from '../src/engine/props/cat.js';
import { Pix } from '../src/engine/props/pixels.js';

const W = 640, H = 360;            // the game's buffer, also used for the large views
const q = new URLSearchParams(location.search);

if (q.get('reduced') === '1') prefs.reducedMotion = true;
else if (q.get('reduced') === '0') prefs.reducedMotion = false;
const fixedT = q.has('t') && Number.isFinite(+q.get('t')) ? +q.get('t') : null;
const dist = +q.get('dist') > 0 ? +q.get('dist') : 2;
const only = CAT_KINDS.includes(q.get('only')) ? q.get('only') : null;
const at = CAT_KINDS.includes(q.get('at')) ? q.get('at') : null;

const $ = id => document.getElementById(id);

// ── header toggles ───────────────────────────────────────────────────────────
const href = patch => {
  const p = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(patch)) (v === null ? p.delete(k) : p.set(k, v));
  const s = p.toString();
  return s ? `?${s}` : location.pathname;
};
const link = (label, patch, current) => {
  const a = document.createElement('a');
  a.textContent = label;
  a.href = href(patch);
  if (current) a.setAttribute('aria-current', 'true');
  return a;
};
const opts = $('opts');
const group = (label, items) => {
  const span = document.createElement('span');
  span.textContent = label;
  opts.append(span, ...items);
};
group('DISTANCE', [1.5, 2, 2.5, 3.5].map(d => link(`${d} M`, { dist: d === 2 ? null : String(d) }, d === dist)));
group('MOUVEMENT', [link('NORMAL', { reduced: '0' }, !prefs.reducedMotion), link('RÉDUIT', { reduced: '1' }, prefs.reducedMotion)]);
group('HORLOGE', [link('LIVE', { t: null }, fixedT === null), link('3,3 S', { t: '3.3' }, fixedT === 3.3), link('5,9 S', { t: '5.9' }, fixedT === 5.9), link('9,1 S', { t: '9.1' }, fixedT === 9.1)]);
group('CADRE', [link('TOUS', { at: null }, !at), ...CAT_KINDS.map(k => link(k.toUpperCase(), { at: k }, k === at))]);
group('EN GRAND', [link('TOUS', { only: null }, !only), ...CAT_KINDS.map(k => link(k.toUpperCase(), { only: k }, k === only))]);
$('game-title').textContent = `DANS LE JEU · CAMÉRA DU JEU À ${String(dist).replace('.', ',')} M`;

// ── scene: three stages side by side ─────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);

const scene = new THREE.Scene();
const DARK = new THREE.Color(0x050508);
scene.background = DARK;
scene.add(new THREE.AmbientLight(0xb0b4d0, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(1, 3, 3);
scene.add(sun);

// Heights are those of the game: the eye is 0.5 m above the floor, the workbench top 0.35 m,
// the Quartiers crate top 0.45 m, the PROD crate 0.2 m (where the eyes are scaled by 1.5).
const EYE = 0.5;
const STAGES = {
  loaf: { x: -0.78, top: 0.35, box: [0.72, 0.5], color: 0x7a5a34, wall: 0x0d1a12, label: ['ARMURERIE', 'sur le clavier, établi'], scale: 1 },
  sleeping: { x: 0, top: 0.45, box: [0.5, 0.5], color: 0x8a6238, wall: 0x140c1e, label: ['QUARTIERS', 'endormi sur sa caisse'], scale: 1 },
  eyes: { x: 0.78, top: 0.2, box: [0.5, 0.4], color: 0x1a1820, wall: 0x000000, label: ['PROD', 'dans le noir, ×1,5'], scale: 1.5 },
};

const disposables = [];
const boxMat = c => { const m = new THREE.MeshLambertMaterial({ color: c }); disposables.push(m); return m; };
const wallGeo = new THREE.PlaneGeometry(0.74, 1.3);
disposables.push(wallGeo);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8).rotateX(-Math.PI / 2), boxMat(0x0b0b10));
scene.add(floor);
disposables.push(floor.geometry);

const stages = {};
const backdrops = {};
for (const kind of CAT_KINDS) {
  const s = STAGES[kind];
  const group = new THREE.Group();
  group.position.x = s.x;
  const box = new THREE.Mesh(new THREE.BoxGeometry(s.box[0], s.top, s.box[1]), boxMat(s.color));
  box.position.y = s.top / 2;
  const wall = new THREE.Mesh(wallGeo, new THREE.MeshBasicMaterial({ color: s.wall }));
  wall.position.set(0, 0.65, -0.42);
  const cat = createCat(kind);
  cat.object.position.set(0, s.top, 0);
  cat.object.scale.setScalar(s.scale);
  group.add(wall, box, cat.object);
  disposables.push(box.geometry, wall.material);
  scene.add(group);
  stages[kind] = { ...s, group, wall, cat };
  backdrops[kind] = new THREE.Color(s.wall);
}

// The game's optics: 60° horizontal on 16:9 = ~36° vertical, never pitched.
const V_FOV = 2 * Math.atan(Math.tan(Math.PI / 6) * H / W) * 180 / Math.PI;
const gameCam = new THREE.PerspectiveCamera(V_FOV, W / H, 0.02, 50);
const camX = at ? STAGES[at].x : 0;
gameCam.position.set(camX, EYE, dist);
gameCam.lookAt(camX, EYE, -1);
gameCam.updateMatrixWorld(true);

// Labels under each stage, projected once.
const tags = $('tags');
const v = new THREE.Vector3();
for (const kind of CAT_KINDS) {
  const s = stages[kind];
  const tag = document.createElement('div');
  tag.className = 'tag';
  const b = document.createElement('b');
  b.textContent = `${kind.toUpperCase()} · ${s.label[0]}`;
  const i = document.createElement('i');
  i.textContent = s.label[1];
  tag.append(b, i);
  v.set(s.x, 0, 0.25).project(gameCam);
  tag.style.left = `${(v.x * 0.5 + 0.5) * 100}%`;
  tag.style.top = `calc(${(-v.y * 0.5 + 0.5) * 100}% + 4px)`;
  tags.append(tag);
}

// ── large views: one cat, the same optics, framed to fill the canvas ─────────
const bigCams = {};
const bigCtx = {};
const FOCAL = H / 2 / Math.tan((V_FOV * Math.PI) / 360);
for (const kind of only ? [only] : CAT_KINDS) {
  const s = stages[kind];
  const w = s.cat.width * s.scale, h = s.cat.height * s.scale;
  const d = Math.max((w * FOCAL) / (0.62 * W), (h * FOCAL) / (0.8 * H));
  const cam = new THREE.PerspectiveCamera(V_FOV, W / H, 0.02, 50);
  cam.position.set(s.x, s.top + h / 2, d);
  cam.lookAt(s.x, s.top + h / 2, -1);
  cam.updateMatrixWorld(true);
  bigCams[kind] = cam;

  const fig = document.createElement('figure');
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const cap = document.createElement('figcaption');
  cap.textContent = `${kind.toUpperCase()} · ${s.label[0]} · à ${d.toFixed(2).replace('.', ',')} M`;
  fig.append(canvas, cap);
  $('bigs').append(fig);
  bigCtx[kind] = canvas.getContext('2d');
}

// ── the sheet: every image the painters make ────────────────────────────────
const pixCanvas = (pix, scale) => {
  const c = document.createElement('canvas');
  c.width = pix.w; c.height = pix.h;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pix.data), pix.w, pix.h), 0, 0);
  c.style.width = `${pix.w * scale}px`;
  c.style.height = `${pix.h * scale}px`;
  return c;
};
const sheetItem = (label, pix, scale, bg) => {
  const fig = document.createElement('figure');
  const c = pixCanvas(pix, scale);
  if (bg) c.style.background = bg;
  const cap = document.createElement('figcaption');
  cap.textContent = label;
  fig.append(c, cap);
  $('sheet').append(fig);
};
const paint = (tex, fn) => { const p = new Pix(tex.w, tex.h); fn(p); return p; };
for (const [label, pose] of [
  ['loaf · yeux ouverts', {}], ['loaf · mi-clos', { eyes: 'half' }], ['loaf · clos', { eyes: 'closed' }], ['loaf · content', { eyes: 'happy' }],
  ['loaf · oreille', { ear: 1 }], ['loaf · queue haut', { tail: 1 }], ['loaf · queue dehors', { tail: 2 }],
]) sheetItem(label, paint(LOAF_TEX, p => paintLoaf(p, pose)), 6, '#0e1a14');
sheetItem('sleeping', paint(SLEEPING_TEX, paintSleepingCat), 8, '#140c1e');
for (const g of [0, 1, -1]) sheetItem(`eyes · regard ${g}`, paint(EYES_TEX, p => paintEyes(p, g)), 12, '#000');
sheetItem('z', paint(Z_TEX, paintZ), 10, '#140c1e');

// ── loop ─────────────────────────────────────────────────────────────────────
let override = fixedT;
let clockT = fixedT ?? 0;
const start = performance.now();
let reactAt = q.get('react') === '1' ? 0 : null;
let raf = 0;

function frame(now) {
  raf = requestAnimationFrame(frame);
  const t = override ?? (now - start) / 1000;
  clockT = t;
  const calm = prefs.reducedMotion;
  if (reactAt !== null) { stages.loaf.cat.react(Math.max(t, 0)); reactAt = null; }
  for (const k of CAT_KINDS) stages[k].cat.update(t, calm);

  for (const [kind, ctx] of Object.entries(bigCtx)) {
    for (const k of CAT_KINDS) stages[k].group.visible = k === kind;
    scene.background = backdrops[kind];
    floor.visible = false;
    renderer.render(scene, bigCams[kind]);
    ctx.drawImage(renderer.domElement, 0, 0);
  }
  for (const k of CAT_KINDS) stages[k].group.visible = true;
  scene.background = DARK;
  floor.visible = true;
  renderer.render(scene, gameCam);
}
raf = requestAnimationFrame(frame);

window.__cats = {
  cats: Object.fromEntries(CAT_KINDS.map(k => [k, stages[k].cat])),
  get t() { return clockT; },
  setTime(t) { override = t === null ? null : +t; },
  setReduced(on) { prefs.reducedMotion = !!on; },
  react() { reactAt = 0; },
};

addEventListener('pagehide', () => {
  cancelAnimationFrame(raf);
  for (const k of CAT_KINDS) stages[k].cat.dispose();
  disposables.forEach(d => d.dispose());
  renderer.dispose();
});
