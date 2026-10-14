// Dev proof for the windows on the moon (decor/windowSlots.js), in plain node (no DOM, no GPU):
//
//   node src/engine/decor/check-windows.mjs            prove every rule, print PASS / FAIL, the VIEW TABLE and the notes for the dressers
//   node src/engine/decor/check-windows.mjs --png DIR  also draw DIR/windows-map.png (plan of the rooms), DIR/windows-walls.png (one
//                                                      elevation per wall that hosts a window) and DIR/windows-exterior.png (the base seen
//                                                      from above: hulls, panes, what each pane looks at, where the sky bodies lie)
//   node src/engine/decor/check-windows.mjs --ascii    print the top-down map as text
//   node src/engine/decor/check-windows.mjs --free     list the free spans of every wall (the designer's worksheet)
//   node src/engine/decor/check-windows.mjs --dress    print only the notes for the exterior builder and props dresser (what each window
//                                                      stares at: hull wall, distance, coordinates on the wall; the lit glass of every
//                                                      window on its hull; the face segments to keep neutral; the annex's roof plant)
//
// Version 3: the windows are panes onto ONE real exterior world (src/engine/exterior/, layout in exterior/exteriorLayout.js) drawn from the
// player's own camera, under ONE sky (the Earth south, the Sun to the east, the ringed giant north, the asteroids west). The base is five hulls
// at their real height (the atrium tower 2.5, the wings 1.65–2.0, the annex 1.2, the corridors 0.75, the plain at −0.45), so a window looks
// mostly at its NEIGHBOURS across the alleys: what a window shows is decided by where it is and which way it faces, and this file traces it
// with plain rays: the hulls of the blocks and links are boxes, the plain is a plane, the sky bodies are discs at (az, el).
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
//   · EXTERIOR: nothing of the exterior (a hull, a tube) stands between any camera position of the room (from the player's own wall margin,
//     Player.js COLLISION_MARGIN, outward) and any pane, nor in the recess behind it (decor/windows.js WALL_DEPTH / SHAFT_DEPTH: the glass is
//     not on the wall face): every segment eye → glass that passes through the opening, with the real hull boxes (tall wings, links and all);
//     blocks are never smaller than their rooms and hold their ceilings under a roof slab; the Earth is framed as a disc (not only as a slice)
//     by at least one window; no window stares at a wall within 2.6 m unless its `dress` note tells the props dresser what to hang there; every
//     window has something to look at; every cardinal direction is served; each sky body is seen through the windows that face it
//   · THE BASE AS A SIGHT: at least three windows look at the outside of the building, and EVERY hull is seen from outside (the Armurerie from
//     the atrium's west window, the Trophées from its east one, the Quartiers from the atrium's north window and from the Armurerie's); the three
//     windows of the atrium frame a neighbour's wall AND a slice of sky; no window of a public room shows the annex's door or the alley behind the
//     push-wall (the secret stays neutral there)
//   · THE PROD ANNEX: the lowest hull (roof 1.2) is above no eye but under every ray of a south window of a wing (the glass starts 0.6 m over the eye): its
//     walls, its hazard door and its stencils are seen from nowhere (arm-e1 glimpses its north wall at a grazing angle). What a south window frames of it is
//     what stands over its parapet: the ROOF PLANT of windowSlots.js LANDMARKS (a bulkhead with the red hazard door, the lit PROD plate, a red lamp, turned to
//     face the Armurerie), modelled here as an oriented box that hides what lies behind it. Proved: it stands on the annex roof inside its parapet and out
//     of the secret's span; some window of a public room (arm-s1) frames at least half of its plate, with nothing in the way, from a quarter of the spots
//     of its room; a letter of it is at least 8 px tall and a font pixel 1.5 px wide on a 640 × 360 screen (`plateFraming`)
//   · the VIEW TABLE: window → where the visitor stands → what it shows (hulls, plain, bodies, the sky above the roof line in degrees), and the
//     notes for the dressers (what each window stares at, the lit glass of every window on its hull, what to keep neutral)
//
// Everything below the heading `Level model` is the model of what stands where; the rules come after it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MAP, PUSH_WALL, floorAt, ceilAt, getCellType, isWall } from '../Map.js';
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
import * as SKYMOD from '../props/sky.js';
import { BLOCKS, LINKS, GROUND_Y, SKYLIGHT, WORLD_RADIUS } from '../exterior/exteriorLayout.js';
import { WINDOWS, LANDMARKS } from './windowSlots.js';
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
  maxOblique: 70,      // degrees off the axis of a pane beyond which a visitor sees a sliver: such spots are left out of the view statistics
  stareDist: 2.6,      // a wall of the exterior nearer than this to the glass (a 1 m or 2 m alley) is a wall the window stares at
  stareShare: 0.25,    // … when at least this share of what the pane shows is such a wall: its `dress` note must say what hangs there
  outsideShare: 0.35,  // a window "looks at the outside of the building" when this share of its pane shows a hull (wall, roof, tube)
  seesHull: 0.15,      // a window "sees a hull from outside" when this share of its pane shows that hull's walls
  skySlice: 0.08,      // a window that frames a neighbour's wall also frames a slice of sky when this share of its pane is sky
  secret: [11.8, 13.2], // x span of the secret corridor (the push-wall at x 12–13 and the annex's door): nothing public looks at it
  plateHalf: 0.5,      // the PROD plate is "in the glass" from a spot when this share of it is framed with nothing in the way
  plateSpots: 0.25,    // … and some window frames it so from at least this share of the spots of its room
  letterPx: 8,         // … and a letter of it is at least this tall on a 640 × 360 screen (the font is 5 rows: 1.6 screen px per font pixel)
  fontPx: 1.5,         // … and a font pixel is at least this wide on screen (the plate is seen at an angle, foreshortened)
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

// How close to a wall the player's camera can come: Player.js stops the body COLLISION_MARGIN short of a wall, so an eye is never nearer to a
// pane than this (the proofs of the hull stand from here on, not from 0.3 m).
export const REACH = +(grab('engine/Player.js', /const COLLISION_MARGIN = ([\d.]+)/, 'COLLISION_MARGIN (the player stops this far from a wall)')?.[1] ?? 0.2);

// The recess of a pane (decor/windows.js): the glass lies WALL_DEPTH behind the wall face (outside), or SHAFT_DEPTH above the ceiling. These
// two numbers are the integrator's; a miss is a WARN (the defaults are used), not a failure.
const recessOf = name => {
  const m = read('engine/decor/windows.js').match(new RegExp(`const ${name}\\s*=\\s*([\\d.]+)`));
  return m ? +m[1] : null;
};
export const RECESS = { wall: recessOf('WALL_DEPTH') ?? 0.22, shaft: recessOf('SHAFT_DEPTH') ?? 0.3, found: recessOf('WALL_DEPTH') !== null && recessOf('SHAFT_DEPTH') !== null };

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
function spotsOf(room, step = 0.25) {
  registerSolids();
  const spots = [];
  for (let z = 0; z < MAP.length; z += step) for (let x = 0; x < MAP[0].length; x += step) {
    if (roomAt(x, z) === room && isFree(x, z)) spots.push({ x, z });
  }
  return spots;
}

// ══ The exterior world ════════════════════════════════════════════════════════════════════════════════════
// exterior/exteriorLayout.js: the hulls (BLOCKS, LINKS) are boxes from the ground up to their roofs, drawn from OUTSIDE only (their faces are
// FrontSide: from inside a hull you see through it). A pane shows what the camera's ray meets beyond the glass. Plain rays are enough to
// prove what stands between a camera and a pane, and to say what a pane looks at.
const SOLIDS = [...BLOCKS, ...LINKS].map(b => ({ id: b.id, link: LINKS.includes(b), lo: [b.x0, GROUND_Y, b.z0], hi: [b.x1, b.roofY, b.z1] }));
const FACE = { '0,-1': 'W', '0,1': 'E', '2,-1': 'N', '2,1': 'S', '1,1': 'roof', '1,-1': 'floor' };   // axis (x, y, z), sign of the outward normal
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
// Name of a heading (0 = east, 90 = south, 270 = north) on the compass of the map (north up).
export const compass = h => COMPASS[Math.round((wrap360(h + 90)) / 22.5) % 16];
const dir = (az, el) => [Math.cos(el * D2R) * Math.cos(az * D2R), Math.sin(el * D2R), Math.cos(el * D2R) * Math.sin(az * D2R)];

// Slab test of a ray o + t·d against a hull: the span [t0, t1] it spends inside, and the face it enters through
// (axis, sign of that face's outward normal). t0 > 0: the ray comes from OUTSIDE and enters through a face that points at it (drawn).
// t0 < 0: it starts inside (the faces it leaves through point away from it, culled).
function slab(o, d, s) {
  let t0 = -Infinity, t1 = Infinity, axis = -1, sgn = 0;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-12) { if (o[a] < s.lo[a] - 1e-9 || o[a] > s.hi[a] + 1e-9) return null; continue; }
    let ta = (s.lo[a] - o[a]) / d[a], tb = (s.hi[a] - o[a]) / d[a], sg = -1;
    if (ta > tb) { const k = ta; ta = tb; tb = k; sg = 1; }
    if (ta > t0) { t0 = ta; axis = a; sgn = sg; }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return null;
  }
  return { t0, t1, axis, sgn };
}

// What stands between the camera and the pane (the segment o → o + d, t in (0, 1)): the first hull the ray ENTERS, or null.
export function between(o, d) {
  let best = null;
  for (const s of SOLIDS) {
    const h = slab(o, d, s);
    if (!h || h.t0 <= EPS || h.t0 >= 1 - EPS || h.t1 - h.t0 <= EPS) continue;
    if (!best || h.t0 < best.t) best = { t: h.t0, id: s.id, face: FACE[`${h.axis},${h.sgn}`] };
  }
  return best;
}

// What the pane shows along the ray (the pane is at t = 1): the first hull entered beyond it, else the ground (within WORLD_RADIUS of
// the camera, else the horizon), else the sky. `dist` is the horizontal distance from the glass; `at` the point hit.
export function beyond(o, d) {
  const dxz = Math.hypot(d[0], d[2]);
  let best = { cls: 'sky', t: Infinity };
  for (const s of SOLIDS) {
    const h = slab(o, d, s);
    if (!h || h.t0 < 1 - 1e-6 || h.t1 - h.t0 <= EPS) continue;
    if (h.t0 < best.t) best = { cls: 'hull', t: h.t0, id: s.id, face: FACE[`${h.axis},${h.sgn}`] };
  }
  const lm = PLANT.hit(o, d);
  if (lm && lm.t0 >= 1 - 1e-6 && lm.t1 - lm.t0 > EPS && lm.t0 < best.t) best = { cls: 'hull', t: lm.t0, id: PLANT.L.id, face: lm.face };
  if (d[1] < -1e-9) {
    const tg = (GROUND_Y - o[1]) / d[1];
    if (tg >= 1 - 1e-6 && tg < best.t) best = { cls: tg * dxz > WORLD_RADIUS ? 'far' : 'ground', t: tg };
  }
  if (best.t === Infinity) return { cls: 'sky', t: Infinity, dist: Infinity, at: null };
  best.dist = (best.t - 1) * dxz;
  best.at = [o[0] + d[0] * best.t, o[1] + d[1] * best.t, o[2] + d[2] * best.t];
  return best;
}
const labelOf = h => h.cls === 'hull' ? `${h.id}.${h.face}` : h.cls === 'far' ? 'horizon' : h.cls;

// ── Landmarks: what stands ON a hull ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// windowSlots.js LANDMARKS: the PROD annex's roof plant, a bulkhead turned to face the middle of the Armurerie, with the lit PROD plate on its front.
// It is an ORIENTED box (u across its front, o out of it, y up). Rays meet it like a hull, so it hides what lies behind it, and the plate on its
// front is what the legibility proof samples.
const PLANT = (() => {
  const L = LANDMARKS.annexPlant, b = BLOCKS.find(q => q.id === L.host), h = L.heading * D2R;
  const n = [Math.cos(h), Math.sin(h)], r = [n[1], -n[0]];                       // n: the way the front looks, r: to the right of a viewer who faces it (x, z)
  const y0 = b.roofY, y1 = y0 + L.h, F = L.d / 2;
  const at = (u, y, o = 0) => [L.x + r[0] * u + n[0] * o, y, L.z + r[1] * u + n[1] * o];
  const P = L.plate, corner = (u, y) => at(u, y, F);
  return {
    L, b, n, r, y0, y1, F, at,
    plate: { corners: [corner(-P.w / 2, P.y0), corner(P.w / 2, P.y0), corner(P.w / 2, P.y0 + P.h), corner(-P.w / 2, P.y0 + P.h)], w: P.w, h: P.h, y0: P.y0, letter: 5 * (P.w - 0.16) / 17, width: 15 * (P.w - 0.16) / 17 },
    // the ray o + t·d into the local frame, and the span it spends inside the box, with the face it enters by ('front' | 'back' | 'side' | 'top')
    hit(o, d) {
      const lo = [-L.w / 2, y0, -L.d / 2], hi = [L.w / 2, y1, L.d / 2];
      const O = [(o[0] - L.x) * r[0] + (o[2] - L.z) * r[1], o[1], (o[0] - L.x) * n[0] + (o[2] - L.z) * n[1]];
      const Dv = [d[0] * r[0] + d[2] * r[1], d[1], d[0] * n[0] + d[2] * n[1]];
      let t0 = -Infinity, t1 = Infinity, axis = -1, sgn = 0;
      for (let a = 0; a < 3; a++) {
        if (Math.abs(Dv[a]) < 1e-12) { if (O[a] < lo[a] - 1e-9 || O[a] > hi[a] + 1e-9) return null; continue; }
        let ta = (lo[a] - O[a]) / Dv[a], tb = (hi[a] - O[a]) / Dv[a], sg = -1;
        if (ta > tb) { const k = ta; ta = tb; tb = k; sg = 1; }
        if (ta > t0) { t0 = ta; axis = a; sgn = sg; }
        if (tb < t1) t1 = tb;
        if (t0 > t1) return null;
      }
      return { t0, t1, face: axis === 2 ? (sgn > 0 ? 'front' : 'back') : axis === 1 ? 'top' : 'side' };
    },
  };
})();

// ── The sky: where the bodies are ────────────────────────────────────────────────────────────────────────────
// ONE sky for the whole world, read from props/sky.js BODIES (id, kind, az, el, radius, note; headings: 0 east, 90 south, 270 north).
// The four that matter to the layout are the Earth (south), the Sun (east-south-east), the ringed giant (north) and the asteroid stream
// (west, from (166°, 36°) down to (248°, 1.5°) as its note says). If a body is missing or BODIES is not exported yet, the SPEC direction
// is used and said so. Every other body (moons, planets, the jokes) is listed too: a window may show them.
const PLAN = Object.freeze({
  earth:     { az: 90,  el: 11, radius: 6 },
  sun:       { az: 30,  el: 15, radius: 1.1 },
  giant:     { az: 268, el: 5,  radius: 8.5 },
  asteroids: { az: 204, el: 17, radius: 46, stream: [[166, 36], [248, 1.5]] },
});
export function skyPlan() {
  const list = Array.isArray(SKYMOD.BODIES) && SKYMOD.BODIES.length ? SKYMOD.BODIES : null;
  const out = { v2: !!list, source: list ? 'props/sky.js BODIES' : 'SPEC directions (props/sky.js exports no BODIES yet)', bodies: {}, notes: [] };
  const mainIds = Object.keys(PLAN);
  for (const id of mainIds) {
    const hit = list?.find(b => b.id === id);
    if (list && !hit) out.notes.push(`BODIES lists no "${id}": the SPEC direction is used`);
    const b = { id, main: true, ...(hit ?? PLAN[id]) };
    let discs = [{ az: b.az, el: b.el, radius: b.radius }];
    if (id === 'asteroids') {
      // the stream: its two ends are written in the note, "(166,36) down to (248,1.5)"; five discs along it
      const m = (hit?.note ?? '').match(/\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)\)[^()]*\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)\)/);
      const [[a0, e0], [a1, e1]] = m ? [[+m[1], +m[2]], [+m[3], +m[4]]] : PLAN.asteroids.stream;
      discs = [0, 0.25, 0.5, 0.75, 1].map(t => ({ az: a0 + (a1 - a0) * t, el: e0 + (e1 - e0) * t, radius: 8 }));
    }
    out.bodies[id] = { ...b, discs };
  }
  for (const b of list ?? []) if (!mainIds.includes(b.id)) out.bodies[b.id] = { ...b, main: false, discs: [{ az: b.az, el: b.el, radius: Math.max(b.radius, 1) }] };
  return out;
}
export const MAIN_BODIES = Object.keys(PLAN);

// Directions across a body's discs (centre, then three rings each): the share of them that reach the eye through a pane is how much of it shows.
function discDirs(b) {
  const out = [];
  for (const c of b.discs) {
    out.push(dir(c.az, c.el));
    for (const [rho, n] of [[0.4, 6], [0.75, 10], [1, 14]]) for (let k = 0; k < n; k++) {
      const a = (k / n) * 2 * Math.PI + rho;
      out.push(dir(c.az + (c.radius * rho * Math.cos(a)) / Math.max(0.2, Math.cos(c.el * D2R)), c.el + c.radius * rho * Math.sin(a)));
    }
  }
  return out;
}

// ── Panes: the pane as a rectangle, its sample points, who stands in front of it ───────────────────────────────────────
// { n: axis of the glass's normal (0 x, 1 y, 2 z), c: its coordinate, lo/hi: the corners, side: sign of the normal pointing to the viewer }
export function paneOf(w) {
  if (w.kind === 'skylight') {
    const c = ceilAt(w.x, w.z);
    return { n: 1, c, lo: [w.x - w.w / 2, c, w.z - w.d / 2], hi: [w.x + w.w / 2, c, w.z + w.d / 2], side: -1, centre: [w.x, c, w.z], outward: null };
  }
  const f = frameOfWindow(w), { floor } = localHeights(w);
  const y0 = floor + w.sill, y1 = y0 + w.h;
  const lo = f.n === 'x' ? [f.plane, y0, f.s - w.w / 2] : [f.s - w.w / 2, y0, f.plane];
  const hi = f.n === 'x' ? [f.plane, y1, f.s + w.w / 2] : [f.s + w.w / 2, y1, f.plane];
  return { n: f.n === 'x' ? 0 : 2, c: f.plane, lo, hi, side: f.side, centre: [(lo[0] + hi[0]) / 2, (y0 + y1) / 2, (lo[2] + hi[2]) / 2], outward: bearing(0, 0, -w.facing[0], -w.facing[1]) };
}
// Sample points on the glass (cell centres of a 5 × 4 grid; 5 × 3 for a skylight).
function panePoints(pane) {
  const pts = [], nu = 5, nv = pane.n === 1 ? 3 : 4;
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const u = (i + 0.5) / nu, v = (j + 0.5) / nv;
    if (pane.n === 1) pts.push([pane.lo[0] + u * (pane.hi[0] - pane.lo[0]), pane.c, pane.lo[2] + v * (pane.hi[2] - pane.lo[2])]);
    else {
      const a = pane.n === 0 ? 2 : 0, p = [0, pane.lo[1] + v * (pane.hi[1] - pane.lo[1]), 0];
      p[pane.n] = pane.c; p[a] = pane.lo[a] + u * (pane.hi[a] - pane.lo[a]);
      pts.push(p);
    }
  }
  return pts;
}
// Points that run from edge to edge of a pane (the edges and the corners included), at most `step` m apart, on the GLASS: `depth` m behind the
// opening (windows.js sinks the glass WALL_DEPTH into the wall, on the outside, and the skylight's SHAFT_DEPTH over the ceiling).
// A wall pane: columns along the wall, 5 rows high. A skylight: a grid over the opening.
function glassPoints(pane, step = 0.1, depth = 0) {
  const pts = [], at = (i, n) => (n <= 1 ? 0.5 : i / (n - 1));
  if (pane.n === 1) {
    const nx = Math.max(2, Math.ceil((pane.hi[0] - pane.lo[0]) / (step * 2)) + 1), nz = Math.max(2, Math.ceil((pane.hi[2] - pane.lo[2]) / (step * 2)) + 1);
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) pts.push([pane.lo[0] + at(i, nx) * (pane.hi[0] - pane.lo[0]), pane.c - pane.side * depth, pane.lo[2] + at(k, nz) * (pane.hi[2] - pane.lo[2])]);
    return pts;
  }
  const a = pane.n === 0 ? 2 : 0, span = pane.hi[a] - pane.lo[a], nu = Math.max(2, Math.ceil(span / step) + 1), nv = 5;
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const p = [0, pane.lo[1] + at(j, nv) * (pane.hi[1] - pane.lo[1]), 0];
    p[pane.n] = pane.c - pane.side * depth; p[a] = pane.lo[a] + at(i, nu) * span;
    pts.push(p);
  }
  return pts;
}
// Does the segment from the eye `o` to the glass point `q` pass through the OPENING (the pane's rectangle on the wall or ceiling plane)? A segment
// that does not hits a reveal, the inside of the wall: the glass point is not seen from there (the pane shader draws the reveal instead), and
// the segment says nothing about what stands outside.
function throughOpening(pane, o, q) {
  const dn = q[pane.n] - o[pane.n];
  if (Math.abs(dn) < 1e-12) return false;
  const t = (pane.c - o[pane.n]) / dn;
  if (t <= 0 || t >= 1) return false;
  for (let a = 0; a < 3; a++) {
    if (a === pane.n) continue;
    const v = o[a] + (q[a] - o[a]) * t;
    if (v < pane.lo[a] - 1e-9 || v > pane.hi[a] + 1e-9) return false;
  }
  return true;
}
const eyeOf = (x, z) => floorAt(x, z) + RULES.gazeFrom;
// Is the spot on the room side of the glass, at least `gap` (REACH: the nearest the player's body gets to a wall) from it?
const inFront = (pane, P, gap = REACH) => (pane.n === 1 ? pane.c - P.y : ((pane.n === 0 ? P.x : P.z) - pane.c) * pane.side) >= gap;

// Fraction of a body that reaches an eye at P through the pane with nothing in the way.
function coverage(pane, P, dirs) {
  const o = [P.x, P.y, P.z];
  let seen = 0;
  for (const u of dirs) {
    if (Math.abs(u[pane.n]) < 1e-9) continue;
    const t = (pane.c - o[pane.n]) / u[pane.n];
    if (t <= 0) continue;
    const H = [o[0] + u[0] * t, o[1] + u[1] * t, o[2] + u[2] * t];
    let inside = true;
    for (let a = 0; a < 3; a++) if (a !== pane.n && (H[a] < pane.lo[a] - 1e-9 || H[a] > pane.hi[a] + 1e-9)) inside = false;
    if (!inside) continue;
    const r = beyond(o, [u[0] * t, u[1] * t, u[2] * t]);
    if (r.cls === 'sky' || r.cls === 'far') seen++;
  }
  return seen / dirs.length;
}

// Open line of sight in the level (walls and ceilings) from the eye at P to the glass point q (the push-wall is closed).
function lineOpen(P, q) {
  const dx = q[0] - P.x, dz = q[2] - P.z, dy = q[1] - P.y, len = Math.hypot(dx, dz), n = Math.max(2, Math.ceil(len / 0.04));
  for (let i = 1; i < n; i++) {
    const t = i / n, x = P.x + dx * t, z = P.z + dz * t, y = P.y + dy * t;
    if (isWall(x, z) || y > ceilAt(x, z) - 0.01 || y < floorAt(x, z)) return false;
  }
  return true;
}

let solidsRegistered = false;
function registerSolids() { if (!solidsRegistered) { for (const b of Object.values(LOUNGE_SOLIDS)) addSolidBox(b); solidsRegistered = true; } }
function walkSpots(step = 0.5) {
  registerSolids();
  const out = [];
  for (let z = 0.25; z < MAP.length; z += step) for (let x = 0.25; x < MAP[0].length; x += step) if (!isWall(x, z) && isFree(x, z)) out.push({ x, z, y: eyeOf(x, z), cell: getCellType(x, z) });
  return out;
}

// How much of a body an eye at P gets through the pane. `cover`: the share of the body's disc that reaches the eye with nothing in the way;
// `fill`: the share of the glass (its sample points) that lies inside the body. A body is SEEN when it covers a quarter or fills a quarter
// of the glass: a wide body (the giant, the asteroid stream) seen through a narrow window is still what the window shows.
function bodySeen(pane, P, pts, dirs, cosList) {
  const o = [P.x, P.y, P.z];
  const cover = coverage(pane, P, dirs);
  let inBody = 0;
  for (const q of pts) {
    const dx = q[0] - o[0], dy = q[1] - o[1], dz = q[2] - o[2], len = Math.hypot(dx, dy, dz);
    if (cosList.some(c => (dx * c.u[0] + dy * c.u[1] + dz * c.u[2]) / len >= c.cos) && beyond(o, [dx, dy, dz]).cls !== 'hull') inBody++;
  }
  return { cover, fill: inBody / pts.length };
}

const PLAIN_CELL = 4;             // metres: the grid of the "plain seen from the windows" map
const PLAIN_FOCUS = 30;           // metres: the stretch of open ground a window "focuses" on, for the dresser (beyond it the ground melts into the horizon)
const SKY_HEIGHTS = [3, 5, 8];     // heights (m) at which the rays through the skylight are boxed, for the dresser of the tower's top

// ── One window, audited: who sees it, what is between, what it shows ───────────────────────────────────────────────────
// Every walkable spot of the window's room that stands in front of it (the eye 0.5 m over the floor) × 20 sample points of the glass.
export function auditWindow(w, ctx, sky) {
  const pane = paneOf(w), pts = panePoints(pane);
  const spots = ctx.spots(w.room).map(s => ({ x: s.x, z: s.z, y: eyeOf(s.x, s.z) })).filter(P => inFront(pane, P));
  const A = { w, pane, spots, rays: 0, between: [], classes: new Map(), off: [Infinity, -Infinity], el: [Infinity, -Infinity], bodies: {}, zones: new Map(), cone: {}, plain: new Map(), groundPts: [] };
  let nearWall = 0;
  const dirsOf = Object.fromEntries(Object.entries(sky.bodies).map(([k, b]) => [k, discDirs(b)]));
  for (const k of Object.keys(sky.bodies)) A.bodies[k] = { spots: 0, half: 0, best: 0, bestFill: 0, dmin: Infinity, dmax: 0 };
  const cosOf = Object.fromEntries(Object.entries(sky.bodies).map(([k, b]) => [k, b.discs.map(c => ({ u: dir(c.az, c.el), cos: Math.cos(c.radius * D2R) }))]));
  const tally = (map, h) => {
    const k = labelOf(h), c = map.get(k) ?? { n: 0, dmin: Infinity, dmax: 0 };
    c.n++; if (h.dist !== Infinity) { c.dmin = Math.min(c.dmin, h.dist); c.dmax = Math.max(c.dmax, h.dist); }
    map.set(k, c);
  };
  A.nearHull = 0; A.nearSpots = 0; A.nearTotal = 0; A.secretRays = 0; A.best = {};
  const offs = [];
  const viewed = [];
  for (const P of spots) {
    const o = [P.x, P.y, P.z];
    let hullHere = 0;
    // a visitor who looks at the glass from more than 70° off its axis sees a sliver (a 0.7 m pane is 0.2 m wide at 70°): the proof of the
    // hull covers every spot, the view statistics only the spots that see the glass properly
    const grazing = pane.outward !== null && Math.abs(angDiff(bearing(P.x, P.z, pane.centre[0], pane.centre[2]), pane.outward)) > RULES.maxOblique;
    if (grazing) {
      for (const q of pts) { const bad = between(o, [q[0] - o[0], q[1] - o[1], q[2] - o[2]]); A.rays++; if (bad) A.between.push({ P, ...bad }); }
      continue;
    }
    viewed.push(P);
    const here = new Map();       // what this spot sees, per class: the best spot to look at each hull is kept in A.best
    for (const q of pts) {
      const d = [q[0] - o[0], q[1] - o[1], q[2] - o[2]];
      A.rays++;
      const bad = between(o, d);
      if (bad) A.between.push({ P, ...bad });
      const h = beyond(o, d);
      tally(A.classes, h);
      here.set(labelOf(h), (here.get(labelOf(h)) ?? 0) + 1);
      if (h.cls === 'hull') hullHere++;
      // the secret: the first thing this ray meets lies in the alley behind the push-wall (its two faces and its floor) or on the annex's door
      if (h.at && h.at[0] > RULES.secret[0] && h.at[0] < RULES.secret[1] && h.at[2] > 15.99 && h.at[2] < 18.01 && h.at[1] < 2.6) A.secretRays++;
      if (w.kind === 'skylight') for (const H of SKY_HEIGHTS) { const t = (H - o[1]) / d[1]; (A.cone[H] ??= []).push([o[0] + d[0] * t, o[2] + d[2] * t]); }
      const el = Math.atan2(d[1], Math.hypot(d[0], d[2])) * R2D;
      A.el[0] = Math.min(A.el[0], el); A.el[1] = Math.max(A.el[1], el);
      if (h.cls === 'ground') {
        const k = `${Math.floor(h.at[0] / PLAIN_CELL)},${Math.floor(h.at[2] / PLAIN_CELL)}`; A.plain.set(k, (A.plain.get(k) ?? 0) + 1);
        if (h.dist <= PLAIN_FOCUS) A.groundPts.push(h.at);
      }
      if (h.cls === 'hull' && h.face !== 'roof' && h.dist <= RULES.stareDist) nearWall++;
      if (h.cls === 'hull' || (h.cls === 'ground' && h.dist <= 6)) {
        const key = h.cls === 'hull' ? `${h.id}.${h.face}` : `ground<6 (${w.id})`;
        const z = A.zones.get(key) ?? { n: 0, lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity], dmin: Infinity, pts: [] };
        z.n++; z.dmin = Math.min(z.dmin, h.dist); z.pts.push(h.at);
        for (let a = 0; a < 3; a++) { z.lo[a] = Math.min(z.lo[a], h.at[a]); z.hi[a] = Math.max(z.hi[a], h.at[a]); }
        A.zones.set(key, z);
      }
    }
    for (const [k, n] of here) if (n > (A.best[k]?.n ?? 0)) A.best[k] = { n, P };
    if (Math.hypot(P.x - pane.centre[0], P.z - pane.centre[2]) <= 3) {     // a visitor close to the glass, looking out and down
      A.nearTotal++; A.nearHull = Math.max(A.nearHull, hullHere / pts.length);
      if (hullHere / pts.length >= 0.5) A.nearSpots++;
    }
    if (pane.outward !== null) {
      const off = angDiff(bearing(P.x, P.z, pane.centre[0], pane.centre[2]), pane.outward);
      A.off[0] = Math.min(A.off[0], off); A.off[1] = Math.max(A.off[1], off); offs.push(off);
    }
    for (const [k, b] of Object.entries(sky.bodies)) {
      const { cover, fill } = bodySeen(pane, P, pts, dirsOf[k], cosOf[k]), B = A.bodies[k];
      if (cover >= 0.25 || fill >= 0.25) {
        const dd = Math.hypot(P.x - pane.centre[0], P.z - pane.centre[2]);
        B.spots++; B.dmin = Math.min(B.dmin, dd); B.dmax = Math.max(B.dmax, dd);
      }
      if (cover >= 0.5 || fill >= 0.5) B.half++;
      B.best = Math.max(B.best, cover); B.bestFill = Math.max(B.bestFill, fill);
    }
  }
  A.viewed = viewed;
  const total = viewed.length * pts.length || 1;     // the rays of the spots that see the glass properly
  A.rayView = total;
  const share = pred => [...A.classes].filter(([k]) => pred(k)).reduce((a, [, c]) => a + c.n, 0) / total;
  A.share = {
    hull: share(k => /\.(N|S|E|W|roof)$/.test(k)),
    wall: share(k => /\.(N|S|E|W)$/.test(k)),
    ground: share(k => k === 'ground'),
    horizon: share(k => k === 'horizon'),
    sky: share(k => k === 'sky'),
  };
  offs.sort((a, b) => a - b);
  A.offCore = offs.length ? [offs[Math.floor(0.1 * offs.length)], offs[Math.min(offs.length - 1, Math.floor(0.9 * offs.length))]] : [0, 0];   // 80 % of the visitors look within these headings
  A.share.stare = nearWall / total;     // rays that end on a WALL within 2.6 m of the glass: the alley walls a window stares at
  return A;
}

// What one spot sees through a pane: shares of what the 20 rays hit, the bodies, the heading and elevation range.
export function viewFrom(w, P, sky) {
  const pane = paneOf(w), pts = panePoints(pane), o = [P.x, P.y, P.z];
  const classes = new Map();
  let azMin = Infinity, azMax = -Infinity, elMin = Infinity, elMax = -Infinity;
  const c0 = bearing(P.x, P.z, pane.centre[0], pane.centre[2]);
  for (const q of pts) {
    const d = [q[0] - o[0], q[1] - o[1], q[2] - o[2]];
    const h = beyond(o, d), k = labelOf(h), c = classes.get(k) ?? { n: 0, dmin: Infinity, dmax: 0 };
    c.n++; if (h.dist !== Infinity) { c.dmin = Math.min(c.dmin, h.dist); c.dmax = Math.max(c.dmax, h.dist); }
    classes.set(k, c);
    const az = angDiff(wrap360(Math.atan2(d[2], d[0]) * R2D), c0), el = Math.atan2(d[1], Math.hypot(d[0], d[2])) * R2D;
    azMin = Math.min(azMin, az); azMax = Math.max(azMax, az); elMin = Math.min(elMin, el); elMax = Math.max(elMax, el);
  }
  const bodies = {};
  for (const [k, b] of Object.entries(sky.bodies)) {
    const r = bodySeen(pane, P, pts, discDirs(b), b.discs.map(c => ({ u: dir(c.az, c.el), cos: Math.cos(c.radius * D2R) })));
    if (r.cover >= 0.25 || r.fill >= 0.25) bodies[k] = r;
  }
  return { classes, bodies, heading: [c0 + azMin, c0 + azMax], el: [elMin, elMax], n: pts.length };
}

// ── One window against every rule ─────────────────────────────────────────────────────────────────────────
export function evaluate(w, ctx) {
  const checks = [], facts = {}, warns = [];
  const check = (rule, ok, detail = '') => checks.push({ rule, ok, detail });

  // struct
  const num = v => typeof v === 'number' && Number.isFinite(v);
  const base = typeof w.id === 'string' && w.id && ROOM_TYPE[w.room] !== undefined && (w.kind === 'wall' || w.kind === 'skylight')
    && num(w.x) && num(w.z) && num(w.w) && w.w > 0
    && !('skyYaw' in w)                                                      // one sky for the whole world: a window no longer turns it
    && (w.dress === undefined || (typeof w.dress === 'string' && w.dress.length >= 12));
  let shape = false;
  if (w.kind === 'wall') {
    shape = Array.isArray(w.facing) && w.facing.length === 2 && Math.abs(Math.abs(w.facing[0]) + Math.abs(w.facing[1]) - 1) < EPS
      && (w.facing[0] === 0 || w.facing[1] === 0) && num(w.h) && w.h > 0 && num(w.sill);
  } else if (w.kind === 'skylight') shape = num(w.d) && w.d > 0;
  check('struct', base && shape, base && shape ? '' : 'fields: id room kind x z w + (facing h sill | d), optional dress (a sentence for the props dresser); no skyYaw');
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

  // exterior: nothing of the exterior stands between any camera position of the room and the glass; what the glass looks at
  exteriorChecks(w, ctx, check, facts, warns);

  // view facts: horizon, distances
  facts.horizon = w.sill < RULES.gazeFrom && head > RULES.gazeFrom;
  facts.fullFrom = Math.max(head - RULES.gazeFrom, RULES.gazeFrom - w.sill) / RULES.vtan;
  return { checks, facts, warns };
}

// The three rules that come from the exterior world, shared by the wall windows and the skylight.
//   hull   nothing of the exterior (a hull, a tube) is entered by any segment from an eye of the room to a point of the glass
//   stare  a window that mostly shows a wall within 2.6 m carries a `dress` note (what the props dresser hangs there)
//   worth  it shows something: a sky body from ≥ 5 spots, or the outside of the building, or the plain
function exteriorChecks(w, ctx, check, facts, warns) {
  const A = ctx.audit(w);
  facts.audit = A;
  const bad = A.between;
  check('hull', bad.length === 0 && A.spots.length > 0, bad.length
    ? `${bad.length} of ${A.rays} rays enter ${[...new Set(bad.map(b => `${b.id}.${b.face}`))].join(', ')} before the glass (e.g. from (${fmt(bad[0].P.x)}, ${fmt(bad[0].P.z)}))`
    : `${A.spots.length} spots × 20 points: no hull between the eye and the glass`);
  const stares = A.share.stare >= RULES.stareShare;
  check('stare', !stares || !!w.dress, stares
    ? w.dress ? `${fmt(A.share.stare * 100, 0)} % of the pane is a wall within ${RULES.stareDist} m: dress note given` : `${fmt(A.share.stare * 100, 0)} % of the pane is a wall within ${RULES.stareDist} m and the window has no \`dress\` note`
    : `${fmt(A.share.stare * 100, 0)} % of the pane is a near wall`);
  if (w.dress && A.share.wall < 0.1) warns.push(`has a dress note but only ${fmt(A.share.wall * 100, 0)} % of its pane is a wall of the base: check that it is still needed`);
  const seenBodies = Object.entries(A.bodies).filter(([, b]) => b.spots >= 5).map(([k]) => k);
  const ok = seenBodies.length > 0 || A.share.hull >= 0.25 || A.nearHull >= RULES.outsideShare || A.share.ground + A.share.horizon >= 0.25 || w.kind === 'skylight';
  check('worth', ok, ok ? `${seenBodies.length ? seenBodies.slice(0, 4).join(', ') : ''}${A.nearHull >= RULES.outsideShare ? `${seenBodies.length ? ' + ' : ''}the building` : ''}`.trim() || 'the plain' : 'shows only empty sky: no body, no hull, no ground');
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
  check('footprint', r.x0 >= SKYLIGHT.x0 - EPS && r.x1 <= SKYLIGHT.x1 + EPS && r.z0 >= SKYLIGHT.z0 - EPS && r.z1 <= SKYLIGHT.z1 + EPS,
    `pane ${fmt(r.x0)}–${fmt(r.x1)} × ${fmt(r.z0)}–${fmt(r.z1)} inside the exterior's SKYLIGHT ${SKYLIGHT.x0}–${SKYLIGHT.x1} × ${SKYLIGHT.z0}–${SKYLIGHT.z1} (kept clear below y ${SKYLIGHT.clearY}); `
    + `it frames the sky from ${fmt(lowest, 1)}° up`);
  exteriorChecks(w, ctx, check, facts, warns);
  facts.skylight = { level: share(needLevel), look: share(needLook), pitchDeg: pitch * R2D, lowest };
  return { checks, facts, warns };
}

// ── Everything together ─────────────────────────────────────────────────────────────────────────────────
// The evaluation context: the level model, the wall runs, the walkable spots (cached per room), the sky, the audit of each window (cached).
export function makeContext(windows) {
  const cache = new Map(), audits = new Map(), plates = new Map();
  const ctx = {
    model: buildModel(), ceiling: buildCeilingModel(), runs: wallRuns(), windows, sky: skyPlan(),
    spots: room => (cache.has(room) ? cache.get(room) : cache.set(room, spotsOf(room)).get(room)),
    audit: w => audits.get(w) ?? audits.set(w, auditWindow(w, ctx, ctx.sky)).get(w),
    plate: w => plates.get(w) ?? plates.set(w, plateFraming(w, ctx)).get(w),
  };
  return ctx;
}

// Room → the block that hides it.
const ROOM_BLOCK = Object.freeze({ armurerie: 'armurerie', trophees: 'trophees', quartiers: 'quartiers', atrium: 'atrium', prod: 'annex' });
const block = id => BLOCKS.find(b => b.id === id);
export const outwardOf = w => (w.kind === 'wall' ? bearing(0, 0, -w.facing[0], -w.facing[1]) : null);
const SEEN_MIN = 8;       // spots from which a body counts as seen through a window

// ── The exterior model against the level ─────────────────────────────────────────────────────────────────────
// "Blocks are never smaller than their rooms", "every roof is a slab over its ceiling and over every eye", "every pane lies on its block's face".
function exteriorModelProofs(line, note, ctx) {
  // every open cell of a room lies inside its block; every corridor cell inside a link (the secret vestibule is the one exception)
  for (const [room, id] of Object.entries(ROOM_BLOCK)) {
    const b = block(id);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let my = 0; my < MAP.length; my++) for (let mx = 0; mx < MAP[0].length; mx++) if (roomAt(mx + 0.5, my + 0.5) === room) {
      x0 = Math.min(x0, mx); x1 = Math.max(x1, mx + 1); z0 = Math.min(z0, my); z1 = Math.max(z1, my + 1);
    }
    line(!!b && b.x0 <= x0 && b.x1 >= x1 && b.z0 <= z0 && b.z1 >= z1, `hull: the ${id} block is not smaller than the ${room}`,
      `room ${x0}–${x1} × ${z0}–${z1}, block ${b ? `${b.x0}–${b.x1} × ${b.z0}–${b.z1}` : 'missing'}`);
  }
  const loose = [];
  for (let my = 0; my < MAP.length; my++) for (let mx = 0; mx < MAP[0].length; mx++) {
    if (MAP[my][mx] !== 0) continue;                                          // corridors and vestibules
    const x = mx + 0.5, z = my + 0.5;
    if (!SOLIDS.some(s => x > s.lo[0] && x < s.hi[0] && z > s.lo[2] && z < s.hi[2])) loose.push(`(${mx}, ${my})`);
  }
  const secret = loose.filter(c => c === `(${PUSH_WALL.mx}, ${PUSH_WALL.my + 1})`);
  line(loose.length === secret.length, 'hull: every door and vestibule cell lies inside a link or a block', loose.length === secret.length ? `${LINKS.length} links` : `← ${loose.join(' ')}`);
  if (secret.length) note('WARN', 'secret vestibule', `the cell ${secret[0]} (south of the push-wall) lies in no link: when the secret is open the camera stands in the open alley, outside every hull `
    + `(the atrium's south face then shows in any pane seen through the opening). A LINK { x 12–13, z 16–18 } would close it.`);
  // no two blocks overlap (touching is fine: the links touch their two blocks)
  const clash = [];
  for (let i = 0; i < SOLIDS.length; i++) for (let j = i + 1; j < SOLIDS.length; j++) {
    const a = SOLIDS[i], b = SOLIDS[j];
    if (a.link && b.link) continue;
    if (Math.min(a.hi[0], b.hi[0]) - Math.max(a.lo[0], b.lo[0]) > EPS && Math.min(a.hi[2], b.hi[2]) - Math.max(a.lo[2], b.lo[2]) > EPS) clash.push(`${a.id}×${b.id}`);
  }
  line(clash.length === 0, 'hull: no two blocks overlap on the plan (links only touch the blocks they join)', clash.length ? `← ${clash.join(', ')}` : '');
  // heights (version 3: the wings are real buildings, no roof is hidden under an eye any more). Every block holds its room under a roof slab, the
  // eye of every spot is under its own roof (the camera stands inside the hull whose faces are not drawn), every pane lies under its parapet,
  // and no wing is taller than the tower (the hall is the landmark).
  const slab = [];
  for (const [room, id] of Object.entries(ROOM_BLOCK)) {
    const b = block(id);
    let ceil = -Infinity, eye = -Infinity, floor = Infinity;
    for (let my = 0; my < MAP.length; my++) for (let mx = 0; mx < MAP[0].length; mx++) if (roomAt(mx + 0.5, my + 0.5) === room) {
      ceil = Math.max(ceil, ceilAt(mx + 0.5, my + 0.5)); floor = Math.min(floor, floorAt(mx + 0.5, my + 0.5));
    }
    for (const P of ctx.spots(room)) eye = Math.max(eye, eyeOf(P.x, P.z));
    slab.push({ id, room, roof: b.roofY, ceil, eye, floor, thick: b.roofY - ceil });
  }
  line(slab.every(s => s.thick >= 0.25 - EPS), 'hull: every block\'s roof stands at least 0.25 m over the highest ceiling of its room (a roof slab, not a skin)',
    slab.map(s => `${s.id} ${fmt(s.roof)} over ${fmt(s.ceil)}`).join(', '));
  line(slab.every(s => s.roof > s.eye + 0.5), 'hull: the eye of every spot of a room stands under its own roof (the camera is inside its hull, whose faces are not drawn)',
    slab.map(s => `${s.id} eye ${fmt(s.eye)} < roof ${fmt(s.roof)}`).join(', '));
  line(slab.every(s => s.floor >= GROUND_Y + 0.1), 'hull: every floor lies over the plain (GROUND_Y): no hull is dug into the ground, nothing of a room under the plain',
    slab.map(s => `${s.id} floor ${fmt(s.floor)}`).join(', '));
  const atrium = block('atrium');
  line(BLOCKS.every(b => b.id === 'atrium' || b.roofY < atrium.roofY), 'hull: the atrium hull is the tallest block (the landmark: the drum, the dome and the masts rise over it)',
    `roof ${atrium.roofY}; others ${BLOCKS.filter(b => b.id !== 'atrium').map(b => `${b.id} ${b.roofY}`).join(', ')}; corridors ${LINKS.map(l => l.roofY).join(', ')}`);
  line(LINKS.every(l => l.roofY < Math.min(...BLOCKS.map(b => b.roofY))), 'hull: the corridors are lower than every block (tubes across the alleys, under the neighbours\' parapets)',
    `${LINKS.map(l => `${l.id} ${l.roofY}`).join(', ')}`);
  const high = [];
  for (const w of ctx.windows) {
    const b = block(ROOM_BLOCK[w.room]), top = w.kind === 'skylight' ? ceilAt(w.x, w.z) : localHeights(w).floor + w.sill + w.h;
    if (top > b.roofY - 0.1) high.push(`${w.id} ${fmt(top)} / roof ${fmt(b.roofY)}`);
  }
  line(high.length === 0, 'hull: every pane lies under the parapet of its own block (head ≥ 0.1 m under the roof)', high.length ? `← ${high.join(', ')}` : '');
  // every wall pane lies on a face of its own block, inside it
  const off = [];
  for (const w of ctx.windows) {
    if (w.kind !== 'wall') continue;
    const b = block(ROOM_BLOCK[w.room]), f = frameOfWindow(w);
    const planes = f.n === 'x' ? [b.x0, b.x1] : [b.z0, b.z1];
    const [lo, hi] = f.n === 'x' ? [b.z0, b.z1] : [b.x0, b.x1];
    if (!planes.some(p => Math.abs(p - f.plane) < EPS) || f.s - w.w / 2 < lo - EPS || f.s + w.w / 2 > hi + EPS) off.push(w.id);
  }
  line(off.length === 0, 'hull: every pane lies on a face of its own block', off.length ? `← ${off.join(', ')}` : '');
  // the GLASS is not on the wall face: windows.js sinks it WALL_DEPTH behind it (outside), the skylight's SHAFT_DEPTH above the ceiling. The same
  // proof from every eye to every point of the glass itself (so a hull within the recess would be caught too): the glass is sampled edge to edge
  // (≤ 0.1 m apart, edges and corners included), and only the segments that pass through the OPENING count: any other is stopped by the wall
  // (the pane shader draws a reveal there), so it says nothing about what stands outside. A tube that crosses the alley right next to a window
  // (link-w beside atr-w1, link-n beside qua-s1…) is thus judged where it matters: past the opening, in the recess and beyond.
  if (!RECESS.found) note('WARN', 'recess', `windows.js: WALL_DEPTH / SHAFT_DEPTH not found, the defaults ${RECESS.wall} / ${RECESS.shaft} are used`);
  let glassRays = 0, gated = 0;
  const behindGlass = [];
  for (const w of ctx.windows) {
    const A = ctx.audit(w), pane = A.pane;
    const pts = glassPoints(pane, 0.1, w.kind === 'skylight' ? RECESS.shaft : RECESS.wall);
    for (const P of A.spots) for (const q of pts) {
      const o = [P.x, P.y, P.z];
      if (!throughOpening(pane, o, q)) { gated++; continue; }
      glassRays++;
      const bad = between(o, [q[0] - P.x, q[1] - P.y, q[2] - P.z]);
      if (bad) behindGlass.push({ w: w.id, P, ...bad });
    }
  }
  line(behindGlass.length === 0, `hull: ${glassRays.toLocaleString('en-US')} rays eye → GLASS through the opening (sunk ${RECESS.wall} m into the wall, ${RECESS.shaft} m over the ceiling; ${gated.toLocaleString('en-US')} more stop in the reveal): no hull in the recess either, with the real heights`,
    behindGlass.length ? `← ${[...new Set(behindGlass.map(b => `${b.w}:${b.id}.${b.face}`))].slice(0, 6).join(', ')} (e.g. from (${fmt(behindGlass[0].P.x)}, ${fmt(behindGlass[0].P.z)}))` : '');
}

// ── What a camera outside the room can see ────────────────────────────────────────────────────────────────
// The exterior is drawn from the player's own camera, so a pane seen THROUGH A DOOR from another room (or the vestibule) is seen by a camera
// that may stand outside the hull of the pane's own room, and a front face of a hull can then stand in front of it. Not part of the hard proof
// (the spec guarantees the room itself), but the windows integrator must know: this lists every such pair (WARN).
function crossRoom(ctx) {
  const spots = walkSpots(0.5), out = [];
  for (const w of ctx.windows) {
    const pane = paneOf(w), pts = panePoints(pane), who = new Map();
    let sees = 0;
    for (const P of spots) {
      if (roomAt(P.x, P.z) === w.room || !inFront(pane, P)) continue;
      let seen = 0, hit = null;
      for (const q of pts) {
        if (!lineOpen(P, q)) continue;
        seen++;
        const bad = between([P.x, P.y, P.z], [q[0] - P.x, q[1] - P.y, q[2] - P.z]);
        if (bad && !hit) hit = `${bad.id}.${bad.face}`;
      }
      if (!seen) continue;
      sees++;
      if (hit) {
        const k = `${roomAt(P.x, P.z) ?? 'vestibule'} → ${hit}`, e = who.get(k) ?? { n: 0, lo: [Infinity, Infinity], hi: [-Infinity, -Infinity] };
        e.n++; e.lo = [Math.min(e.lo[0], P.x), Math.min(e.lo[1], P.z)]; e.hi = [Math.max(e.hi[0], P.x), Math.max(e.hi[1], P.z)];
        who.set(k, e);
      }
    }
    out.push({ w, sees, who });
  }
  return out;
}

// ── The annex's plant: is the PROD plate in the glass, and is it legible? ────────────────────────────────────────────────────────────────────
// For a window and every spot of its room that looks at it properly: the share of a 9 × 4 grid of the lit plate (on the front of the plant) that the eye sees
// through the opening AND the sunk glass with nothing in the way (the first thing the ray meets beyond the glass is the plant's front, at that point). From
// the spots that frame at least half of it, how big a letter is on a 640 × 360 screen (a 60° horizontal field: f = 320 / tan 30° = 554 px; the visitor
// looks at the glass, so the depth is measured along that axis, and a plate seen at an angle is foreshortened across).
export const SCREEN_F = 320 / Math.tan(Math.PI / 6);
export function plateFraming(w, ctx) {
  const pane = paneOf(w), glassC = pane.c - pane.side * RECESS.wall, pl = PLANT.plate, grid = [];
  for (let i = 0; i < 9; i++) for (let j = 0; j < 4; j++) {
    const u = (i + 0.5) / 9, v = (j + 0.5) / 4;
    grid.push(PLANT.at((u - 0.5) * pl.w, pl.y0 + v * pl.h, PLANT.F));
  }
  const centre = PLANT.at(0, pl.y0 + pl.h / 2, PLANT.F), px = (pl.w - 0.16) / 17;
  const inside = (c, a) => c[a] >= pane.lo[a] - 1e-9 && c[a] <= pane.hi[a] + 1e-9;
  const out = { spots: [], total: 0, half: 0, whole: 0, some: 0, letter: [], pixel: [], from: [], over: { west: [], westZ: [], north: [] } };
  const wx = PLANT.b.x0 + 0.2, nz = PLANT.b.z0 + 0.2;        // the lines just inside the annex's west and north parapets: how high do the sight lines pass over them?
  for (const S of ctx.spots(w.room)) {
    const P = { x: S.x, z: S.z, y: eyeOf(S.x, S.z) };
    if (!inFront(pane, P)) continue;
    if (pane.outward !== null && Math.abs(angDiff(bearing(P.x, P.z, pane.centre[0], pane.centre[2]), pane.outward)) > RULES.maxOblique) continue;
    const o = [P.x, P.y, P.z];
    let seen = 0;
    for (const q of grid) {
      const dq = [q[0] - o[0], q[1] - o[1], q[2] - o[2]];
      const tw = (pane.c - o[pane.n]) / dq[pane.n], tg = (glassC - o[pane.n]) / dq[pane.n];
      if (!(tw > 0 && tw < 1 && tg > tw && tg < 1)) continue;
      const a = pane.n === 0 ? 2 : 0;
      const cw = [o[0] + dq[0] * tw, o[1] + dq[1] * tw, o[2] + dq[2] * tw], cg = [o[0] + dq[0] * tg, o[1] + dq[1] * tg, o[2] + dq[2] * tg];
      if (!inside(cw, a) || !inside(cw, 1) || !inside(cg, a) || !inside(cg, 1)) continue;
      const hit = beyond(o, [dq[0] * tg, dq[1] * tg, dq[2] * tg]);
      if (hit.id === PLANT.L.id && hit.face === 'front' && Math.hypot(hit.at[0] - q[0], hit.at[1] - q[1], hit.at[2] - q[2]) < 0.03) {
        seen++;
        const tx = (wx - o[0]) / dq[0], tz = (nz - o[2]) / dq[2];
        if (tx > 0 && tx < 1) { const z = o[2] + dq[2] * tx; if (z > PLANT.b.z0 && z < PLANT.b.z1) { out.over.west.push(o[1] + dq[1] * tx); out.over.westZ.push(z); } }
        if (tz > 0 && tz < 1) { const x = o[0] + dq[0] * tz; if (x > PLANT.b.x0 && x < PLANT.b.x1) out.over.north.push(o[1] + dq[1] * tz); }
      }
    }
    const f = seen / grid.length;
    out.total++;
    if (f > 0) out.some++;
    if (f >= 0.999) out.whole++;
    if (f >= 0.5) {
      out.half++;
      const dc = [pane.centre[0] - o[0], pane.centre[1] - o[1], pane.centre[2] - o[2]], lc = Math.hypot(...dc);
      const dp = [centre[0] - o[0], centre[1] - o[1], centre[2] - o[2]], ld = Math.hypot(...dp);
      const depth = (dp[0] * dc[0] + dp[1] * dc[1] + dp[2] * dc[2]) / lc, cosPhi = -(dp[0] * PLANT.n[0] + dp[2] * PLANT.n[1]) / ld;
      out.letter.push(5 * px * SCREEN_F / depth); out.pixel.push(px * SCREEN_F * cosPhi / depth); out.from.push(S);
    }
    out.spots.push({ P: S, f });
  }
  return out;
}

// ── The view table ───────────────────────────────────────────────────────────────────────────────────────
const pct = (n, tot) => `${Math.round((100 * n) / tot)}%`;
function classText(classes, total, max = 3) {
  const rows = [...classes].sort((a, b) => b[1].n - a[1].n).slice(0, max);
  return rows.map(([k, c]) => {
    const d = c.dmin === Infinity ? '' : k === 'horizon' ? '' : c.dmax - c.dmin < 0.15 ? ` ${fmt(c.dmin, 1)} m` : ` ${fmt(c.dmin, 1)}–${fmt(c.dmax, 1)} m`;
    return `${k} ${pct(c.n, total)}${d}`;
  }).join(' · ');
}
const hdgText = (a, b) => `${compass(a)}${Math.abs(angDiff(b, a)) < 4 ? '' : '…' + compass(b)} (${fmt(wrap360(a), 0)}°–${fmt(wrap360(b), 0)}°)`;
const BODY_SHORT = { earth: 'Earth', sun: 'Sun', giant: 'ringed giant', asteroids: 'asteroids' };
const bodyName = k => BODY_SHORT[k] ?? k;

// ── The sky above the roof line ──────────────────────────────────────────────────────────────────────────
// A vertical scan of the glass (its middle column, bottom to top) from one spot: what each stretch of it shows, as runs of the same class with
// their elevation range (degrees over the eye's horizon) and distance. A neighbour's wall fills the glass up to its roof line and the sky starts
// above it: `armurerie.E 1.0 m −3…38°, sky 38…52°`. Wall panes only.
const wallLabel = k => /\.(N|S|E|W)$/.test(k);
export function scanView(w, P, n = 40) {
  const pane = paneOf(w), o = [P.x, P.y, P.z], runs = [], y0 = pane.lo[1], y1 = pane.hi[1];
  for (let j = 0; j < n; j++) {
    const q = pane.centre.slice(); q[1] = y0 + ((j + 0.5) / n) * (y1 - y0);
    const d = [q[0] - o[0], q[1] - o[1], q[2] - o[2]], h = beyond(o, d), k = labelOf(h);
    const el = Math.atan2(d[1], Math.hypot(d[0], d[2])) * R2D, last = runs[runs.length - 1];
    if (last && last.k === k) { last.e1 = el; last.dmin = Math.min(last.dmin, h.dist); last.dmax = Math.max(last.dmax, h.dist); }
    else runs.push({ k, e0: el, e1: el, dmin: h.dist, dmax: h.dist });
  }
  return runs;
}
const runText = r => {
  const d = r.dmin === Infinity || r.k === 'sky' || r.k === 'horizon' ? '' : r.dmax - r.dmin < 0.15 ? ` ${fmt(r.dmin, 1)} m` : ` ${fmt(r.dmin, 1)}–${fmt(r.dmax, 1)} m`;
  return `${r.k}${d} ${fmt(r.e0, 0)}…${fmt(r.e1, 0)}°`;
};
// Over every spot that sees the glass properly: where the wall gives way to the sky (the roof line, in degrees over the eye) and how far up the
// glass reaches. { spots (that see a roof line), of (all), roof: [lo, median, hi], top: [lo, median, hi] }, or null when nothing shows a wall.
function roofLine(w, A) {
  if (w.kind === 'skylight') return null;
  const roof = [], top = [], sky = [], byHull = new Map();
  for (const P of A.viewed) {
    const runs = scanView(w, P, 24);
    const i = runs.findIndex((r, k) => r.k === 'sky' && k > 0 && wallLabel(runs[k - 1].k));
    if (i < 0) continue;
    roof.push(runs[i].e0); top.push(runs[runs.length - 1].e1); sky.push(runs[runs.length - 1].e1 - runs[i].e0);
    const id = runs[i - 1].k.split('.')[0], e = byHull.get(id) ?? byHull.set(id, []).get(id);
    e.push(runs[i].e0);
  }
  if (!roof.length) return null;
  const q = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
  return {
    spots: roof.length, of: A.viewed.length, roof: [q(roof, 0.05), q(roof, 0.5), q(roof, 0.95)], top: [q(top, 0.05), q(top, 0.5), q(top, 0.95)], sky: [q(sky, 0.1), q(sky, 0.5), q(sky, 0.9)],
    byHull: new Map([...byHull].map(([id, a]) => [id, { n: a.length, el: [q(a, 0.05), q(a, 0.5), q(a, 0.95)] }])),     // the roof line of each hull it is seen against
  };
}

// Where a visitor can stand to look at the window, three or four named spots, and what the glass shows from each.
function vantagesOf(w, A) {
  if (w.kind === 'skylight') return [[0, 0, 'under it'], [3, 0, 'from the south, 3 m'], [-3, 0, 'from the north, 3 m'], [0, 3, 'from the east, 3 m'], [0, -3, 'from the west, 3 m']].map(([dz, dx, label]) => {
    const t = { x: w.x + dx, z: w.z + dz }, P = A.viewed.reduce((a, s) => (Math.hypot(s.x - t.x, s.z - t.z) < Math.hypot(a.x - t.x, a.z - t.z) ? s : a));
    return { P, label };
  });
  const [fx, fz] = w.facing, tx = -fz, tz = fx, c = A.pane.centre, picks = [];
  for (const [dist, ang, label] of [[1.2, 0, 'close, head-on'], [3, 0, '3 m head-on'], [3, 35, '3 m, from the left'], [3, -35, '3 m, from the right'], [5.5, 0, '5.5 m head-on']]) {
    const a = ang * D2R, t = { x: c[0] + fx * dist * Math.cos(a) + tx * dist * Math.sin(a), z: c[2] + fz * dist * Math.cos(a) + tz * dist * Math.sin(a) };
    const P = A.viewed.reduce((best, s) => (!best || Math.hypot(s.x - t.x, s.z - t.z) < Math.hypot(best.x - t.x, best.z - t.z) ? s : best), null);
    if (!P || Math.hypot(P.x - t.x, P.z - t.z) > 0.7 || picks.some(p => p.P === P)) continue;
    picks.push({ P, label });
  }
  return picks;
}

function viewTable(ctx, results, print) {
  const { sky } = ctx;
  for (const r of results) {
    const w = r.w, A = r.facts.audit, tot = A.rayView, pane = A.pane;
    const xs = A.viewed.map(s => s.x), zs = A.viewed.map(s => s.z);
    const wall = w.kind === 'skylight' ? `ceiling over (${w.x}, ${w.z}), ${w.w} × ${w.d}` : `${frameOfWindow(w).n === 'x' ? 'x' : 'z'}=${frameOfWindow(w).plane} at ${frameOfWindow(w).s}, ${w.w} × ${w.h}, sill ${w.sill}`;
    const face = w.kind === 'skylight' ? 'looks UP' : `looks ${compass(outwardOf(w))} (${fmt(outwardOf(w), 0)}°)`;
    print(`${w.id.padEnd(8)} ${w.room.padEnd(9)} ${face} — ${wall}`);
    print(`           stands: ${A.viewed.length} spots, x ${fmt(Math.min(...xs))}–${fmt(Math.max(...xs))}, z ${fmt(Math.min(...zs))}–${fmt(Math.max(...zs))}`
      + `${w.kind === 'skylight' ? '' : `; sees heading ${hdgText(outwardOf(w) + A.off[0], outwardOf(w) + A.off[1])}`}; elevation ${fmt(A.el[0], 0)}° … ${fmt(A.el[1], 0)}°`);
    print(`           shows : ${classText(A.classes, tot, 5)}${A.share.stare >= RULES.stareShare ? '   [STARES at a wall]' : ''}`);
    const PF = w.kind === 'wall' && w.room !== 'prod' ? ctx.plate(w) : null;
    if (PF && PF.some >= 0.02 * PF.total && PF.some > 0) {
      const lt = [...PF.letter].sort((a, b) => a - b);
      print(`           plant : the PROD plate on the annex's roof plant is in the glass: some of it from ${pct(PF.some, PF.total)} of the spots, at least half of it from ${pct(PF.half, PF.total)}, all of it from ${pct(PF.whole, PF.total)}`
        + `${lt.length ? `; a letter is ${fmt(lt[0], 0)}–${fmt(lt[lt.length - 1], 0)} px tall at 640 × 360 (from x ${fmt(Math.min(...PF.from.map(s => s.x)))}–${fmt(Math.max(...PF.from.map(s => s.x)))}, z ${fmt(Math.min(...PF.from.map(s => s.z)))}–${fmt(Math.max(...PF.from.map(s => s.z)))})` : ''}`);
    }
    const seen = Object.entries(A.bodies).filter(([, b]) => b.spots >= 5).sort((a, b) => b[1].spots - a[1].spots);
    const mains = seen.filter(([k]) => sky.bodies[k].main), others = seen.filter(([k]) => !sky.bodies[k].main);
    print(`           sky   : ${mains.map(([k, b]) => `${bodyName(k)} from ${b.spots} spots (${b.half} well${sky.bodies[k].discs.length === 1 ? `, never more than ${Math.round(100 * b.best)}% of its disc` : ''}) at ${fmt(b.dmin, 1)}–${fmt(b.dmax, 1)} m`).join('; ') || 'no main body'}`
      + `${others.length ? ` | also ${others.map(([k, b]) => `${k} ${b.spots}`).join(', ')}` : ''}`);
    // where to stand to see each hull the glass shows: the spot that fills most of the glass with it (for every hull wall at ≥ 8 % overall)
    const wallsSeen = [...A.classes].filter(([k, c]) => wallLabel(k) && c.n / tot >= 0.08).sort((a, b) => b[1].n - a[1].n);
    for (const [k] of wallsSeen) {
      const b = A.best[k];
      if (b) print(`           best  : ${k} fills ${Math.round(100 * b.n / (A.pane.n === 1 ? 15 : 20))}% of the glass from (${fmt(b.P.x)}, ${fmt(b.P.z)}): ${scanView(w, b.P).map(runText).join(' | ')}`);
    }
    const RL = roofLine(w, A);
    if (RL) print(`           roof  : the wall gives way to sky at el ${fmt(RL.roof[1], 0)}° (${fmt(RL.roof[0], 0)}…${fmt(RL.roof[2], 0)}° over the ${RL.spots} of ${RL.of} spots that see a roof line); the glass tops out at ${fmt(RL.top[1], 0)}° (${fmt(RL.top[0], 0)}…${fmt(RL.top[2], 0)}°): `
      + `SKY ABOVE THE ROOF LINE ${fmt(RL.sky[1], 0)}° (${fmt(RL.sky[0], 0)}…${fmt(RL.sky[2], 0)}°: 80 % of those spots)`);
    for (const v of vantagesOf(w, A)) {
      const V = viewFrom(w, v.P, sky);
      const bs = Object.entries(V.bodies).sort((a, b) => Math.max(b[1].cover, b[1].fill) - Math.max(a[1].cover, a[1].fill)).slice(0, 3).map(([k, b]) => `${bodyName(k)} ${Math.round(100 * Math.max(b.cover, b.fill))}%`);
      const scan = w.kind === 'skylight' ? classText(V.classes, V.n, 3) : scanView(w, v.P).map(runText).join(' | ');
      print(`             · (${fmt(v.P.x)}, ${fmt(v.P.z)}) ${v.label}: ${scan}${bs.length ? `  + ${bs.join(', ')}` : ''}  [el ${fmt(V.el[0], 0)}…${fmt(V.el[1], 0)}°]`);
    }
    if (w.dress) print(`           dress : ${w.dress}`);
    if (w.kind === 'skylight') {
      const q = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
      print(`           cone  : what the glass can show above the tower (80 % of the rays): ${SKY_HEIGHTS.map(H => {
        const c = A.cone[H] ?? [];
        return `y ${H}: x ${fmt(q(c.map(p => p[0]), 0.1), 0)}–${fmt(q(c.map(p => p[0]), 0.9), 0)}, z ${fmt(q(c.map(p => p[1]), 0.1), 0)}–${fmt(q(c.map(p => p[1]), 0.9), 0)}`;
      }).join(' | ')}; a mast taller than 3 m near the skylight crosses the glass`);
    }
  }
}

// ── Notes for the dressers ───────────────────────────────────────────────────────────────────────────────
// For the exterior builder and the props dresser, from the same rays as the view table. Where a face is looked at, how much, from how far, and
// the box of its hits: `core` holds 80 % of them (10–90 %), `whole` all of them. A hull face is described in world metres: W/E faces lie on
// x = const (along z), N/S faces on z = const (along x); the face runs from the plain (GROUND_Y) up to the parapet (the block's roofY): NOTHING
// that belongs to a face (a ladder, a pipe, a lamp, a tray) may rise above its parapet by more than 0.1 m.
const faceOf = w => (w.facing[0] === 1 ? 'W' : w.facing[0] === -1 ? 'E' : w.facing[1] === 1 ? 'N' : 'S');   // the hull face a wall pane lies on
const quant = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
const range = (lo, hi, n = 2) => `${fmt(lo, n)}–${fmt(hi, n)}`;
function boxText(face, lo, hi) {            // the box of a face zone: 'z 14.40–15.80  y 0.40–1.50'
  const along = face === 'W' || face === 'E' ? 2 : 0;
  return `${'xyz'[along]} ${range(lo[along], hi[along])}  y ${range(lo[1], hi[1])}`;
}
// Where a 1 m prop (a rock, a cairn, a mast stub) standing on the plain is seen through a window: for every ground cell of a 3 m fan that opens from the
// glass (5–40 m out), the share of the spots that see the window properly from which the ray eye → prop passes through the OPENING and meets no hull
// before the prop. The best cells (≥ 10 % of the spots: a far prop is seen through a window only from the strip of the room that lines up with it, so a share is never high; at least 8 m apart) are where the props dresser should put what the window is to frame.
function landmarkSpots(w, A, step = 3) {
  const pane = A.pane, spots = A.viewed;
  if (!spots.length || pane.outward === null) return [];
  const r = pane.outward * D2R, fx = Math.cos(r), fz = Math.sin(r), cells = [];
  for (let out = 5; out <= 40; out += step) for (let side = -out; side <= out; side += step) {
    const q = [pane.centre[0] + fx * out - fz * side, GROUND_Y + 0.5, pane.centre[2] + fz * out + fx * side];
    let seen = 0;
    for (const P of spots) {
      const o = [P.x, P.y, P.z];
      if (!throughOpening(pane, o, q)) continue;
      const d = [q[0] - o[0], q[1] - o[1], q[2] - o[2]], tp = (pane.c - o[pane.n]) / d[pane.n];
      let blocked = false;
      for (const s of SOLIDS) {
        const h = slab(o, d, s);
        if (h && h.t0 >= tp - EPS && h.t0 < 1 - EPS && h.t1 - h.t0 > EPS) { blocked = true; break; }
      }
      if (!blocked) seen++;
    }
    if (seen / spots.length >= 0.1) cells.push({ x: q[0], z: q[2], out, share: seen / spots.length });
  }
  cells.sort((a, b) => b.share - a.share);
  const picked = [];
  for (const c of cells) if (picked.length < 3 && picked.every(p => Math.hypot(p.x - c.x, p.z - c.z) >= 8)) picked.push(c);
  return picked;
}

function dressNotes(ctx, results, print) {
  const { sky } = ctx;
  const planeOf = (b, face) => ({ W: `x = ${b.x0}`, E: `x = ${b.x1}`, N: `z = ${b.z0}`, S: `z = ${b.z1}` })[face];
  const lengthOf = (b, face) => (face === 'W' || face === 'E' ? `z ${b.z0}–${b.z1}` : `x ${b.x0}–${b.x1}`);
  const hulls = [...BLOCKS, ...LINKS];
  const zones = new Map();      // `${hull}.${face}` → { windows: Map id → { share, dmin, dmax }, pts }
  for (const r of results) {
    const A = r.facts.audit;
    for (const [key, z] of A.zones) {
      if (key.startsWith('ground')) continue;
      const e = zones.get(key) ?? { from: new Map(), pts: [], lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] };
      e.from.set(r.w.id, { share: z.n / A.rayView, n: z.n, dmin: z.dmin, pts: z.pts, lo: z.lo, hi: z.hi });
      e.pts.push(...z.pts);
      for (let a = 0; a < 3; a++) { e.lo[a] = Math.min(e.lo[a], z.lo[a]); e.hi[a] = Math.max(e.hi[a], z.hi[a]); }
      zones.set(key, e);
    }
  }
  const lit = new Map();        // `${hull}.${face}` → the panes that lie on that face, as lit glass
  for (const w of ctx.windows) {
    const pane = paneOf(w), b = ROOM_BLOCK[w.room];
    if (w.kind === 'skylight') { lit.set(`${b}.roof`, [{ id: w.id, text: `x ${range(pane.lo[0], pane.hi[0])}  z ${range(pane.lo[2], pane.hi[2])}  (the opening in the roof slab: ceiling ${fmt(pane.c)}, the glass ${fmt(RECESS.shaft)} m over it; from outside a flat lit pane ON the roof at y ${block(ROOM_BLOCK[w.room]).roofY}, facing up; nothing stands over it below y ${SKYLIGHT.clearY})` }]); continue; }
    const key = `${b}.${faceOf(w)}`, a = pane.n === 0 ? 2 : 0;
    (lit.get(key) ?? lit.set(key, []).get(key)).push({ id: w.id, text: `${'xyz'[a]} ${range(pane.lo[a], pane.hi[a])}  y ${range(pane.lo[1], pane.hi[1])}` });
  }

  const roofs = new Map(results.map(r => [r.w.id, roofLine(r.w, r.facts.audit)]));
  print('A. BY HULL FACE (the dresser\'s sheet): lit glass of the windows ON the face, and what the panes of OTHER windows see of it');
  print('   world metres; a face runs from the plain (y ' + GROUND_Y + ') up to its parapet; seen-by shares are of each window\'s glass (80 % of the visitors), core = 10–90 % of the hits');
  for (const b of hulls) {
    print(`   ${b.id.toUpperCase().padEnd(10)} ${b.link ? 'tube' : 'hull'}  x ${b.x0}–${b.x1}  z ${b.z0}–${b.z1}  plain ${GROUND_Y} → roof ${b.roofY}  (${b.note})`);
    for (const face of ['N', 'E', 'S', 'W', 'roof']) {
      const key = `${b.id}.${face}`, L = lit.get(key) ?? [], Z = zones.get(key);
      const seen = Z ? [...Z.from].filter(([, f]) => f.share >= 0.03).sort((p, q) => q[1].share - p[1].share) : [];
      if (!L.length && !seen.length) continue;
      print(`      ${face === 'roof' ? 'ROOF' : `${face} face`}  ${face === 'roof' ? `x ${b.x0}–${b.x1}, z ${b.z0}–${b.z1}, y ${b.roofY}` : `${planeOf(b, face)}, ${lengthOf(b, face)}, y ${GROUND_Y}…${b.roofY}`}`);
      for (const l of L) print(`         lit glass : ${l.id.padEnd(8)} ${l.text}`);
      if (seen.length) {
        const core = [0, 1, 2].map(a => [quant(Z.pts.map(p => p[a]), 0.1), quant(Z.pts.map(p => p[a]), 0.9)]);
        for (const [id, f] of seen) {
          const c = [0, 1, 2].map(a => [quant(f.pts.map(p => p[a]), 0.1), quant(f.pts.map(p => p[a]), 0.9)]);
          print(`         seen by   : ${id.padEnd(8)} ${String(Math.round(100 * f.share)).padStart(3)} % of its glass from ${fmt(f.dmin, 1)} m   hits ${face === 'roof' ? `x ${range(c[0][0], c[0][1])} z ${range(c[2][0], c[2][1])}` : boxText(face, c.map(p => p[0]), c.map(p => p[1]))}   ${face === 'roof' ? '' : `(whole ${boxText(face, f.lo, f.hi)})`}`);
        }
        print(`         all views : core ${face === 'roof' ? `x ${range(core[0][0], core[0][1])} z ${range(core[2][0], core[2][1])}` : boxText(face, core.map(p => p[0]), core.map(p => p[1]))}   ${face === 'roof' ? '' : `whole ${boxText(face, Z.lo, Z.hi)}   `}highest point seen y ${fmt(Z.hi[1])} of ${b.roofY}`);
      }
    }
    // the roof edge as a line against the sky: a rooftop prop shows over the parapet when its top is over roofY + s × tan(el), s m behind the edge
    const edges = results.map(r => [r.w.id, roofs.get(r.w.id)?.byHull.get(b.id)]).filter(([id, e]) => e && e.n >= Math.max(5, 0.05 * roofs.get(id).of));
    if (edges.length) print(`      ROOF EDGE  y ${b.roofY}: a line against the sky from ${edges.map(([id, e]) => `${id} at el ${fmt(e.el[1], 0)}° (${fmt(e.el[0], 0)}…${fmt(e.el[2], 0)}°)`).join(', ')}; a prop s m behind the edge is seen over the parapet when its top is higher than ${b.roofY} + s × tan(el) (e.g. at el 12°: +0.21 m per metre)`);
  }

  print('\nB. BY WINDOW: what each glass stares at (shares of its glass over the visitors who see it properly), and the sky above the roof line');
  for (const r of results) {
    const w = r.w, A = r.facts.audit, tot = A.rayView;
    if (w.kind === 'skylight') { print(`   ${w.id.padEnd(8)} skylight: looks UP; see the VIEW TABLE: the tower's own drum, dome and masts (rise over y ${block('atrium').roofY}) cross the glass; keep the SKYLIGHT footprint clear below y ${SKYLIGHT.clearY}`); continue; }
    const out = outwardOf(w), pane = A.pane, a = pane.n === 0 ? 2 : 0;
    print(`   ${w.id.padEnd(8)} ${w.room.padEnd(9)} looks ${compass(out)} from the ${faceOf(w)} face of ${ROOM_BLOCK[w.room]}: glass ${'xyz'[a]} ${range(pane.lo[a], pane.hi[a])}  y ${range(pane.lo[1], pane.hi[1])}  at ${'xz'[pane.n === 0 ? 0 : 1]} ${fmt(pane.c)}`);
    const zs = [...A.zones].filter(([k, z]) => !k.startsWith('ground') && z.n / tot >= 0.04).sort((p, q) => q[1].n - p[1].n);
    for (const [key, z] of zs) {
      const face = key.split('.')[1], c = [0, 1, 2].map(ax => [quant(z.pts.map(p => p[ax]), 0.1), quant(z.pts.map(p => p[ax]), 0.9)]);
      const hull = hulls.find(h => h.id === key.split('.')[0]);
      if (!hull) {          // a landmark that stands on a roof (the annex's plant): see section D
        print(`      → ${key.padEnd(13)} ${String(Math.round(100 * z.n / tot)).padStart(3)} % of the glass, ${fmt(z.dmin, 1)} m and more away: the ${key.split('.')[0]} on a roof, hits x ${range(c[0][0], c[0][1])} z ${range(c[2][0], c[2][1])} y ${range(c[1][0], c[1][1])}  (section D)`);
        continue;
      }
      print(`      → ${key.padEnd(13)} ${String(Math.round(100 * z.n / tot)).padStart(3)} % of the glass, ${fmt(z.dmin, 1)} m and more away: wall ${planeOf(hull, face) ?? ''}  hits ${face === 'roof' ? `x ${range(c[0][0], c[0][1])} z ${range(c[2][0], c[2][1])}` : boxText(face, c.map(p => p[0]), c.map(p => p[1]))}   ${face === 'roof' ? '' : `(whole ${boxText(face, z.lo, z.hi)})`}`);
    }
    const g = A.classes.get('ground'), skyN = A.classes.get('sky')?.n ?? 0, hz = A.classes.get('horizon')?.n ?? 0;
    print(`      → plain ${g ? `${Math.round(100 * g.n / tot)} %, ${fmt(g.dmin, 1)}–${fmt(g.dmax, 0)} m` : '0 %'} · horizon ${Math.round(100 * hz / tot)} % · sky ${Math.round(100 * skyN / tot)} %`
      + `${Object.entries(A.bodies).filter(([, b]) => b.spots >= SEEN_MIN).sort((p, q) => q[1].spots - p[1].spots).slice(0, 4).map(([k]) => k).join(', ') ? ` · bodies: ${Object.entries(A.bodies).filter(([, b]) => b.spots >= SEEN_MIN).sort((p, q) => q[1].spots - p[1].spots).slice(0, 4).map(([k]) => bodyName(k)).join(', ')}` : ''}`);
    // the open ground a window frames: where a 1 m prop on the plain shows through this glass, for the props dresser (see landmarkSpots)
    if (A.share.ground + A.share.horizon >= 0.1) {
      const L = landmarkSpots(w, A);
      if (L.length) print(`      → landmarks: a 1 m prop on the plain shows through this glass, at (x, z), from this share of the standing spots (the strip of the room that lines up with it): ${L.map(l => `(${fmt(l.x, 0)}, ${fmt(l.z, 0)}) ${fmt(l.out, 0)} m out ${Math.round(100 * l.share)} %`).join(' · ')}`
        + ` (open ground and horizon fill ${Math.round(100 * (A.share.ground + A.share.horizon))} % of the pane; the ground within ${PLAIN_FOCUS} m is ${Math.round(100 * A.groundPts.length / tot)} % of it${g ? `, nearest ${fmt(g.dmin, 1)} m from the glass` : ''})`);
    }
    const RL = roofLine(w, A);
    if (RL && RL.spots >= 0.1 * RL.of) print(`      → the wall gives way to sky at el ${fmt(RL.roof[1], 0)}° (${fmt(RL.roof[0], 0)}…${fmt(RL.roof[2], 0)}°) over the eye: sky above the roof line ${fmt(RL.sky[1], 0)}° (${fmt(RL.sky[0], 0)}…${fmt(RL.sky[2], 0)}°)`);
    if (w.dress) print(`      → dress: ${w.dress}`);
  }

  print('\nD. THE PROD ANNEX: its ROOF PLANT (windowSlots.js LANDMARKS.annexPlant; the annex\'s walls are seen from no wing, so the plant is what announces it)');
  {
    const L = PLANT.L, b = PLANT.b, pl = L.plate, q = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
    const fp = [[-L.w / 2, -L.d / 2], [L.w / 2, -L.d / 2], [-L.w / 2, L.d / 2], [L.w / 2, L.d / 2]].map(([u, o]) => PLANT.at(u, 0, o));
    print(`   a bulkhead ${fmt(L.w)} × ${fmt(L.d)} × ${fmt(L.h)} m on the ${L.host} roof (y ${b.roofY} → ${fmt(PLANT.y1)}), centre (${L.x}, ${L.z}), footprint x ${range(Math.min(...fp.map(p => p[0])), Math.max(...fp.map(p => p[0])))} z ${range(Math.min(...fp.map(p => p[2])), Math.max(...fp.map(p => p[2])))}, `
      + `its FRONT face looks ${compass(L.heading)} (${L.heading}°), toward the middle of the Armurerie; on that face: the red hazard door at the foot (y ${b.roofY}–${fmt(b.roofY + 0.62)}), the lit PROD plate ${fmt(pl.w)} × ${fmt(pl.h)} at y ${fmt(pl.y0)}–${fmt(pl.y0 + pl.h)}, a red lamp on a mast over the cap`);
    for (const r of results.filter(r => r.w.kind === 'wall' && r.w.room !== 'prod')) {
      const F = ctx.plate(r.w);
      if (!F.some) continue;
      print(`   framed by ${r.w.id}: at least half of the plate from ${F.half} of ${F.total} spots (${Math.round(100 * F.half / F.total)} %), all of it from ${F.whole}${F.over.west.length ? `; the sight lines of the half-framing spots pass over the annex's west parapet line (x ${fmt(PLANT.b.x0 + 0.2)}) at z ${fmt(q(F.over.westZ, 0.02))}–${fmt(q(F.over.westZ, 0.98))}, y ${fmt(q(F.over.west, 0.02))}–${fmt(q(F.over.west, 0.98))}` : ''}`);
    }
    const lowest = Math.min(...results.filter(r => r.w.kind === 'wall' && r.w.room !== 'prod').map(r => ctx.plate(r.w)).filter(F => F.over.west.length).map(F => q(F.over.west, 0.02)));
    print(`   KEEP CLEAR: nothing on the annex roof may stand between the plate and the Armurerie's south ribbon: the sight lines pass over the parapet (${fmt(b.roofY + 0.12)}) at ${fmt(lowest)} m and more, so no other roof object of the annex's west part (x ${b.x0}–${fmt(L.x + 1, 1)}, z 19–22) may rise over ${fmt(lowest - 0.05)} m; no second sign, mast or antenna beside the plate`);
  }

  print('\nC. KEEP NEUTRAL (the secret) and the height rule');
  const annexN = zones.get('annex.N'), publicSeen = annexN ? [...annexN.from].filter(([id]) => id !== 'prod-p1') : [];
  print(`   the alley segment x ${RULES.secret[0]}–${RULES.secret[1]}, z 16–18 (behind the push-wall) and the annex's north-face door (x 12–13, z 18): un-dressed, plain wall, no light, no hatch, no stencil. `
    + `${publicSeen.length ? `Public windows see annex.N ${publicSeen.map(([id, f]) => `from ${id} at x ${range(Math.min(...f.pts.map(p => p[0])), Math.max(...f.pts.map(p => p[0])))}`).join(', ')} (proved to stay clear of the door)` : 'No public window sees annex.N.'}`);
  print('   prod-p1 (the secret room) sees the atrium\'s south face including the push-wall (x 12–13, z 16): the rusty service hatch of its dress note is fine there.');
  print('   parapets (the highest a prop of a FACE may stand, +0.1 m at most for a ladder): ' + hulls.map(b => `${b.id} ${b.roofY}`).join(', ') + '; rooftop objects (masts, antennas, dishes, vents) stand ON a roof and are not bound by these.');
}

function proofs() {
  let failed = 0;
  const line = (ok, label, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`); return ok; };
  const note = (kind, label, detail = '') => console.log(`${kind.padEnd(4)}  ${label}${detail ? '  ' + detail : ''}`);

  const windows = [...WINDOWS];
  const ctx = makeContext(windows);
  const { model, ceiling, runs, sky } = ctx;

  console.log('── Mirror guards (constants read from the decor sources) ──');
  for (const g of guards) line(g.ok, g.label, g.detail);

  console.log(`\n── The sky (${sky.source}) ──`);
  const want = { earth: [90, 15], sun: [30, 15], giant: [270, 20], asteroids: [204, 40] };      // heading and tolerance of the SPEC
  for (const id of MAIN_BODIES) {
    const b = sky.bodies[id], [h, tol] = want[id], ok = Math.abs(angDiff(b.az, h)) <= tol;
    const text = `${id}: heading ${fmt(b.az, 0)}° (${compass(b.az)}), elevation ${fmt(b.el, 1)}°, radius ${fmt(b.radius, 1)}°`;
    if (sky.v2) line(ok, `sky: ${text}`, ok ? '' : `← the layout assumes ${h}° ±${tol}°`);
    else note('WARN', `sky: ${text}`, `(SPEC value; sky.js is not repainted yet, it must put the ${id} at ${h}° ±${tol}°)`);
  }
  for (const n of sky.notes) note('WARN', 'sky', n);
  note('INFO', 'sky', `also: ${Object.values(sky.bodies).filter(b => !b.main).map(b => `${b.id} ${fmt(b.az, 0)}°/${fmt(b.el, 0)}°`).join(', ') || 'nothing else listed'}`);

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
    struct: 'well-formed (ids, rooms, facing, sizes; no skyYaw: one sky for the whole world)',
    'wall-face': 'on a real wall face of its own room, facing INTO the room (the skylight: wholly over the atrium)',
    margin: '≥ 0.3 m from every door opening and room corner (the push-wall is a door)',
    height: 'sill ≥ 0.2 m above the floor, head ≥ 0.12 m under the ceiling',
    gap: '≥ 0.3 m between neighbours on a wall',
    overlap: 'overlaps or hides nothing (consoles, doors and signage, frames, plinths, racks, props, sprites, notes, PROD hook, dashboard, lounge, PROD dressing, lit panels, hub) and no darkened wall',
    cone: 'keeps the reading cones of the wall notes free',
    footprint: 'the skylight lies inside the exterior\'s SKYLIGHT footprint',
    hull: 'NOTHING OF THE EXTERIOR between any eye of the room and any point of the glass (every segment through the opening, with the real hull heights: hulls and tubes are entered only beyond it)',
    stare: 'a window that mostly shows a wall within 2.6 m has a `dress` note for the props dresser',
    worth: 'every window shows something (a sky body, the outside of the building, the plain)',
  };
  for (const [rule, text] of Object.entries(RULE_TEXT)) {
    const failing = results.filter(r => r.checks.some(c => c.rule === rule && !c.ok)).map(r => r.w.id);
    line(failing.length === 0, `${rule}: ${text}`, failing.length ? `← ${failing.join(', ')}` : '');
  }

  // per room: 2–4 windows (the atrium counts its skylight), PROD = 1
  const rooms = Object.keys(ROOM_TYPE);
  for (const room of rooms) {
    const n = results.filter(r => r.w.room === room).length;
    if (room === 'prod') line(n === 1, `count: ${room} has exactly one window (a secret: flagged below)`, `${n}`);
    else line(n >= 2 && n <= 4, `count: ${room} has 2–4 windows`, `${n}${room === 'atrium' ? ' (incl. the skylight)' : ''}`);
  }
  line(windows.filter(w => w.kind === 'skylight').length === 1, 'atrium has exactly one skylight');
  const wallsOnly = windows.filter(w => w.room !== 'prod' && w.kind === 'wall');
  const sizes = new Set(wallsOnly.map(w => `${w.w}x${w.h}`));
  line(sizes.size >= wallsOnly.length - 1, 'rhythm: sizes vary (no two windows alike but at most one pair)', `${sizes.size} sizes in ${wallsOnly.length} windows`);
  line(!windows.some(w => w.room === 'atrium' && w.kind === 'wall' && frameOfWindow(w).n === 'z' && Math.abs(frameOfWindow(w).plane - PUSH_WALL.my) < EPS),
    `secret: no window is cut in the atrium's south wall (z = ${PUSH_WALL.my}), the wall of the push-wall`);

  // ── sky coverage ────────────────────────────────────────────────────────────────────────────────
  console.log('\n── Which way the windows look, and which sky they show ──');
  const outward = r => outwardOf(r.w);
  const dirs = { N: 270, E: 0, S: 90, W: 180 };
  for (const [name, h] of Object.entries(dirs)) {
    const ws = results.filter(r => r.w.kind === 'wall' && r.w.room !== 'prod' && Math.abs(angDiff(outward(r), h)) < 1).map(r => r.w.id);
    line(ws.length >= 2, `cardinal: ${name} is served by at least two windows`, ws.join(', '));
  }
  const seeing = role => results.map(r => [r.w, r.facts.audit.bodies[role]]).filter(([, b]) => b && b.spots >= SEEN_MIN).sort((a, b) => b[1].spots - a[1].spots);
  const list = role => seeing(role).map(([w, b]) => `${w.id} ${b.spots} spots (${b.half} well, ${fmt(b.dmin, 1)}–${fmt(b.dmax, 1)} m)`).join('; ');
  const earth = sky.bodies.earth;
  const earthSeers = seeing('earth');
  line(earthSeers.length >= 2, 'sky: the Earth is seen through at least two windows', list('earth') || '← none');
  line(earthSeers.every(([w]) => Math.abs(angDiff(outwardOf(w) ?? earth.az, earth.az)) <= 75),
    `sky: … and only through windows that face its side (outward within 75° of ${fmt(earth.az, 0)}° ${compass(earth.az)})`, earthSeers.map(([w]) => `${w.id} ${compass(outwardOf(w) ?? earth.az)}`).join(', '));
  // A ribbon that is filled with the Earth is not a view of the Earth: it must frame the disc (the limb, the terminator), not a slice of it.
  const discOf = ([w, b]) => `${w.id} ${Math.round(100 * b.best)}%`;
  line(earthSeers.some(([, b]) => b.best >= 0.4), 'sky: the Earth shows as a disc somewhere: some window frames at least 40 % of it from some spot (a ribbon filled with a slice of it does not count)',
    earthSeers.map(discOf).join(', ') || '← none');
  for (const [w, b] of earthSeers) if (b.best < 0.3) note('WARN', `Earth through ${w.id}`, `never frames more than ${Math.round(100 * b.best)} % of the disc: the glass is a band of Earth (clouds, ocean), without limb or terminator`);
  const anyEarth = results.filter(r => (r.facts.audit.bodies.earth?.spots ?? 0) > 0).map(r => r.w.id);
  line(anyEarth.length <= Math.floor(windows.length / 2), 'sky: the Earth shows through fewer than half of the windows (it was through every one of them in version 1)', `${anyEarth.length} of ${windows.length}: ${anyEarth.join(', ')}`);
  line(!results.some(r => r.w.kind === 'wall' && Math.abs(angDiff(outward(r), earth.az)) > 100 && (r.facts.audit.bodies.earth?.best ?? 0) > 0.02),
    'sky: no window that faces away from the Earth shows any of it (north, east and west windows never do)');
  for (const role of ['sun', 'giant', 'asteroids']) {
    const b = sky.bodies[role];
    line(seeing(role).length >= 2, `sky: the ${bodyName(role)} (${compass(b.az)}) is seen through at least two windows`, list(role) || '← none');
  }
  note('INFO', 'jokes and company', Object.values(sky.bodies).filter(b => !b.main && b.radius >= 1).map(b => {
    const ws = results.filter(r => (r.facts.audit.bodies[b.id]?.spots ?? 0) >= 3).map(r => `${r.w.id}(${r.facts.audit.bodies[b.id].spots})`);
    return `${b.id} [${b.kind}, ${fmt(b.az, 0)}° ${compass(b.az)}, el ${fmt(b.el, 0)}°]: ${ws.join(' ') || 'no window'}`;
  }).join('  |  '));

  // ── the outside of the building ─────────────────────────────────────────────────────────────────
  const lookers = results.filter(r => r.facts.audit && (r.facts.audit.share.hull >= 0.25 || r.facts.audit.nearHull >= 0.5)).map(r => r.w.id);
  line(lookers.length >= 3, 'outside: at least three windows look at the outside of the building (a wall, a roof or a tube for a quarter of their pane, or for half of it from a spot within 3 m)',
    results.filter(r => lookers.includes(r.w.id)).map(r => `${r.w.id} (${fmt(r.facts.audit.share.hull * 100, 0)} % overall, ${fmt(r.facts.audit.nearHull * 100, 0)} % from the best spot ≤ 3 m)`).join('; '));
  const publicLookers = lookers.filter(id => results.find(r => r.w.id === id)?.w.room !== 'prod');
  if (publicLookers.length < 3) note('WARN', 'outside', `only ${publicLookers.length} windows a visitor reaches without finding the secret look at the building (${publicLookers.join(', ')}): the third of the three above is the PROD porthole`);
  const guitar = results.find(r => r.w.id === 'qua-s1');
  line(!!guitar && guitar.facts.audit.share.wall >= 0.2, 'outside: the Quartiers window by the guitar and amp (qua-s1) looks at the building: the atrium tower\'s north wall',
    guitar ? `${fmt(guitar.facts.audit.share.wall * 100, 0)} % of its pane is a wall: ${classText(guitar.facts.audit.classes, guitar.facts.audit.rayView, 3)}` : 'qua-s1 missing');
  // "The window to the right of the guitar and its amp" is ambiguous: facing the east wall where they stand, the glass on its right is qua-e1 (the
  // same wall, south of the amp); the south-east corner's window, qua-s1, is the one on the right of them as the lounge is entered. Both must show the building.
  const guitarE = results.find(r => r.w.id === 'qua-e1');
  line(!!guitarE && guitarE.facts.audit.share.wall >= 0.2, 'outside: the Quartiers window on the east wall, right of the guitar and amp (qua-e1), looks at the building too: the Trophées\' north wall',
    guitarE ? `${fmt(guitarE.facts.audit.share.wall * 100, 0)} % of its pane is a wall: ${classText(guitarE.facts.audit.classes, guitarE.facts.audit.rayView, 3)}` : 'qua-e1 missing');

  // ── version 3: the neighbours read as BUILDINGS ─────────────────────────────────────────────────
  // Every hull is seen from outside through some window of the base, not only the one next to the visitor: the Armurerie from the atrium's west
  // window, the Trophées from its east one, the Quartiers from the atrium's north window and from the Armurerie's, the annex's north wall from the
  // Armurerie's east slit (a glimpse: its roof is 1.2, above the eyes of the wings, 0.3 m; what announces it is its roof plant, proved below).
  const wallShare = (r, id) => [...r.facts.audit.classes].filter(([k]) => k.startsWith(`${id}.`) && wallLabel(k)).reduce((a, [, c]) => a + c.n, 0) / r.facts.audit.rayView;
  const walls = results.filter(r => r.w.kind === 'wall');
  for (const [id, min] of [['armurerie', 2], ['trophees', 2], ['quartiers', 2], ['atrium', 3], ['annex', 1]]) {
    const seen = walls.filter(r => wallShare(r, id) >= RULES.seesHull), pub = seen.filter(r => r.w.room !== 'prod');
    line(seen.length >= min && pub.length >= 1, `base: the ${id} hull is seen from outside through at least ${min} window${min > 1 ? 's' : ''}, one of a public room (≥ ${Math.round(RULES.seesHull * 100)} % of the pane shows its walls)`,
      seen.map(r => `${r.w.id} ${fmt(100 * wallShare(r, id), 0)} %`).join(', ') || '← none');
  }
  for (const [wid, id, min, what] of [['atr-w1', 'armurerie', 0.4, 'the atrium\'s left window shows the Armurerie (Capacités)'], ['atr-e1', 'trophees', 0.4, 'the atrium\'s right window shows the Trophées (Succès)'],
    ['atr-n1', 'quartiers', 0.2, 'the atrium\'s north window shows the Quartiers'], ['arm-e1', 'annex', 0.1, 'the Armurerie\'s east slit keeps a glimpse of the PROD annex\'s north wall (a slit 50–75° off its axis)']]) {
    const r = results.find(q => q.w.id === wid);
    line(!!r && wallShare(r, id) >= min, `owner: ${what} (≥ ${Math.round(min * 100)} % of its pane)`, r ? `${wid}: ${fmt(100 * wallShare(r, id), 0)} % ${id}` : `${wid} missing`);
  }
  // A window that frames a neighbour's wall frames a slice of sky above its roof line when the room allows it: the three of the atrium do (the
  // hall is 2.0 high, its panes reach 1.85, over every wing's parapet but the Trophées', which the near half of the hall still looks over).
  for (const wid of ['atr-w1', 'atr-e1', 'atr-n1']) {
    const r = results.find(q => q.w.id === wid), A = r?.facts.audit;
    line(!!A && A.share.wall >= 0.2 && A.share.sky >= RULES.skySlice, `sky slice: ${wid} frames a neighbour's wall AND a slice of sky over its roof line (wall ≥ 20 %, sky ≥ ${Math.round(RULES.skySlice * 100)} %)`,
      A ? `wall ${fmt(A.share.wall * 100, 0)} % · sky ${fmt(A.share.sky * 100, 0)} %` : `${wid} missing`);
  }
  for (const r of walls) {
    const A = r.facts.audit;
    if (A.share.wall >= 0.5 && A.share.sky < RULES.skySlice) note('INFO', `wall view: ${r.w.id}`, `${fmt(A.share.wall * 100, 0)} % wall, ${fmt(A.share.sky * 100, 1)} % sky: the neighbour is taller than any ray through this glass (or the glass stops under its roof line): accepted, a wall view`);
  }
  // The PROD annex is the lowest hull (roof 1.2) and every window that could look at it is above the visitor's eye (a south wall of a wing starts at 1.09): its
  // rays go UP over its roof line, so its walls, its hazard door and the stencils painted on them are seen from no wing (arm-e1 glimpses its north wall past the
  // tower's corner at a grazing angle). What a south window frames of it is what stands higher than its parapet: the roof plant (windowSlots.js LANDMARKS),
  // a bulkhead with the red hazard door, the lit PROD plate and a red lamp, turned to face the middle of the Armurerie. The proof: some window of a public room
  // frames at least half of the plate, with nothing in the way, from a quarter of the spots of its room, and a letter is legible at 640 × 360.
  {
    const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };
    const L = PLANT.L, b = PLANT.b, pl = L.plate;
    const xs = [PLANT.at(-L.w / 2, 0, -L.d / 2), PLANT.at(L.w / 2, 0, -L.d / 2), PLANT.at(-L.w / 2, 0, L.d / 2), PLANT.at(L.w / 2, 0, L.d / 2)];
    const bb = { x0: Math.min(...xs.map(p => p[0])), x1: Math.max(...xs.map(p => p[0])), z0: Math.min(...xs.map(p => p[2])), z1: Math.max(...xs.map(p => p[2])) };
    line(bb.x0 >= b.x0 + 0.1 && bb.x1 <= b.x1 - 0.1 && bb.z0 >= b.z0 + 0.1 && bb.z1 <= b.z1 - 0.1 && pl.y0 >= b.roofY + 0.3 && pl.y0 + pl.h <= PLANT.y1 && Math.abs(L.w) >= pl.w + 0.1,
      `annex: the roof plant (LANDMARKS.${Object.keys(LANDMARKS)[0]}) stands on the ${L.host} roof, inside its parapet, its plate on its front face (${fmt(L.w)} × ${fmt(L.d)} × ${fmt(L.h)} m, plate ${fmt(pl.w)} × ${fmt(pl.h)} at y ${fmt(pl.y0)}–${fmt(pl.y0 + pl.h)})`,
      `footprint x ${fmt(bb.x0)}–${fmt(bb.x1)}, z ${fmt(bb.z0)}–${fmt(bb.z1)} of the roof x ${b.x0}–${b.x1}, z ${b.z0}–${b.z1}; facing ${L.heading}° ${compass(L.heading)}`);
    line(bb.x1 < RULES.secret[0] || bb.x0 > RULES.secret[1], 'annex: the roof plant stays out of the secret\'s span (x 11.8–13.2): nothing over the push-wall\'s corridor, nothing near the annex\'s door',
      `x ${fmt(bb.x0)}–${fmt(bb.x1)}`);
    const rows = walls.filter(r => r.w.room !== 'prod').map(r => ({ r, f: ctx.plate(r.w) })).filter(o => o.f.some > 0).sort((a, c) => c.f.half / c.f.total - a.f.half / a.f.total);
    for (const { r, f } of rows) note('INFO', `annex plate: ${r.w.id}`, `${f.some} of ${f.total} spots see some of the PROD plate, ${f.half} (${Math.round(100 * f.half / f.total)} %) at least half of it, ${f.whole} (${Math.round(100 * f.whole / f.total)} %) all of it`);
    const top = rows[0];
    const share = top ? top.f.half / top.f.total : 0;
    line(!!top && share >= RULES.plateSpots && top.r.w.room !== 'prod',
      `annex: the PROD plate of the annex's roof plant is framed (≥ ${Math.round(RULES.plateHalf * 100)} % of it, nothing in the way) from at least ${Math.round(RULES.plateSpots * 100)} % of the spots of a public room, through ${top ? top.r.w.id : 'no window'}`,
      top ? `${top.r.w.id}: ${Math.round(100 * share)} % of ${top.f.total} spots (x ${fmt(Math.min(...top.f.from.map(s => s.x)))}–${fmt(Math.max(...top.f.from.map(s => s.x)))}, z ${fmt(Math.min(...top.f.from.map(s => s.z)))}–${fmt(Math.max(...top.f.from.map(s => s.z)))}), all of it from ${Math.round(100 * top.f.whole / top.f.total)} %` : '← no window frames it');
    if (top && top.f.half) {
      const lo = q(top.f.letter, 0), px = q(top.f.pixel, 0.05);
      line(lo >= RULES.letterPx && px >= RULES.fontPx, `annex: the PROD plate is legible at 640 × 360 from every spot that frames half of it: a letter is ≥ ${RULES.letterPx} px tall and a font pixel ≥ ${RULES.fontPx} px wide on screen`,
        `letters ${fmt(lo, 1)}–${fmt(q(top.f.letter, 1), 1)} px tall (median ${fmt(q(top.f.letter, 0.5), 1)}), a font pixel ${fmt(q(top.f.pixel, 0), 1)}–${fmt(q(top.f.pixel, 1), 1)} px wide (5 % ${fmt(px, 1)}) over ${top.f.half} spots`);
    } else line(false, 'annex: the PROD plate is legible at 640 × 360', '← not framed');
    const ow = results.find(r => r.w.id === 'arm-s1');
    line(!!ow && !!rows.find(o => o.r.w.id === 'arm-s1' && o.f.half / o.f.total >= RULES.plateSpots), 'owner: the Armurerie\'s south ribbon (arm-s1) shows the PROD annex: its roof plant with the lit PROD plate (from the centre-north of the room)',
      ow ? `arm-s1: ${Math.round(100 * (rows.find(o => o.r.w.id === 'arm-s1')?.f.half ?? 0) / (rows.find(o => o.r.w.id === 'arm-s1')?.f.total || 1))} % of its spots` : 'arm-s1 missing');
  }

  // The secret: the push-wall's alley (x 12–13, z 16–18: its two faces and its floor) and the annex's door are NEUTRAL, seen from no window of a public room.
  const leaks = results.filter(r => r.w.room !== 'prod' && r.facts.audit.secretRays > 0);
  line(leaks.length === 0, 'secret: no window of a public room looks at the alley behind the push-wall (x 12–13, z 16–18) nor at the annex\'s door (x 12–13, z 18): it stays neutral',
    leaks.length ? `← ${leaks.map(r => `${r.w.id} (${r.facts.audit.secretRays} rays)`).join(', ')}` : `prod-p1 alone sees it (${results.find(r => r.w.room === 'prod')?.facts.audit.secretRays ?? 0} rays), from inside the secret`);

  // ── exterior model ──────────────────────────────────────────────────────────────────────────────
  console.log('\n── The exterior world against the level (exterior/exteriorLayout.js) ──');
  exteriorModelProofs(line, note, ctx);
  const rooms2 = results.filter(r => r.facts.audit);
  const totalRays = rooms2.reduce((a, r) => a + r.facts.audit.rays, 0);
  line(rooms2.every(r => r.facts.audit.between.length === 0), `hull: ${totalRays.toLocaleString('en-US')} rays eye → glass (every spot of every room × 20 points of every pane): none enters a hull before the glass`);
  const cross = crossRoom(ctx);
  const crossBad = cross.filter(c => c.who.size);
  for (const c of cross) {
    if (!c.who.size) continue;
    const spots = [...c.who.values()].reduce((a, e) => a + e.n, 0);
    note('WARN', `through-the-door: ${c.w.id}`, `${spots} of the ${c.sees} spots outside its room that see it have a hull in front of the glass: `
      + [...c.who].sort((a, b) => b[1].n - a[1].n).slice(0, 3).map(([k, e]) => `${k} (${e.n} spots)`).join('; '));
  }
  if (!crossBad.length) note('INFO', 'through-the-door', 'no pane is seen with a hull in front of it from another room');
  else note('INFO', 'through-the-door', `${crossBad.length} panes: a camera in another room that sees them through a door has the tower's hull between it and the glass; `
    + 'the pane must not paint that hull (decor/windows.js does so: where the exterior depth is nearer than the glass it falls back to the bare sky, uExtDepth; keep that gate)');

  // ── soft findings ───────────────────────────────────────────────────────────────────────────────
  console.log('\n── Soft findings (WARN never fails the check) ──');
  let warned = 0;
  for (const r of results) for (const m of r.warns) { warned++; note('WARN', r.w.id, m); }
  if (!warned) note('INFO', 'no soft overlaps');

  // ── view table ──────────────────────────────────────────────────────────────────────────────────
  console.log('\n── VIEW TABLE: window → where the visitor stands → what the glass shows (INFO) ──');
  console.log('   (spots = walkable spots of the room, 0.25 m grid, eye 0.5 m over the floor; shows = what 20 rays per spot meet beyond the glass; "well" = at least half of the disc of the body is in the glass OR the body fills at least half of the glass: a slice of a big body through a ribbon counts, so "never more than X% of its disc" says how much of the body is ever framed)');
  viewTable(ctx, results, s => console.log(s));
  const spawn = new Player();
  const seenAtSpawn = results.filter(r => r.w.kind === 'wall' && r.w.room === 'atrium').filter(r => {
    const d = angDiff(bearing(spawn.x, spawn.y, r.w.x, r.w.z), spawn.angle * R2D);
    return Math.abs(d) <= 30;
  }).map(r => r.w.id);
  note('INFO', 'first view', `at the spawn (${spawn.x}, ${spawn.y}) looking north the frame holds: ${seenAtSpawn.join(', ') || 'no window'}`);
  // What those windows really frame from the spawn: the first thing the visitor sees through glass. A window that frames bare stars there wastes it.
  for (const id of seenAtSpawn) {
    const w = windows.find(q => q.id === id), P = { x: spawn.x, z: spawn.y, y: eyeOf(spawn.x, spawn.y) }, V = viewFrom(w, P, sky);
    const names = Object.entries(V.bodies).map(([k]) => bodyName(k));
    const cls = classText(V.classes, V.n, 2);
    if (names.length) note('INFO', `first view: ${id}`, `frames heading ${fmt(wrap360(V.heading[0]), 0)}°–${fmt(wrap360(V.heading[1]), 0)}°, elevation ${fmt(V.el[0], 0)}°…${fmt(V.el[1], 0)}°: ${cls}, with ${names.join(', ')}`);
    else note('WARN', `first view: ${id}`, `from the spawn the glass frames heading ${fmt(wrap360(V.heading[0]), 0)}°–${fmt(wrap360(V.heading[1]), 0)}°, elevation ${fmt(V.el[0], 0)}°…${fmt(V.el[1], 0)}°: ${cls}, and NO body of the sky `
      + `(the visitor's first look through glass is a bare starfield; a body of the sky at about ${fmt(wrap360((V.heading[0] + V.heading[1]) / 2), 0)}°, el ${fmt((V.el[0] + V.el[1]) / 2, 0)}° would fill it)`);
  }
  const prod = results.find(r => r.w.room === 'prod');
  if (prod) note('FLAG', prod.w.id, 'the PROD room is a secret: this porthole is its only window (entrance wall, the one wall the black overlays do not cover)');

  // ── for the exterior builder and the props dresser ──────────────────────────────────────────────
  console.log('\n── DRESS NOTES (for the exterior builder and the props dresser; `--dress` prints them alone) ──');
  dressNotes(ctx, results, s => console.log(s));
  console.log('\n── PLAIN SEEN: where the open ground is seen from (rays that land on the ground ≤ 46 m away, per 4 m cell; digit = log2 of the number of rays, # = the base) ──');
  {
    const plain = new Map();
    for (const r of results) for (const [k, n] of r.facts.audit.plain) plain.set(k, (plain.get(k) ?? 0) + n);
    const [cx0, cx1, cz0, cz1] = [-8, 14, -8, 14];       // cells of PLAIN_CELL metres: x −32…56, z −32…56
    console.log(`   x from ${cx0 * PLAIN_CELL} to ${cx1 * PLAIN_CELL} m, z from ${cz0 * PLAIN_CELL} to ${cz1 * PLAIN_CELL} m (north up); the base spans x 2–23, z 2–23`);
    for (let cz = cz0; cz < cz1; cz++) {
      let row = '';
      for (let cx = cx0; cx < cx1; cx++) {
        const x = cx * PLAIN_CELL, z = cz * PLAIN_CELL, n = plain.get(`${cx},${cz}`) ?? 0;
        const base = x + PLAIN_CELL > 2 && x < 23 && z + PLAIN_CELL > 2 && z < 23;
        row += base ? '#' : n ? String(Math.min(9, Math.max(1, Math.round(Math.log2(n))))) : '.';
      }
      console.log(`   ${row}   z ${String(cz * PLAIN_CELL).padStart(4)}`);
    }
  }
  // ── tail ────────────────────────────────────────────────────────────────────────────────────────
  console.log(`\n${failed ? 'FAIL' : 'PASS'}  ${windows.length} windows, ${failed} failing rule${failed === 1 ? '' : 's'}, ${warned} soft finding${warned === 1 ? '' : 's'}`);
  return { failed, results, model, ceiling, runs, windows, ctx };
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
  disc(cx, cy, r, c, a = 1) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.px(x, y, c, a);
  }
  // A pie slice: centre, radius, heading range in degrees (0 = right, 90 = down), translucent.
  wedge(cx, cy, r, h0, h1, c, a = 0.2) {
    const span = h1 - h0;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
      if (d2 > r * r || d2 < 1) continue;
      const h = ((Math.atan2(dy, dx) * 180) / Math.PI - h0 + 540) % 360 - 180;     // heading relative to h0, in (−180, 180]
      const t = (((h % 360) + 360) % 360);
      if (t <= (span + 360) % 360 || (span >= 360)) this.px(x, y, c, a * (1 - 0.5 * Math.sqrt(d2) / r));
    }
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

// The base seen from above, as the exterior world will draw it: hulls, links, the panes with what each looks at, where the sky bodies lie.
// Wedges: the headings a visitor can look through each pane (from the spots of its room), coloured by what it shows (the body most seen,
// or orange when it shows the base itself).
const BODY_COLOUR = { earth: [70, 140, 255], sun: [255, 215, 70], giant: [200, 110, 255], asteroids: [120, 200, 110] };
const HULL_COLOUR = { quartiers: [62, 30, 72], armurerie: [24, 62, 38], trophees: [74, 50, 20], atrium: [50, 80, 130], annex: [72, 20, 52] };
function windowColour(r) {
  const A = r.facts.audit, out = A.pane.outward;
  if (A.share.hull >= 0.25 || A.nearHull >= 0.5) return [255, 150, 50];
  // the body the window is aimed at: among those seen from enough spots, the one nearest its axis
  let best = null, bd = 1e9;
  for (const [k, c] of Object.entries(BODY_COLOUR)) {
    const b = A.bodies[k], az = r.ctx?.sky?.bodies?.[k]?.az;
    if (!b || b.spots < SEEN_MIN || az === undefined) continue;
    const d = out === null ? 0 : Math.abs(angDiff(az, out)) - Math.min(30, b.half / 3);
    if (d < bd) { bd = d; best = c; }
  }
  return best ?? [190, 190, 200];
}
function drawExterior(file, { results, ctx }) {
  const S = 30, M = 100, W = 25 * S + 2 * M, H = 25 * S + 2 * M;
  const img = new Img(W, H, [10, 12, 18]);
  const X = x => M + x * S, Y = z => M + z * S;
  img.rect(X(0), Y(0), X(25), Y(25), [34, 36, 40]);
  for (let g = 0; g <= 25; g += 5) { img.line(X(g), Y(0), X(g), Y(25), [48, 50, 56]); img.line(X(0), Y(g), X(25), Y(g), [48, 50, 56]); }
  for (let g = 0; g <= 25; g += 5) { img.text(String(g), X(g) - 4, Y(0) - 12, [120, 120, 130], 1); img.text(String(g), X(0) - 16, Y(g) - 3, [120, 120, 130], 1); }
  // links under the blocks, blocks, the tower brighter
  for (const l of LINKS) { img.rect(X(l.x0), Y(l.z0), X(l.x1), Y(l.z1), [96, 98, 108]); img.frame(X(l.x0), Y(l.z0), X(l.x1), Y(l.z1), [200, 200, 210], 1); }
  for (const b of BLOCKS) {
    img.rect(X(b.x0), Y(b.z0), X(b.x1), Y(b.z1), HULL_COLOUR[b.id]);
    img.frame(X(b.x0), Y(b.z0), X(b.x1), Y(b.z1), b.id === 'atrium' ? [255, 255, 255] : [210, 210, 220], b.id === 'atrium' ? 3 : 1);
    img.text(`${b.id.toUpperCase()} ROOF ${b.roofY}`, X(b.x0) + 8, Y(b.z0) + 8, [225, 225, 235], 2);
  }
  img.rect(X(SKYLIGHT.x0), Y(SKYLIGHT.z0), X(SKYLIGHT.x1), Y(SKYLIGHT.z1), [255, 90, 220], 0.35);
  img.frame(X(SKYLIGHT.x0), Y(SKYLIGHT.z0), X(SKYLIGHT.x1), Y(SKYLIGHT.z1), [255, 90, 220], 1);
  { // the annex's roof plant (LANDMARKS): its footprint, a bar on its front (the PROD plate) and a short line out of it, the way it looks
    const L = PLANT.L, c = [[-L.w / 2, -L.d / 2], [L.w / 2, -L.d / 2], [L.w / 2, L.d / 2], [-L.w / 2, L.d / 2]].map(([u, o]) => PLANT.at(u, 0, o));
    for (let i = 0; i < 4; i++) img.line(X(c[i][0]), Y(c[i][2]), X(c[(i + 1) % 4][0]), Y(c[(i + 1) % 4][2]), [255, 70, 50]);
    const a = PLANT.at(-L.plate.w / 2, 0, L.d / 2), b = PLANT.at(L.plate.w / 2, 0, L.d / 2), m = PLANT.at(0, 0, L.d / 2 + 0.9);
    img.line(X(a[0]), Y(a[2]), X(b[0]), Y(b[2]), [255, 230, 90]); img.line(X((a[0] + b[0]) / 2), Y((a[2] + b[2]) / 2), X(m[0]), Y(m[2]), [255, 70, 50]);
    img.text('PROD PLANT', X(L.x) + 22, Y(L.z) + 12, [255, 110, 90], 2);
  }
  // the sky bodies on the border, in their heading from the middle of the base
  const cx = 12.5, cz = 12.5, sky = ctx.sky;
  const edge = (az, pad) => { const dx = Math.cos(az * D2R), dz = Math.sin(az * D2R), t = Math.min(dx ? (12.5 + pad) / Math.abs(dx) : 1e9, dz ? (12.5 + pad) / Math.abs(dz) : 1e9); return [X(cx + dx * t), Y(cz + dz * t)]; };
  const star = (b, col, label, r = 11) => {
    const [px, py] = edge(b.az, 1.9);
    img.line(X(cx), Y(cz), px, py, [col[0] * 0.35, col[1] * 0.35, col[2] * 0.35]);
    img.disc(px, py, r, col);
    img.text(`${label} ${fmt(b.az, 0)}`, Math.min(Math.max(px - label.length * 4 - 8, 4), W - 90), Math.min(Math.max(py + r + 4, 2), H - 14), col, 2);
  };
  star(sky.bodies.earth, BODY_COLOUR.earth, 'EARTH', 15);
  star(sky.bodies.sun, BODY_COLOUR.sun, 'SUN', 9);
  star(sky.bodies.giant, BODY_COLOUR.giant, 'RINGED GIANT', 15);
  for (const b of Object.values(sky.bodies).filter(b => !b.main && (b.kind === 'joke' || b.kind === 'moon' || b.kind === 'satellite' || b.kind === 'comet'))) star(b, [190, 190, 200], b.id.toUpperCase(), 3);
  { // the asteroid stream: dots along its arc
    const a = sky.bodies.asteroids;
    for (const d of a.discs) { const [px, py] = edge(d.az, 1.9); img.disc(px, py, 3, BODY_COLOUR.asteroids); }
    const [px, py] = edge(a.discs[2].az, 1.9); img.text('ASTEROIDS', px - 74, py + 8, BODY_COLOUR.asteroids, 2);
  }
  // the panes and their cones
  for (const r of results) {
    const w = r.w, A = r.facts.audit, col = windowColour({ ...r, ctx });
    if (w.kind === 'skylight') { img.text('SKY', X(w.x) - 6, Y(w.z) - 3, [255, 90, 220], 2); continue; }
    const [fx, fz] = w.facing, out = A.pane.outward, half = w.w / 2;
    const px = X(w.x), pz = Y(w.z);
    img.wedge(px, pz, 4.2 * S, out + A.offCore[0], out + A.offCore[1], col, 0.24);
    if (fx !== 0) img.rect(px - 4, Y(w.z - half), px + 4, Y(w.z + half), col); else img.rect(X(w.x - half), pz - 4, X(w.x + half), pz + 4, col);
    img.line(px, pz, px - fx * 20, pz - fz * 20, col);
    const lx = px - fx * 26 - (fx > 0 ? w.id.length * 8 : 0), lz = pz - fz * 26 - 5 + (fz > 0 ? -14 : fz < 0 ? 4 : 0);
    img.text(w.id, lx, lz, col, 2);
  }
  img.text('THE BASE FROM ABOVE: THE PANES AND WHAT EACH ONE LOOKS AT (80 PERCENT OF THE VISITORS)', 10, 6, [225, 225, 235], 2);
  img.text('COLOUR = BODY SEEN BEST: BLUE EARTH, YELLOW SUN, PURPLE GIANT, GREEN ASTEROIDS, ORANGE THE BASE ITSELF, GREY NONE', 10, 22, [170, 170, 185], 2);
  img.save(file);
}

// The same, in text: 1 char = 0.5 m across, 1 line = 1 m down; windows are numbered on the cell just outside their glass.
const MARKS = '123456789BCDEFGHJKLMNPRSUVWXYZ';
export function asciiMap(ctx) {
  const cols = 50, rows = 25, g = Array.from({ length: rows }, () => Array(cols).fill('.'));
  const inBox = (b, x, z) => x >= b.x0 && x < b.x1 && z >= b.z0 && z < b.z1;
  const LETTER = { quartiers: 'q', armurerie: 'a', trophees: 't', atrium: 'A', annex: 'p' };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = c / 2 + 0.25, z = r + 0.5;
    const b = BLOCKS.find(b => inBox(b, x, z)), l = LINKS.find(l => inBox(l, x, z));
    g[r][c] = b ? LETTER[b.id] : l ? '=' : '.';
  }
  const legend = [];
  const clamp = (v, hi) => Math.min(hi - 1, Math.max(0, v));
  ctx.windows.forEach((w, i) => {
    const m = MARKS[i];
    if (w.kind === 'skylight') { g[Math.floor(w.z)][Math.floor(w.x * 2)] = m; legend.push(`${m} ${w.id.padEnd(8)} skylight over the hub`); return; }
    const [fx, fz] = w.facing, xx = w.x - fx * 0.26, zz = w.z - fz * 0.5;      // the cell just outside the glass
    g[clamp(Math.floor(zz), rows)][clamp(Math.floor(xx * 2), cols)] = m;
    legend.push(`${m} ${w.id.padEnd(8)} looks ${compass(bearing(0, 0, -fx, -fz)).padEnd(2)}  (${w.x}, ${w.z}) ${w.w}×${w.h} sill ${w.sill}${w.dress ? '  [dress note]' : ''}`);
  });
  const out = [];
  out.push(`      N: ringed giant ${fmt(ctx.sky.bodies.giant.az, 0)}°    W: asteroid stream, duck, comet    S: EARTH ${fmt(ctx.sky.bodies.earth.az, 0)}°    ESE: SUN ${fmt(ctx.sky.bodies.sun.az, 0)}°, mug, saucer (ENE)`);
  out.push(`      x → (1 char = 0.5 m), z ↓ (1 line = 1 m).  A atrium tower (roof ${BLOCKS.find(b => b.id === 'atrium').roofY})  q quartiers  a armurerie  t trophees  p annex  = links  digits/letters = panes on the cell outside their glass`);
  out.push('      ' + Array.from({ length: cols }, (_, c) => (c % 10 === 0 ? String(c / 2).padEnd(1) : ' ')).join(''));
  for (let r = 0; r < rows; r++) out.push(`  ${String(r).padStart(2)}  ${g[r].join('')}`);
  out.push('');
  out.push(...legend);
  return out.join('\n');
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
  if (argv.includes('--dress')) {           // the proofs run silently, then only the notes for the dressers are printed
    const log = console.log;
    console.log = () => {};
    let res;
    try { res = proofs(); } finally { console.log = log; }
    console.log('── DRESS NOTES (for the exterior builder and the props dresser) ──');
    dressNotes(res.ctx, res.results, s => console.log(s));
    process.exitCode = res.failed || guards.some(g => !g.ok) ? 1 : 0;
    return;
  }
  const res = proofs();
  if (argv.includes('--ascii')) console.log(`\n── Top-down map ──\n${asciiMap(res.ctx)}`);
  const at = argv.indexOf('--png');
  if (at >= 0) {
    const dir = path.resolve(argv[at + 1] ?? '.');
    fs.mkdirSync(dir, { recursive: true });
    drawMap(path.join(dir, 'windows-map.png'), res);
    drawWalls(path.join(dir, 'windows-walls.png'), res);
    drawExterior(path.join(dir, 'windows-exterior.png'), res);
    console.log(`pictures: ${['windows-map.png', 'windows-walls.png', 'windows-exterior.png'].map(f => path.join(dir, f)).join(', ')}`);
  }
  process.exitCode = res.failed || guards.some(g => !g.ok) ? 1 : 0;
}

// Only run the proofs when this file is the entry point (a scratch tool can import the model).
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
