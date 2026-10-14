// Where the windows on the moon are cut (decor/windows.js builds them, check-windows.mjs proves them).
// Pure data (no three.js, no DOM). World: x = map column, z = map row, y up; every height is above the LOCAL floor.
//
//   kind 'wall'      (x, z) = centre of the opening ON THE WALL FACE; facing = unit normal pointing INTO the room [fx, fz];
//                    w = width along the wall, h = height, sill = height of the bottom edge above floorAt().
//   kind 'skylight'  (x, z) = centre on the ceiling, w (along x) × d (along z); the pane sits at ceilAt(x, z).
//
//   skyYaw (degrees)  rotates the sky lookup of that window:  lookup azimuth = view azimuth + skyYaw, with the headings of
//                     the sky (0 = east / +x, 90 = south / +z, 180 = west, 270 = north), so the Earth (props/sky.js EARTH.az)
//                     shows through the window where the view azimuth is  EARTH.az − skyYaw.  Each wall has its own: the sky
//                     is not one global sphere, it is turned wall by wall so that the Earth sits where a visitor looks from
//                     (see EARTH_VIEW). Windows of one wall share their skyYaw.
//
// How the numbers were chosen (the proofs are in check-windows.mjs; `node check-windows.mjs --free` lists every free span)
//   · The eye is at 0.5 m and the camera is level by default: the horizon of a window sits at 0.5 m on its glass. A sill under
//     0.5 shows the lunar ground, the horizon and the sky (the main windows, where the Earth rises just over the hills: it
//     stands 7.5° up, 12° across, props/sky.js EARTH); a sill over 0.5 shows sky only (the high ones: the Earth enters them
//     from a few metres away, the further the higher the sill).
//   · Heights are chosen against the room: head ≥ 0.12 m under the ceiling, sill ≥ 0.2 m over the floor.
//   · Spans between the doors, consoles, racks, frames, plinths, props and notes are the only places left; widths and heights
//     vary on purpose (a tall slit next to a wide low window), never an evenly spaced row.
//   · The skylight is seen by looking up (a level camera sees a ceiling point only from 4.6 m away, the 35° freelook, a shear of the projection, from 1.5 m).
//   · The sealed push-wall of the atrium (south wall, x 12–13) is a secret: no window flanks it, none is cut in that wall.
//   · The PROD room's one window is a secret too: a 0.5 m porthole on its entrance wall, the only wall the room's black
//     overlays do not cover; it is the room's single natural light.
import { EARTH } from '../props/sky.js';

// View azimuth (degrees) at which the Earth shows through the windows of a wall, seen from the spot named after it.
// It is the bearing from that spot to the wall's main window, plus a few degrees so that the Earth is not dead centre.
export const EARTH_VIEW = Object.freeze({
  atriumW: 195,     // from the spawn (12.5, 15.4), toward the lancet window south of the west door
  atriumE: 349,     // from the spawn, toward the window south of the east door (the lit side of the disc shows left of the tech pillar)
  atriumN: 292,     // from the spawn, toward the window above the server rack, right of the north vestibule
  armW: 166,        // from the door (7.2, 12.5), toward the wide window left of the SKILLS console
  armN: 267,        // from the middle of the room (4.7, 12.5), toward the clerestory over the north rack
  armS: 76,         // from the middle of the room, toward the clerestory over the south rack
  troE: 350,        // from the west door (17.5, 12.5), toward the tall window north of the MISSIONS console
  troW: 210,        // from the east side (21, 12.5), toward the high window over the north-west plinth
  quaS: 62,         // from the CONTACT console (13, 3.5), toward the big window of the south wall
  quaW: 198,        // from the rug (11, 4.5) and from the middle of the room (12.5, 4.5), toward the window between the plant and the PROFILE console
  prodN: 245,       // from the arcade console (12.5, 20.5), toward the porthole on the entrance wall
});

// Degrees in [−180, 180) that put the Earth at view azimuth `view`.
const yaw = view => ((EARTH.az - view) % 360 + 540) % 360 - 180;

export const WINDOWS = Object.freeze([
  // ── Atrium: tall hall (floor 0, ceiling 2.0). Three wall windows in three different corners (the north-west one is the
  // DF STATUS console's) and a skylight over the hub. ─────────────────────────────────────────────────────────────────
  // West wall, south of the Armurerie door: a lancet, 0.66 × 1.5, between the door's soffite sign and the tech pillar.
  { id: 'atr-w1', room: 'atrium', kind: 'wall', x: 9, z: 14.68, facing: [1, 0], w: 0.66, h: 1.5, sill: 0.25, skyYaw: yaw(EARTH_VIEW.atriumW) },
  // East wall, south of the Trophées door: shorter and a touch narrower than its west cousin (0.6 × 1.25).
  { id: 'atr-e1', room: 'atrium', kind: 'wall', x: 16, z: 14.63, facing: [-1, 0], w: 0.6, h: 1.25, sill: 0.3, skyYaw: yaw(EARTH_VIEW.atriumE) },
  // North wall, right of the Quartiers vestibule: over the server rack (0.85 m), level with the soffite signs, the one window
  // in the visitor's first view. 0.66 × 0.9, sill 0.95.
  { id: 'atr-n1', room: 'atrium', kind: 'wall', x: 14.67, z: 9, facing: [0, 1], w: 0.66, h: 0.9, sill: 0.95, skyYaw: yaw(EARTH_VIEW.atriumN) },
  // Skylight over the hub: the free band of the ceiling between the two rows of lit panels (cells 10 and 13 → z 10–11 and 13–14),
  // 3.0 × 1.7 centred on the hub (12.5, 12), 0.15 m clear of every panel.
  { id: 'atr-sky', room: 'atrium', kind: 'skylight', x: 12.5, z: 12, w: 3.0, d: 1.7, skyYaw: 0 },

  // ── Armurerie: green, low (floor −0.2, ceiling 1.45: 1.65 m inside). The racks take the north and south walls up to 1.04 m. ──
  // West wall, left of the SKILLS console: the wide low window (1.5 × 1.05).
  { id: 'arm-w1', room: 'armurerie', kind: 'wall', x: 2, z: 14.25, facing: [1, 0], w: 1.5, h: 1.05, sill: 0.3, skyYaw: yaw(EARTH_VIEW.armW) },
  // West wall, right of the console: the narrow tall one (0.62 × 1.2).
  { id: 'arm-w2', room: 'armurerie', kind: 'wall', x: 2, z: 11.42, facing: [1, 0], w: 0.62, h: 1.2, sill: 0.3, skyYaw: yaw(EARTH_VIEW.armW) },
  // North wall, over the family-1..4 rack: a clerestory ribbon (1.3 × 0.4, sill 1.12 = 8 cm over the rack top). From the middle
  // of the room (3.5 m) it spans 10°..16° up and catches the top of the Earth's disc (7.5° ± 6°); its centre sits in it from 4.7 to 7.7 m.
  { id: 'arm-n1', room: 'armurerie', kind: 'wall', x: 4.5, z: 9, facing: [0, 1], w: 1.3, h: 0.4, sill: 1.12, skyYaw: yaw(EARTH_VIEW.armN) },
  // South wall, over the family-5..7 rack: its twin, shifted 1.1 m east and a little shorter (1.1 × 0.4).
  { id: 'arm-s1', room: 'armurerie', kind: 'wall', x: 5.6, z: 16, facing: [0, -1], w: 1.1, h: 0.4, sill: 1.12, skyYaw: yaw(EARTH_VIEW.armS) },

  // ── Trophées: amber (floor −0.2, ceiling 1.7: 1.9 m inside). Frames fill the north and south walls; the east wall has the
  // MISSIONS console between two windows, the west wall a high one over the first diorama. ────────────────────────────────
  // East wall, north of the console: tall and wide, 1.3 × 1.3.
  { id: 'tro-e1', room: 'trophees', kind: 'wall', x: 23, z: 11.1, facing: [-1, 0], w: 1.3, h: 1.3, sill: 0.3, skyYaw: yaw(EARTH_VIEW.troE) },
  // East wall, south of the console: smaller, 1.0 × 1.0.
  { id: 'tro-e2', room: 'trophees', kind: 'wall', x: 23, z: 13.95, facing: [-1, 0], w: 1.0, h: 1.0, sill: 0.3, skyYaw: yaw(EARTH_VIEW.troE) },
  // West wall, north of the door: sky only (sill 0.95, above the 0.88 m dioramas), 0.8 × 0.75.
  { id: 'tro-w1', room: 'trophees', kind: 'wall', x: 17, z: 10.2, facing: [1, 0], w: 0.8, h: 0.75, sill: 0.95, skyYaw: yaw(EARTH_VIEW.troW) },

  // ── Quartiers: warm lounge (floor −0.2, ceiling 1.35: 1.55 m inside). The north wall is the feature wall (blueprint, lamp,
  // CONTACT console and its neon, key hook, cat crate, barbecue): no window there. ─────────────────────────────────────────
  // South wall, east of the vestibule mouth: the big low window (1.2 × 0.95).
  { id: 'qua-s1', room: 'quartiers', kind: 'wall', x: 15.2, z: 7, facing: [0, -1], w: 1.2, h: 0.95, sill: 0.3, skyYaw: yaw(EARTH_VIEW.quaS) },
  // West wall, between the plant and the PROFILE console: a slit, 0.6 × 1.0.
  { id: 'qua-w1', room: 'quartiers', kind: 'wall', x: 8, z: 3.35, facing: [1, 0], w: 0.6, h: 1.0, sill: 0.3, skyYaw: yaw(EARTH_VIEW.quaW) },
  // West wall, over the sofa's west end (sofa top 0.5, sill 0.55): 0.7 × 0.85.
  { id: 'qua-w2', room: 'quartiers', kind: 'wall', x: 8, z: 6.2, facing: [1, 0], w: 0.7, h: 0.85, sill: 0.55, skyYaw: yaw(EARTH_VIEW.quaW) },

  // ── PROD (the secret room, floor −0.25, ceiling 0.9: 1.15 m inside): ONE porthole, flagged in the report. On the entrance wall
  // (z 18), west of the opening: the south, west and east walls are under black overlays (decor/secret.js), this one is not.
  // 0.5 × 0.5, sill 0.45: a visitor who turns round in the dark sees the Earth glow; it is clear of the crate and the cat's eyes. ─
  { id: 'prod-p1', room: 'prod', kind: 'wall', x: 11.33, z: 18, facing: [0, 1], w: 0.5, h: 0.5, sill: 0.45, skyYaw: yaw(EARTH_VIEW.prodN) },
]);
