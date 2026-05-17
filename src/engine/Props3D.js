// 3D props — axis-aligned boxes placed in each room.
// x, y    : centre en coordonnées map (world X et world Z)
// w, d    : largeur (X) et profondeur (Z) en cellules
// h       : hauteur (fraction de la hauteur mur, 1.0 = plein mur)
// texSide : textureId faces latérales
// texTop  : textureId face supérieure (optionnel, fallback texSide)
//
// Existing IDs : 2=TEKGRT01 3=SHAWNT01 4=STONE09 5=GRAYCMP1 6=WARNWL01 7=PLATEF1
// New prop IDs : 50=COMPCT01 51=LOCKER01 52=SHAWNT02 53=DARKB01 54=SILVCOMP
//               55=WOODB01  56=METALT1  57=BRNZGRN1 58=COMPSP01

export const PROPS3D = [
  // ── Skills room (x: 1–9, z: 13–17) ───────────────────────────────────────
  // North wall — lockers
  { x: 1.50,  y: 13.22, w: 0.55, d: 0.28, h: 0.92, texSide: 51 },
  { x: 2.20,  y: 13.22, w: 0.55, d: 0.28, h: 0.92, texSide: 51 },
  // North wall — control panel + server rack
  { x: 4.50,  y: 13.22, w: 1.00, d: 0.38, h: 0.68, texSide: 50, texTop: 56 },
  { x: 7.00,  y: 13.22, w: 0.50, d: 0.38, h: 0.85, texSide: 58 },
  // East wall near north — control panel
  { x: 8.72,  y: 13.50, w: 0.28, d: 0.80, h: 0.68, texSide: 50, texTop: 56 },
  // Center — freestanding server rack
  { x: 5.00,  y: 15.00, w: 0.55, d: 0.40, h: 0.85, texSide: 58 },
  // South wall — workbench + crates + silver terminal
  { x: 3.00,  y: 16.78, w: 1.60, d: 0.42, h: 0.34, texSide: 2,  texTop: 56 },
  { x: 5.50,  y: 16.75, w: 0.65, d: 0.65, h: 0.65, texSide: 55 },
  { x: 7.50,  y: 16.78, w: 0.45, d: 0.38, h: 0.88, texSide: 54 },
  // West wall — lab bench
  { x: 1.28,  y: 15.00, w: 0.28, d: 0.90, h: 0.38, texSide: 5,  texTop: 56 },

  // ── Projects room (x: 13–20, z: 7–11) ────────────────────────────────────
  // North wall — wide desk + terminal tower + crate
  { x: 14.50, y: 7.22,  w: 1.40, d: 0.42, h: 0.35, texSide: 3,  texTop: 56 },
  { x: 16.50, y: 7.22,  w: 0.58, d: 0.38, h: 0.85, texSide: 52 },
  { x: 18.50, y: 7.25,  w: 0.65, d: 0.65, h: 0.65, texSide: 55 },
  // West wall near north — bench panel
  { x: 13.20, y: 7.50,  w: 0.28, d: 0.80, h: 0.68, texSide: 3,  texTop: 56 },
  // South wall — bureau + terminal danger + crate stack
  { x: 14.50, y: 10.78, w: 1.10, d: 0.45, h: 0.34, texSide: 3,  texTop: 3 },
  { x: 17.00, y: 10.78, w: 0.58, d: 0.50, h: 0.85, texSide: 6 },
  { x: 18.80, y: 10.75, w: 0.65, d: 0.65, h: 0.65, texSide: 55 },
  // East wall — workbench strip (two segments)
  { x: 19.72, y: 8.00,  w: 0.28, d: 1.00, h: 0.40, texSide: 3,  texTop: 56 },
  { x: 19.72, y: 9.50,  w: 0.28, d: 0.80, h: 0.70, texSide: 52 },

  // ── Passions room (x: 6–15, z: 1–4) ──────────────────────────────────────
  // North wall — sofa + jukebox + amplifier
  { x: 7.50,  y: 1.22,  w: 1.20, d: 0.40, h: 0.42, texSide: 4,  texTop: 57 },
  { x: 10.50, y: 1.22,  w: 0.58, d: 0.42, h: 0.88, texSide: 53 },
  { x: 13.00, y: 1.22,  w: 0.55, d: 0.38, h: 0.72, texSide: 4 },
  // South wall — table basse + sofa + crate stack
  { x: 8.00,  y: 3.78,  w: 0.90, d: 0.48, h: 0.30, texSide: 7,  texTop: 7 },
  { x: 11.50, y: 3.78,  w: 1.00, d: 0.42, h: 0.42, texSide: 4,  texTop: 57 },
  { x: 13.80, y: 3.75,  w: 0.65, d: 0.65, h: 0.65, texSide: 55 },
  // West wall — sideboard
  { x: 6.28,  y: 2.50,  w: 0.28, d: 0.80, h: 0.38, texSide: 7,  texTop: 57 },
  // East wall — sideboard
  { x: 14.80, y: 2.20,  w: 0.28, d: 0.90, h: 0.42, texSide: 4,  texTop: 57 },
];
