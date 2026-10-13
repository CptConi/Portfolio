import * as THREE from 'three';
import { skills } from '../../data/skills.js';
import { techOf } from '../../data/tech.js';
import { floorAt, ceilAt } from '../Map.js';
import { radialTex, gradTex, wrapName } from './helpers.js';

// Armurerie tech racks — two slanted racks hugging the N/S walls, one row per skill
// family (same order and colours as the SKILLS console). Each row opens with a coloured
// numbered plaque ("1 LANGAGES" … "7 OUTILS", Doom weapon-slot style) followed by the
// family's logos. North wall = families 1-4, south wall = the rest.
//
// The layout is a pure function of skills.js; everything static is merged into a few
// batched meshes (7 draw calls for both racks, no PointLight).
//   ARMORY_RACK_AABBS  floor footprints for player collision (Player.js)
//   ARMORY_LAYOUT      rows / plaques / logo slots, wall-local metres (x along the rack
//                      from its centre, y above the floor, row 0 = top)
//   ARMORY_FAMILIES    [{ index, category, color, count, wall }] for later features

const GREEN = 0x00ff41;

// Rack envelope. The front face leans back toward the top (top shallower than bottom, ~11°).
// The camera never pitches (eye at +0.5 m, ±18° vertically), so the face spans roughly
// 0.06-0.96 m: the top row sits ~0.46 m above the eye and is whole from ~1.6 m away.
const RACK = { X0: 3.0, X1: 7.0, H: 1.04, DBOT: 0.40, DTOP: 0.20, NZ: 9.0, SZ: 16.0 };
const FOOT = 0.42;   // collision depth from the wall: body + glow trims, with a hair of margin
const W = RACK.X1 - RACK.X0;
const CX = (RACK.X0 + RACK.X1) / 2;
const THETA = Math.atan2(RACK.DBOT - RACK.DTOP, RACK.H);   // face lean → quad tilt
const SIN = Math.sin(THETA), COS = Math.cos(THETA);
const FACE_LEN = Math.hypot(RACK.H, RACK.DBOT - RACK.DTOP);
const depthAt = y => RACK.DBOT + (RACK.DTOP - RACK.DBOT) * (y / RACK.H);

export const ARMORY_RACK_AABBS = [
  { minX: RACK.X0, maxX: RACK.X1, minZ: RACK.NZ, maxZ: RACK.NZ + FOOT },
  { minX: RACK.X0, maxX: RACK.X1, minZ: RACK.SZ - FOOT, maxZ: RACK.SZ },
];

// ── Layout (metres) ─────────────────────────────────────────────────────────
const EDGE = 0.10;                       // rack end → plaque / last logo
const GAP = 0.10;                        // plaque → first logo
const Y_BOT = 0.06, Y_TOP = RACK.H - 0.08;   // usable height of the face
const MAX_PITCH = 0.5;                   // sparse rows keep their logos together
// Logo card = min(MAX, pitch - GAP, FILL * row). Atlas cells carry an ~11 % transparent
// margin, so a card can fill almost its whole row without the glyphs touching.
const CARD = { MAX: 0.30, GAP: 0.03, FILL: 0.94 };

// Plaque texture density: a 16 px glyph is 5.6 cm tall, ~9 screen px at the room centre
// on the 640x360 buffer. Whole texels everywhere so the pixel font stays crisp.
const PX_PER_M = 288, PLAQUE_PX_W = 208, NUM_PX_W = 64;
const PLAQUE_W = PLAQUE_PX_W / PX_PER_M;

// A logo shared by several families (Ionic, Firebase, AWS…) is shown once, in the LAST
// family that lists it: AWS lands in CLOUD / DEVOPS, Firebase in the databases.
function computeLayout() {
  const owner = new Map();
  skills.forEach((cat, i) => cat.items.forEach(name => {
    const { f } = techOf(name);
    if (f) owner.set(f, i);
  }));

  const families = skills.map((cat, i) => {
    const logos = [], seen = new Set();
    for (const name of cat.items) {
      const { f, c } = techOf(name);
      if (f && owner.get(f) === i && !seen.has(f)) { seen.add(f); logos.push({ name, f, c }); }
    }
    return { index: i + 1, category: cat.category, color: cat.color, logos };
  });

  const split = Math.ceil(families.length / 2);
  const groups = [
    { id: 'north', z: RACK.NZ, dir: 1, families: families.slice(0, split) },     // faces +Z
    { id: 'south', z: RACK.SZ, dir: -1, families: families.slice(split) },       // faces -Z
  ];

  const plaqueX = -W / 2 + EDGE + PLAQUE_W / 2;
  const logoX0 = -W / 2 + EDGE + PLAQUE_W + GAP, logoX1 = W / 2 - EDGE;

  const walls = groups.map(g => {
    const band = (Y_TOP - Y_BOT) / g.families.length;
    const plaqueH = Math.round(band * 0.86 * PX_PER_M) / PX_PER_M;
    const rows = g.families.map((fam, r) => {
      const pitch = Math.min((logoX1 - logoX0) / fam.logos.length, MAX_PITCH);
      return {
        ...fam,
        wall: g.id,
        y: Y_TOP - (r + 0.5) * band,
        band,
        plaque: { x: plaqueX, w: PLAQUE_W, h: plaqueH },
        pitch,
        card: Math.min(CARD.MAX, pitch - CARD.GAP, band * CARD.FILL),
        logos: fam.logos.map((l, k) => ({ ...l, x: logoX0 + (k + 0.5) * pitch })),
      };
    });
    return { id: g.id, z: g.z, dir: g.dir, band, rows };
  });
  return { walls };
}

export const ARMORY_LAYOUT = computeLayout();

export const ARMORY_FAMILIES = ARMORY_LAYOUT.walls.flatMap(w => w.rows)
  .map(r => ({ index: r.index, category: r.category, color: r.color, count: r.logos.length, wall: r.wall }));

// ── Textures ────────────────────────────────────────────────────────────────
const FONT = '"Press Start 2P", monospace';

// UV rectangle of a pixel rect inside a canvas (canvas textures are flipped on Y).
function atlasUV(x, y, w, h, cw, ch, inset = 0) {
  return { u0: (x + inset) / cw, u1: (x + w - inset) / cw, v0: 1 - (y + h - inset) / ch, v1: 1 - (y + inset) / ch };
}

// One mipmapped atlas for every logo. The SVGs decode asynchronously and each re-upload
// costs a full 1024x896 upload plus mip rebuild, so arrivals are coalesced: at most one
// refresh per REFRESH_MS, with a trailing one so the last logos always show up.
const CELL = 128, LOGO_PAD = 14, ATLAS_COLS = 8, REFRESH_MS = 200;
function buildLogoAtlas(files) {
  const cv = document.createElement('canvas');
  cv.width = ATLAS_COLS * CELL;
  cv.height = Math.ceil(files.length / ATLAS_COLS) * CELL;
  const ctx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;   // the cards sit on a leaning face, often seen at a glancing angle
  let lastRefresh = performance.now(), timer = 0;   // the first burst of loads waits one window
  const refresh = () => { timer = 0; lastRefresh = performance.now(); tex.needsUpdate = true; };
  const scheduleRefresh = () => {
    if (!timer) timer = setTimeout(refresh, Math.max(0, lastRefresh + REFRESH_MS - performance.now()));
  };
  const uv = new Map();
  files.forEach((f, i) => {
    const x = (i % ATLAS_COLS) * CELL, y = Math.floor(i / ATLAS_COLS) * CELL;
    uv.set(f, atlasUV(x, y, CELL, CELL, cv.width, cv.height));
    const img = new Image();
    img.onload = () => {
      const box = CELL - 2 * LOGO_PAD, iw = img.naturalWidth, ih = img.naturalHeight;
      const fit = iw && ih ? Math.min(box / iw, box / ih) : 0;   // SVG without intrinsic size fills the box
      const w = fit ? iw * fit : box, h = fit ? ih * fit : box;
      ctx.drawImage(img, x + (CELL - w) / 2, y + (CELL - h) / 2, w, h);
      scheduleRefresh();
    };
    img.src = '/logos/' + f + '.svg';
  });
  return { tex, uv };
}

// "CLOUD / DEVOPS" → two lines, "BASE DE DONNÉES" → "BASE DE" / "DONNÉES".
const labelLines = category =>
  category.split(/\s*\/\s*/).flatMap(part => (part.length > 8 ? wrapName(part) : [part]));

// Doom weapon-slot plaque: family-coloured block with a big dark numeral, then the
// family name in white on near-black, all inside a family-coloured frame.
function paintPlaque(ctx, y, w, h, row) {
  ctx.fillStyle = '#060906';
  ctx.fillRect(0, y, w, h);
  ctx.fillStyle = row.color;
  ctx.fillRect(0, y, NUM_PX_W, h);
  ctx.strokeStyle = row.color;
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, y + 1.5, w - 3, h - 3);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const numPx = Math.min(48, Math.max(24, 8 * Math.round(h * 0.5 / 8)));
  ctx.fillStyle = '#050805';
  ctx.font = `${numPx}px ${FONT}`;
  ctx.fillText(String(row.index), NUM_PX_W / 2, y + h / 2 + 2);

  const lines = labelLines(row.category), labelW = w - NUM_PX_W;
  const px = Math.max(...lines.map(l => l.length)) * 16 <= labelW - 8 ? 16 : 8;
  ctx.fillStyle = '#d0dcd2';   // pale, just under the bloom threshold so thin glyphs stay crisp
  ctx.font = `${px}px ${FONT}`;
  lines.forEach((l, i) => ctx.fillText(l, NUM_PX_W + labelW / 2, y + (h / (lines.length + 1)) * (i + 1) + 1));
}

// All plaques stacked in one crisp (nearest-filtered) canvas.
function buildPlaqueAtlas(rows) {
  const hs = rows.map(r => Math.round(r.plaque.h * PX_PER_M));
  const cv = document.createElement('canvas');
  cv.width = PLAQUE_PX_W;
  cv.height = hs.reduce((a, b) => a + b, 0);
  const ctx = cv.getContext('2d');
  const uv = new Map();
  let y = 0;
  rows.forEach((row, i) => {
    paintPlaque(ctx, y, cv.width, hs[i], row);
    uv.set(row.index, atlasUV(0, y, cv.width, hs[i], cv.width, cv.height, 0.5));
    y += hs[i];
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, uv };
}

// ── Merged quad batches ─────────────────────────────────────────────────────
const FULL_UV = { u0: 0, v0: 0, u1: 1, v1: 1 };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const grey = k => [k, k, k];
const tint = (color, k) => { const c = new THREE.Color(color); return [c.r * k, c.g * k, c.b * k]; };

const newBatch = () => ({ pos: [], uv: [], col: [], idx: [] });

// Appends one quad given its corners bottom-left, bottom-right, top-right, top-left; `lo`
// / `hi` are the vertex colours of the bottom / top pair. The winding is flipped when
// needed so the quad faces `facing`.
function pushQuad(b, corners, facing, uv = FULL_UV, lo = grey(1), hi = lo) {
  const at = b.pos.length / 3;
  corners.forEach((p, k) => {
    b.pos.push(p[0], p[1], p[2]);
    b.uv.push(k === 1 || k === 2 ? uv.u1 : uv.u0, k < 2 ? uv.v0 : uv.v1);
    b.col.push(...(k < 2 ? lo : hi));
  });
  const front = dot(cross(sub(corners[1], corners[0]), sub(corners[3], corners[0])), facing) >= 0;
  b.idx.push(...(front ? [at, at + 1, at + 2, at, at + 2, at + 3] : [at, at + 2, at + 1, at, at + 3, at + 2]));
}

function batchMesh(scene, b, material, renderOrder) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  if (material.vertexColors) geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  geo.setIndex(b.idx);
  const mesh = new THREE.Mesh(geo, material);
  mesh.renderOrder = renderOrder;
  mesh.matrixAutoUpdate = false;
  scene.add(mesh);
}

const additive = (map, extra = {}) => new THREE.MeshBasicMaterial({
  map, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, ...extra });

// ── Build ───────────────────────────────────────────────────────────────────
export function buildArmory(scene, tex) {
  const base = floorAt(4.5, 12);
  const ceilLocal = ceilAt(4.5, 12) - base;
  const { H, DBOT, DTOP } = RACK;
  const rows = ARMORY_LAYOUT.walls.flatMap(w => w.rows);
  const logos = buildLogoAtlas(rows.flatMap(r => r.logos.map(l => l.f)));
  const plaques = buildPlaqueAtlas(rows);

  const glow = newBatch(), trim = newBatch(), halos = newBatch(), cards = newBatch(), plates = newBatch();

  // Slanted body: profile in depth × height, extruded along the rack width.
  const shape = new THREE.Shape();
  shape.moveTo(0, 0); shape.lineTo(DBOT, 0); shape.lineTo(DTOP, H); shape.lineTo(0, H); shape.closePath();
  const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: false });
  bodyGeo.rotateY(-Math.PI / 2); bodyGeo.translate(W / 2, 0, 0);
  const bodyMat = tex
    ? new THREE.MeshLambertMaterial({ map: tex.get(53), color: 0x9fb4a4 })
    : new THREE.MeshBasicMaterial({ color: 0x223026 });

  for (const wall of ARMORY_LAYOUT.walls) {
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.set(CX, base, wall.z);
    body.rotation.y = wall.dir < 0 ? Math.PI : 0;
    body.matrixAutoUpdate = false;
    body.updateMatrix();
    scene.add(body);

    // Wall-local (x along the rack, y up, z out of the wall) → world; the south rack is
    // the north one turned half a circle.
    const world = (x, y, z) => [CX + wall.dir * x, base + y, wall.z + wall.dir * z];
    const facing = [0, SIN, wall.dir * COS];
    // Quad lying on the leaning face, centred at (xc, yc) with size w × h, `off` m proud of it.
    const onFace = (xc, yc, w, h, off) => {
      const cy = yc + off * SIN, cz = depthAt(yc) + off * COS;
      const p = (du, dv) => world(xc + du * w / 2, cy + dv * h / 2 * COS, cz - dv * h / 2 * SIN);
      return [p(-1, -1), p(1, -1), p(1, 1), p(-1, 1)];
    };

    // Neon trim: bright cap along the top edge, leaning side edges, faint foot line.
    pushQuad(trim, onFace(0, H - 0.025, W, 0.05, 0.006), facing, FULL_UV, tint(GREEN, 1));
    for (const s of [-1, 1])
      pushQuad(trim, onFace(s * (W / 2 - 0.0175), H / 2, 0.035, FACE_LEN, 0.006), facing, FULL_UV, tint(GREEN, 0.5));
    pushQuad(trim, onFace(0, 0.0225, W, 0.045 / COS, 0.006), facing, FULL_UV, tint(GREEN, 0.2));

    // Light wash on the wall above the rack (replaces the old end-of-rack point lights)
    // and a soft spill on the floor in front of it.
    const washH = ceilLocal - H + 0.015, washW = W * 0.98;   // up to 5 mm under the ceiling
    pushQuad(glow, [
      world(-washW / 2, H - 0.02, 0.02), world(washW / 2, H - 0.02, 0.02),
      world(washW / 2, H - 0.02 + washH, 0.02), world(-washW / 2, H - 0.02 + washH, 0.02),
    ], [0, 0, wall.dir], FULL_UV, grey(0.3));
    const spillW = W * 1.05, spillD = 1.3;
    pushQuad(glow, [
      world(-spillW / 2, 0.025, 0), world(spillW / 2, 0.025, 0),
      world(spillW / 2, 0.025, spillD), world(-spillW / 2, 0.025, spillD),
    ], [0, 1, 0], FULL_UV, grey(0.2));

    for (const row of wall.rows) {
      const yBot = row.y - row.band / 2;
      // Row field: the family colour glows up from a bright rail at the row's base.
      pushQuad(trim, onFace(0, row.y, W - 0.07, row.band, 0.004), facing, FULL_UV, tint(row.color, 0.07), tint(row.color, 0.01));
      pushQuad(trim, onFace(0, yBot + 0.008, W - 0.07, 0.016, 0.008), facing, FULL_UV, tint(row.color, 0.55));

      pushQuad(plates, onFace(row.plaque.x, row.y, row.plaque.w, row.plaque.h, 0.014), facing, plaques.uv.get(row.index));
      for (const l of row.logos) {
        pushQuad(halos, onFace(l.x, row.y, row.card * 1.4, row.card * 1.4, 0.010), facing, FULL_UV, tint(l.c, 0.42));
        pushQuad(cards, onFace(l.x, row.y, row.card, row.card, 0.020), facing, logos.uv.get(l.f));
      }
    }
  }

  batchMesh(scene, glow, additive(gradTex(GREEN)), 0);
  batchMesh(scene, trim, additive(null), 1);
  batchMesh(scene, halos, additive(radialTex(0xffffff)), 2);
  batchMesh(scene, cards, new THREE.MeshBasicMaterial({ map: logos.tex, transparent: true, depthWrite: false }), 3);
  batchMesh(scene, plates, new THREE.MeshBasicMaterial({ map: plaques.tex }), 0);
}
