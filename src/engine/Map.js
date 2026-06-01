// Atrium layout — a tall central hall (type 6) with the landmark at its centre.
// Four doors lead off it: Armurerie (W), Trophées (E), Quartiers (N), and the
// hidden Arcade (S, behind a push-wall). You spawn inside the atrium.
//
// 0 = corridor / vestibule (low ceiling)
// 1 = wall
// 2 = skills / armurerie     3 = projects / trophées     4 = passions / quartiers
// 5 = secret arcade room     6 = atrium (cathedral hall)
export const MAP = [
//      0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24
  [ 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1 ], // 0
  [ 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1 ], // 1
  [ 1, 1, 1, 1, 1, 1, 1, 1, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1, 1, 1, 1, 1, 1, 1, 1 ], // 2  quartiers
  [ 1, 1, 1, 1, 1, 1, 1, 1, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1, 1, 1, 1, 1, 1, 1, 1 ], // 3
  [ 1, 1, 1, 1, 1, 1, 1, 1, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1, 1, 1, 1, 1, 1, 1, 1 ], // 4
  [ 1, 1, 1, 1, 1, 1, 1, 1, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1, 1, 1, 1, 1, 1, 1, 1 ], // 5
  [ 1, 1, 1, 1, 1, 1, 1, 1, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1, 1, 1, 1, 1, 1, 1, 1 ], // 6
  [ 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1 ], // 7  vestibule N
  [ 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1 ], // 8  vestibule N
  [ 1, 1, 2, 2, 2, 2, 2, 2, 1, 6, 6, 6, 6, 6, 6, 6, 1, 3, 3, 3, 3, 3, 3, 1, 1 ], // 9  armu | atrium | proj
  [ 1, 1, 2, 2, 2, 2, 2, 2, 1, 6, 6, 6, 6, 6, 6, 6, 1, 3, 3, 3, 3, 3, 3, 1, 1 ], // 10
  [ 1, 1, 2, 2, 2, 2, 2, 2, 0, 6, 6, 6, 6, 6, 6, 6, 0, 3, 3, 3, 3, 3, 3, 1, 1 ], // 11 doors W/E
  [ 1, 1, 2, 2, 2, 2, 2, 2, 0, 6, 6, 6, 6, 6, 6, 6, 0, 3, 3, 3, 3, 3, 3, 1, 1 ], // 12 doors W/E
  [ 1, 1, 2, 2, 2, 2, 2, 2, 0, 6, 6, 6, 6, 6, 6, 6, 0, 3, 3, 3, 3, 3, 3, 1, 1 ], // 13 doors W/E
  [ 1, 1, 2, 2, 2, 2, 2, 2, 1, 6, 6, 6, 6, 6, 6, 6, 1, 3, 3, 3, 3, 3, 3, 1, 1 ], // 14
  [ 1, 1, 2, 2, 2, 2, 2, 2, 1, 6, 6, 6, 6, 6, 6, 6, 1, 3, 3, 3, 3, 3, 3, 1, 1 ], // 15
  [ 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1 ], // 16 atrium S wall (push-wall @12)
  [ 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1 ], // 17 secret vestibule
  [ 1, 1, 1, 1, 1, 1, 1, 1, 1, 5, 5, 5, 5, 5, 5, 5, 1, 1, 1, 1, 1, 1, 1, 1, 1 ], // 18 arcade
  [ 1, 1, 1, 1, 1, 1, 1, 1, 1, 5, 5, 5, 5, 5, 5, 5, 1, 1, 1, 1, 1, 1, 1, 1, 1 ], // 19
  [ 1, 1, 1, 1, 1, 1, 1, 1, 1, 5, 5, 5, 5, 5, 5, 5, 1, 1, 1, 1, 1, 1, 1, 1, 1 ], // 20
  [ 1, 1, 1, 1, 1, 1, 1, 1, 1, 5, 5, 5, 5, 5, 5, 5, 1, 1, 1, 1, 1, 1, 1, 1, 1 ], // 21
  [ 1, 1, 1, 1, 1, 1, 1, 1, 1, 5, 5, 5, 5, 5, 5, 5, 1, 1, 1, 1, 1, 1, 1, 1, 1 ], // 22
  [ 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1 ], // 23
  [ 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1 ], // 24
];

export const MAP_WIDTH = MAP[0].length;
export const MAP_HEIGHT = MAP.length;

// Hidden push-wall on the atrium's south wall → slides up to reveal the arcade.
export const PUSH_WALL = { mx: 12, my: 16 };
let _secretOpen = false;
export function setSecretOpen(v) { _secretOpen = v; }
export function isSecretOpen() { return _secretOpen; }

export function isWall(x, y) {
  const mx = Math.floor(x);
  const my = Math.floor(y);
  if (mx < 0 || mx >= MAP_WIDTH || my < 0 || my >= MAP_HEIGHT) return true;
  if (mx === PUSH_WALL.mx && my === PUSH_WALL.my) return !_secretOpen;
  return MAP[my][mx] === 1;
}

export function getCellType(x, y) {
  const mx = Math.floor(x);
  const my = Math.floor(y);
  if (mx < 0 || mx >= MAP_WIDTH || my < 0 || my >= MAP_HEIGHT) return 1;
  return MAP[my][mx];
}

// ── Verticality ────────────────────────────────────────────────────────────
// Atrium (6) is the cathedral; rooms step DOWN a little; vestibules are low and
// tight so the atrium "opens up" dramatically on entry.
const FLOOR_H = { 0: 0, 2: -0.2, 3: -0.2, 4: -0.2, 5: -0.25, 6: 0 };
const CEIL_H  = { 0: 0.85, 2: 1.05, 3: 1.3, 4: 0.95, 5: 0.9, 6: 2.0 };
export const STEP_MAX = 0.3;

// Threshold cells get an intermediate floor for 2-step ramps into the rooms.
const FLOOR_OVERRIDE = {
  '8,11': -0.1, '8,12': -0.1, '8,13': -0.1,        // → armurerie (W door)
  '16,11': -0.1, '16,12': -0.1, '16,13': -0.1,     // → trophées (E door)
  '11,7': -0.1, '12,7': -0.1, '13,7': -0.1,        // → quartiers (N vestibule)
  '11,8': -0.1, '12,8': -0.1, '13,8': -0.1,
  '12,17': -0.12,                                  // → arcade (secret)
};

export function floorAt(x, y) {
  const mx = Math.floor(x), my = Math.floor(y);
  const o = FLOOR_OVERRIDE[mx + ',' + my];
  return o !== undefined ? o : (FLOOR_H[getCellType(x, y)] ?? 0);
}
export function ceilAt(x, y) { return CEIL_H[getCellType(x, y)] ?? 1; }
