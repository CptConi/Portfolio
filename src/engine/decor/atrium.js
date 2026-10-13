import * as THREE from 'three';
import { floorAt, ceilAt } from '../Map.js';
import { DASHBOARD } from '../layout.js';
import { prefs } from '../prefs.js';
import { softPool, hex, radialTex, gradTex, paintPath } from './helpers.js';
import { FONT, CAP, mipTexture, fitFont, quadsGeometry } from './thresholds.js';

// Atrium dressing: the hub (holo-directory, floor ring, name banner), the DF STATUS console's
// surroundings, and the painted guidance lines. Everything here is non-colliding.

const HCOL = 0x37c0ff;

// Hub: the holo-directory in the centre of the tall hall, hovering over its floor ring, with the name
// banner hung above it. The guidance line to the Quartiers runs straight through it. The holo stays
// below ~0.75 m so that, seen from the spawn, it does not cross the text of the north soffite sign.
export const HUB = { x: 12.5, z: 12, y: 0.4, r: 0.34 };

// The banner hangs above head height, in the one strip of screen that is free and safe from the
// spawn (3.4 m away): below what a wide window crops and above the north soffite sign. The canvas is
// 640×360 under object-fit: cover, so a window wider than 16:9 loses rows at the top (22 of 360 at
// 1920×950 = everything above 1.46 m here), and the camera never pitches, so nothing can tilt it
// back into view. The sign tops out at 1.5 m, hence a 0.4 m banner centred at 1.255 m. Its density
// matches the old banner (328 px per metre): glyphs are 16 / 12 / 12 px on screen from the spawn.
const BANNER = { y: 1.255, w: 1.9, h: 0.402, px: { w: 624, h: 132 } };

// The atrium's north wall: the DF STATUS console stands against the segment west of the vestibule.
const NORTH_WALL_Z = 9.0;
const SEGMENT = { x0: 9.0, x1: 11.0 };

// Upright quad on the north wall segment, facing the hall; `off` = distance in front of the wall.
const wallQuad = (x0, x1, y0, y1, off) => quadsGeometry([{
  x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: NORTH_WALL_Z + off, facing: [0, 1], w: x1 - x0, h: y1 - y0, uv: [0, 0, 1, 1] }]);

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Dark plate with a colour frame (same language as the soffite signs).
function plate(g, w, h, color) {
  g.fillStyle = '#060d14';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = hex(color);
  g.lineWidth = 6;
  g.strokeRect(3, 3, w - 6, h - 6);
  g.globalAlpha = 0.3;
  g.lineWidth = 2;
  g.strokeRect(12, 12, w - 24, h - 24);
  g.globalAlpha = 1;
}

// Centred lines, each { text, size, color }: the biggest size that fits wins, `gap` px between.
function centredLines(g, w, top, bottom, lines, gap) {
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  const sized = lines.map(l => ({ ...l, size: fitFont(g, l.text, l.size, w - 48) }));
  const total = sized.reduce((s, l) => s + l.size * CAP, 0) + gap * (sized.length - 1);
  let y = Math.round(top + (bottom - top - total) / 2);   // whole pixels keep the pixel font crisp
  const rules = [];
  for (const l of sized) {
    y += l.size * CAP;
    g.font = `${l.size}px ${FONT}`;
    g.fillStyle = l.color;
    g.fillText(l.text, w / 2, y);
    rules.push(y + gap / 2);
    y += gap;
  }
  return rules;   // y of the middle of each gap (the last one lies below the text)
}

// Name banner: three lines, readable from the spawn (≥ 12 px per glyph on the 640×360 buffer).
function buildBanner(scene) {
  const { w, h } = BANNER.px;
  const c = canvas(w, h), g = c.getContext('2d');
  plate(g, w, h, HCOL);
  const rules = centredLines(g, w, 14, h - 14, [
    { text: 'NICOLAS RENARD', size: 32, color: '#eaf8ff' },
    { text: 'LEAD DEVELOPER', size: 24, color: hex(HCOL) },
    { text: 'DIGITAL FACTORY GUARANÍ', size: 24, color: '#a9dcf5' },
  ], 12);
  g.globalAlpha = 0.5;
  g.fillStyle = hex(HCOL);
  g.fillRect(w / 2 - 110, rules[1] - 1, 220, 2);   // between the role and the company
  g.globalAlpha = 1;

  // Two quads, back to back, so the text also reads from the north side.
  const quad = (z, facing) => ({ x: HUB.x, y: BANNER.y, z, facing, w: BANNER.w, h: BANNER.h, uv: [0, 0, 1, 1] });
  scene.add(new THREE.Mesh(quadsGeometry([quad(HUB.z + 0.02, [0, 1]), quad(HUB.z + 0.01, [0, -1])]),
    new THREE.MeshBasicMaterial({ map: mipTexture(c) })));
}

// ── Hub gauge ────────────────────────────────────────────────────────────────────────────────────
// The holo is the progress gauge of the "recette" (features/recette.js): the 30 edges of an
// icosahedron standing on a vertex, a dim base always drawn and a lit copy of the same edges
// revealed by its draw range as cas de test are validated. Lit edges are cyan, gold once the
// recette is complete (the bloom pass picks both up: colours go slightly above 1.0).
const GAUGE_EDGES = 30;
const GAUGE_BASE_OPACITY = 0.45;
const GAUGE_SWEEP = 14;       // edges lit per second
const GAUGE_GOLD_TIME = 0.9;  // s, cyan → gold
const GAUGE_LIT = new THREE.Color(0x8fe6ff).multiplyScalar(1.2);
const GAUGE_GOLD = new THREE.Color(0xffb21e).multiplyScalar(1.4);
const RING_GOLD = new THREE.Color(0xffb21e);

// Edge endpoints as a flat xyz array, ordered bottom → top and, level by level, around the axis:
// a gauge that fills like a tank, with the next edge always close to the last lit one.
function gaugeEdges(r) {
  const ico = new THREE.IcosahedronGeometry(r, 0);
  const pos = ico.getAttribute('position');
  ico.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3().fromBufferAttribute(pos, 0).normalize(), new THREE.Vector3(0, 1, 0)));
  const wire = new THREE.WireframeGeometry(ico).getAttribute('position');
  const edges = [];
  for (let i = 0; i < wire.count; i += 2) {
    const a = new THREE.Vector3().fromBufferAttribute(wire, i);
    const b = new THREE.Vector3().fromBufferAttribute(wire, i + 1);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    edges.push({ a, b, level: Math.round(mid.y / r * 20), turn: Math.atan2(mid.z, mid.x) });
  }
  edges.sort((p, q) => p.level - q.level || p.turn - q.turn);
  return new Float32Array(edges.flatMap(e => [e.a.x, e.a.y, e.a.z, e.b.x, e.b.y, e.b.z]));
}

let hubGauge = null;

// The hub gauge, or null until the atrium is built:
//   setProgress(done, total)   light round(done / total × 30) edges (the sweep plays in update())
//   setGold(on)                lit colour cyan ⇄ gold (the floor ring follows)
//   update(dt)                 advance the sweep, the colour change and the gold pulse
// With reduced motion every change is applied at once and nothing pulses.
export const getHubGauge = () => hubGauge;

function buildHubGauge(parent, ring) {
  const position = new THREE.BufferAttribute(gaugeEdges(HUB.r), 3);
  const litGeo = new THREE.BufferGeometry().setAttribute('position', position);   // same points as the base
  litGeo.setDrawRange(0, 0);
  const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };
  const baseMat = new THREE.LineBasicMaterial({ color: HCOL, opacity: GAUGE_BASE_OPACITY, ...additive });
  parent.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', position), baseMat));
  const litMat = new THREE.LineBasicMaterial({ color: GAUGE_LIT, ...additive });
  const lit = new THREE.LineSegments(litGeo, litMat);
  lit.visible = false;
  parent.add(lit);

  const ringCyan = ring.material.color.clone();
  let target = 0, shown = 0;          // edges: wanted / currently lit (fractional while sweeping)
  let goldTo = 0, gold = 0;           // 0 = cyan … 1 = gold
  let clock = 0, drawn = -1;

  function paint() {
    const n = Math.round(shown);
    if (n !== drawn) {
      drawn = n;
      litGeo.setDrawRange(0, n * 2);
      lit.visible = n > 0;
    }
    litMat.color.lerpColors(GAUGE_LIT, GAUGE_GOLD, gold);
    baseMat.opacity = GAUGE_BASE_OPACITY * (1 - gold);   // under the gold edges the cyan base would only bleach them
    litMat.opacity = gold === 1 && !prefs.reducedMotion ? 0.85 + 0.15 * Math.sin(clock * 3) : 1;
    ring.material.color.lerpColors(ringCyan, RING_GOLD, gold);
  }

  hubGauge = {
    setProgress(done, total) {
      target = total > 0 ? Math.round(Math.min(Math.max(done / total, 0), 1) * GAUGE_EDGES) : 0;
      if (prefs.reducedMotion || target < shown) shown = target;
      paint();
    },
    setGold(on) {
      goldTo = on ? 1 : 0;
      if (prefs.reducedMotion || !on) gold = goldTo;
      paint();
    },
    update(dt) {
      clock += dt;
      if (shown < target) shown = Math.min(target, shown + GAUGE_SWEEP * dt);
      if (gold !== goldTo) gold = Math.min(1, Math.max(0, gold + Math.sign(goldTo - gold) * dt / GAUGE_GOLD_TIME));
      paint();
    },
  };
}

// Hub: gauge holo, floor pad and ring, ceiling glow, banner.
function buildHub(scene, anim) {
  softPool(scene, HCOL, HUB.x, HUB.z, 2.4, { y: floorAt(HUB.x, HUB.z) + 0.02, opacity: 0.32 });
  softPool(scene, HCOL, HUB.x, HUB.z, 2.2, { y: ceilAt(HUB.x, HUB.z) - 0.015, opacity: 0.4, down: true });

  const ring = new THREE.Mesh(new THREE.RingGeometry(HUB.r, HUB.r + 0.06, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: HCOL, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false }));
  ring.position.set(HUB.x, floorAt(HUB.x, HUB.z) + 0.025, HUB.z);
  scene.add(ring);

  // The node spins about the vertical; the gauge inside it keeps a fixed lean (no tumbling: its
  // fill order is bottom → top and has to stay readable).
  const node = new THREE.Group();
  node.position.set(HUB.x, HUB.y, HUB.z);
  const lean = new THREE.Group();
  lean.rotation.set(0.2, 0, 0.1);
  node.add(lean);
  buildHubGauge(lean, ring);
  scene.add(node);
  // Read live so a change of the reduced-motion preference applies at once; reduced = a still holo.
  anim.push({
    node, y0: HUB.y, spd: 1.4, rx: 0,
    get ry() { return prefs.reducedMotion ? 0 : 0.6; },
    get amp() { return prefs.reducedMotion ? 0 : 0.04; },
  });
  buildBanner(scene);
}

// Yellow/black safety strip, 45° stripes.
function hazardTexture() {
  const c = canvas(512, 16), g = c.getContext('2d');
  g.fillStyle = '#14110a';
  g.fillRect(0, 0, 512, 16);
  g.fillStyle = '#f2c200';
  for (let x = -16; x < 512; x += 32) {
    g.beginPath();
    g.moveTo(x, 16); g.lineTo(x + 16, 16); g.lineTo(x + 32, 0); g.lineTo(x + 16, 0);
    g.closePath();
    g.fill();
  }
  return mipTexture(c);
}

// "DIGITAL / FACTORY" plate.
function plaqueTexture(w, h) {
  const c = canvas(w, h), g = c.getContext('2d');
  plate(g, w, h, HCOL);
  centredLines(g, w, 12, h - 12, [
    { text: 'DIGITAL', size: 40, color: '#eaf8ff' },
    { text: 'FACTORY', size: 40, color: hex(HCOL) },
  ], 14);
  return mipTexture(c);
}

// DF STATUS console (layout.js DASHBOARD, no ceiling light): a faint cyan pool on the floor in front
// of it, a wash and a safety strip on the wall behind, a small plaque above. The pool leans west and
// everything on the wall stops short of the vestibule: nothing here touches the console's east face
// (layout.js PROD_PANEL), which must stay unremarkable.
function buildDashboardDressing(scene) {
  const { x, z, facing: [, fz] } = DASHBOARD;
  const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };
  const decal = f => ({ polygonOffset: true, polygonOffsetFactor: f, polygonOffsetUnits: f });
  const end = SEGMENT.x1 - 0.05;

  const pool = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.5).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: radialTex(HCOL), opacity: 0.26, ...additive }));
  pool.position.set(x - 0.15, floorAt(x, z + fz) + 0.03, z + fz * 0.95);
  scene.add(pool);

  // Everything on the wall sits above the console's top edge (0.86 m), which hides the wall below
  // ~1 m from anywhere closer than 3 m. The wash fades upward (gradTex: bright at the bottom).
  scene.add(new THREE.Mesh(wallQuad(SEGMENT.x0 + 0.2, end, 0.9, 1.94, 0.008),
    new THREE.MeshBasicMaterial({ map: gradTex(HCOL), opacity: 0.55, ...decal(-1), ...additive })));

  scene.add(new THREE.Mesh(wallQuad(SEGMENT.x0 + 0.1, end, 0.955, 1.025, 0.012),
    new THREE.MeshBasicMaterial({ map: hazardTexture(), ...decal(-2) })));

  // Centred at the height of the soffite signs, so the wall reads as one row of signage.
  const PLAQUE_PX = { w: 336, h: 148 };   // 336 px per metre
  scene.add(new THREE.Mesh(wallQuad(x - 0.55, x + 0.45, 1.04, 1.48, 0.02),
    new THREE.MeshBasicMaterial({ map: plaqueTexture(PLAQUE_PX.w, PLAQUE_PX.h), ...decal(-2) })));
}

// Atrium: hub holo-directory and banner, DF STATUS console dressing.
export function buildAtriumHub(scene, anim) {
  buildHub(scene, anim);
  buildDashboardDressing(scene);
}

// Black-Mesa guidance lines — start at the south wall, split mid-room.
export function buildGuidanceLines(scene) {
  const GREEN = 0x2a9d4a, AMBER = 0xb5701a, VIOLET = 0x7d3aa8;
  paintPath(scene, GREEN,  [[12.3, 15.5], [12.3, 12.5], [9.0, 12.5]]);   // → Armurerie (W door centre z12.5)
  paintPath(scene, VIOLET, [[12.5, 15.5], [12.5, 9.0]]);                 // → Quartiers (N door centre x12.5)
  paintPath(scene, AMBER,  [[12.7, 15.5], [12.7, 12.5], [16.0, 12.5]]);  // → Trophées (E door centre z12.5)
}
