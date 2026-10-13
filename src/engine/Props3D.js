import { getDynamicPlinths } from './PlinthGenerator.js';

// 3D box props — crates, lockers, servers, terminals, panels. Textured boxes
// (not billboards). Collision is automatic (Player reads these). Heights are
// floor-relative; Renderer offsets each by the local floor.
//
// x, y : centre (world X / world Z)   w, d : width (X) / depth (Z)   h : height
// texSide / texTop : TextureManager ids
//  50 COMPCT01  51 LOCKER01  52 SHAWNT02  53 DARKB01  54 SILVCOMP
//  55 WOODB01   56 METALT1   57 BRNZGRN1  58 COMPSP01 59 BOX_MAT1   5 GRAYCMP1

const PLINTH_PROPS = getDynamicPlinths().map(p => ({
  x: p.x, y: p.z, w: 0.5, d: 0.5, h: 0.5, texSide: 5, texTop: 56
}));

export const PROPS3D = [
  // ── Trophées gallery plinths — generated dynamically ──────────────────────
  ...PLINTH_PROPS,

  // ── Atrium (kept airy) — server rack east of the north vestibule + crates. The
  // west side of the vestibule is the DF STATUS console (Screens.js / layout.js). ─
  { x: 14.4, y: 9.6,  w: 0.5,  d: 0.4,  h: 0.85, texSide: 58, texTop: 56 },
  { x: 10.3, y: 15.3, w: 0.5,  d: 0.5,  h: 0.5,  texSide: 55, texTop: 56 },
  { x: 14.7, y: 15.3, w: 0.5,  d: 0.5,  h: 0.5,  texSide: 55, texTop: 56 },

  // ── Armurerie (W) — central workbench + west cabinet. The side walls (N/S)
  // are taken by the slanted tech-rack props built in Decor.js. ──────────────
  { x: 4.7, y: 12.5, w: 1.0,  d: 0.6,  h: 0.35, texSide: 55, texTop: 56 },  // central table
  { x: 2.7, y: 10.5, w: 0.3,  d: 0.7,  h: 0.7,  texSide: 54 },
  
  // Rows of servers (Environmental Storytelling: the tech arsenal)
  // Placed at the edges of the room to flank the slanted skill racks (which are between X 3 and 7)
  { x: 2.5, y: 9.3,  w: 0.8,  d: 0.35, h: 0.95, texSide: 58, texTop: 56 },
  { x: 7.5, y: 9.3,  w: 0.8,  d: 0.35, h: 0.95, texSide: 58, texTop: 56 },
  { x: 2.5, y: 15.7, w: 0.8,  d: 0.35, h: 0.95, texSide: 58, texTop: 56 },
  { x: 7.5, y: 15.7, w: 0.8,  d: 0.35, h: 0.95, texSide: 58, texTop: 56 },

  // ── Quartiers (N) — the cat's crate (it sleeps on top; props/placement.js knows its spot).
  // The rest of the lounge (sofa, coffee table, amp, guitar, barbecue, lamp…) is built by
  // props/lounge.js, with its own collision. ─────────────────────────────────────────────────
  { x: 15.5, y: 2.45, w: 0.5, d: 0.5, h: 0.45, texSide: 55, texTop: 56 },

  // ── Arcade (secret) — electronics den flanking the cabinet ─────────────────
  { x: 10.0, y: 21.0, w: 0.5,  d: 0.4,  h: 0.8,  texSide: 58, texTop: 56 },
  { x: 15.0, y: 21.0, w: 0.5,  d: 0.4,  h: 0.8,  texSide: 58, texTop: 56 },
  { x: 10.6, y: 18.7, w: 0.5,  d: 0.5,  h: 0.5,  texSide: 55, texTop: 56 },
  { x: 14.4, y: 18.7, w: 0.5,  d: 0.5,  h: 0.5,  texSide: 55, texTop: 56 },
  { x: 9.4,  y: 20.0, w: 0.3,  d: 0.7,  h: 0.7,  texSide: 54 },
  { x: 15.6, y: 20.0, w: 0.3,  d: 0.7,  h: 0.65, texSide: 53 },
];
