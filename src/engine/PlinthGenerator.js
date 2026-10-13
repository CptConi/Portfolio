// Where everything stands in the Trophées gallery. Pure data (no three.js, no DOM), so
// the decor (decor/gallery.js), the interaction feature (features/gallery.js), Props3D
// (plinth collision) and the node proofs all read the same numbers.
//
//   north row  z ≈ 9.6   plinths facing +z, one framed wall panel behind each
//   south row  z ≈ 15.4  plinths facing −z, same thing
//   west wall  x = 17    the contact frame, on the wall segment south of the door
//
// Both rows hold half of the featured missions (north first), in console order, centred
// on the room. When there are more than four per row the slots (and the frames) shrink
// so that neighbouring frames never overlap.
import { projects, featuredProjects } from '../data/projects.js';
import { PLINTH_TOP } from './layout.js';

// Wall faces of the room (Map.js cells x 17..22, z 9..15).
export const ROOM = Object.freeze({ minX: 17, maxX: 23, minZ: 9, maxZ: 16 });

// Props3D draws the plinths as 0.5 m cubes: keep `size` in sync with it.
export const PLINTH = Object.freeze({ size: 0.5, top: PLINTH_TOP, wallGap: 0.6 });

// Wall frame behind a plinth: w × h = screen size; cy = height of its centre above the
// local floor. The camera never pitches and the eye sits at 0.5: much higher and the top
// of the frame leaves the screen when the visitor stands within 3 m; much lower and the
// diorama hides it. 1.08 maximises the readable share of the text over the aisle.
export const FRAME = Object.freeze({ w: 1.2, h: 0.68, cy: 1.08, bezel: 0.05, depth: 0.05 });

// Slot = distance between two neighbouring plinth axes; GAP = clear wall between two
// neighbouring screens; EDGE = free wall kept at each end of a row.
const SLOT_MAX = 1.37;
const GAP = 0.17;
const EDGE = 0.3;

const round = v => Math.round(v * 1000) / 1000;

// Positions for `total` plinths: the first half on the north wall, the rest on the south.
export function layoutPlinths(total) {
  const half = Math.ceil(total / 2);
  const cx = (ROOM.minX + ROOM.maxX) / 2;
  const span = ROOM.maxX - ROOM.minX - 2 * EDGE;
  return Array.from({ length: total }, (_, i) => {
    const north = i < half;
    const count = north ? half : total - half;
    const k = north ? i : i - half;
    const slot = Math.min(SLOT_MAX, (span + GAP) / count);
    return {
      x: round(cx + (k - (count - 1) / 2) * slot),
      z: north ? ROOM.minZ + PLINTH.wallGap : ROOM.maxZ - PLINTH.wallGap,
      face: north ? [0, 1] : [0, -1],
      frameW: round(Math.min(FRAME.w, slot - GAP)),
    };
  });
}

let plinths = null;

// One entry per featured mission, in console order: { x, z, face, frameW, name, page }.
export function getDynamicPlinths() {
  plinths ??= Object.freeze(layoutPlinths(featuredProjects.length).map((p, i) => Object.freeze({
    ...p,
    name: featuredProjects[i].name,
    page: projects.indexOf(featuredProjects[i]),    // page of this mission on the MISSIONS console
  })));
  return plinths;
}

// Wall panel hung behind plinth `p`: { x, z, facing, w, h, cy }, (x, z) = centre on the wall face.
export function frameOf(p) {
  const w = p.frameW;
  return {
    x: p.x,
    z: p.face[1] > 0 ? ROOM.minZ : ROOM.maxZ,
    facing: p.face,
    w,
    h: round(w * FRAME.h / FRAME.w),
    cy: FRAME.cy,
  };
}

// The "Envie d'échanger ?" frame, on the west wall segment z ∈ [14, 16] (south of the
// door). Hung lower than the mission frames: nothing stands in front of it, and the
// visitor reads it from about 1.5 m, where a frame centred at 1.0 would lose its top.
export function getContactFrame() {
  return { x: ROOM.minX, z: 15.0, facing: [1, 0], w: FRAME.w, h: FRAME.h, cy: 0.8 };
}
