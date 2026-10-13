// Dev lab for the mission dioramas (lab/dioramas.html, served by `vite` only: it is not
// an entry of the production build). Renders the eight dioramas on dark plinths in a
// 640×360 pixel-art canvas, exactly the game's buffer size, with a slow auto-rotation.
//
//   ?kind=neemba   one diorama, large          &cam=eye   the player's view: eye at plinth-top height, level,
//   &spin=auto|sway|0                                     the game's optics (&dist=1.5 metres from the plinth)
//   &t=4.2         freeze the clock (shots)    &reduced=1|0  force reduced motion on/off
//   &yaw=30        start angle in degrees
//
// Console handle: window.__dioramas = { kinds, slots, setTime(t|null), setReduced(bool) }.
import * as THREE from 'three';
import { prefs } from '../src/engine/prefs.js';
import { DIORAMA_KINDS, createDiorama } from '../src/engine/dioramas/index.js';

const INFO = {
  phenix: ['PHENIX FORMATION', 'Trois apps en une : les cubes orbitent puis fusionnent, le compteur grimpe vers 3 000 formations par an.'],
  neemba: ['NEEMBA THEBRIDGE', 'Pont entre SAP Ariba et IRIUM : les commandes (orange) sont contrôlées à la porte et passent au vert.'],
  tbe: ['TBE', 'Camion de mise en bouteille : chaque bouteille passe sous le portique, le mobile compte.'],
  irun: ['IRUN', 'Scanner Zebra : balayage rouge sur l\'étiquette de la palette, puis bip vert.'],
  parfumerie: ['PARFUMERIE PRIVÉE', 'Flacon sous vitrine : reflet qui glisse sur le verre, quelques étincelles.'],
  oviepro: ['OVIEPRO', 'Pile d\'arrêts de travail tamponnée, un pion par profil.'],
  heartside: ['HEARTSIDE', 'Casque VR, cœur qui bat ; mobile et microservices en orbite.'],
  taxis: ['1001TAXIS', 'Taxi qui roule : bornes et lampadaires défilent, enseigne lumineuse, épingle de carte qui rebondit.'],
};

const W = 640, H = 360;
const ORANGE = 0xff8c00;
const q = new URLSearchParams(location.search);

const single = DIORAMA_KINDS.includes(q.get('kind')) ? q.get('kind') : null;
const camMode = q.get('cam') === 'eye' ? 'eye' : '3q';
if (q.get('reduced') === '1') prefs.reducedMotion = true;
else if (q.get('reduced') === '0') prefs.reducedMotion = false;
const spinParam = q.get('spin');
const fixedT = q.has('t') && Number.isFinite(+q.get('t')) ? +q.get('t') : null;
// A frozen clock or reduced motion means a still presentation unless asked otherwise.
const spin = ['auto', 'sway', '0'].includes(spinParam) ? spinParam : (prefs.reducedMotion || fixedT !== null ? '0' : 'auto');
const yaw0 = (+q.get('yaw') || 0) * Math.PI / 180;
const dist = +q.get('dist') > 0 ? +q.get('dist') : 1.5;

const $ = id => document.getElementById(id);
const canvas = $('c');
if (q.get('kind') && !single) $('error').textContent = `Diorama inconnu : ${q.get('kind')}`;

// ── header: navigation + toggles ─────────────────────────────────────────────
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
$('nav').append(link('TOUS', { kind: null }, !single), ...DIORAMA_KINDS.map(k => link(k.toUpperCase(), { kind: k }, k === single)));
const opts = $('opts');
const group = (label, items) => {
  const span = document.createElement('span');
  span.textContent = label;
  opts.append(span, ...items);
};
group('VUE', [link('3/4', { cam: null }, camMode === '3q'), link('YEUX', { cam: 'eye' }, camMode === 'eye')]);
group('ROTATION', [link('AUTO', { spin: 'auto' }, spin === 'auto'), link('BALANCE', { spin: 'sway' }, spin === 'sway'), link('OFF', { spin: '0' }, spin === '0')]);
group('MOUVEMENT', [link('NORMAL', { reduced: '0' }, !prefs.reducedMotion), link('RÉDUIT', { reduced: '1' }, prefs.reducedMotion)]);

// ── scene ────────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07070c);
scene.add(new THREE.AmbientLight(0x9098b8, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(2, 4, 3);
scene.add(sun);
scene.add(new THREE.GridHelper(14, 56, 0x5a3200, 0x15151f));

const poolTexture = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,140,0,0.9)');
  g.addColorStop(1, 'rgba(255,140,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();

const PLINTH = 0.5;     // the gallery plinths are 0.5 m wide, and 0.5 m tall = the player's eye height
const plinthGeo = new THREE.BoxGeometry(PLINTH, 1, PLINTH);
const plinthMat = new THREE.MeshLambertMaterial({ color: 0x1b1b26 });
const lipGeo = new THREE.BufferGeometry().setFromPoints([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => new THREE.Vector3(x * PLINTH / 2, 0, z * PLINTH / 2)));
const lipMat = new THREE.LineBasicMaterial({ color: ORANGE });
const poolGeo = new THREE.PlaneGeometry(1.2, 1.2).rotateX(-Math.PI / 2);
const poolMat = new THREE.MeshBasicMaterial({ map: poolTexture, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });

// Slots: grid of 2 × 4 (back row on taller plinths so it stays visible, except in the eye view
// where every plinth top must sit at the eye), or a single centred one.
const slots = [];
const place = (kind, x, z, h) => {
  const plinth = new THREE.Mesh(plinthGeo, plinthMat);
  plinth.scale.y = h;
  plinth.position.set(x, h / 2, z);
  const lip = new THREE.LineLoop(lipGeo, lipMat);
  lip.position.set(x, h + 0.002, z);
  const pool = new THREE.Mesh(poolGeo, poolMat);
  pool.position.set(x, 0.004, z);
  const diorama = createDiorama(kind);
  diorama.group.position.set(x, h, z);
  scene.add(plinth, lip, pool, diorama.group);
  slots.push({ kind, x, z, h, diorama, plinth, lip, pool });
};

if (single) place(single, 0, 0, 0.5);
else {
  // In the eye view the rows stagger, or the front row would hide the back one entirely.
  const eye = camMode === 'eye';
  DIORAMA_KINDS.forEach((kind, i) => place(kind, ((i % 4) - 1.5) * 0.76 + (eye ? (i < 4 ? 0.19 : -0.19) : 0), i < 4 ? -0.55 : 0.5, i < 4 && !eye ? 0.62 : 0.5));
}

// The game's optics: 60° horizontal FOV on 16:9, i.e. ~36° vertical, never pitched.
const V_FOV = 2 * Math.atan(Math.tan(Math.PI / 6) * H / W) * 180 / Math.PI;
const camera = new THREE.PerspectiveCamera(camMode === 'eye' || single ? V_FOV : 34, W / H, 0.05, 50);
if (camMode === 'eye') {
  camera.position.set(0, 0.5, single ? dist : 3.4);
  camera.lookAt(0, 0.5, -1);
} else if (single) {
  camera.position.set(0.5, 1.2, 0.95);
  camera.lookAt(0, 0.69, 0);
} else {
  camera.position.set(0, 1.8, 3.05);
  camera.lookAt(0, 0.6, 0);
}
camera.updateMatrixWorld(true);

// ── labels, projected once: on the plinth front, or above the diorama for the back row ──
const tags = $('tags');
const v = new THREE.Vector3();
slots.forEach(({ kind, x, z, h }, i) => {
  const [name] = INFO[kind];
  const tag = document.createElement('div');
  tag.className = 'tag';
  const b = document.createElement('b');
  b.textContent = single ? name : `${i + 1} · ${kind.toUpperCase()}`;
  tag.append(b);
  if (!single) { const sub = document.createElement('i'); sub.textContent = name; tag.append(sub); }
  if (!single && z < 0) v.set(x, h + 0.52, z); else v.set(x, h * 0.45, z + 0.32);
  v.project(camera);
  tag.style.left = `${(v.x * 0.5 + 0.5) * 100}%`;
  tag.style.top = `${(-v.y * 0.5 + 0.5) * 100}%`;
  tags.append(tag);
});
if (single) {
  const story = $('story');
  story.hidden = false;
  story.textContent = INFO[single][1];
}

// ── interaction: drag to turn ────────────────────────────────────────────────
let drag = 0;
const stage = $('stage');
stage.addEventListener('pointerdown', e => {
  let lastX = e.clientX;
  stage.classList.add('drag');
  stage.setPointerCapture(e.pointerId);
  const move = ev => { drag += (ev.clientX - lastX) * 0.012; lastX = ev.clientX; };
  const up = () => {
    stage.classList.remove('drag');
    stage.removeEventListener('pointermove', move);
    stage.removeEventListener('pointerup', up);
    stage.removeEventListener('pointercancel', up);
  };
  stage.addEventListener('pointermove', move);
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
});

// ── loop ─────────────────────────────────────────────────────────────────────
let override = fixedT;
let clockT = fixedT ?? 0;
const start = performance.now();
let last = start;
let raf = 0;

function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const t = override ?? (now - start) / 1000;
  clockT = t;
  for (const { diorama } of slots) {
    diorama.update(t, dt);
    const auto = spin === 'auto' ? t * 0.35 : spin === 'sway' ? 0.55 * Math.sin(t * 0.5) : 0;
    diorama.group.rotation.y = yaw0 + drag + auto;
  }
  renderer.render(scene, camera);
}
raf = requestAnimationFrame(frame);

window.__dioramas = {
  kinds: DIORAMA_KINDS,
  slots,
  get t() { return clockT; },
  setTime(t) { override = t === null ? null : +t; },
  setReduced(on) { prefs.reducedMotion = !!on; },
};

addEventListener('pagehide', () => {
  cancelAnimationFrame(raf);
  for (const { diorama } of slots) diorama.dispose();
  for (const o of [plinthGeo, plinthMat, lipGeo, lipMat, poolGeo, poolMat, poolTexture, renderer]) o.dispose();
});
