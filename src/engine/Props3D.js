// 3D props — axis-aligned boxes rendered per column via ray-AABB intersection.
// x, y    : centre en coordonnées map
// w, d    : largeur (x) et profondeur (y) en cellules map
// h       : hauteur comme fraction de la hauteur mur (1.0 = plein mur)
// texSide : textureId pour les faces latérales (IDs TextureManager)
// texTop  : textureId face supérieure (optionnel, fallback texSide)
//
// Wall texture IDs: 1=BRICKDRT 2=TEKGRT01 3=SHAWNT01 4=STONE09
// Accent IDs:       5=GRAYCMP1 6=WARNWL01 7=PLATEF1  8=GOBS01

export const PROPS3D = [
  // ── Skills room (gauche, x≈1-8, y≈13-16) ─────────────────────────────
  // Paillasse de labo — circuit board sur le dessus
  { x: 3.5, y: 14.5, w: 1.2, d: 0.45, h: 0.36, texSide: 2, texTop: 5 },
  // Console arcade debout
  { x: 6.5, y: 13.7, w: 0.55, d: 0.42, h: 0.88, texSide: 5 },
  // Rack serveur
  { x: 7.5, y: 15.5, w: 0.55, d: 0.38, h: 0.72, texSide: 2 },

  // ── Projects room (droite, x≈13-19, y≈7-10) ──────────────────────────
  // Bureau large — dessus métal brossé
  { x: 15.5, y: 8.5, w: 1.1, d: 0.48, h: 0.34, texSide: 3, texTop: 3 },
  // Terminal debout — bandes danger sur les côtés
  { x: 17.5, y: 9.0, w: 0.58, d: 0.50, h: 0.85, texSide: 6 },

  // ── Passions room (nord, x≈6-14, y≈1-3) ─────────────────────────────
  // Jukebox — relief décoratif
  { x: 8.5,  y: 2.0, w: 0.58, d: 0.42, h: 0.88, texSide: 8 },
  // Table basse — damier métal doré
  { x: 11.5, y: 1.8, w: 0.9,  d: 0.48, h: 0.30, texSide: 7, texTop: 7 },
  // Ampli guitare
  { x: 13.0, y: 2.4, w: 0.55, d: 0.38, h: 0.72, texSide: 4 },
];
