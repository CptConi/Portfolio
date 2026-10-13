import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { featuredProjects as projects, periodLabel, badgesOf } from '../../data/projects.js';
import { techOf } from '../../data/tech.js';
import { floorAt, ceilAt } from '../Map.js';
import { SCREENS } from '../Screens.js';
import { prefs } from '../prefs.js';
import { createDiorama, dioramaFor } from '../dioramas/index.js';
import { PLINTH, FRAME, getDynamicPlinths, getContactFrame, frameOf } from '../PlinthGenerator.js';
import { hex, radialTex, paintPath, wrapName } from './helpers.js';

// Trophées gallery. Per featured mission: the plinth carries the mission diorama, a name
// plate on its front face and a ring of stack logos orbiting around its top; behind it
// hangs a framed poster (name, period, tagline, client, badges). A ninth, dashed frame on
// the west wall invites the visitor to write (features/gallery.js wires its [E] action).
// Flat unlit materials, no light. Layout numbers live in PlinthGenerator.js.
//
// Composition, and why
//   The camera never pitches and the eye is 0.5 above the floor, so everything at or below
//   the plinth top (0.5) falls under the horizon and everything above it over it. The ring,
//   the plate and the plinth lip sit below it and so can never hide the diorama or the frame.
//   The diorama itself hides the lower-centre of its frame from every walking position:
//   the frame keeps its large text in the upper block, its fine print in the two lower
//   corners, and a warm backlight behind the diorama. Text sizes are multiples of 8 so each
//   font pixel stays whole; sheets use mipmaps (far better than nearest when minified) with
//   a nearest magnification filter, so up close the pixels stay crisp.
//
// Textures are three canvas sheets (frames 3×3, name plates 2×4, logo chips) rather than one
// texture per object, which keeps the gallery at 25 draw calls on top of the dioramas' own
// (7 to 13 each): 8 merged static meshes (wall wash, bezels, borders, screens, plates,
// plinth lips, floor pools, ceiling pools), 2 per ring (chips, halos) and the aisle line.

const ORANGE = 0xff8c00;
const FONT = '"Press Start 2P", monospace';

// ── Canvas cells (px) ─────────────────────────────────────────────────────────
const FW = 384, FH = 216;              // mission / contact frame
const PAD = 14;                        // text margin inside a frame
const FLANK = { y: 148, w: 100 };      // the two lower corners, left clear of the diorama's shadow
const PW = 256, PH = 96;               // plinth name plate
const CS = 128;                        // stack logo chip

// ── Layout of the 3D pieces (metres; heights above the local floor) ─────────
const PLATE = { w: 0.44, h: 0.165, cy: 0.25 };              // plinth front face
// Chips span 0.335 – 0.485: just under the horizon. Raise `y` above 0.5 and the ring floats
// over the diorama, but then it covers the frame's text from every walking position.
const RING = { y: 0.41, r: 0.42, chip: 0.15, halo: 0.26 };
const LIP = 0.02;                                            // glowing strip along the plinth top
const SWAY = 0.26;                                           // diorama yaw sway, radians

// ── Canvas sheets ─────────────────────────────────────────────────────────────
class Sheet {
  constructor(cols, rows, cw, ch) {
    this.cols = cols; this.rows = rows; this.cw = cw; this.ch = ch;
    const canvas = document.createElement('canvas');
    canvas.width = cols * cw;
    canvas.height = rows * ch;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.anisotropy = 4;
  }

  // Runs draw(ctx) with the origin at the top-left corner of cell i, clipped to the cell.
  paint(i, draw) {
    const { ctx, cw, ch } = this;
    ctx.save();
    ctx.translate((i % this.cols) * cw, Math.floor(i / this.cols) * ch);
    ctx.beginPath();
    ctx.rect(0, 0, cw, ch);
    ctx.clip();
    draw(ctx);
    ctx.restore();
    this.texture.needsUpdate = true;
  }

  // [u0, v0, u1, v1] of cell i, `inset` canvas pixels in from every side.
  uv(i, inset = 0) {
    const W = this.cols * this.cw, H = this.rows * this.ch;
    const x = (i % this.cols) * this.cw, y = Math.floor(i / this.cols) * this.ch;
    return [(x + inset) / W, 1 - (y + this.ch - inset) / H, (x + this.cw - inset) / W, 1 - (y + inset) / H];
  }
}

// Maps a plane's 0..1 UVs onto a sheet cell.
function remapUV(geo, [u0, v0, u1, v1]) {
  const uv = geo.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * (u1 - u0), v0 + uv.getY(k) * (v1 - v0));
  return geo;
}

// ── Text layout ───────────────────────────────────────────────────────────────
// Press Start 2P is monospaced with a 1 em advance: sizes that are multiples of 8 keep
// every font pixel on whole canvas pixels.
const font = (ctx, px) => { ctx.font = `${px}px ${FONT}`; };
const NBSP = '\u00a0';
const plain = s => s.replace(/\u00a0/g, ' ');

// French typography: "3 000" and the space before ? ! : ; must never wrap.
const glue = s => s.replace(/(\d) (?=\d{3}\b)/g, `$1${NBSP}`).replace(/ ([?!:;])/g, `${NBSP}$1`);

// Fewest lines (≤ maxLines) that fit maxW, then the most even split. null when a word is too wide.
function wrapBalanced(ctx, text, maxW, maxLines) {
  const words = text.split(' ');
  const wd = words.map(s => ctx.measureText(plain(s)).width);
  if (wd.some(w => w > maxW)) return null;
  const space = ctx.measureText(' ').width;
  const n = words.length;
  const span = (a, b) => wd.slice(a, b).reduce((s, w) => s + w, space * (b - a - 1));

  for (let lines = 1; lines <= maxLines; lines++) {
    const cost = Array.from({ length: lines + 1 }, () => new Array(n + 1).fill(Infinity));
    const from = Array.from({ length: lines + 1 }, () => new Array(n + 1).fill(0));
    cost[0][0] = 0;
    for (let l = 1; l <= lines; l++) {
      for (let j = l; j <= n; j++) {
        for (let i = l - 1; i < j; i++) {
          const w = span(i, j);
          if (w > maxW || cost[l - 1][i] === Infinity) continue;
          const c = cost[l - 1][i] + (maxW - w) ** 2;
          if (c < cost[l][j]) { cost[l][j] = c; from[l][j] = i; }
        }
      }
    }
    if (cost[lines][n] === Infinity) continue;
    const out = [];
    for (let l = lines, j = n; l > 0; j = from[l][j], l--) {
      out.unshift(plain(words.slice(from[l][j], j).join(' ')));
    }
    return out;
  }
  return null;
}

// Last resort for a word wider than the box: break it wherever it overflows.
function hardWrap(ctx, text, maxW) {
  const lines = [];
  let line = '';
  for (const ch of text) {
    if (line && ctx.measureText(line + ch).width > maxW) { lines.push(line.trim()); line = ''; }
    line += ch;
  }
  return line.trim() ? [...lines, line.trim()] : lines;
}

// One line when the whole name fits, else its best two-line split; null when neither fits.
function nameLines(ctx, name, size, maxW) {
  font(ctx, size);
  if (ctx.measureText(name).width <= maxW) return [name];
  const two = wrapName(name);
  return two.length === 2 && two.every(l => ctx.measureText(l).width <= maxW) ? two : null;
}

const pitch = size => size + 2;
const blockH = (lines, size) => (lines - 1) * pitch(size) + size;

// Type scales tried in order: the first one whose stack fits its box wins.
const SCALES = [
  { name: 32, meta: 16, tag: 16 },
  { name: 24, meta: 16, tag: 16 },
  { name: 24, meta: 16, tag: 8 },
  { name: 16, meta: 8, tag: 8 },
];
const STACK_GAP = 8;

function fitStack(ctx, project, box) {
  const meta = periodLabel(project);
  const tag = glue(project.tagline);
  let out = null;
  for (const sc of SCALES) {
    const name = nameLines(ctx, project.name, sc.name, box.w);
    font(ctx, sc.meta);
    const metaL = wrapBalanced(ctx, meta, box.w, 2);
    font(ctx, sc.tag);
    const tagL = wrapBalanced(ctx, tag, box.w, 3);
    out = {
      scale: sc,
      name: name ?? [project.name],
      meta: metaL ?? [meta],
      tag: tagL ?? [tag],
    };
    const h = blockH(out.name.length, sc.name) + STACK_GAP + blockH(out.meta.length, sc.meta)
      + STACK_GAP + blockH(out.tag.length, sc.tag);
    if (name && metaL && tagL && h <= box.h) break;
  }
  return out;
}

const COLOR = {
  name: '#ffb340', nameShadow: '#6b3600', meta: '#ff8c00', tag: '#dcd0b8',
  label: '#9a7b4a', value: '#d8cdb8', badge: '#ff8c00', ink: '#120b04',
};

function drawLines(ctx, lines, size, x, y, color, shadow = 0) {
  font(ctx, size);
  lines.forEach((text, i) => {
    const yy = y + i * pitch(size);
    if (shadow) { ctx.fillStyle = COLOR.nameShadow; ctx.fillText(text, x + shadow, yy + shadow); }
    ctx.fillStyle = color;
    ctx.fillText(text, x, yy);
  });
}

// ── Mission frame ────────────────────────────────────────────────────────────

function paintBase(ctx, glow) {
  const bg = ctx.createLinearGradient(0, 0, 0, FH);
  bg.addColorStop(0, '#0d0a07');
  bg.addColorStop(1, '#1b1208');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, FW, FH);
  if (glow) {                 // warm backlight: the diorama stands out against it
    const g = ctx.createRadialGradient(FW / 2, FH + 12, 6, FW / 2, FH + 12, 170);
    g.addColorStop(0, 'rgba(255,140,0,0.34)');
    g.addColorStop(1, 'rgba(255,140,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, FW, FH);
  }
  ctx.strokeStyle = '#4a2c0c';
  ctx.lineWidth = 2;
  ctx.strokeRect(5, 5, FW - 10, FH - 10);
}

// "CLIENT" + the client name (without the ' / Guaraní' every mission carries) at 8 px.
function drawClient(ctx, project, x, y) {
  const client = project.client.replace(/\s*\/\s*Guaraní$/, '');
  font(ctx, 8);
  const lines = wrapBalanced(ctx, client, FLANK.w, 4) ?? hardWrap(ctx, client, FLANK.w);
  ctx.textAlign = 'left';
  drawLines(ctx, ['CLIENT'], 8, x, y, COLOR.label);
  drawLines(ctx, lines, 8, x, y + 14, COLOR.value);
}

// Badges stacked against the right edge (8 px; EN COURS is solid).
function drawBadges(ctx, project, right, y) {
  font(ctx, 8);
  ctx.textAlign = 'left';
  badgesOf(project).filter(b => b !== 'EN LIGNE').slice(0, 3).forEach((b, i) => {
    const w = ctx.measureText(b).width + 10;
    const x = right - w, yy = y + i * 17;
    if (b === 'EN COURS') {
      ctx.fillStyle = COLOR.badge;
      ctx.fillRect(x, yy, w, 13);
      ctx.fillStyle = COLOR.ink;
    } else {
      ctx.strokeStyle = COLOR.badge;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, yy + 1, w - 2, 11);
      ctx.fillStyle = COLOR.badge;
    }
    ctx.fillText(b, x + 5, yy + 3);
  });
}

function paintMission(sheet, i, project, image = null) {
  sheet.paint(i, ctx => {
    paintBase(ctx, true);
    ctx.textBaseline = 'top';

    let box = { x: PAD, y: 12, w: FW - 2 * PAD, h: 134 }, align = 'center';
    if (image) {              // screenshot inset on the left, text on the right
      const iw = 112, ih = 63;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(image, PAD, 14, iw, ih);
      ctx.imageSmoothingEnabled = false;
      ctx.strokeStyle = COLOR.meta;
      ctx.lineWidth = 2;
      ctx.strokeRect(PAD - 1, 13, iw + 2, ih + 2);
      box = { x: PAD + iw + 14, y: 12, w: FW - 2 * PAD - iw - 14, h: 134 };
      align = 'left';
    }

    const st = fitStack(ctx, project, box);
    const cx = align === 'center' ? box.x + box.w / 2 : box.x;
    ctx.textAlign = align;
    let y = box.y;
    drawLines(ctx, st.name, st.scale.name, cx, y, COLOR.name, 3);
    y += blockH(st.name.length, st.scale.name) + STACK_GAP;
    drawLines(ctx, st.meta, st.scale.meta, cx, y, COLOR.meta);
    y += blockH(st.meta.length, st.scale.meta) + STACK_GAP;
    drawLines(ctx, st.tag, st.scale.tag, cx, y, COLOR.tag);

    drawClient(ctx, project, PAD, image ? 90 : FLANK.y);
    drawBadges(ctx, project, FW - PAD, FLANK.y);
  });
}

// ── Contact frame ("Envie d'échanger ?") ─────────────────────────────────────
function paintContact(sheet, i) {
  sheet.paint(i, ctx => {
    paintBase(ctx, false);
    ctx.strokeStyle = '#ff8c00';
    ctx.lineWidth = 3;
    ctx.setLineDash([12, 8]);
    ctx.strokeRect(9, 9, FW - 18, FH - 18);
    ctx.setLineDash([]);

    // Pixel envelope.
    const ex = FW / 2 - 30, ey = 22;
    ctx.fillStyle = COLOR.name;
    ctx.fillRect(ex, ey, 60, 40);
    ctx.fillStyle = '#1b1208';
    ctx.fillRect(ex + 3, ey + 3, 54, 34);
    ctx.strokeStyle = COLOR.name;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ex + 3, ey + 4);
    ctx.lineTo(ex + 30, ey + 25);
    ctx.lineTo(ex + 57, ey + 4);
    ctx.stroke();

    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    font(ctx, 24);
    const title = wrapBalanced(ctx, glue("ENVIE D'ÉCHANGER ?"), FW - 2 * PAD, 2);
    drawLines(ctx, title, 24, FW / 2, 76, COLOR.name, 3);
    font(ctx, 16);
    const sub = wrapBalanced(ctx, glue("Approchez : la fiche contact s'ouvre."), FW - 2 * PAD, 3);
    drawLines(ctx, sub, 16, FW / 2, 76 + blockH(title.length, 24) + 18, COLOR.tag);
  });
}

// ── Plinth name plate ────────────────────────────────────────────────────────
function paintPlate(sheet, i, name) {
  sheet.paint(i, ctx => {
    ctx.fillStyle = '#0a0704';
    ctx.fillRect(0, 0, PW, PH);
    ctx.strokeStyle = '#ff8c00';
    ctx.lineWidth = 4;
    ctx.strokeRect(3, 3, PW - 6, PH - 6);
    let size = 24, lines = nameLines(ctx, name, size, PW - 28);
    if (!lines) { size = 16; lines = nameLines(ctx, name, size, PW - 28) ?? [name]; }
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    drawLines(ctx, lines, size, PW / 2, (PH - blockH(lines.length, size)) / 2, COLOR.name, 2);
  });
}

// ── Stack logo chips (transparent corners) ───────────────────────────────────
// Rectangle with cut corners (pixel-art "rounded").
function chamfer(ctx, x, y, w, h, k) {
  ctx.beginPath();
  ctx.moveTo(x + k, y); ctx.lineTo(x + w - k, y); ctx.lineTo(x + w, y + k);
  ctx.lineTo(x + w, y + h - k); ctx.lineTo(x + w - k, y + h); ctx.lineTo(x + k, y + h);
  ctx.lineTo(x, y + h - k); ctx.lineTo(x, y + k);
  ctx.closePath();
  ctx.fill();
}

// Loads an image; calls done(img) once it has decoded. A failure is silently ignored.
function loadImage(src, done) {
  if (typeof Image === 'undefined') return;
  const img = new Image();
  img.onload = () => done(img);
  img.src = src;
}

// Mean luminance (0..1, alpha-weighted) of a logo; dark brand marks (Unity, .NET…) need a
// light plate. Falls back to "not dark" when the pixels cannot be read.
function isDarkLogo(img) {
  try {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 24;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, 24, 24);
    const px = g.getImageData(0, 0, 24, 24).data;
    let sum = 0, weight = 0;
    for (let k = 0; k < px.length; k += 4) {
      sum += (0.2126 * px[k] + 0.7152 * px[k + 1] + 0.0722 * px[k + 2]) / 255 * px[k + 3];
      weight += px[k + 3];
    }
    return weight > 0 && sum / weight < 0.32;
  } catch {
    return false;
  }
}

// Plate and, once it has decoded, the logo (or a text label for techs without one).
function paintChip(sheet, i, tech) {
  const plate = (ctx, fill) => {
    ctx.clearRect(0, 0, CS, CS);
    ctx.fillStyle = hex(tech.c);
    chamfer(ctx, 4, 4, CS - 8, CS - 8, 18);
    ctx.fillStyle = fill;
    chamfer(ctx, 10, 10, CS - 20, CS - 20, 14);
  };
  sheet.paint(i, ctx => {
    plate(ctx, '#0c0c10');
    if (tech.f) return;
    ctx.fillStyle = hex(tech.c);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    font(ctx, tech.l.length <= 3 ? 32 : 16);
    ctx.fillText(tech.l, CS / 2, CS / 2);
  });
  if (!tech.f) return;
  loadImage(`/logos/${tech.f}.svg`, img => sheet.paint(i, ctx => {
    plate(ctx, isDarkLogo(img) ? '#dcdce4' : '#0c0c10');
    const pad = 26, room = CS - 2 * pad;
    if (img.naturalWidth && img.naturalHeight) {
      const sc = Math.min(room / img.naturalWidth, room / img.naturalHeight);
      const w = img.naturalWidth * sc, h = img.naturalHeight * sc;
      ctx.drawImage(img, (CS - w) / 2, (CS - h) / 2, w, h);
    } else {
      ctx.drawImage(img, pad, pad, room, room);   // SVG without an intrinsic size
    }
  }));
}

// ── Geometry helpers ─────────────────────────────────────────────────────────
// Local pieces face +z; this turns one toward `facing` and drops it at (x, y, z).
const place = (geo, x, y, z, [fx, fz]) => geo.rotateY(Math.atan2(fx, fz)).translate(x, y, z);
const plane = (w, h) => new THREE.PlaneGeometry(w, h);

function mesh(list, material) {
  const geo = mergeGeometries(list);
  list.forEach(g => g.dispose());
  return new THREE.Mesh(geo, material);
}

const additive = (map, opacity, extra = {}) => new THREE.MeshBasicMaterial({
  map, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
  side: THREE.DoubleSide, ...extra,
});

const chipKey = tech => tech.f ?? `#${tech.l}`;

export function buildGallery(scene) {
  const plinths = getDynamicPlinths();
  const stands = [];

  const frames = new Sheet(3, Math.ceil((plinths.length + 1) / 3), FW, FH);
  const plates = new Sheet(2, Math.max(1, Math.ceil(plinths.length / 2)), PW, PH);
  const stacks = projects.map(p => p.stack.slice(0, 4).map(techOf));
  const keys = [...new Set(stacks.flat().map(chipKey))];
  const chips = new Sheet(6, Math.max(1, Math.ceil(keys.length / 6)), CS, CS);
  keys.forEach((key, cell) => paintChip(chips, cell, stacks.flat().find(t => chipKey(t) === key)));

  const chipMat = new THREE.MeshBasicMaterial({ map: chips.texture, alphaTest: 0.5 });
  const haloMat = additive(radialTex(0xffffff), 0.6, { vertexColors: true });

  // World-space pieces, merged per material at the end (one draw call each).
  const bezels = [], borders = [], screens = [], washes = [];
  const plateGeos = [], lips = [], floorPools = [], ceilPools = [];

  // Wall frame: dark bezel, orange border (not on the contact frame, which is dashed),
  // screen = cell `cell` of the frame sheet, soft orange wash on the wall around it.
  const hangFrame = (f, cell, border) => {
    const [fx, fz] = f.facing;
    const floor = floorAt(f.x + fx * 0.5, f.z + fz * 0.5);
    const room = ceilAt(f.x + fx * 0.5, f.z + fz * 0.5) - floor;
    const { bezel, depth } = FRAME;
    const put = g => place(g, f.x, floor + f.cy, f.z, f.facing);
    bezels.push(put(new THREE.BoxGeometry(f.w + 2 * bezel, f.h + 2 * bezel, depth).translate(0, 0, depth / 2)));
    if (border) borders.push(put(plane(f.w + 0.04, f.h + 0.04).translate(0, 0, depth + 0.001)));
    screens.push(remapUV(put(plane(f.w, f.h).translate(0, 0, depth + 0.002)), frames.uv(cell, 2)));
    const washH = Math.min(f.h * 2.2, 2 * (room - 0.02 - f.cy));        // stays under the ceiling
    washes.push(put(plane(f.w * 1.5, washH).translate(0, 0, 0.004)));
  };

  // Ring of stack logos around the plinth: one merged mesh of chips (two back-to-back
  // quads each, so a logo is never mirrored) and one of halos, between the two quads.
  const buildRing = techs => {
    const chipGeos = [], haloGeos = [];
    techs.forEach((tech, k) => {
      const a = (k / techs.length) * Math.PI * 2;
      const orbit = g => g.rotateY(a).translate(Math.sin(a) * RING.r, 0, Math.cos(a) * RING.r);
      const uv = chips.uv(keys.indexOf(chipKey(tech)), 1);
      const quad = (z, turn) => remapUV(orbit(plane(RING.chip, RING.chip).rotateY(turn).translate(0, 0, z)), uv);
      chipGeos.push(quad(0.004, 0), quad(-0.004, Math.PI));
      const halo = orbit(plane(RING.halo, RING.halo));
      const col = new THREE.Color(tech.c);
      const rgb = new Float32Array(halo.attributes.position.count * 3);
      for (let j = 0; j < rgb.length; j += 3) { rgb[j] = col.r; rgb[j + 1] = col.g; rgb[j + 2] = col.b; }
      halo.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
      haloGeos.push(halo);
    });
    if (!chipGeos.length) return null;
    const ring = new THREE.Group();
    ring.add(mesh(chipGeos, chipMat), mesh(haloGeos, haloMat));
    return ring;
  };

  plinths.forEach((p, i) => {
    const project = projects[i];
    const floor = floorAt(p.x, p.z), ceil = ceilAt(p.x, p.z);
    const [fx, fz] = p.face;
    const half = PLINTH.size / 2;

    paintMission(frames, i, project);
    if (project.image) loadImage(project.image, img => paintMission(frames, i, project, img));
    hangFrame(frameOf(p), i, true);

    paintPlate(plates, i, project.name);
    plateGeos.push(remapUV(
      place(plane(PLATE.w, PLATE.h).translate(0, 0, half + 0.004), p.x, floor + PLATE.cy, p.z, p.face),
      plates.uv(i, 2)));

    // Pools of light, pushed toward the room: on the floor and on the ceiling.
    floorPools.push(plane(1.3, 1.3).rotateX(-Math.PI / 2).translate(p.x, floor + 0.03, p.z + fz * 0.2));
    ceilPools.push(plane(0.8, 0.8).rotateX(Math.PI / 2).translate(p.x, ceil - 0.015, p.z + fz * 0.2));

    // Glowing strip along the top edge of the plinth (front and both sides).
    const ly = floor + PLINTH.top - LIP / 2 - 0.002;
    lips.push(
      place(plane(PLINTH.size, LIP).translate(0, 0, half + 0.003), p.x, ly, p.z, p.face),
      plane(PLINTH.size, LIP).rotateY(Math.PI / 2).translate(p.x + half + 0.003, ly, p.z),
      plane(PLINTH.size, LIP).rotateY(-Math.PI / 2).translate(p.x - half - 0.003, ly, p.z));

    const kind = dioramaFor(project.name);
    const diorama = kind ? createDiorama(kind) : null;
    const yaw = Math.atan2(fx, fz);
    if (diorama) {
      diorama.group.position.set(p.x, floor + PLINTH.top, p.z);
      diorama.group.rotation.y = yaw;
      scene.add(diorama.group);
    }

    const ring = buildRing(stacks[i]);
    if (ring) {
      ring.position.set(p.x, floor + RING.y, p.z);
      scene.add(ring);
    }
    stands.push({ diorama, ring, yaw, ringY: floor + RING.y, phase: i * 1.3, spin: 0.45 + i * 0.03 });
  });

  paintContact(frames, plinths.length);
  hangFrame(getContactFrame(), plinths.length, false);

  const addStatic = (list, material) => {
    if (!list.length) return;
    const m = mesh(list, material);
    m.matrixAutoUpdate = false;
    scene.add(m);
  };
  addStatic(washes, additive(radialTex(ORANGE), 0.2));
  addStatic(bezels, new THREE.MeshBasicMaterial({ color: 0x17120d }));
  addStatic(borders, new THREE.MeshBasicMaterial({ color: ORANGE }));
  addStatic(screens, new THREE.MeshBasicMaterial({ map: frames.texture }));
  addStatic(plateGeos, new THREE.MeshBasicMaterial({ map: plates.texture }));
  addStatic(lips, new THREE.MeshBasicMaterial({ color: ORANGE, side: THREE.DoubleSide }));
  addStatic(floorPools, additive(radialTex(ORANGE), 0.4));
  addStatic(ceilPools, additive(radialTex(ORANGE), 0.45));

  // Amber guidance line from the door to the console's approach point: the continuation
  // of the line painted across the atrium.
  const missions = SCREENS.find(s => s.id === 'projects');
  if (missions) {
    const [fx] = missions.facing;
    paintPath(scene, 0xb5701a, [[17.05, missions.z], [missions.x + fx * 1.3, missions.z]]);
  }

  let last = null;
  return {
    update(t) {
      const dt = last === null ? 0 : Math.min(Math.max(t - last, 0), 0.1);
      last = t;
      const still = prefs.reducedMotion;
      for (const s of stands) {
        if (s.diorama) {
          s.diorama.update(t, dt);
          s.diorama.group.rotation.y = s.yaw + (still ? 0 : Math.sin(t * 0.45 + s.phase) * SWAY);
        }
        if (s.ring) {
          s.ring.rotation.y = s.phase + (still ? 0 : t * s.spin);
          s.ring.position.y = s.ringY + (still ? 0 : Math.sin(t * 1.1 + s.phase) * 0.012);
        }
      }
    },
  };
}
