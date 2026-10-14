// Layout of the EXTERIOR world: the base seen from outside, in the same coordinates as the level
// (x = map column, z = map row, y up, metres). Pure data (no three.js, no DOM): the exterior builder,
// its props and the window proofs all read it.
//
// The exterior world is a second scene, drawn from the player's own camera into a texture that the window
// panes show (decor/windows.js). It never contains the interior: every block below is the HULL of a room,
// seen from outside at its real height (ceiling + a 0.3 m slab), and its faces are drawn from outside only
// (FrontSide): from inside a block you see through it. Two rules keep that honest:
//   · a block is never SMALLER than the room it hides (a pane sits on the room's wall face, which is on the
//     block's face or inside it): nothing of the exterior may stand between the camera and a pane;
//   · the atrium is the tallest block and carries the drum, the dome and the masts; the wings stand about
//     2.2 m above the plain. A window of a room therefore looks mostly at its neighbours' hulls across the
//     1 m alleys (the Armurerie's east wall from the atrium's west window, the Quartiers' south wall from
//     its north one...): each hull has its own identity (colour, lit windows, markings) and the alleys are
//     dressed. Sky shows above the roof lines, from outer walls, and when the visitor looks up.
//
// Between two blocks there is a 1 m alley (the thickness of the wall cells); tubes cross it at the doors.

export const GROUND_Y = -0.45;

// Hulls = the interior footprints of the rooms (open cells), so panes lie on a block's face.
export const BLOCKS = Object.freeze([
  { id: 'quartiers', x0: 8,  x1: 17, z0: 2,  z1: 7,  roofY: 1.65,  note: 'north wing, lounge (ceiling 1.35)' },
  { id: 'armurerie', x0: 2,  x1: 8,  z0: 9,  z1: 16, roofY: 1.75,  note: 'west wing (ceiling 1.45)' },
  { id: 'trophees',  x0: 17, x1: 23, z0: 9,  z1: 16, roofY: 2.0,   note: 'east wing (ceiling 1.7)' },
  { id: 'atrium',    x0: 9,  x1: 16, z0: 9,  z1: 16, roofY: 2.5,   note: 'the hall, the tallest block (ceiling 2.0); the skylight is at (12.5, 12)' },
  { id: 'annex',     x0: 9,  x1: 16, z0: 18, z1: 23, roofY: 1.2,   note: 'south annex, the PROD room (ceiling 0.9, floor -0.25)' },
]);

// Corridors that cross an alley, as boxes on the same footprints as the level's door/vestibule cells.
export const LINKS = Object.freeze([
  { id: 'link-n', x0: 11, x1: 14, z0: 7,  z1: 9,  roofY: 0.75, note: 'north vestibule: quartiers ↔ atrium' },
  { id: 'link-w', x0: 8,  x1: 9,  z0: 11, z1: 14, roofY: 0.75, note: 'west door: armurerie ↔ atrium' },
  { id: 'link-e', x0: 16, x1: 17, z0: 11, z1: 14, roofY: 0.75, note: 'east door: atrium ↔ trophees' },
]);

// The skylight of the atrium (windowSlots 'atr-sky'): the exterior must leave the sky above it free of
// anything lower than SKYLIGHT_CLEAR_Y inside this footprint (masts and antennas may rise above it).
export const SKYLIGHT = Object.freeze({ x0: 11, x1: 14, z0: 11, z1: 13, clearY: 3.0 });

// How far the exterior reaches around the base (the camera far plane is 50 m).
export const WORLD_RADIUS = 46;

// The sun lights the exterior with one directional light and sets the phase of the Earth in the sky;
// both read props/sky.js (SUN, EARTH). Headings: 0 = east (+x), 90 = south (+z), 180 = west, 270 = north.
