// Dev proof for the windows on the moon (decor/windowSlots.js), in plain node (no DOM, no GPU):
//
//   node src/engine/decor/check-windows.mjs            prove every rule, print PASS / FAIL, exit 1 on a failure
//   node src/engine/decor/check-windows.mjs --png DIR  also draw DIR/windows-map.png (plan of the level) and
//                                                      DIR/windows-walls.png (one elevation per wall that hosts a window)
//   node src/engine/decor/check-windows.mjs --free     list the free spans of every wall (the designer's worksheet)
//
// What it proves, with the game's own modules (Map.js, Screens.js, Props3D.js, PlinthGenerator.js, props/placement.js,
// data/notes.js, decor/armory.js, decor/thresholds.js…) and, for the numbers those modules keep private, constants read
// straight out of their source text (so a move in the decor breaks this check instead of silently leaving a window behind):
//
//   · every window is on a real wall face of its own room, facing INTO the room, and inside one run of solid wall
//   · ≥ 0.3 m from every door opening and every room corner (the push-wall counts as a door), ≥ 0.3 m from its neighbours
//   · sill ≥ 0.2 m above the floor, head ≥ 0.12 m under the ceiling
//   · nothing is overlapped or hidden: consoles, the monolith, doors' signage, gallery frames, plinths and dioramas,
//     armory racks, Props3D, sprites, notes (≥ 0.25 m), the PROD hook and key zone, the dashboard dressing, lounge props,
//     the PROD dressing, ceiling light panels, the hub. A free-standing thing within 1 m of the wall that stands in the
//     way of the window as seen from the room counts as hiding it (its outline is projected on the wall).
//   · additive washes (soft light on a wall) are listed as WARN when a window lies in one: they never fail the check
//   · skylight: wholly inside the atrium, clear of the lit ceiling panels
//   · 2–4 windows per room (the atrium counts its skylight), at most one in the PROD room
//
// Everything below the heading `Level model` is the model of what stands where; the rules come after it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MAP, PUSH_WALL, floorAt, ceilAt, getCellType } from '../Map.js';
import { SCREENS, ARCADE, consoleAABBs } from '../Screens.js';
import { PROPS3D } from '../Props3D.js';
import { spriteAABBs } from '../Sprites2D.js';
import { FRAME, PLINTH, getDynamicPlinths, frameOf, getContactFrame } from '../PlinthGenerator.js';
import { ARMORY_RACK_AABBS } from './armory.js';
import { soffiteLayout } from './thresholds.js';
import { HUB } from './atrium.js';
import { PROD_PANEL, PROD_KEY } from '../layout.js';
import { LOUNGE, LOUNGE_SOLIDS, KEY_ZONE } from '../props/placement.js';
import { PLACEMENTS } from '../../data/notes.js';
import { sizeOf } from '../props/notes3d.js';
import { createCat } from '../props/cat.js';
import { signWidth, SIGN_ROWS } from '../props/sign.js';
import { Player, isFree, addSolidBox } from '../Player.js';
import { EARTH } from '../props/sky.js';
import { WINDOWS, EARTH_VIEW } from './windowSlots.js';
import zlib from 'node:zlib';

// ── Rules (metres) ──────────────────────────────────────────────────────────────────────────────────────
export const RULES = Object.freeze({
  doorCorner: 0.3,     // opening edge → door opening / room corner
  gap: 0.3,            // opening edge → the next window on the same wall
  sillMin: 0.2,        // sill above the local floor
  headGap: 0.12,       // head under the local ceiling
  object: 0.12,        // opening edge → outline of a free-standing solid thing (a window frame is ~0.08 wide)
  wallItem: 0.2,       // opening edge → a frame, poster, sign or rack hung on the same wall
  note: 0.25,          // opening edge → a note
  vertical: 0.05,      // vertical slack when deciding whether a thing is above / below the window
  hideDist: 1.0,       // a free-standing thing nearer than this to the wall can stand in front of a window
  ceilingObject: 0.1,  // skylight edge → a lit ceiling panel
  gazeFrom: 0.5,       // eye height above the floor (Player.js EYE_OFFSET)
  vtan: Math.tan(Math.PI / 6) / (16 / 9),   // tan of the vertical half field of view (60° horizontal, 16:9)
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', '..');
const read = rel => fs.readFileSync(path.join(SRC, rel), 'utf8');

// ── Mirror guards ─────────────────────────────────────────────────────────────────────────────────────────
// Constants the decor keeps to itself are read from its source text, so that a change there is noticed.
export const guards = [];                     // { label, ok, detail }
const guard = (label, ok, detail = '') => { guards.push({ label, ok, detail }); return ok; };

// The literal of `const NAME = <literal>;` in a source file ({...} or [...]) evaluated as plain JS.
function literal(rel, name) {
  const src = read(rel);
  const at = src.search(new RegExp(`\\bconst ${name}\\s*=\\s*[\\[{]`));
  if (at < 0) { guard(`${rel}: const ${name}`, false, 'not found'); return null; }
  const open = src.indexOf(src.slice(at).match(/[\[{]/)[0], at + 5);
  const close = { '[': ']', '{': '}' }[src[open]];
  let depth = 0, end = open;
  for (let i = open; i < src.length; i++) {
    if (src[i] === src[open]) depth++;
    else if (src[i] === close && --depth === 0) { end = i; break; }
  }
  try {
    const v = new Function(`return (${src.slice(open, end + 1)});`)();
    guard(`${rel}: const ${name}`, true);
    return v;
  } catch (err) {
    guard(`${rel}: const ${name}`, false, err.message);
    return null;
  }
}

// The first match of `re` in a source file, or null (and a failed guard).
function grab(rel, re, label) {
  const m = read(rel).match(re);
  guard(`${rel}: ${label}`, !!m, m ? '' : `no match for ${re}`);
  return m;
}

// ── Level model ────────────────────────────────────────────────────────────────────────────────────────
// Everything is a box in world metres: x, z on the plan, y ABOVE THE LOCAL FLOOR of the room it stands in.
//   tier  'solid'  a physical thing: a window must keep `RULES.object` clear of it
//         'note'   a note: `RULES.note`
//         'soft'   an additive wash / glow: a window in it is only a WARN
export const ROOM_TYPE = Object.freeze({ armurerie: 2, trophees: 3, quartiers: 4, atrium: 6, prod: 5 });
const TYPE_ROOM = Object.fromEntries(Object.entries(ROOM_TYPE).map(([k, v]) => [v, k]));
export const roomAt = (x, z) => TYPE_ROOM[getCellType(x, z)] ?? null;

const box = (id, tier, x0, x1, z0, z1, y0, y1, extra = {}) => ({ id, tier, x0, x1, z0, z1, y0, y1, ...extra });
const around = (id, tier, x, z, hx, hz, y0, y1, extra = {}) => box(id, tier, x - hx, x + hx, z - hz, z + hz, y0, y1, extra);

// Sprites2D.js: DEFS and SPRITES are private, so they are read from the source and cross-checked against spriteAABBs().
function spriteElements() {
  const src = read('engine/Sprites2D.js');
  const defs = {};
  for (const m of src.matchAll(/^\s*(\w+):\s*\{[^}]*?\bh: ([\d.]+),\s*ar: ([\d.]+) \/ ([\d.]+)[^}]*\}/gm)) {
    defs[m[1]] = { h: +m[2], w: +m[2] * (+m[3] / +m[4]), solid: /solid: true/.test(m[0]) };
  }
  const out = [];
  for (const m of src.matchAll(/\{ x: ([\d.]+), z: ([\d.]+), d: '(\w+)'(?:, yoff: ([\d.]+))? \}/g)) {
    const [x, z, d, yoff] = [+m[1], +m[2], m[3], +(m[4] ?? 0)];
    const def = defs[d];
    if (!def) { guard(`Sprites2D.js: def ${d}`, false, 'unknown sprite def'); continue; }
    out.push({ x, z, d, ...def, yoff });
  }
  // Guard: the solid ones must be exactly what Player.js / notes see.
  const solid = out.filter(s => s.solid);
  const aabb = spriteAABBs(0);
  const same = solid.length === aabb.length && solid.every((s, i) =>
    Math.abs((aabb[i].minX + aabb[i].maxX) / 2 - s.x) < 1e-6 && Math.abs((aabb[i].maxX - aabb[i].minX) - s.w) < 1e-6);
  guard('Sprites2D.js source = spriteAABBs()', same, `${solid.length} parsed solid sprites vs ${aabb.length}`);
  return out.map(s => around(`sprite:${s.d}(${s.x},${s.z})`, 'solid', s.x, s.z, s.w / 2, s.w / 2, s.yoff, s.yoff + s.h, { sprite: true }));
}

// Wall faces of the levels' rooms: x-normal and z-normal walls, with the cells in front / behind.
const isPush = (mx, my) => mx === PUSH_WALL.mx && my === PUSH_WALL.my;
const solidWall = (mx, my) => MAP[my]?.[mx] === 1 && !isPush(mx, my);     // the push-wall is a door

export function buildModel() {
  const el = [];
  const add = (...b) => { el.push(...b); return b[0]; };

  // Consoles (Screens.js): the cabinet is 0.86 m high (ScreenManager.js buildMainframe), 1 m wide along the wall.
  const consoleBoxes = consoleAABBs(0);
  [...SCREENS, ARCADE].forEach((s, i) => {
    const b = consoleBoxes[i];
    add(box(`console:${s.id}`, 'solid', b.minX, b.maxX, b.minZ, b.maxZ, 0, 0.86));
  });

  // Props3D boxes (plinths included).
  for (const p of PROPS3D) add(around(`prop(${p.x},${p.y})`, 'solid', p.x, p.y, p.w / 2, p.d / 2, 0, p.h));

  // 2D sprites (candles too, which Player.js lets you walk through).
  add(...spriteElements());

  // Gallery (decor/gallery.js): frame + bezel, orange wash, dioramas on the plinths, rings of stack logos.
  const RING = literal('engine/decor/gallery.js', 'RING') ?? { y: 0.41, r: 0.42, chip: 0.15, halo: 0.26 };
  const hang = (id, f) => {
    const [fx, fz] = f.facing;
    const room = ceilAt(f.x + fx * 0.5, f.z + fz * 0.5) - floorAt(f.x + fx * 0.5, f.z + fz * 0.5);
    const hw = f.w / 2 + FRAME.bezel, hh = f.h / 2 + FRAME.bezel;
    const washH = Math.min(f.h * 2.2, 2 * (room - 0.02 - f.cy));
    const along = (a, h) => fx !== 0
      ? { z0: f.z - a, z1: f.z + a, x0: Math.min(f.x, f.x + fx * h), x1: Math.max(f.x, f.x + fx * h) }
      : { x0: f.x - a, x1: f.x + a, z0: Math.min(f.z, f.z + fz * h), z1: Math.max(f.z, f.z + fz * h) };
    const frame = along(hw, FRAME.depth + 0.003), wash = along(f.w * 0.75, 0.004);
    add(box(`${id}:frame`, 'solid', frame.x0, frame.x1, frame.z0, frame.z1, f.cy - hh, f.cy + hh));
    add(box(`${id}:wash`, 'soft', wash.x0, wash.x1, wash.z0, wash.z1, f.cy - washH / 2, f.cy + washH / 2));
  };
  getDynamicPlinths().forEach((p, i) => {
    hang(`gallery:frame${i}`, frameOf(p));
    const half = PLINTH.size / 2;
    add(around(`gallery:diorama${i}`, 'solid', p.x, p.z, 0.24, 0.24, PLINTH.top, PLINTH.top + 0.38));
    const ring = RING.r + RING.chip / 2 + 0.03;     // chips orbit at r; a halo is a little wider than a chip
    add(around(`gallery:ring${i}`, 'solid', p.x, p.z, ring, ring, RING.y - RING.chip / 2, RING.y + RING.chip / 2));
    add(around(`gallery:plinth${i}`, 'solid', p.x, p.z, half, half, 0, PLINTH.top));
  });
  hang('gallery:contact', getContactFrame());

  // Armory racks (decor/armory.js): body 1.04 m high, 0.42 m deep; the wash above lights the wall up to the ceiling.
  const RACK = literal('engine/decor/armory.js', 'RACK') ?? { H: 1.04, X0: 3, X1: 7 };
  ARMORY_RACK_AABBS.forEach((b, i) => {
    add(box(`armory:rack${i}`, 'solid', b.minX, b.maxX, b.minZ, b.maxZ, 0, RACK.H));
    const north = b.minZ < 12;
    const w = (RACK.X1 - RACK.X0) * 0.98, cx = (RACK.X0 + RACK.X1) / 2;
    const z0 = north ? RACK.NZ : RACK.SZ - 0.04, z1 = north ? RACK.NZ + 0.04 : RACK.SZ;
    add(box(`armory:wash${i}`, 'soft', cx - w / 2, cx + w / 2, z0, z1, RACK.H - 0.02, ceilAt(4.5, 12) - floorAt(4.5, 12) + 0.015));
  });

  // Doors' signage (decor/thresholds.js): the soffite sign and its wash, on the hall side of each door.
  const ROOMS = literal('engine/decor/thresholds.js', 'ROOMS') ?? [];
  for (const r of ROOMS) {
    const { sign, wash } = soffiteLayout(r);
    for (const [id, q, tier] of [['sign', sign, 'solid'], ['wash', wash, 'soft']]) {
      const onX = q.facing[0] !== 0, hw = q.w / 2, hh = q.h / 2, flo = floorAt(q.x, q.z);
      add(box(`door:${r.name}:${id}`, tier, onX ? q.x - 0.01 : q.x - hw, onX ? q.x + 0.01 : q.x + hw,
        onX ? q.z - hw : q.z - 0.01, onX ? q.z + hw : q.z + 0.01, q.y - hh - flo, q.y + hh - flo));
    }
  }

  // Atrium (decor/atrium.js): the hub (holo, ring, banner) and the DF STATUS dressing on the north wall segment.
  const SEGMENT = literal('engine/decor/atrium.js', 'SEGMENT') ?? { x0: 9, x1: 11 };
  const NORTH_Z = +(grab('engine/decor/atrium.js', /const NORTH_WALL_Z = ([\d.]+)/, 'NORTH_WALL_Z')?.[1] ?? 9);
  const BANNER = literal('engine/decor/atrium.js', 'BANNER') ?? { y: 1.255, w: 1.9, h: 0.402 };
  add(box('atrium:df-dressing', 'solid', SEGMENT.x0, SEGMENT.x1, NORTH_Z, NORTH_Z + 0.03, 0, ceilAt(10, 10) - floorAt(10, 10)));
  add(around('atrium:hub', 'solid', HUB.x, HUB.z, HUB.r + 0.06, HUB.r + 0.06, 0, 1.0));
  add(box('atrium:banner', 'solid', HUB.x - BANNER.w / 2, HUB.x + BANNER.w / 2, HUB.z + 0.005, HUB.z + 0.025, BANNER.y - BANNER.h / 2, BANNER.y + BANNER.h / 2));

  // The hidden PROD panel on the east face of the DF console (and its alarm halo), the PROD key hook and its zone.
  const plate = grab('engine/SecretDevice.js', /const PLATE_W = ([\d.]+), PLATE_H = ([\d.]+)/, 'PLATE_W, PLATE_H');
  const [plateW, plateH] = plate ? [+plate[1], +plate[2]] : [0.34, 0.43];
  add(box('prod-panel', 'solid', PROD_PANEL.x, PROD_PANEL.x + 0.03, PROD_PANEL.z - plateW / 2, PROD_PANEL.z + plateW / 2,
    PROD_PANEL.y - plateH / 2 - floorAt(PROD_PANEL.x + 0.5, PROD_PANEL.z), PROD_PANEL.y + plateH / 2 - floorAt(PROD_PANEL.x + 0.5, PROD_PANEL.z)));
  add(box('prod-panel:alarm', 'soft', PROD_PANEL.x, PROD_PANEL.x + 0.1, PROD_PANEL.z - 0.425, PROD_PANEL.z + 0.425,
    PROD_PANEL.y - 0.385 - floorAt(PROD_PANEL.x + 0.5, PROD_PANEL.z), PROD_PANEL.y + 0.465 - floorAt(PROD_PANEL.x + 0.5, PROD_PANEL.z)));
  const hookLy = PROD_KEY.y - floorAt(PROD_KEY.x, PROD_KEY.z + 0.5);
  add(box('prod-key:hook', 'solid', PROD_KEY.x - 0.1, PROD_KEY.x + 0.1, PROD_KEY.z - 0.04, PROD_KEY.z + 0.05, hookLy - 0.14, hookLy + 0.14));
  add(box('prod-key:zone', 'solid', KEY_ZONE.minX, KEY_ZONE.maxX, KEY_ZONE.minZ, KEY_ZONE.maxZ, 0, 1.55));

  // Quartiers (decor/quartiers.js + props/lounge.js): blueprint, banner, neon sign, lamp wash, barbecue wash.
  const POSTER = literal('engine/decor/quartiers.js', 'POSTER') ?? { x: 10.2, z: 2, w: 0.72, h: 0.64, y: 0.72 };
  const BANN = literal('engine/decor/quartiers.js', 'BANNER') ?? { x: 9.05, z: 7, w: 0.42, h: 0.72, y: 0.95 };
  add(box('quartiers:blueprint', 'solid', POSTER.x - POSTER.w / 2, POSTER.x + POSTER.w / 2, POSTER.z, POSTER.z + 0.03, POSTER.y - POSTER.h / 2, POSTER.y + POSTER.h / 2));
  add(box('quartiers:banner', 'solid', BANN.x - BANN.w / 2, BANN.x + BANN.w / 2, BANN.z - 0.03, BANN.z, BANN.y - BANN.h / 2, BANN.y + BANN.h / 2));
  const contact = SCREENS.find(s => s.id === 'contact');
  const signY = +(grab('engine/props/lounge.js', /y: floorY\(contact\.x, 2\.0\) \+ ([\d.]+)/, 'neon sign height')?.[1] ?? 1.12);
  const pixel = +(grab('engine/props/sign.js', /pixel = ([\d.]+)/, 'sign pixel')?.[1] ?? 0.0145);
  const signW = signWidth('ENVIE D\'ÉCHANGER ?') * pixel, signH = SIGN_ROWS * pixel;
  add(box('quartiers:neon', 'solid', contact.x - signW / 2, contact.x + signW / 2, 2.0, 2.03, signY - signH / 2, signY + signH / 2));
  add(box('quartiers:neon-halo', 'soft', contact.x - (signW + 0.7) / 2, contact.x + (signW + 0.7) / 2, 2.0, 2.02, signY - (signH + 0.45) / 2, signY + (signH + 0.45) / 2));
  const L = LOUNGE;
  const lampY = 0.78 + 0.02 + 0.17 / 2;                  // lamp.js: pole 0.78 m, shade 0.17 m, wash centred on the shade
  add(box('quartiers:lamp-wash', 'soft', L.lamp.x - 0.6, L.lamp.x + 0.6, 2.0, 2.02, lampY - 0.6, lampY + 0.6));
  add(box('quartiers:bbq-wash-n', 'soft', L.bbq.x - 0.1 - 0.75, L.bbq.x - 0.1 + 0.75, 2.0, 2.02, 0.5 - 0.55, 0.5 + 0.55));
  add(box('quartiers:bbq-wash-e', 'soft', 16.98, 17.0, L.bbq.z + 0.1 - 0.75, L.bbq.z + 0.1 + 0.75, 0.5 - 0.55, 0.5 + 0.55));
  // Lounge solids with the height of what stands there (a barbecue with its lid up, a guitar on its stand, an amp…).
  const heights = { bbq: 0.8, guitar: 0.95, amp: 0.55, lamp: 1.0, plant: 0.75, sofa: 0.5, table: 0.32 };
  for (const [k, b] of Object.entries(LOUNGE_SOLIDS)) {
    if (k === 'plant') continue;                         // the plant is a 0.5 m billboard: below
    const pad = k === 'lamp' ? 0.025 : 0;                // the shade is a little wider than the foot
    add(box(`lounge:${k}`, 'solid', b.minX - pad, b.maxX + pad, b.minZ - pad, b.maxZ + pad, 0, heights[k]));
  }
  add(around('lounge:plant', 'solid', L.plant.x, L.plant.z, 0.25, 0.25, 0, 0.75, { sprite: true }));
  // The sleeping cat on its crate (a 0.38 × 0.27 billboard), the PROD room's eyes (0.13 × 0.052, scale 1.5).
  const sleeping = createCat('sleeping');
  add(around('cat:quartiers', 'solid', L.crate.x, L.crate.z, sleeping.width / 2, sleeping.width / 2, L.crate.top, L.crate.top + sleeping.height, { sprite: true }));
  const cp = grab('features/cats.js', /id: 'cat-prod', kind: 'eyes', x: ([\d.]+), z: ([\d.]+), base: surface\([\d.]+, [\d.]+, ([\d.]+)\), scale: ([\d.]+)/, 'cat-prod');
  if (cp) {
    const eyes = createCat('eyes'), s = +cp[4];
    add(around('cat:prod', 'solid', +cp[1], +cp[2], eyes.width * s / 2, eyes.width * s / 2, +cp[3] - 0.05, +cp[3] + eyes.height * s + 0.05, { sprite: true }));
  }

  // PROD room dressing (decor/secret.js): poster and sign on the south wall, racks and cables on the side walls.
  const P_POSTER = literal('engine/decor/secret.js', 'POSTER') ?? { x: 10.8, y: 0.32, z: 22.945, w: 2, h: 0.9 };
  const P_SIGN = literal('engine/decor/secret.js', 'SIGN') ?? { x: 14.55, y: 0.36, z: 22.945, w: 1.1, h: 0.4 };
  const P_RACKS = literal('engine/decor/secret.js', 'RACKS') ?? [];
  const P_RACK = literal('engine/decor/secret.js', 'RACK') ?? { depth: 0.12, w: 1, h: 0.84, base: -0.22 };
  const pf = floorAt(12.5, 20.5);
  for (const [id, q] of [['poster', P_POSTER], ['sign', P_SIGN]]) {
    add(box(`prod:${id}`, 'solid', q.x - q.w / 2, q.x + q.w / 2, q.z - 0.01, q.z + 0.06, q.y - q.h / 2 - pf, q.y + q.h / 2 - pf));
    add(box(`prod:${id}-wash`, 'soft', q.x - q.w / 2 - 0.4, q.x + q.w / 2 + 0.4, q.z - 0.03, q.z + 0.06, q.y - q.h / 2 - 0.3 - pf, q.y + q.h / 2 + 0.3 - pf));
  }
  P_RACKS.forEach((r, i) => {
    const fx = r.facing[0];
    add(box(`prod:rack${i}`, 'solid', fx > 0 ? r.x - P_RACK.depth / 2 : r.x - P_RACK.depth / 2, r.x + P_RACK.depth / 2, r.z - P_RACK.w / 2, r.z + P_RACK.w / 2,
      P_RACK.base - pf, P_RACK.base + P_RACK.h - pf));
  });
  // The three darkened walls: a 94 % black overlay hangs 2 cm in front of them (decor/secret.js darkWall).
  add(box('prod:dark-south', 'soft', 9, 16, 22.97, 23, 0, 1.15, { forbidden: true }));
  add(box('prod:dark-west', 'soft', 9, 9.03, 18, 23, 0, 1.15, { forbidden: true }));
  add(box('prod:dark-east', 'soft', 15.97, 16, 18, 23, 0, 1.15, { forbidden: true }));
  add(box('prod:cables-w', 'solid', 9.0, 9.1, 18.5, 21.3, 0.75, 1.0));         // cable drapes: 0.52–0.74 m world, i.e. +0.25 above the floor
  add(box('prod:cables-e', 'solid', 15.9, 16.0, 18.6, 21.5, 0.75, 1.0));

  // Notes (data/notes.js): each is a small card on a surface; kept 0.25 m clear, reading cone included (see rules).
  for (const [slot, n] of Object.entries(PLACEMENTS)) {
    const sz = sizeOf(['plinth-phenix', 'plinth-tbe', 'plinth-parfumerie', 'wall-fps', 'atrium-pillar'].includes(slot) ? 'plaque'
      : /console|df-|rack-|spawn/.test(slot) ? (slot === 'spawn-crate' ? 'sticker' : 'postit') : 'tag');
    const k = n.scale ?? 1, hw = sz.w * k / 2, hh = sz.h * k / 2;
    add(box(`note:${slot}`, 'note', n.x - hw - (n.facing[0] ? 0.01 : 0), n.x + hw + (n.facing[0] ? 0.01 : 0), n.z - hw - (n.facing[1] ? 0.01 : 0), n.z + hw + (n.facing[1] ? 0.01 : 0),
      n.ly - hh, n.ly + hh));
  }
  return el;
}

// The lit ceiling panels of Renderer._buildFloorCeiling (cells whose column and row are ≡ 1 mod 3) and the hub's glow.
export function buildCeilingModel() {
  grab('engine/Renderer.js', /mx % 3 === 1 && my % 3 === 1/, 'lit ceiling cells rule');
  const out = [];
  for (let my = 0; my < MAP.length; my++) for (let mx = 0; mx < MAP[0].length; mx++) {
    if (MAP[my][mx] === 1 && !isPush(mx, my)) continue;
    if (mx % 3 === 1 && my % 3 === 1) out.push({ id: `lit-panel(${mx},${my})`, tier: 'solid', x0: mx, x1: mx + 1, z0: my, z1: my + 1 });
  }
  const g = grab('engine/decor/atrium.js', /softPool\(scene, HCOL, HUB\.x, HUB\.z, ([\d.]+), \{ y: ceilAt\(HUB\.x, HUB\.z\) - 0\.015/, 'hub ceiling glow');
  const r = g ? +g[1] / 2 : 1.1;
  out.push({ id: 'hub-ceiling-glow', tier: 'soft', x0: HUB.x - r, x1: HUB.x + r, z0: HUB.z - r, z1: HUB.z + r });
  return out;
}

// ── Walls ─────────────────────────────────────────────────────────────────────────────────────────────
// A window's wall frame: n = axis of the wall's normal ('x' | 'z'), plane = the wall's coordinate, side = sign of the
// normal pointing into the room, s = coordinate of the window's centre along the wall.
export function frameOfWindow(w) {
  const [fx, fz] = w.facing;
  return fx !== 0
    ? { n: 'x', plane: w.x, side: fx, s: w.z, along: 'z' }
    : { n: 'z', plane: w.z, side: fz, s: w.x, along: 'x' };
}

// Projection of a box on a wall frame: along-interval, vertical interval, and the distance interval in front of the wall.
export function project(b, f) {
  const [a0, a1] = f.along === 'z' ? [b.z0, b.z1] : [b.x0, b.x1];
  const [n0, n1] = f.n === 'x' ? [b.x0, b.x1] : [b.z0, b.z1];
  const d0 = f.side > 0 ? n0 - f.plane : f.plane - n1, d1 = f.side > 0 ? n1 - f.plane : f.plane - n0;
  return { a0, a1, y0: b.y0, y1: b.y1, d0, d1 };
}

// Runs of solid wall facing into a room: [{ room, n, plane, side, lo, hi }], lo/hi along the wall.
export function wallRuns() {
  const faces = [];
  for (let my = 0; my < MAP.length; my++) for (let mx = 0; mx < MAP[0].length; mx++) {
    const room = TYPE_ROOM[MAP[my][mx]];
    if (!room) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!solidWall(mx + dx, my + dz)) continue;
      faces.push(dx !== 0
        ? { room, n: 'x', plane: dx > 0 ? mx + 1 : mx, side: -dx, lo: my, hi: my + 1 }
        : { room, n: 'z', plane: dz > 0 ? my + 1 : my, side: -dz, lo: mx, hi: mx + 1 });
    }
  }
  const runs = [];
  faces.sort((a, b) => (a.room + a.n + a.plane + a.side).localeCompare(b.room + b.n + b.plane + b.side) || a.lo - b.lo);
  for (const f of faces) {
    const last = runs[runs.length - 1];
    if (last && last.room === f.room && last.n === f.n && last.plane === f.plane && last.side === f.side && Math.abs(last.hi - f.lo) < 1e-9) last.hi = f.hi;
    else runs.push({ ...f });
  }
  return runs;
}

// The run of wall a window sits on, or null.
export function runOf(w, runs = wallRuns()) {
  const f = frameOfWindow(w);
  return runs.find(r => r.room === w.room && r.n === f.n && Math.abs(r.plane - f.plane) < 1e-6 && r.side === f.side
    && f.s >= r.lo - 1e-9 && f.s <= r.hi + 1e-9) ?? null;
}

// How far from a thing a window's opening must stay: notes 0.25 m, things hung on the wall 0.2 m, free-standing 0.12 m.
const marginOf = (b, p, rules) => b.tier === 'note' ? rules.note : b.tier === 'soft' ? 0 : p.d0 <= 0.2 ? rules.wallItem : rules.object;

// ── Conflicts of one wall window with the model ─────────────────────────────────────────────────────────
export function wallConflicts(w, model, rules = RULES) {
  const f = frameOfWindow(w);
  const a0 = f.s - w.w / 2, a1 = f.s + w.w / 2, y0 = w.sill, y1 = w.sill + w.h;
  const hard = [], soft = [];
  for (const b of model) {
    const p = project(b, f);
    if (p.d1 < -0.05 || p.d0 > rules.hideDist) continue;                 // behind the wall, or too far to stand in front of it
    const m = marginOf(b, p, rules);
    const mv = b.tier === 'soft' ? 0 : rules.vertical;
    if (p.a1 + m <= a0 || p.a0 - m >= a1) continue;
    if (p.y1 + mv <= y0 || p.y0 - mv >= y1) continue;
    (b.tier === 'soft' ? soft : hard).push(b);
  }
  return { hard, soft };
}

// ── Free spans (the designer's worksheet) ────────────────────────────────────────────────────────────────
export function freeSpans(run, sill, head, model, rules = RULES) {
  const f = { n: run.n, plane: run.plane, side: run.side, along: run.n === 'x' ? 'z' : 'x' };
  const blocked = [];
  for (const b of model) {
    const p = project(b, f);
    if (p.d1 < -0.05 || p.d0 > rules.hideDist) continue;
    if (b.tier === 'soft' && !b.forbidden) continue;
    const m = marginOf(b, p, rules);
    if (p.y1 + rules.vertical <= sill || p.y0 - rules.vertical >= head) continue;
    blocked.push([p.a0 - m, p.a1 + m, b.id]);
  }
  const lo = run.lo + rules.doorCorner, hi = run.hi - rules.doorCorner;
  blocked.sort((a, b) => a[0] - b[0]);
  const free = [];
  let at = lo;
  for (const [b0, b1] of blocked) {
    if (b0 > at) free.push([at, Math.min(b0, hi)]);
    at = Math.max(at, b1);
  }
  if (at < hi) free.push([at, hi]);
  return free.filter(([a, b]) => b - a > 1e-6);
}

export const heightOf = (room, x, z) => ceilAt(x, z) - floorAt(x, z);


// ══ The proofs ════════════════════════════════════════════════════════════════════════════════════════════
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const wrap360 = a => ((a % 360) + 360) % 360;
const angDiff = (a, b) => ((a - b + 540) % 360) - 180;                  // a − b, in (−180, 180]
const bearing = (x0, z0, x1, z1) => wrap360(Math.atan2(z1 - z0, x1 - x0) * R2D);   // heading: 0 east, 90 south
const fmt = (v, n = 2) => (Math.round(v * 10 ** n) / 10 ** n).toFixed(n);
const EPS = 1e-6;

// The local floor and ceiling in front of a wall window.
function localHeights(w) {
  const [fx, fz] = w.facing ?? [0, 0];
  const x = w.x + fx * 0.25, z = w.z + fz * 0.25;
  const floor = floorAt(x, z);
  return { floor, ceil: ceilAt(x, z) - floor };
}

// Which end of a run is a door and which a corner: the room still lies in front of the wall past a door.
function endKind(run, end) {
  const a = end === 'lo' ? run.lo - 0.5 : run.hi + 0.5;
  const [x, z] = run.n === 'x' ? [run.plane + run.side * 0.5, a] : [a, run.plane + run.side * 0.5];
  return roomAt(x, z) === run.room ? 'door' : 'corner';
}

// Cone of a note's reading aim (features/notes.js AIM.cos), as the stretch of a wall plane it covers.
const AIM_COS = 0.93;
function coneOnWall(note, f) {
  if (!note.stand) return null;
  const [sx, sz, hd] = note.stand;
  const half = Math.acos(AIM_COS) * R2D;
  const step = 0.01;
  // Walk along the wall line and keep the points seen within the cone from the standing spot.
  const reach = [];
  for (let a = (f.along === 'z' ? 8 : 0); a < 26; a += step) {
    const x = f.along === 'x' ? a : f.plane, z = f.along === 'z' ? a : f.plane;
    if (Math.abs(angDiff(bearing(sx, sz, x, z), hd)) <= half) reach.push(a);
  }
  return reach.length ? [Math.min(...reach), Math.max(...reach)] : null;
}

// Walkable spots of a room, from the game's own collision (Player.js) with the lounge solids registered like features do.
let solidsRegistered = false;
function spotsOf(room, step = 0.25) {
  if (!solidsRegistered) { for (const b of Object.values(LOUNGE_SOLIDS)) addSolidBox(b); solidsRegistered = true; }
  const spots = [];
  for (let z = 0; z < MAP.length; z += step) for (let x = 0; x < MAP[0].length; x += step) {
    if (roomAt(x, z) === room && isFree(x, z)) spots.push({ x, z });
  }
  return spots;
}

// ── One window against every rule ─────────────────────────────────────────────────────────────────────────
export function evaluate(w, ctx) {
  const checks = [], facts = {}, warns = [];
  const check = (rule, ok, detail = '') => checks.push({ rule, ok, detail });

  // struct
  const num = v => typeof v === 'number' && Number.isFinite(v);
  const base = typeof w.id === 'string' && w.id && ROOM_TYPE[w.room] !== undefined && (w.kind === 'wall' || w.kind === 'skylight')
    && num(w.x) && num(w.z) && num(w.w) && w.w > 0 && num(w.skyYaw) && w.skyYaw >= -180 && w.skyYaw <= 180;
  let shape = false;
  if (w.kind === 'wall') {
    shape = Array.isArray(w.facing) && w.facing.length === 2 && Math.abs(Math.abs(w.facing[0]) + Math.abs(w.facing[1]) - 1) < EPS
      && (w.facing[0] === 0 || w.facing[1] === 0) && num(w.h) && w.h > 0 && num(w.sill);
  } else if (w.kind === 'skylight') shape = num(w.d) && w.d > 0;
  check('struct', base && shape, base && shape ? '' : 'fields: id room kind x z w skyYaw(−180..180) + (facing h sill | d)');
  if (!(base && shape)) return { checks, facts, warns };

  if (w.kind === 'skylight') return evaluateSkylight(w, ctx, checks, facts, warns);

  const f = frameOfWindow(w);
  const a0 = f.s - w.w / 2, a1 = f.s + w.w / 2;

  // wall-face: the window lies on one run of solid wall of ITS room, facing into it
  const run = runOf(w, ctx.runs);
  const inRun = !!run && a0 >= run.lo - EPS && a1 <= run.hi + EPS;
  check('wall-face', inRun, run
    ? inRun ? `${w.room} ${f.n}=${run.plane}, run ${fmt(run.lo)}–${fmt(run.hi)}, faces ${w.facing}` : `span ${fmt(a0)}–${fmt(a1)} leaves its run ${fmt(run.lo)}–${fmt(run.hi)}`
    : `no wall face of ${w.room} at ${f.n}=${f.plane} looking ${w.facing} (wrong plane, wrong side or not a wall)`);
  if (!run) return { checks, facts, warns };

  // margin: ≥ 0.3 m from every door opening and room corner
  const mLo = a0 - run.lo, mHi = run.hi - a1;
  const kLo = endKind(run, 'lo'), kHi = endKind(run, 'hi');
  check('margin', mLo >= RULES.doorCorner - EPS && mHi >= RULES.doorCorner - EPS,
    `${fmt(mLo)} to the ${kLo} / ${fmt(mHi)} to the ${kHi}`);
  facts.margins = [mLo, mHi];

  // height: sill ≥ 0.2 over the floor, head ≥ 0.12 under the ceiling
  const { floor, ceil } = localHeights(w);
  const head = w.sill + w.h;
  check('height', w.sill >= RULES.sillMin - EPS && head <= ceil - RULES.headGap + EPS,
    `sill ${fmt(w.sill)} head ${fmt(head)} / room ${fmt(ceil)} → ${fmt(ceil - head)} under the ceiling`);
  facts.head = head; facts.ceil = ceil; facts.floor = floor;

  // gap: ≥ 0.3 m to the next window of the same wall
  const same = ctx.windows.filter(o => o !== w && o.kind === 'wall' && o.room === w.room && frameOfWindow(o).n === f.n
    && Math.abs(frameOfWindow(o).plane - f.plane) < EPS && frameOfWindow(o).side === f.side);
  let gap = Infinity, near = null;
  for (const o of same) {
    const g = Math.abs(frameOfWindow(o).s - f.s) - (o.w + w.w) / 2;
    if (g < gap) { gap = g; near = o; }
  }
  check('gap', gap >= RULES.gap - EPS, near ? `${fmt(gap)} to ${near.id}` : 'alone on its wall');

  // overlap: nothing overlapped or hidden (hard), and the PROD overlays
  const { hard, soft } = wallConflicts(w, ctx.model);
  const forbidden = soft.filter(b => b.forbidden);
  const bad = [...hard, ...forbidden];
  check('overlap', bad.length === 0, bad.length ? `hits ${bad.map(b => b.id).join(', ')}` : 'clear of every wall, ceiling and floor element');
  for (const b of soft.filter(b => !b.forbidden)) warns.push(`stands in the soft wash ${b.id} (additive light, tints the glass a little)`);

  // nearest solid thing, for the record
  let nearest = { d: Infinity, id: null };
  for (const b of ctx.model) {
    if (b.tier === 'soft') continue;
    const p = project(b, f);
    if (p.d1 < -0.05 || p.d0 > RULES.hideDist || p.a1 <= run.lo || p.a0 >= run.hi) continue;
    if (p.y1 + RULES.vertical <= w.sill || p.y0 - RULES.vertical >= head) continue;
    const d = Math.max(p.a0 - a1, a0 - p.a1);
    if (d < nearest.d) nearest = { d, id: b.id };
  }
  facts.nearest = nearest;

  // cone: a note stuck on this very wall keeps its reading cone free
  let coneHit = null;
  for (const [slot, n] of Object.entries(PLACEMENTS)) {
    const [nn, na] = f.n === 'x' ? [n.x, n.z] : [n.z, n.x];
    if (Math.abs((nn - f.plane) * f.side) > 0.2 || (nn - f.plane) * f.side < -0.05) continue;
    const span = coneOnWall(n, f);
    if (span && span[1] + RULES.note > a0 && span[0] - RULES.note < a1 && Math.abs(na - f.s) < 3) coneHit = slot;
  }
  check('cone', !coneHit, coneHit ? `inside the reading cone of the note ${coneHit}` : 'no wall note aims here');

  // sky: the Earth lies in front of the glass, and a visitor can find the spot where it shows
  const earthAz = wrap360(EARTH.az - w.skyYaw);
  const normal = bearing(0, 0, -w.facing[0], -w.facing[1]);
  const off = angDiff(earthAz, normal);
  facts.earthAz = earthAz; facts.earthOff = off;
  check('sky', Math.abs(off) <= 75, `Earth at ${fmt(earthAz, 0)}°, ${fmt(off, 0)}° off the glass's outward axis (${fmt(normal, 0)}°)`);

  // view facts: horizon, distances
  const horizon = w.sill < RULES.gazeFrom && head > RULES.gazeFrom;
  facts.horizon = horizon;
  facts.fullFrom = Math.max(head - RULES.gazeFrom, RULES.gazeFrom - w.sill) / RULES.vtan;
  facts.earthCentreWithin = (head - RULES.gazeFrom) / Math.tan(EARTH.el * D2R);
  facts.earthCentreBeyond = w.sill > RULES.gazeFrom ? (w.sill - RULES.gazeFrom) / Math.tan(EARTH.el * D2R) : 0;
  const spots = ctx.spots(w.room);
  let seen = 0, dmin = Infinity, dmax = 0;
  const half = w.w / 2;
  const e0 = f.along === 'z' ? [w.x, w.z - half] : [w.x - half, w.z], e1 = f.along === 'z' ? [w.x, w.z + half] : [w.x + half, w.z];
  for (const P of spots) {
    if (((f.n === 'x' ? P.x : P.z) - f.plane) * f.side < 0.3) continue;
    const b0 = bearing(P.x, P.z, e0[0], e0[1]), b1 = bearing(P.x, P.z, e1[0], e1[1]);
    const span = angDiff(b1, b0), t = angDiff(earthAz, b0);
    if (!(span >= 0 ? t >= 0 && t <= span : t <= 0 && t >= span)) continue;
    const d = Math.hypot(w.x - P.x, w.z - P.z);
    if (Math.atan((w.sill - RULES.gazeFrom) / d) * R2D > EARTH.el || Math.atan((head - RULES.gazeFrom) / d) * R2D < EARTH.el) continue;
    seen++; dmin = Math.min(dmin, d); dmax = Math.max(dmax, d);
  }
  facts.earthSpots = seen; facts.earthRange = seen ? [dmin, dmax] : null;
  return { checks, facts, warns };
}

function evaluateSkylight(w, ctx, checks, facts, warns) {
  const check = (rule, ok, detail = '') => checks.push({ rule, ok, detail });
  const r = { x0: w.x - w.w / 2, x1: w.x + w.w / 2, z0: w.z - w.d / 2, z1: w.z + w.d / 2 };
  // inside the atrium (every sample under the opening is an atrium cell), 0.3 m off its walls
  let inside = true;
  for (let x = r.x0; x <= r.x1 + EPS && inside; x += 0.05) for (let z = r.z0; z <= r.z1 + EPS; z += 0.05) {
    if (getCellType(x, z) !== ROOM_TYPE.atrium) { inside = false; break; }
  }
  let wallGap = Infinity;
  for (const [a, b] of [[r.x0 - 9, 0], [16 - r.x1, 0], [r.z0 - 9, 0], [16 - r.z1, 0]]) wallGap = Math.min(wallGap, a + b);
  check('wall-face', inside && w.room === 'atrium', inside ? `${fmt(r.x1 - r.x0)} × ${fmt(r.z1 - r.z0)} wholly over atrium cells` : 'leaves the atrium');
  check('margin', wallGap >= RULES.doorCorner - EPS, `${fmt(wallGap)} to the nearest atrium wall`);
  const c = ceilAt(w.x, w.z);
  check('height', Math.abs(ceilAt(r.x0, r.z0) - c) < EPS && Math.abs(ceilAt(r.x1, r.z1) - c) < EPS, `pane at ceilAt = ${fmt(c)}`);
  // clear of the lit ceiling panels
  let clear = Infinity, nearId = null;
  const soft = [];
  for (const p of ctx.ceiling) {
    const g = Math.max(p.x0 - r.x1, r.x0 - p.x1, p.z0 - r.z1, r.z0 - p.z1);
    if (p.tier === 'soft') { if (g < 0) soft.push(p); continue; }
    if (g < clear) { clear = g; nearId = p.id; }
  }
  check('overlap', clear >= RULES.ceilingObject - EPS, `${fmt(clear)} to ${nearId}`);
  for (const p of soft) warns.push(`covers the ${p.id}: the pane must be drawn ≥ 2 cm below the ceiling so the glow does not tint the sky`);
  check('cone', true, 'no note');
  // How much of the hall sees it: with a level camera (eye 0.5, 16:9) and with the freelook of Player.js (MAX_PITCH, a shear).
  const mp = grab('engine/Player.js', /const MAX_PITCH\s*=\s*\((\d+) \* Math\.PI\) \/ 180/, 'MAX_PITCH (freelook limit)');
  const pitch = mp ? +mp[1] * D2R : 0;
  const spots = ctx.spots('atrium');
  const needLevel = (c - RULES.gazeFrom) / RULES.vtan;
  // Freelook is a shear of the projection (Renderer.render): the top edge of the view is at tan(el) = vtan + tan(pitch).
  const needLook = (c - RULES.gazeFrom) / (RULES.vtan + Math.tan(pitch));
  const share = need => {
    let some = 0, centre = 0;
    for (const P of spots) {
      const corners = [[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1]];
      if (Math.max(...corners.map(([x, z]) => Math.hypot(x - P.x, z - P.z))) >= need) some++;
      if (Math.hypot(w.x - P.x, w.z - P.z) >= need) centre++;
    }
    return { need, some: some / spots.length, centre: centre / spots.length };
  };
  // What it can frame: from a spot of the hall the lowest ray through the pane goes to its farthest corner. Anything painted below
  // that elevation (the Earth, the Sun, the hills) can never show through the skylight: it frames the zenith sky only.
  let lowest = 90;
  for (const P of spots) {
    const far = Math.max(...[[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1]].map(([x, z]) => Math.hypot(x - P.x, z - P.z)));
    lowest = Math.min(lowest, Math.atan((c - RULES.gazeFrom) / far) * R2D);
  }
  const earthTop = EARTH.el + EARTH.radius;
  check('sky', lowest > 0, `frames the sky from ${fmt(lowest, 1)}° up: ${lowest > earthTop ? 'above' : 'only a corner reaches'} the Earth's top edge (${fmt(earthTop, 1)}°), so it shows the zenith (stars, Milky Way), not the Earth`);
  facts.skylight = { level: share(needLevel), look: share(needLook), pitchDeg: pitch * R2D, lowest };
  return { checks, facts, warns };
}

// ── Everything together ─────────────────────────────────────────────────────────────────────────────────
// The evaluation context: the level model, the wall runs, the walkable spots (cached per room).
export function makeContext(windows) {
  const cache = new Map();
  return { model: buildModel(), ceiling: buildCeilingModel(), runs: wallRuns(), windows,
    spots: room => (cache.has(room) ? cache.get(room) : cache.set(room, spotsOf(room)).get(room)) };
}

function proofs() {
  let failed = 0;
  const line = (ok, label, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`); return ok; };
  const note = (kind, label, detail = '') => console.log(`${kind.padEnd(4)}  ${label}${detail ? '  ' + detail : ''}`);

  const windows = [...WINDOWS];
  const ctx = makeContext(windows);
  const { model, ceiling, runs } = ctx;

  console.log('── Mirror guards (constants read from the decor sources) ──');
  for (const g of guards) line(g.ok, g.label, g.detail);

  console.log(`\n── Windows (${windows.length}) ──`);
  const ids = new Set(windows.map(w => w.id));
  line(ids.size === windows.length, 'ids are unique');
  const results = windows.map(w => ({ w, ...evaluate(w, ctx) }));
  for (const r of results) {
    const bad = r.checks.filter(c => !c.ok);
    line(bad.length === 0, r.w.id, bad.length ? bad.map(c => `[${c.rule}: ${c.detail}]`).join(' ') : r.checks.map(c => c.rule).join(' ✓ ') + ' ✓');
  }

  console.log('\n── Rules (over every window) ──');
  const RULE_TEXT = {
    struct: 'well-formed (ids, rooms, facing, sizes, skyYaw)',
    'wall-face': 'on a real wall face of its own room, facing INTO the room (the skylight: wholly over the atrium)',
    margin: '≥ 0.3 m from every door opening and room corner (the push-wall is a door)',
    height: 'sill ≥ 0.2 m above the floor, head ≥ 0.12 m under the ceiling',
    gap: '≥ 0.3 m between neighbours on a wall',
    overlap: 'overlaps or hides nothing (consoles, doors and signage, frames, plinths, racks, props, sprites, notes, PROD hook, dashboard, lounge, PROD dressing, lit panels, hub) and no darkened wall',
    cone: 'keeps the reading cones of the wall notes free',
    sky: 'the Earth lies in front of the glass',
  };
  for (const [rule, text] of Object.entries(RULE_TEXT)) {
    const failing = results.filter(r => r.checks.some(c => c.rule === rule && !c.ok)).map(r => r.w.id);
    line(failing.length === 0, `${rule}: ${text}`, failing.length ? `← ${failing.join(', ')}` : '');
  }
  // sky consistency: one skyYaw per wall
  const walls = new Map();
  for (const w of windows.filter(w => w.kind === 'wall')) {
    const f = frameOfWindow(w), key = `${w.room}/${f.n}=${f.plane}`;
    (walls.get(key) ?? walls.set(key, []).get(key)).push(w);
  }
  const split = [...walls].filter(([, ws]) => new Set(ws.map(w => w.skyYaw)).size > 1).map(([k]) => k);
  line(split.length === 0, 'sky: windows of one wall share their skyYaw', split.length ? `← ${split.join(', ')}` : '');
  const ev = Object.keys(EARTH_VIEW);
  line(ev.length > 0 && ev.every(k => Number.isFinite(EARTH_VIEW[k])), 'sky: EARTH_VIEW lists the view azimuth of the Earth of every wall');

  // per room: 2–4 windows (the atrium counts its skylight), PROD ≤ 1, every room has a window that shows the Earth
  const rooms = Object.keys(ROOM_TYPE);
  for (const room of rooms) {
    const here = results.filter(r => r.w.room === room);
    const n = here.length;
    if (room === 'prod') line(n === 1, `count: ${room} has exactly one window (a secret: flagged below)`, `${n}`);
    else line(n >= 2 && n <= 4, `count: ${room} has 2–4 windows`, `${n}${room === 'atrium' ? ' (incl. the skylight)' : ''}`);
    const shows = here.filter(r => r.facts.earthSpots > 0);
    line(shows.length > 0, `earth: a visitor of the ${room} can see the Earth through a window`,
      shows.map(r => `${r.w.id} from ${r.facts.earthSpots} spots at ${fmt(r.facts.earthRange[0], 1)}–${fmt(r.facts.earthRange[1], 1)} m`).join('; ') || '← none');
  }
  line(windows.filter(w => w.kind === 'skylight').length === 1, 'atrium has exactly one skylight');
  const sizes = new Set(windows.filter(w => w.room !== 'prod' && w.kind === 'wall').map(w => `${w.w}x${w.h}`));
  line(sizes.size >= windows.filter(w => w.room !== 'prod' && w.kind === 'wall').length - 1, 'rhythm: sizes vary (no two windows alike but at most one pair)', `${sizes.size} sizes`);
  const anyYawMissing = windows.some(w => w.skyYaw === undefined);
  line(!anyYawMissing, 'every window has a skyYaw');

  console.log('\n── Soft findings (WARN never fails the check) ──');
  let warned = 0;
  for (const r of results) for (const m of r.warns) { warned++; note('WARN', r.w.id, m); }
  if (!warned) note('INFO', 'no soft overlaps');

  console.log('\n── What a visitor sees (INFO) ──');
  for (const r of results) {
    const w = r.w, f = r.facts;
    if (w.kind === 'skylight') {
      const { level, look, pitchDeg, lowest } = f.skylight;
      note('INFO', w.id, `skylight ${w.w}×${w.d} at (${w.x}, ${w.z}): a ceiling point is on screen from ≥ ${fmt(level.need)} m with a level camera `
        + `(some of the pane from ${fmt(level.some * 100, 0)} % of the hall's floor, its centre from ${fmt(level.centre * 100, 0)} %), `
        + `from ≥ ${fmt(look.need)} m with the ${fmt(pitchDeg, 0)}° freelook (${fmt(look.some * 100, 0)} % / ${fmt(look.centre * 100, 0)} %): it is seen by looking up; `
        + `it frames the sky from ${fmt(lowest, 1)}° up, the Earth tops out at ${fmt(EARTH.el + EARTH.radius, 1)}°: zenith stars only`);
      continue;
    }
    note('INFO', w.id, `${w.w}×${w.h} sill ${w.sill} head ${fmt(f.head)} (${fmt(f.ceil - f.head)} under the ceiling); ${f.horizon ? 'horizon and ground in the glass' : 'sky only'}; `
      + `whole height on screen from ${fmt(f.fullFrom, 1)} m; Earth centre in the glass up to ${fmt(f.earthCentreWithin, 1)} m away`
      + `${f.earthSpots ? `, from ${f.earthSpots} walkable spots (${fmt(f.earthRange[0], 1)}–${fmt(f.earthRange[1], 1)} m)` : ', from no walkable spot'}; `
      + `nearest solid ${f.nearest.id ? `${f.nearest.id} at ${fmt(f.nearest.d)} m` : 'none'}`);
  }
  // First view: the spawn looks north.
  const spawn = new Player();
  const seenAtSpawn = results.filter(r => r.w.kind === 'wall' && r.w.room === 'atrium').filter(r => {
    const d = angDiff(bearing(spawn.x, spawn.y, r.w.x, r.w.z), spawn.angle * R2D);
    return Math.abs(d) <= 30;
  }).map(r => r.w.id);
  note('INFO', 'first view', `at the spawn (${spawn.x}, ${spawn.y}) looking north the frame holds: ${seenAtSpawn.join(', ') || 'no window'}`);
  const prod = results.find(r => r.w.room === 'prod');
  if (prod) note('FLAG', prod.w.id, 'the PROD room is a secret: this porthole is its only window (entrance wall, the one wall the black overlays do not cover)');

  console.log(`\n${failed ? 'FAIL' : 'PASS'}  ${windows.length} windows, ${failed} failing rule${failed === 1 ? '' : 's'}, ${warned} soft finding${warned === 1 ? '' : 's'}`);
  return { failed, results, model, ceiling, runs, windows };
}

// ══ Pictures (--png DIR) ══════════════════════════════════════════════════════════════════════════════════
const FONT = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001',
  '5': '111100111001111', '6': '111100111101111', '7': '111001001010010', '8': '111101111101111', '9': '111101111001111',
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100',
  G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100', Q: '010101101111011', R: '110101110101101',
  S: '011100010001110', T: '111010010010010', U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111', '-': '000000111000000', '.': '000000000000010', ':': '000010000010000', '(': '001010010010001',
  ')': '100010010010100', '/': '001001010100100', '+': '000010111010000', '=': '000111000111000', ' ': '000000000000000',
};

class Img {
  constructor(w, h, bg = [16, 18, 24]) {
    this.w = w; this.h = h; this.rgb = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) this.rgb.set(bg, i * 3);
  }
  px(x, y, c, a = 1) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    for (let k = 0; k < 3; k++) this.rgb[i + k] = a >= 1 ? c[k] : Math.round(this.rgb[i + k] * (1 - a) + c[k] * a);
  }
  rect(x0, y0, x1, y1, c, a = 1) {
    for (let y = Math.floor(Math.min(y0, y1)); y < Math.ceil(Math.max(y0, y1)); y++)
      for (let x = Math.floor(Math.min(x0, x1)); x < Math.ceil(Math.max(x0, x1)); x++) this.px(x, y, c, a);
  }
  frame(x0, y0, x1, y1, c, t = 1) {
    this.rect(x0, y0, x1, y0 + t, c); this.rect(x0, y1 - t, x1, y1, c); this.rect(x0, y0, x0 + t, y1, c); this.rect(x1 - t, y0, x1, y1, c);
  }
  line(x0, y0, x1, y1, c) {
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) || 1;
    for (let i = 0; i <= n; i++) this.px(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, c);
  }
  text(str, x, y, c, s = 2) {
    let cx = x;
    for (const ch of String(str).toUpperCase()) {
      const g = FONT[ch] ?? FONT[' '];
      for (let i = 0; i < 15; i++) if (g[i] === '1') this.rect(cx + (i % 3) * s, y + Math.floor(i / 3) * s, cx + (i % 3 + 1) * s, y + (Math.floor(i / 3) + 1) * s, c);
      cx += 4 * s;
    }
    return cx;
  }
  save(file) {
    const raw = Buffer.alloc((this.w * 3 + 1) * this.h);
    for (let y = 0; y < this.h; y++) this.rgb.copy(raw, y * (this.w * 3 + 1) + 1, y * this.w * 3, (y + 1) * this.w * 3);
    const chunk = (type, body) => {
      const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
      const t = Buffer.from(type), crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, body])) >>> 0);
      return Buffer.concat([len, t, body, crc]);
    };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(this.w, 0); ihdr.writeUInt32BE(this.h, 4); ihdr[8] = 8; ihdr[9] = 2;
    fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  }
}

const ROOM_TINT = { 0: [52, 54, 62], 2: [24, 62, 38], 3: [74, 50, 20], 4: [62, 30, 72], 5: [72, 20, 52], 6: [30, 52, 84] };

// Plan of the level: floors by room, solids, notes, windows on their walls, the skylight.
function drawMap(file, { model, ceiling, windows, results }) {
  const S = 42, M = 24, W = MAP[0].length * S + 2 * M, H = MAP.length * S + 2 * M;
  const img = new Img(W, H);
  const X = x => M + x * S, Y = z => M + z * S;
  for (let my = 0; my < MAP.length; my++) for (let mx = 0; mx < MAP[0].length; mx++) {
    const t = MAP[my][mx];
    img.rect(X(mx), Y(my), X(mx + 1), Y(my + 1), t === 1 ? [34, 36, 42] : ROOM_TINT[t] ?? [60, 60, 60]);
    if (t !== 1) img.frame(X(mx), Y(my), X(mx + 1), Y(my + 1), [0, 0, 0], 1);
  }
  for (const p of ceiling) if (p.tier === 'solid') img.frame(X(p.x0) + 3, Y(p.z0) + 3, X(p.x1) - 3, Y(p.z1) - 3, [110, 110, 90], 1);
  for (const b of model) {
    const c = b.tier === 'note' ? [250, 230, 80] : b.sprite ? [240, 150, 60] : b.id.startsWith('console') ? [80, 160, 255]
      : b.id.startsWith('gallery:ring') ? [150, 90, 40] : b.id.startsWith('prop') || b.id.startsWith('lounge') || b.id.startsWith('gallery') || b.id.startsWith('armory') ? [190, 120, 80] : null;
    if (!c || b.tier === 'soft') continue;
    if (b.id.startsWith('gallery:ring')) { img.frame(X(b.x0), Y(b.z0), X(b.x1), Y(b.z1), c, 1); continue; }
    const big = (b.x1 - b.x0) > 0.06 && (b.z1 - b.z0) > 0.06;
    if (big) img.rect(X(b.x0), Y(b.z0), X(b.x1), Y(b.z1), c, 0.85); else img.rect(X(b.x0) - 2, Y(b.z0) - 2, X(b.x1) + 2, Y(b.z1) + 2, c);
  }
  for (const b of model) if (b.id === 'prod-key:zone') img.frame(X(b.x0), Y(b.z0), X(b.x1), Y(b.z1), [255, 70, 70], 2);
  for (const r of results) {
    const w = r.w, ok = r.checks.every(c => c.ok);
    const col = !ok ? [255, 40, 40] : w.kind === 'skylight' ? [255, 90, 220] : w.sill >= 0.5 ? [255, 235, 120] : [40, 230, 255];
    if (w.kind === 'skylight') {
      img.frame(X(w.x - w.w / 2), Y(w.z - w.d / 2), X(w.x + w.w / 2), Y(w.z + w.d / 2), col, 3);
      img.line(X(w.x - w.w / 2), Y(w.z - w.d / 2), X(w.x + w.w / 2), Y(w.z + w.d / 2), col);
      img.line(X(w.x + w.w / 2), Y(w.z - w.d / 2), X(w.x - w.w / 2), Y(w.z + w.d / 2), col);
      img.text(w.id, X(w.x) - 6 * 4 * 1.5, Y(w.z) - 3, col, 2);
      continue;
    }
    const [fx, fz] = w.facing, onX = fx !== 0, half = w.w / 2, t = 7;
    const cx = X(w.x + fx * 0.07), cz = Y(w.z + fz * 0.07);
    if (onX) img.rect(cx - t / 2, Y(w.z - half), cx + t / 2, Y(w.z + half), col); else img.rect(X(w.x - half), cz - t / 2, X(w.x + half), cz + t / 2, col);
    // a little arrow into the room
    img.line(X(w.x), Y(w.z), X(w.x + fx * 0.35), Y(w.z + fz * 0.35), col);
    const lx = X(w.x + fx * 0.45) - (fx < 0 ? w.id.length * 8 : 0) - (fz !== 0 ? w.id.length * 4 : 0), lz = Y(w.z + fz * 0.45) - 5 + (fz > 0 ? 4 : fz < 0 ? -8 : 0);
    img.text(w.id, lx, lz, col, 2);
  }
  img.text('PLAN: WINDOWS (CYAN = HORIZON, YELLOW = SKY ONLY, MAGENTA = SKYLIGHT, RED = FAILS)', 24, 6, [220, 220, 220], 2);
  img.save(file);
}

// One elevation per wall that hosts a window: obstacles (red), soft washes (yellow), notes (white), margins (hatch), eye level.
function drawWalls(file, { model, windows, runs, results }) {
  const S = 130, PAD = 18;
  const strips = [];
  for (const run of runs) {
    const here = windows.filter(w => w.kind === 'wall' && runOf(w, [run]) === run);
    if (!here.length) continue;
    const mid = (run.lo + run.hi) / 2;
    const fr = run.n === 'x' ? { x: run.plane + run.side * 0.25, z: mid } : { x: mid, z: run.plane + run.side * 0.25 };
    strips.push({ run, here, ceil: ceilAt(fr.x, fr.z) - floorAt(fr.x, fr.z) });
  }
  const W = Math.max(...strips.map(s => (s.run.hi - s.run.lo) * S)) + 2 * PAD + 40;
  const H = strips.reduce((a, s) => a + s.ceil * S + PAD + 18, PAD);
  const img = new Img(Math.ceil(W), Math.ceil(H));
  let top = PAD;
  for (const st of strips) {
    const { run, ceil } = st, f = { n: run.n, plane: run.plane, side: run.side, along: run.n === 'x' ? 'z' : 'x' };
    const x0 = PAD, w = (run.hi - run.lo) * S, y0 = top + 18, h = ceil * S;
    const X = a => x0 + (a - run.lo) * S, Y = y => y0 + h - y * S;
    // the viewer faces the wall: along-wall increases to his right when side is the sign that makes it so; mirror to match
    img.rect(x0, y0, x0 + w, y0 + h, [30, 32, 38]);
    img.rect(X(run.lo), y0, X(run.lo + RULES.doorCorner), y0 + h, [70, 30, 30], 0.7);
    img.rect(X(run.hi - RULES.doorCorner), y0, X(run.hi), y0 + h, [70, 30, 30], 0.7);
    for (const b of model) {
      const p = project(b, f);
      if (p.d1 < -0.05 || p.d0 > RULES.hideDist || p.a1 <= run.lo || p.a0 >= run.hi) continue;
      const c = b.tier === 'note' ? [255, 255, 255] : b.tier === 'soft' ? [230, 200, 60] : [215, 70, 60];
      const m = b.tier === 'note' ? RULES.note : b.tier === 'soft' ? 0 : p.d0 <= 0.2 ? RULES.wallItem : RULES.object;
      if (m) img.rect(X(p.a0 - m), Y(p.y1 + RULES.vertical), X(p.a1 + m), Y(p.y0 - RULES.vertical), c, 0.14);
      img.rect(X(p.a0), Y(p.y1), X(p.a1), Y(p.y0), c, b.tier === 'soft' ? 0.25 : 0.7);
    }
    for (let a = run.lo; a < run.hi; a += 0.1) img.px(X(a), Y(RULES.gazeFrom), [0, 170, 210]);
    for (const wd of st.here) {
      const s = frameOfWindow(wd).s, a0 = s - wd.w / 2, a1 = s + wd.w / 2, y1 = wd.sill, y2 = wd.sill + wd.h;
      const hy = Math.min(Math.max(RULES.gazeFrom, y1), y2);
      img.rect(X(a0), Y(y2), X(a1), Y(hy), [10, 12, 46]);                     // sky above the horizon
      if (y1 < RULES.gazeFrom) img.rect(X(a0), Y(hy), X(a1), Y(y1), [96, 96, 100]);   // ground below it
      const ok = results.find(r => r.w === wd)?.checks.every(c => c.ok);
      img.frame(X(a0), Y(y2), X(a1), Y(y1), ok ? [40, 230, 255] : [255, 40, 40], 2);
      img.text(wd.id, X(a0) + 4, Y(y2) + 4, [255, 255, 255], 2);
    }
    img.frame(x0, y0, x0 + w, y0 + h, [120, 120, 130], 1);
    img.text(`${run.room} ${run.n}=${run.plane} facing ${run.n === 'x' ? (run.side > 0 ? '+X' : '-X') : (run.side > 0 ? '+Z' : '-Z')}  along ${run.n === 'x' ? 'Z' : 'X'} ${run.lo}-${run.hi}  ceiling ${fmt(ceil)}`, x0, top, [200, 200, 210], 2);
    top += ceil * S + PAD + 18;
  }
  img.save(file);
}

// ── Entry point ─────────────────────────────────────────────────────────────────────────────────────────
function freeWorksheet() {
  const model = buildModel(), runs = wallRuns();
  console.log('Free spans of every wall (hard things only; soft washes ignored), margins 0.3 door/corner, 0.12/0.2/0.25 around things.\n');
  for (const r of runs) {
    if (r.hi - r.lo < 0.9) continue;
    const mid = (r.lo + r.hi) / 2, p = r.n === 'x' ? [r.plane + r.side * 0.5, mid] : [mid, r.plane + r.side * 0.5];
    const h = ceilAt(...p) - floorAt(...p);
    console.log(`${r.room} wall ${r.n}=${r.plane} facing ${r.n === 'x' ? r.side : 0},${r.n === 'z' ? r.side : 0} along ${r.lo}–${r.hi}  inside height ${fmt(h)}`);
    for (const [sill, head] of [[0.25, 1.2], [0.55, 1.4], [0.95, 1.8], [1.12, 1.5]]) {
      if (head > h - RULES.headGap + EPS) continue;
      const fs = freeSpans(r, sill, head, model);
      console.log(`   sill ${sill}–head ${head}: ${fs.map(([a, b]) => `[${fmt(a)}, ${fmt(b)}] (${fmt(b - a)})`).join('  ') || '—'}`);
    }
  }
}

export function main(argv = process.argv.slice(2)) {
  if (argv.includes('--free')) return freeWorksheet();
  const res = proofs();
  const at = argv.indexOf('--png');
  if (at >= 0) {
    const dir = path.resolve(argv[at + 1] ?? '.');
    fs.mkdirSync(dir, { recursive: true });
    drawMap(path.join(dir, 'windows-map.png'), res);
    drawWalls(path.join(dir, 'windows-walls.png'), res);
    console.log(`pictures: ${path.join(dir, 'windows-map.png')}, ${path.join(dir, 'windows-walls.png')}`);
  }
  process.exitCode = res.failed || guards.some(g => !g.ok) ? 1 : 0;
}

// Only run the proofs when this file is the entry point (a scratch tool can import the model).
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
