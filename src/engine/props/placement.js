import { sofaFootprint } from './sofa.js';
import { TABLE } from './table.js';
import { AMP } from './amp.js';
import { guitarFootprint } from './guitar.js';

// Where everything stands in the Quartiers lounge (x = map column, z = map row, metres).
// Pure data and footprints: shared by the builders, the collision registration and the node
// proofs (no three.js scene, no DOM).
//
// Kept free on purpose:
//   KEY_ZONE   the PROD key hangs on the north wall at x 14.3 (layout.js PROD_KEY): its wall face
//              and the ground in front of it, where the visitor stands and reaches.
//   MOUTH      the vestibule opening: nothing may narrow the way in from the south.

export const LOUNGE = {
  bbq: { x: 16.35, z: 2.65, yaw: -0.96 },             // front (vents) toward the room, lid toward the corner
  crate: { x: 15.5, z: 2.45, top: 0.45 },             // the cat's crate (Props3D.js); the cat sleeps on top
  guitar: { x: 16.74, z: 4.45, yaw: -Math.PI / 2, scale: 1.12 },   // end pin; front faces west
  amp: { x: 16.86, z: 5.35, yaw: -Math.PI / 2 },
  lamp: { x: 11.3, z: 2.45 },
  plant: { x: 8.55, z: 2.55 },                         // north-west corner
  sofa: { x: 9.05, z: 6.74, yaw: Math.PI },           // back against the south wall, faces north
  table: { x: 9.05, z: 5.62 },                        // coffee table in front of it; a candle stands on it (Sprites2D.js)
};

export const KEY_ZONE = { minX: 13.6, maxX: 15.0, minZ: 2.0, maxZ: 3.4 };
export const MOUTH = { minX: 11, maxX: 14, minZ: 6.2, maxZ: 7.3 };

const box = (x, z, hx, hz) => ({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz });

// Floor footprints registered as player collision (Player.js adds its own 0.2 m margin).
export const LOUNGE_SOLIDS = {
  bbq: box(LOUNGE.bbq.x, LOUNGE.bbq.z, 0.25, 0.25),                       // drum, handles and legs
  guitar: guitarFootprint({ x: LOUNGE.guitar.x, z: LOUNGE.guitar.z }, LOUNGE.guitar.yaw, LOUNGE.guitar.scale),
  amp: box(LOUNGE.amp.x, LOUNGE.amp.z, AMP.cabD / 2, AMP.w / 2),          // yaw −90°: width runs along z
  lamp: box(LOUNGE.lamp.x, LOUNGE.lamp.z, 0.09, 0.09),
  plant: box(LOUNGE.plant.x, LOUNGE.plant.z, 0.14, 0.14),
  sofa: sofaFootprint({ x: LOUNGE.sofa.x, z: LOUNGE.sofa.z }, LOUNGE.sofa.yaw),
  table: box(LOUNGE.table.x, LOUNGE.table.z, TABLE.w / 2, TABLE.d / 2),
};
