// Mission dioramas: a small procedural 3D scene per featured mission, meant to stand on
// a 0.5 m gallery plinth in place of the generic spinning wireframe.
//
//   DIORAMA_KINDS           ['phenix', 'neemba', …]
//   dioramaFor(name)        mission name (as in src/data/projects.js, case-insensitive) → kind | null
//   createDiorama(kind)     → { kind, group, update(t, dt), dispose() }
//
// Conventions
//   • group origin = bottom centre of the diorama (it stands on the plinth top, y = 0);
//     everything fits in 0.40 × 0.38 × 0.40 m (x × y × z) in every animation pose, and
//     within 24 cm of the axis: with the chamfered base tile it never overhangs a 0.5 m
//     plinth, whatever the group's yaw (the lead may orient it, or sway it).
//   • made to be read at eye level: the visitor's eye sits at plinth-top height and the camera
//     never pitches, so top faces are never seen: information lives on vertical faces and
//     raised silhouettes, text is at least ~8 screen px per glyph at 1.5 m (check.mjs enforces it).
//   • the FRONT of every diorama faces local +z. To aim it at the visitor, rotate the
//     group about y by atan2(face.x, face.z) (a plinth facing south, face = [0, 1], needs 0).
//   • `update(t, dt)`: t in seconds (any monotonic clock, even the page uptime: it can reach
//     thousands), dt unused by most builders. Poses are pure functions of t, built from
//     periodic phases only, so there is no drift and no per-frame allocation.
//     With prefs.reducedMotion the diorama freezes on a pleasing still pose (and moves
//     again as soon as the preference flips back).
//   • flat unlit materials only, no lights; ≤ 14 draw calls each, share pooled geometry.
//   • dispose() removes the group from its parent and frees every GPU resource it owns.
//
// Dev tools: `node src/engine/dioramas/check.mjs` (bounds, uptime-proof motion, text, reduced motion, dispose) and the
// lab page /lab/dioramas.html (vite dev only, not part of the production build).
import { prefs } from '../prefs.js';
import { Kit } from './kit.js';
import { build as phenix } from './phenix.js';
import { build as neemba } from './neemba.js';
import { build as tbe } from './tbe.js';
import { build as irun } from './irun.js';
import { build as parfumerie } from './parfumerie.js';
import { build as oviepro } from './oviepro.js';
import { build as heartside } from './heartside.js';
import { build as taxis } from './taxis.js';

export const DIORAMA_KINDS = Object.freeze(['phenix', 'neemba', 'tbe', 'irun', 'parfumerie', 'oviepro', 'heartside', 'taxis']);

const BUILDERS = { phenix, neemba, tbe, irun, parfumerie, oviepro, heartside, taxis };

const MISSIONS = new Map([
  ['phenix formation', 'phenix'],
  ['neemba thebridge', 'neemba'],
  ['tbe', 'tbe'],
  ['irun', 'irun'],
  ['parfumerie privée', 'parfumerie'],
  ['oviepro', 'oviepro'],
  ['heartside', 'heartside'],
  ['1001taxis', 'taxis'],
]);

export function dioramaFor(projectName) {
  if (typeof projectName !== 'string') return null;
  return MISSIONS.get(projectName.normalize('NFC').trim().toLowerCase()) ?? null;
}

export function createDiorama(kind) {
  const build = BUILDERS[kind];
  if (!build) throw new RangeError(`Unknown diorama kind: ${kind}`);

  const kit = new Kit(kind);
  const scene = build(kit);
  kit.finish();

  // Desynchronise the eight cycles a little so they never beat in unison.
  const offset = DIORAMA_KINDS.indexOf(kind) * 1.37;
  let frozen = false;

  scene.pose(scene.staticT, 0);

  return {
    kind,
    group: kit.group,
    update(t, dt = 0) {
      if (prefs.reducedMotion) {
        if (!frozen) { scene.pose(scene.staticT, 0); frozen = true; }
        return;
      }
      frozen = false;
      scene.pose(t + offset, dt);
    },
    dispose() { kit.dispose(); },
  };
}
