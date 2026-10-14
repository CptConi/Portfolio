// Where the windows on the moon are cut (decor/windows.js builds them, check-windows.mjs proves them).
// Pure data (no three.js, no DOM). World: x = map column, z = map row, y up; every height is above the LOCAL floor of the room.
//
//   kind 'wall'      (x, z) = centre of the opening ON THE WALL FACE; facing = unit normal pointing INTO the room [fx, fz];
//                    w = width along the wall, h = height, sill = height of the bottom edge above floorAt().
//   kind 'skylight'  (x, z) = centre on the ceiling, w (along x) × d (along z); the pane sits at ceilAt(x, z).
//   dress (optional) one sentence for the exterior props dresser: what the glass stares at (a wall of the base within ~2.6 m) and what is
//                    worth hanging there. The check demands it of every window that mostly shows such a wall. decor/windows.js reads it too:
//                    a window with a `dress` note is in the shadow of the wall it stares at (no direct sun on its floor pool).
//
// Version 3: a window is a pane onto ONE real exterior world (src/engine/exterior/, drawn from the player's own camera) under ONE sky, so
// there is no per-window sky (no skyYaw, no EARTH_VIEW): a window shows what really lies in its direction. The base seen from outside is
// exterior/exteriorLayout.js: five hulls at their real height, drawn from outside only (from inside a hull you see through it).
//   hull        roof   what stands above the plain (ground −0.45)       a window of it looks over / across
//   atrium      2.5    ~3 m: the tower, with the drum, dome, masts       the wings' walls (1 m alleys W and E, the Quartiers 2 m N); no window S (the secret's wall)
//   trophees    2.0    ~2.5 m                                            the tower's east face (1 m), the Quartiers' south end, the plain E
//   armurerie   1.75   ~2.2 m                                            the tower's west face (1 m), the Quartiers (2 m N), the annex, the plain W
//   quartiers   1.65   ~2.1 m                                            the tower's north face (2 m), the Trophées / Armurerie walls, the plain N
//   annex       1.2    ~1.65 m (PROD, the low one)                       the tower's south face (2 m); seen from the wings only by its ROOF PLANT (LANDMARKS)
//   corridors   0.75   the three tubes that cross the alleys at the doors
//   outward (the way the glass looks) → what lies there                 (props/sky.js BODIES, exterior/exteriorLayout.js)
//   SOUTH   heading  90°  the Earth (el 11°), the orbital station, the Mars-red dot; the annex's roof (1.2) lies under every ray, but for the PROD plant on it (arm-s1)
//   EAST    heading   0°  the Sun (ESE, 30°, el 15°), the mug, Venus, the saucer; the Trophées' own side of the plain
//   NORTH   heading 270°  the ringed giant half-risen (el 4°), its two moons; the Quartiers across the 2 m alley, the plain beyond
//   WEST    heading 180°  the asteroid stream, the duck, the comet, Saturn; the plain beyond the Armurerie
//
// How the numbers were chosen (the proofs are in check-windows.mjs; `node check-windows.mjs --free` lists every free span, the VIEW TABLE
// says what each window shows and from where, `--dress` re-prints the notes for the exterior dressers)
//   · The eye is at 0.5 m over the floor (0.3 m world in the wings, 0.25 in PROD) and the camera is level by default: the horizon of a window
//     sits at the eye height on its glass. A neighbour's wall fills the glass up to its roof line, and sky shows above it: a window that stares
//     at a wall is given, where the room allows it, a head above the neighbour's parapet so that it frames the wall AND a slice of sky. The glass
//     is sunk 0.22 m behind the wall face: from inside, the top edge of a window sees over a parapet when the head is above (roof − eye) × (L / (L + d))
//     + eye, L = distance eye → glass, d = distance glass → wall (the VIEW TABLE prints the roof line of every vantage in degrees).
//   · The Earth is SOUTH, so it shows only through windows that face south (arm-s1, tro-s1). qua-s1 faces south too but the atrium tower stands
//     2 m in front of it and hides the horizon: it shows the tower, not the Earth (that is the point of it). The south walls are full (racks,
//     gallery frames), so those windows are ribbons 0.22–0.44 m tall: the Earth is 13° across and a ribbon frames 4–8° of it, i.e. at most
//     ~58 % of the disc through arm-s1 and ~23 % (a band) through tro-s1 (the check prints "never more than X % of its disc").
//   · Heights are chosen against the room: head ≥ 0.12 m under the ceiling, sill ≥ 0.2 m over the floor.
//   · Spans between the doors, consoles, racks, frames, plinths, props and notes are the only places left; widths and heights vary on purpose
//     (a tall slit next to a wide low window), never an evenly spaced row.
//   · The skylight is seen by looking up (a level camera sees a ceiling point only from 4.6 m away, the 35° freelook, a shear of the projection, from 1.5 m).
//   · The sealed push-wall of the atrium (south wall, x 12–13) is a secret: no window flanks it, none is cut in that wall, and no window of the
//     public rooms looks at the alley segment behind it (x 12–13, z 16–18) nor at the annex's door.
//   · The PROD room's one window is a secret too: a 0.5 m porthole on its entrance wall, the only wall the room's black overlays do not cover;
//     it is the room's single natural light.
//   · The PROD annex (roof 1.2, the lowest hull) cannot be seen from a wing by its walls. The eye of a wing is 0.3 m (floor −0.2) and every south wall is
//     full (racks 1.04, gallery frames 1.47): the glass starts at 1.09, 0.6 m over the eye, so its rays go UP and clear the annex's roof line (+0.9 m over the
//     eye, 3–7 m away) from every spot: its hazard door and the stencils on its west and east faces are seen from nowhere (the previous layout counted on the
//     slit arm-e1, which glimpses its north wall 50–75° off axis: 27 % of that pane, no stencil legible). What a south window frames of it is what stands over
//     its parapet. So the annex announces itself by a ROOF PLANT (LANDMARKS.annexPlant: a bulkhead with the red hazard door, the lit PROD plate over it and a
//     red lamp, turned to face the Armurerie) and the ribbon arm-s1 is cut so that the plate is in its glass: at least half of it from 36 % of the room's spots
//     (the centre-north: x 2–6.25, z 9.75–13.25), all of it from 10 %, a letter 14–23 px tall on a 640 × 360 screen (check-windows.mjs proves it with the
//     real geometry, check-exterior.mjs with the built one and the props on the roof). The atrium's south wall is the secret's, and the Trophées' south wall
//     is full (the ribbon tro-s1 is above the frames): the plant faces the Armurerie only.
//   · Nothing of the exterior may stand between an eye and a pane (exteriorLayout.js: a block is never smaller than its room; the camera is inside
//     its own hull, whose faces are not drawn, and its neighbours lie beyond the pane): check-windows.mjs traces every eye of every room to
//     every point of every pane, through the opening, with the real hull boxes, to prove it.

export const WINDOWS = Object.freeze([
  // ── Atrium: tall hall (floor 0, ceiling 2.0). Three wall windows in three different corners (the north-west one is the
  // DF STATUS console's) and a skylight over the hub. The hall is the tower: its windows look across the alleys at the wings' walls and, above
  // their roof lines (1.65–2.0), out at the sky. ──
  // West wall, south of the Armurerie door: a lancet, 0.66 × 1.6 (head 1.85, 15 cm under the ceiling), between the door's soffite sign and the
  // tech pillar. The Armurerie's east face stands 1 m beyond the glass, 1.75 high: green wall up to its parapet, the lit glass of arm-e1 across
  // the alley, then sky over the roof line (a third of the glass; the roof line is 8–25° up).
  { id: 'atr-w1', room: 'atrium', kind: 'wall', x: 9, z: 14.68, facing: [1, 0], w: 0.66, h: 1.6, sill: 0.25,
    dress: 'The glass stares at the Armurerie\'s east face from 1 m across the alley: x 8, core z 14.5–15.7, y 0.4–1.5 (the whole face z 11.8–16, y 0.25–1.75 is seen from the north of the hall): its own lit window arm-e1 (z 14.73–15.17, y 0.0–0.9) faces you; a green hull stencil, a cable tray, a pipe run, a service lamp; the parapet at 1.75 and the sky over it (roof line at 8–25° up).' },
  // East wall, south of the Trophées door: a touch narrower and shorter than its west cousin (0.6 × 1.55, head 1.85). The Trophées' west face stands
  // 1 m beyond the glass, 2.0 high: amber wall up to its parapet, sky only above it from the near half of the hall (a fifth of the glass).
  { id: 'atr-e1', room: 'atrium', kind: 'wall', x: 16, z: 14.63, facing: [-1, 0], w: 0.6, h: 1.55, sill: 0.3,
    dress: 'The glass stares at the Trophées\' west face from 1 m across the alley: x 17, core z 14.4–15.7, y 0.5–1.9 (the whole face z 11.7–16, up to the 2.0 parapet is seen from the north of the hall): an amber hull stencil, a cable tray, a pipe run with a valve, a service lamp; sky over the parapet from the near half of the hall (roof line at 10–30° up).' },
  // North wall, right of the Quartiers vestibule: over the server rack (0.85 m), level with the soffite signs, the one window in the visitor's
  // first view. 0.66 × 0.9, sill 0.95. The Quartiers' south face stands 2 m beyond the glass, 1.65 high: the glass is above the eye, so it frames
  // the top of that wall (its cornice, y 1.2–1.65) and, over the parapet (the head, 1.85, is above it: the wall AND the sky are in the frame),
  // the ringed giant, the moons, the Quartiers' roof-edge vents against the stars.
  { id: 'atr-n1', room: 'atrium', kind: 'wall', x: 14.67, z: 9, facing: [0, 1], w: 0.66, h: 0.9, sill: 0.95,
    dress: 'The glass stares at the Quartiers\' south face from 2 m across the alley: x 14.4–16.6 (the whole face x 13.1–17 is seen), z 7, y 1.2–1.65 ONLY (the glass is above the eye: the top 0.45 m of the wall, its cornice and the parapet at 1.65, show; nothing lower): a warm cornice stencil, a roof-edge vent or two and a lamp standing against the sky (they show up to ~0.5 m over the parapet, within 2 m of the edge), the vestibule tube link-n (x 11–14) at the left edge.' },
  // Skylight over the hub: the free band of the ceiling between the two rows of lit panels (cells 10 and 13 → z 10–11 and 13–14),
  // 3.0 × 1.7 centred on the hub (12.5, 12), 0.15 m clear of every panel. Zenith stars, the Milky Way, the Sun from the north-west of the hall,
  // and the drum, the dome and the masts of the tower's own roof.
  { id: 'atr-sky', room: 'atrium', kind: 'skylight', x: 12.5, z: 12, w: 3.0, d: 1.7 },

  // ── Armurerie: green, low (floor −0.2, ceiling 1.45: 1.65 m inside). The racks take the north and south walls up to 1.04 m. ──
  // West wall, left of the SKILLS console: the wide low window (1.5 × 1.2, head 1.5: 15 cm under the ceiling, tall enough to catch the
  // asteroid stream from 2.5 m). The outer wall of the wing: the plain to the west, the asteroid stream, the comet.
  { id: 'arm-w1', room: 'armurerie', kind: 'wall', x: 2, z: 14.25, facing: [1, 0], w: 1.5, h: 1.2, sill: 0.3 },
  // North wall, in the north-east corner over the corner prop (0.95 m high): a letterbox slit, 0.5 × 0.3 (sill 1.0, head 1.3). It looks across the 2 m
  // alley at the QUARTIERS: its south face fills the glass (x 8–13) from most of the room, its west end (x 8, z 2–7) the edge of it, and the ringed
  // giant rises over its roof line (1.65) from the far south-west. It was 0.5 tall: every ray through its upper half passed over the Quartiers' parapet
  // (black sky); the sill cannot go lower (the prop 0.95 and the rack 1.04 hide anything under 1.0) and a head over 1.53 is not allowed, so the glass
  // is made shorter instead: the wall now fills half of it from 73 % of the room's spots (62 % before), and from every spot over 3 m away.
  { id: 'arm-n1', room: 'armurerie', kind: 'wall', x: 7.45, z: 9, facing: [0, 1], w: 0.5, h: 0.3, sill: 1.0,
    dress: 'The glass stares at the Quartiers\' south face from 2 m across the alley: x 8.2–10.6 (the whole face x 8–13.3 is seen), z 7, y 1.1–1.55 ONLY (the glass starts at 1.0 and ends at 1.3: the top 0.5 m of the wall under the 1.65 parapet), and its west face x 8, z 4.4–6.9 beyond the corner (8, 7): a warm cornice, a roof-edge vent, a pipe, a lamp; the lit glass qua-w2 (z 5.85–6.55, y 0.35–1.2) is below the view.' },
  // South wall, over the family-5..7 rack and the corner prop: a long ribbon, 2.7 × 0.44 (x 5.0–7.7: 0.3 m from the corner), sill 1.09 (5 cm over the rack top,
  // 14 cm over the prop), head 1.53 (12 cm under the ceiling). It was a 1.1 m ribbon at x 5.05–6.15. Its west half looks SOUTH: the Earth (149 spots see it,
  // from 2.5 to 6.4 m, a ribbon-full of its disc: 58 % at best), the orbital station, the mug. Its east end looks SOUTH-EAST across the open plain at the PROD
  // annex (x 9–16, z 18–23, 3 to 7 m beyond the glass): the glass is above the eye, so its rays go over the annex's 1.2 roof and the annex's WALLS can never
  // be seen from it (see the note on the annex above); what shows is the ROOF PLANT: from the centre-north of the room the PROD plate, with the hazard
  // door under it and the lamp over it, stands in the glass against the stars (the VIEW TABLE: 36 % of the spots frame half of the plate).
  { id: 'arm-s1', room: 'armurerie', kind: 'wall', x: 6.35, z: 16, facing: [0, -1], w: 2.7, h: 0.44, sill: 1.09 },
  // East wall, south of the door: a slit, 0.44 × 0.9, sill 0.2, between the door's jamb and the corner prop. The atrium's west face stands 1 m beyond the glass
  // (its lit window atr-w1 faces it): a wall view (68 % of the pane). From the north-west of the room the glass slides past the tower's south-west corner
  // onto the PROD annex across the plain: its north face (x 9.3–10.7, z 18, the half of it that is not the secret's door) fills 27 % of the pane, 50–75° off the
  // axis, a glimpse. It no longer carries the annex alone: the ribbon arm-s1 does (the plant on its roof).
  { id: 'arm-e1', room: 'armurerie', kind: 'wall', x: 8, z: 14.95, facing: [-1, 0], w: 0.44, h: 0.9, sill: 0.2,
    dress: 'The glass stares at the atrium tower\'s west face from 1 m across the alley: x 9, core z 14.9–15.8, y 0.1–0.9 (the whole face z 12.9–16, y −0.3–1.8 is seen from the north of the room): its lit window atr-w1 (z 14.35–15.0, y 0.25–1.85) faces you, a cyan hull stencil, a cable tray, a pipe run, a service lamp; and, past its south-west corner (9, 16), the PROD annex\'s north face at 3 m: x 9.3–10.7 (whole x 9.0–11.3), z 18, y −0.1–1.1: the dark hull, the red hazard stencil \'PROD\' (never at x 11.8–13.2: the secret\'s door).' },

  // ── Trophées: amber (floor −0.2, ceiling 1.7: 1.9 m inside). Frames fill the north and south walls; the east wall has the
  // MISSIONS console between two windows, the west wall a high one over the first diorama. ────────────────────────────────
  // East wall, north of the console: tall and wide, 1.3 × 1.3. East: the plain, the Sun from the north-west of the room, Jupiter, the saucer.
  { id: 'tro-e1', room: 'trophees', kind: 'wall', x: 23, z: 11.1, facing: [-1, 0], w: 1.3, h: 1.3, sill: 0.3 },
  // East wall, south of the console: smaller, 1.0 × 1.0.
  { id: 'tro-e2', room: 'trophees', kind: 'wall', x: 23, z: 13.95, facing: [-1, 0], w: 1.0, h: 1.0, sill: 0.3 },
  // West wall, north of the door: sky only over the dioramas (sill 0.95, above their 0.88 m), 0.8 × 0.75. It looks at the atrium TOWER: its east
  // face stands 1 m away across the alley and fills the glass; the Quartiers' south-east corner shows past its north-east corner.
  { id: 'tro-w1', room: 'trophees', kind: 'wall', x: 17, z: 10.2, facing: [1, 0], w: 0.8, h: 0.75, sill: 0.95,
    dress: 'The glass stares at the atrium tower\'s east face from 1 m: x 16, core z 9.2–10.5, y 1.0–1.8 (the whole face z 9–13.6, up to 2.5, is seen from the east of the room): a lit window strip, a cable tray, a pipe run, a stencilled hull number, a service lamp; the 1 m alley floor is below the glass.' },
  // South wall, ABOVE the frames of the gallery (they top out at 1.47): a long clerestory ribbon, 2.4 × 0.22, sill 1.55. SOUTH: the Earth, seen
  // from the north half of the room as a band across the glass, over the lander's side of the plain.
  { id: 'tro-s1', room: 'trophees', kind: 'wall', x: 20, z: 16, facing: [0, -1], w: 2.4, h: 0.22, sill: 1.55 },

  // ── Quartiers: warm lounge (floor −0.2, ceiling 1.35: 1.55 m inside). The north wall is the feature wall (blueprint, lamp,
  // CONTACT console and its neon, key hook, cat crate, barbecue): no window there. ─────────────────────────────────────────
  // South wall, east of the vestibule mouth: the big low window (1.2 × 1.1, head 1.4: 15 cm under the ceiling), the one the visitor sees to the
  // right of the guitar and its amp. It looks at the BUILDING: 2 m across the alley the north face of the atrium tower (2.5 high, taller than any
  // ray) fills it from the east half of the room; from the west it slides past the tower's north-east corner onto the Trophées' west and north
  // faces (the Trophées' parapet is 2.0: sky shows over it from the far west). A wall view: the tower is taller than the glass can see over.
  { id: 'qua-s1', room: 'quartiers', kind: 'wall', x: 15.2, z: 7, facing: [0, -1], w: 1.2, h: 1.1, sill: 0.3,
    dress: 'The glass stares at the atrium tower\'s north face from 2 m: core x 14.1–15.8, y 0.2–1.65 (the whole face x 9.3–16, up to y 2.3 is seen from the corners of the room), and its north-east corner (x 16, z 9): a cable tray, vent grills, a lit window strip (atr-n1 sits at x 14.34–15.0, y 0.95–1.85), a ladder that stops at the parapet (2.5), a lamp, a stencilled DF; the alley floor (z 7–9) with a conduit; from the west, the Trophées\' north and west faces (z 9 and x 17, y up to 2.0).' },
  // West wall, between the plant and the PROFILE console: a slit, 0.6 × 1.0.
  { id: 'qua-w1', room: 'quartiers', kind: 'wall', x: 8, z: 3.35, facing: [1, 0], w: 0.6, h: 1.0, sill: 0.3 },
  // West wall, over the sofa's west end (sofa top 0.5, sill 0.55): 0.7 × 0.85. Across the plain the Armurerie's north face (2.7 m).
  { id: 'qua-w2', room: 'quartiers', kind: 'wall', x: 8, z: 6.2, facing: [1, 0], w: 0.7, h: 0.85, sill: 0.55 },
  // East wall, right of the guitar and the amp (facing east: south is on the right), over the brazier by the corner (0.66 m): sill 0.75, 0.7 × 0.66.
  // East: the Sun from the north-west of the lounge, over the Trophées' north face and the plain; Venus and the mug adrift beside it.
  { id: 'qua-e1', room: 'quartiers', kind: 'wall', x: 17, z: 6.3, facing: [-1, 0], w: 0.7, h: 0.66, sill: 0.75 },

  // ── PROD (the secret room, floor −0.25, ceiling 0.9: 1.15 m inside): ONE porthole, flagged in the report. On the entrance wall
  // (z 18), west of the opening: the south, west and east walls are under black overlays (decor/secret.js), this one is not.
  // 0.5 × 0.5, sill 0.45; it is clear of the crate and the cat's eyes. It looks north at the OUTSIDE of the push-wall: the atrium's south face, 2 m away. ─
  { id: 'prod-p1', room: 'prod', kind: 'wall', x: 11.33, z: 18, facing: [0, 1], w: 0.5, h: 0.5, sill: 0.45,
    dress: 'The glass stares at the atrium tower\'s south face from 2 m: core x 9.5–12.6, y 0.3–0.95 (the whole face x 9–16, up to y 2.2, is seen from the room\'s corners); the push-wall (x 12–13) is at the right edge of the view: a rusty service hatch with a faded stencil, a lamp, a pipe, a dented panel; the 2 m alley floor in between.' },
]);

// ── Landmarks: what a window is cut to frame that is not a hull ─────────────────────────────────────────────────────────────────────────────
// The PROD annex is the lowest hull (roof 1.2) and sits 2 m south of the atrium. A visitor's eye is 0.3 m (the wings, floor −0.2) or 0.5 m (the hall)
// above the world's zero, and every south wall of a wing is full (racks 1.04, gallery frames 1.47): the glass there starts at 1.09 (+0.6 m over the
// eye) and its rays only go up. They clear the annex's roof line (+0.9 m over the eye, 3 to 7 m away) from every spot: through a south window of a
// wing the annex's walls, its hazard door and the stencil painted on them are NEVER in view, only what stands higher than its parapet. So the annex is
// announced by a roof plant: a bulkhead with a red hazard door, the lit PROD sign over it and a red lamp, standing on the west part of its roof and
// turned to face the middle of the Armurerie (the ribbon arm-s1). exterior/props.js builds it from this table (hung on the 'annex' roof, inside its
// parapet, clear of the roof's other objects), check-windows.mjs proves it is framed, check-exterior.mjs proves it is legible at 640 × 360.
//   x, z      centre of the bulkhead's footprint; heading = the way its front face looks (0 east, 90 south: 230 = north-west); w along the face, d deep;
//   h         height of the bulkhead over the roof; plate = the lit sign on the front face: w × h, bottom edge y0 (world, over the plain at −0.45)
export const LANDMARKS = Object.freeze({
  annexPlant: Object.freeze({
    id: 'annex-plant', host: 'annex', x: 10.1, z: 21.7, heading: 230, w: 1.6, d: 0.9, h: 1.3,
    plate: Object.freeze({ w: 1.4, h: 0.56, y0: 1.84 }),
  }),
});
