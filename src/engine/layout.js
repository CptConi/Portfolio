// Cross-module layout contract: fixed world positions that several modules must
// agree on (decor, props, features). World conventions:
//   x = map column, z = map row (the player's `y` is world z), y = height.
//   north = −z (player heading 270°), south = +z, east = +x, west = −x.
//   floorAt(x, z) / ceilAt(x, z) give the local floor / ceiling heights.
// Add a constant here when two modules need the same spot; do not duplicate numbers.

// ── Atrium: the Digital Factory STATUS console (north wall, left of the vestibule) ──
// Console centre; its back sits ~0.32 m off the wall face (z = 9.0). Width 1.0 m
// along x, so it spans x ∈ [10.0, 11.0]. Faces south, toward the spawn.
export const DASHBOARD = { id: 'dashboard', x: 10.5, z: 9.6, facing: [0, 1] };

// Hidden PROD panel on the EAST side face of that console (x = 11.0, faces +x).
// y is the world height of the button centre (atrium floor is 0).
export const PROD_PANEL = { x: 11.0, y: 0.40, z: 9.55, facing: [1, 0] };

// ── Quartiers (comms room): the PROD key hangs on the north wall (face z = 2.0) ──
// Quartiers floor is −0.2 and the eye is 0.5 above the local floor, so y = 0.33 is
// roughly eye level. Faces south (+z).
export const PROD_KEY = { x: 14.3, y: 0.33, z: 2.04, facing: [0, 1] };

// ── Secret ──
// The sealed push-wall (see Map.js PUSH_WALL) — world centre of its cell.
export const SECRET_WALL = { x: 12.5, z: 16.5 };

// Gallery (Trophées): plinth positions come from PlinthGenerator.getDynamicPlinths().
// Plinth top is 0.5 above the local floor; dioramas stand on it (origin = top centre).
export const PLINTH_TOP = 0.5;
