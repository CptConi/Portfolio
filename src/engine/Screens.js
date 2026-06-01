// Diegetic interactive consoles placed against room walls.
// Each console = cabinet + tilted keyboard deck + upright monitor whose screen
// is a CanvasTexture (see TerminalScreen.js). Press E to focus: the camera
// glides in front of the small screen so it fills the view.
//
//  x, z    : console centre on the floor, in map coords (world X / world Z)
//  facing  : unit normal the console front points toward (into the room), [fx, fz]
//  type    : content renderer key — 'skills' | 'projects' | 'passions'
//  title   : header label
//  color   : screen accent colour (matches ROOMS)

export const SCREENS = [
  // ── Armurerie (W room, cols 2–7 rows 9–15) — west wall, faces +X ─────────
  { id: 'skills',   type: 'skills',   x: 2.6, z: 12.5, facing: [1, 0],
    title: 'ARMURERIE // SKILLS.DAT', color: '#00ff41' },

  // ── Trophées (E room, cols 17–22 rows 9–15) — east wall, faces -X ────────
  { id: 'projects', type: 'projects', x: 22.4, z: 12.5, facing: [-1, 0],
    title: 'TROPHÉES // MISSIONS.LOG', color: '#ff8c00' },

  // ── Quartiers (N room, cols 8–16 rows 2–6) — north wall, faces +Z ───────
  { id: 'passions', type: 'passions', x: 12.5, z: 2.6, facing: [0, 1],
    title: 'QUARTIERS // PROFILE.SYS', color: '#cc44ff' },
];

// Screen-centre height and how far in front the camera parks when focused.
export const SCREEN_CY  = 0.64;
export const FOCUS_RANGE = 1.9;
export const FOCUS_DIST  = 0.62;

// Secret arcade console (BUG HUNTER) — far (south) wall of the arcade, faces north.
export const ARCADE = { x: 12.5, z: 21.4, facing: [0, -1], id: 'arcade' };

function aabbOf({ x, z, facing: [fx, fz] }, margin) {
  const ALONG = 0.5;  // half-width along the wall
  const DEEP  = 0.32; // half-depth into the room
  const [hx, hz] = fx !== 0 ? [DEEP, ALONG] : [ALONG, DEEP];
  return {
    minX: x - hx - margin, maxX: x + hx + margin,
    minZ: z - hz - margin, maxZ: z + hz + margin,
  };
}

// Axis-aligned floor footprints for player collision (consoles + arcade).
export function consoleAABBs(margin = 0.12) {
  return [...SCREENS, ARCADE].map(s => aabbOf(s, margin));
}
