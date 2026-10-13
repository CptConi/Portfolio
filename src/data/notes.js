// Notes: small physical objects in the level (post-its, engraved plaques, labels, paper tags) that the
// visitor reads on demand, by looking at one and pressing [ E ] (features/notes.js). Nothing pops up by
// itself. Each note is "said" by whoever wrote the object, so the copy has to read naturally as written
// on it: Nicolas on paper, the SYSTÈME on metal and labels, the cat on its tag.
//
//   notes       [{ id, slot, voice, carrier, text }]   what the card shows (id = slot, also the analytics key)
//                 voice    'nicolas' first person, dry · 'systeme' CAPS, bureaucratic · 'chat' MROW + a SYSTÈME line
//                 carrier  'postit' | 'plaque' | 'sticker' | 'tag'   the object it is written on
//   PLACEMENTS  { [slot]: pose }                        where the object is stuck, and how it looks
//                 x, y, z    centre of the note on its surface (world: y includes the local floor)
//                 ly         the same height above the local floor, in metres
//                 facing     [fx, fz] horizontal normal of the surface; the note is read from that side
//                 scale      size of the object relative to its carrier (a plate on the narrow neck of a pillar)
//                 tilt       pitch of the surface toward the sky (the slanted bezel of a console), radians
//                 roll       small hand-placed turn in the plane of the surface, radians
//                 billboard  true: the object turns to the camera, like the sprite it hangs on
//                 view       cosine of the widest viewing angle it is read from (default: features/notes.js AIM.view)
//                 host       id of the console whose bezel it is stuck to (hidden while that console is focused)
//                 finish     'steel' | 'brass'   (plaques)      mark  'paw'   (a tag)
//                 stand      [x, z, heading°]     a spot to read it from (dev warp: __game.notes.tp)
//                 surface    what it is stuck to, for the humans
//
// The copy is the writers' final text, verbatim, with their no-break spaces (\u00a0: "3 000", « Outils »,
// the space before a colon). The figures it quotes are checked against the data offline, not recomputed
// here: ATRIUM 49 m² / 2 m and 25×25 (Map.js), 3 000 formations, the Parfumerie version jumps and the TBE
// releases (projects.js). The squads of 1 to 4 are the Digital Factory's, owner-stated (no data file).
//
// Poses are computed from the real layout, never typed: props/placement.js (the lounge), Props3D.js (crates,
// servers, the workbench, the plinths), PlinthGenerator.js, Screens.js (consoles), Sprites2D.js (the atrium
// pillars), Map.js (floors). A move of any of those moves the note with it. The one exception is the
// blueprint of the Quartiers, whose frame is not exported by decor/quartiers.js (POSTER below).
//
// Where a note sits matters as much as what it says: on a vertical face, roughly 0.2 to 0.65 m above the
// floor (the eye is at 0.5), facing the room, away from every door axis and every spot a visitor lands on,
// and either clear of other interactions or ON the thing they belong to (a console, a plinth), where
// features/notes.js lets the one you are aiming at win. A sweep of the level proves it (see features/notes.js).
// The camera never pitches (the eye is at 0.5 m), so a low note (the plinth plates at 0.26 m, the bench tag at
// 0.24 m) is read from a little farther: its prompt waits until three quarters of it are in the frame.

import { PROPS3D } from '../engine/Props3D.js';
import { SCREENS } from '../engine/Screens.js';
import { spriteAABBs } from '../engine/Sprites2D.js';
import { LOUNGE } from '../engine/props/placement.js';
import { PLINTH, getDynamicPlinths } from '../engine/PlinthGenerator.js';
import { floorAt, getCellType } from '../engine/Map.js';

const ATRIUM = 6, ARMURERIE = 2;

// ── Copy ────────────────────────────────────────────────────────────────────────────────────────
// Order = the order of a visit: the hall, the Armurerie, the Trophées, the Quartiers.
const COPY = [
  { slot: 'spawn-crate', voice: 'nicolas', carrier: 'sticker',
    text: 'Testé par moi, donc pas testé. À refaire par vos soins.' },
  { slot: 'atrium-pillar', voice: 'systeme', carrier: 'plaque',
    text: 'ATRIUM\u00a0: 49\u00a0M², PLAFOND 2\u00a0M. CE PILIER N\'EST PAS DOCUMENTÉ\u00a0: NE PAS LE RETIRER.' },
  { slot: 'df-console', voice: 'nicolas', carrier: 'postit',
    text: 'Squads de 1 à 4 personnes. Dans la plus petite, la revue de code, c\'est soi-même d\'il y a trois semaines.' },

  { slot: 'rack-skills', voice: 'nicolas', carrier: 'postit',
    text: '// TODO\u00a0: trouver un meilleur nom que «\u00a0Outils\u00a0». Git y côtoie l\'API TikTok.' },
  { slot: 'bench-cat', voice: 'nicolas', carrier: 'tag',
    text: 'Ce chat a déjà fusionné une branche. Je ne sais toujours pas laquelle.' },

  { slot: 'plinth-phenix', voice: 'systeme', carrier: 'plaque',
    text: 'ENVIRON 3\u00a0000 FORMATIONS PAR AN. PLUS GROS PROJET DE LA DIGITAL FACTORY À DATE. SOCLE RENFORCÉ EN CONSÉQUENCE.' },
  { slot: 'plinth-tbe', voice: 'systeme', carrier: 'plaque',
    text: 'TBE\u00a0: CAMIONS DE MISE EN BOUTEILLE. TROIS MISES EN PROD PRÉVUES LE MÊME JOUR. CASSE TOLÉRÉE\u00a0: AUCUNE.' },
  { slot: 'plinth-parfumerie', voice: 'systeme', carrier: 'plaque',
    text: 'STRAPI 4 VERS 5, NODE 16 VERS 22, ANGULAR 16 VERS 19. SITE FERMÉ, DÉCISION DU GROUPE. IL ÉTAIT À JOUR.' },

  { slot: 'console-contact', voice: 'nicolas', carrier: 'postit',
    text: 'Remarque, anomalie ou bonjour\u00a0: e-mail, LinkedIn ou GitHub. Sans étapes de reproduction, je lirai quand même.' },
  { slot: 'wall-fps', voice: 'systeme', carrier: 'plaque',
    text: 'NIVEAU À L\'ANCIENNE\u00a0: 25×25 CASES. CRITÈRE DE RÉUSSITE\u00a0: NE PAS S\'Y PERDRE. VOUS ÊTES ICI\u00a0: CRITÈRE ATTEINT.' },
  { slot: 'cat-crate', voice: 'chat', carrier: 'tag',
    text: 'MROW. TRADUCTION\u00a0: IL EST 4\u00a0H. LA GAMELLE EST PLEINE. LE CHAT LE SAIT.' },
];

// ── Where things stand ──────────────────────────────────────────────────────────────────────────
const FACES = { e: [1, 0], w: [-1, 0], s: [0, 1], n: [0, -1] };   // outward normals (z grows southward)

const hash = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
// Stable "hand-placed" turn in [−amp, +amp] radians, one per note.
const jitter = (id, amp) => ((hash(id) % 2001) / 1000 - 1) * amp;

const round = v => Math.round(v * 1000) / 1000;

// A prop of Props3D.js as { x, z, w, d, h } (its `y` is the world z).
const boxOf = p => ({ x: p.x, z: p.y, w: p.w, d: p.d, h: p.h });

// Point on the `side` face ('e' | 'w' | 's' | 'n') of a box, `ly` above its local floor.
function onBox(id, box, side, ly, extra = {}) {
  const [fx, fz] = FACES[side];
  const x = box.x + fx * box.w / 2, z = box.z + fz * box.d / 2;
  return { id, x: round(x), z: round(z), ly, y: round(floorAt(x, z) + ly), facing: [fx, fz], tilt: 0, ...extra };
}

// The slanted front of a console (ScreenManager.js buildMainframe: a vertical foot to 0.42 m, then a panel
// leaning back to 0.86 m, the screen in the middle of it). A note stuck to the bare left margin of the
// bezel, where nothing is drawn: `side` is the offset along the console, toward the viewer's right.
const PANEL = { zFront: 0.28, zTop: 0.12, yBreak: 0.42, yTop: 0.86 };
function onBezel(id, def, side, ly, extra = {}) {
  const [fx, fz] = def.facing, rx = fz, rz = -fx;
  const out = PANEL.zFront + (ly - PANEL.yBreak) * (PANEL.zTop - PANEL.zFront) / (PANEL.yTop - PANEL.yBreak);
  const x = def.x + rx * side + fx * out, z = def.z + rz * side + fz * out;
  const tilt = Math.atan2(PANEL.zFront - PANEL.zTop, PANEL.yTop - PANEL.yBreak);
  return { id, x: round(x), z: round(z), ly, y: round(floorAt(def.x, def.z) + ly), facing: [fx, fz], tilt: round(tilt), host: def.id, ...extra };
}

// decor/quartiers.js POSTER (not exported): the blueprint pinned on the north wall of the Quartiers.
const POSTER = { x: 10.2, z: 2.0, w: 0.72, h: 0.64, y: 0.72 };

function computePlacements() {
  const out = {};
  // A slot whose host has left the layout is dropped (and said so), not allowed to take the level down.
  const put = (id, make, stand, surface) => {
    try {
      const pose = make();
      out[id] = Object.freeze({ ...pose, roll: round(jitter(id, pose.roll ?? 0)), stand, surface });
    } catch (err) {
      console.warn(`[notes] "${id}" dropped: its host is gone from the layout`, err);
    }
  };

  // The first wooden crate of the atrium, on the west side of the spawn: its east face is what the view turns
  // to at the "west" beat of the arrival sequence (features/intro.js), two metres out.
  put('spawn-crate', () => {
    const crate = boxOf(PROPS3D.find(p => p.texSide === 55 && getCellType(p.x, p.y) === ATRIUM));
    return onBox('spawn-crate', crate, 'e', 0.30, { roll: 0.05 });
  }, [11.7, 15.3, 180], 'atrium crate, east face');

  // The tall tech pillars are sprites (Sprites2D.js): they turn to the camera, and so does the plate on one.
  // The south-east pillar stands by the spawn, off every lane.
  put('atrium-pillar', () => {
    const [pillar] = spriteAABBs(0)
      .map(b => ({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 }))
      .filter(c => getCellType(c.x, c.z) === ATRIUM)
      .sort((a, b) => (b.x + b.z) - (a.x + a.z));
    const ly = 0.55;
    return { id: 'atrium-pillar', x: round(pillar.x), z: round(pillar.z), ly, y: round(floorAt(pillar.x, pillar.z) + ly),
      facing: [0, 1], tilt: 0, billboard: true, scale: 0.7, finish: 'steel' };
  }, [15.3, 14.15, 90], 'atrium pillar (sprite), plate');

  // The DF STATUS console: a post-it on the bare left margin of its bezel.
  put('df-console', () => onBezel('df-console', SCREENS.find(s => s.id === 'dashboard'), -0.41, 0.62, { roll: 0.07 }),
    [10.2, 10.8, 264], 'DF STATUS console, left of the screen');

  // The Armurerie: a post-it on the south-east server, the unit that ends the OUTILS rack (family 7).
  put('rack-skills', () => {
    const server = boxOf(PROPS3D.filter(p => p.texSide === 58 && getCellType(p.x, p.y) === ARMURERIE)
      .sort((a, b) => (b.y - a.y) || (b.x - a.x))[0]);
    return onBox('rack-skills', { ...server, x: server.x - 0.1 }, 'n', 0.55, { roll: 0.07 });
  }, [7.4, 14.38, 90], 'Armurerie server ending the south rack');

  // The workbench (the longest prop of the room), where a cat sleeps: a tag hung from the top edge of its east
  // face, which is what the visitor sees coming in from the atrium door.
  put('bench-cat', () => {
    const bench = boxOf(PROPS3D.filter(p => getCellType(p.x, p.y) === ARMURERIE).sort((a, b) => b.w - a.w)[0]);
    return onBox('bench-cat', bench, 'e', bench.h - 0.1125, { roll: 0.04 });
  }, [6.6, 12.5, 180], 'Armurerie workbench, east face');

  // The Trophées plinths: a plate on the flank of the plinth, a little toward the aisle, under the ring of logos.
  const plate = (id, name, side, stand) => put(id, () => {
    const p = getDynamicPlinths().find(q => q.name === name);
    const pose = onBox(id, { x: p.x, z: p.z, w: PLINTH.size, d: PLINTH.size, h: PLINTH.top }, side, 0.26, { finish: 'brass' });
    return { ...pose, z: round(pose.z + p.face[1] * 0.06) };
  }, stand, `${name} plinth, ${side === 'e' ? 'east' : 'west'} flank`);
  plate('plinth-phenix', 'PHENIX FORMATION', 'e', [19.25, 10.16, 205]);
  plate('plinth-tbe', 'TBE', 'w', [19.4, 10.16, 335]);
  plate('plinth-parfumerie', 'PARFUMERIE PRIVÉE', 'e', [19.25, 14.84, 155]);

  // The Quartiers: a post-it on the contact console, an engraved plate under the blueprint, a tag on the cat's crate.
  put('console-contact', () => onBezel('console-contact', SCREENS.find(s => s.id === 'contact'), -0.41, 0.62, { roll: 0.07 }),
    [12.0, 3.9, 275], 'CONTACT console, left of the screen');

  put('wall-fps', () => {
    const ly = 0.30;
    return { id: 'wall-fps', x: POSTER.x, z: POSTER.z, ly, y: round(floorAt(POSTER.x, POSTER.z + 0.5) + ly),
      facing: [0, 1], tilt: 0, finish: 'steel' };
  }, [10.2, 3.15, 270], 'Quartiers blueprint, plate under it');

  put('cat-crate', () => {
    const c = LOUNGE.crate;
    const crate = boxOf(PROPS3D.find(p => Math.abs(p.x - c.x) < 0.01 && Math.abs(p.y - c.z) < 0.01));
    // view 0.6: read from the front only, not from the side where the PROD key hangs two metres away.
    return onBox('cat-crate', crate, 's', crate.h - 0.1125, { roll: -0.04, mark: 'paw', view: 0.6 });
  }, [15.5, 3.85, 270], 'the cat\'s crate, south face');

  return Object.freeze(out);
}

export const PLACEMENTS = computePlacements();

// A note without a place is dropped with it (see put): the counter of the report follows `notes.length`.
export const notes = Object.freeze(COPY.filter(n => PLACEMENTS[n.slot])
  .map(n => Object.freeze({ id: n.slot, ...n })));
