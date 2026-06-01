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
  // ── Skills room (cols 1–8, rows 13–16) — west wall, faces +X ─────────────
  { id: 'skills',   type: 'skills',   x: 1.45, z: 15.0, facing: [1, 0],
    title: 'ARMURERIE // SKILLS.DAT', color: '#00ff41' },

  // ── Projects room (cols 13–19, rows 7–10) — east wall, faces -X ──────────
  { id: 'projects', type: 'projects', x: 19.55, z: 9.0, facing: [-1, 0],
    title: 'TROPHÉES // MISSIONS.LOG', color: '#ff8c00' },

  // ── Passions room (cols 6–14, rows 1–3) — north wall, faces +Z ──────────
  { id: 'passions', type: 'passions', x: 9.0, z: 1.45, facing: [0, 1],
    title: 'QUARTIERS // PROFILE.SYS', color: '#cc44ff' },
];

// Screen-centre height and how far in front the camera parks when focused.
export const SCREEN_CY  = 0.64;
export const FOCUS_RANGE = 1.9;
export const FOCUS_DIST  = 0.62;

// Axis-aligned floor footprints for player collision (all consoles are wall-aligned).
export function consoleAABBs(margin = 0.12) {
  const ALONG = 0.5;  // half-width along the wall
  const DEEP  = 0.32; // half-depth into the room
  return SCREENS.map(({ x, z, facing: [fx, fz] }) => {
    const [hx, hz] = fx !== 0 ? [DEEP, ALONG] : [ALONG, DEEP];
    return {
      minX: x - hx - margin, maxX: x + hx + margin,
      minZ: z - hz - margin, maxZ: z + hz + margin,
    };
  });
}
