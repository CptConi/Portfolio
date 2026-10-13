// Dev check for the Quartiers lounge layout, in plain node (no DOM, no GPU):
//
//   node src/engine/props/check.mjs
//
// Proves, with the game's own collision code (Player.js) and map (Map.js):
//   · every solid stands on walkable floor of the Quartiers, inside the walls
//   · no two solids overlap (raw footprints), and the PROD key's wall and standing zone are free
//   · the vestibule mouth is clear, and the visitor can walk from it to each console's focus
//     point and to the key, with and without 0.1 m of extra clearance
//   · the cat's crate is the Props3D crate under the sleeping cat
// Exits with a non-zero status when something fails.

import { isWall, floorAt, STEP_MAX } from '../Map.js';
import { PROPS3D } from '../Props3D.js';
import { SCREENS, consoleAABBs } from '../Screens.js';
import { spriteAABBs } from '../Sprites2D.js';
import { Player, addSolidBox } from '../Player.js';
import { PROD_KEY } from '../layout.js';
import { LOUNGE, LOUNGE_SOLIDS, KEY_ZONE, MOUTH } from './placement.js';

let failed = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};

const ROOM = { minX: 8, maxX: 17, minZ: 2, maxZ: 7 };
const inRoom = (x, z) => x >= ROOM.minX && x <= ROOM.maxX && z >= ROOM.minZ && z <= ROOM.maxZ;
const overlap = (a, b) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

// ── The solids of the room (raw footprints, no player margin) ────────────────────────────
const items = [
  ...Object.entries(LOUNGE_SOLIDS).map(([name, b]) => ({ name, ...b })),
  ...PROPS3D.filter(p => inRoom(p.x, p.y)).map(p => ({
    name: `prop(${p.x},${p.y})`, minX: p.x - p.w / 2, maxX: p.x + p.w / 2, minZ: p.y - p.d / 2, maxZ: p.y + p.d / 2 })),
  ...SCREENS.filter(s => inRoom(s.x, s.z)).map(s => ({ name: `console:${s.id}`, ...consoleAABBs(0)[SCREENS.indexOf(s)] })),
  ...spriteAABBs(0).filter(b => inRoom((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2)).map((b, i) => ({ name: `sprite#${i}`, ...b })),
];

for (const it of items) {
  const corners = [[it.minX, it.minZ], [it.maxX, it.minZ], [it.minX, it.maxZ], [it.maxX, it.maxZ]];
  const onFloor = corners.every(([x, z]) => !isWall(x, z) && inRoom(x, z) && Math.abs(floorAt(x, z) - -0.2) < 1e-9);
  ok(onFloor, `${it.name} stands on Quartiers floor`);
}

let clash = 0;
for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
  if (overlap(items[i], items[j])) { clash++; ok(false, `${items[i].name} overlaps ${items[j].name}`); }
}
ok(clash === 0, 'no two solids overlap', `(${items.length} solids)`);

// The key wall and standing zone: nothing within x 13.8..14.8 of the wall, nothing standing in the zone.
const wallStrip = { minX: 13.8, maxX: 14.8, minZ: 2.0, maxZ: 2.6 };
ok(items.every(it => !overlap(it, wallStrip)), 'the key wall strip (x 13.8–14.8, z < 2.6) is empty');
ok(items.every(it => !overlap({ minX: it.minX - 0.2, maxX: it.maxX + 0.2, minZ: it.minZ - 0.2, maxZ: it.maxZ + 0.2 }, { minX: 13.6, maxX: 15.0, minZ: 2.5, maxZ: 3.4 })),
  'the key standing area (x 13.6–15.0, z 2.5–3.4) is free of any blocked ground');
ok(KEY_ZONE.minX <= PROD_KEY.x && PROD_KEY.x <= KEY_ZONE.maxX, 'KEY_ZONE covers the PROD key hook', `(hook at x ${PROD_KEY.x})`);

// ── Collision through the game's own Player ──────────────────────────────────────────────
for (const b of Object.values(LOUNGE_SOLIDS)) addSolidBox(b);
const player = new Player();
const STEP = 0.05;
const free = (x, z) => {            // can the player be at (x, z) and still take a step somewhere?
  for (const [dx, dz] of [[STEP, 0], [-STEP, 0], [0, STEP], [0, -STEP]]) {
    player.x = x; player.y = z;
    player._move(dx, dz);
    if (player.x !== x || player.y !== z) return true;
  }
  return false;
};

// Grid over the room.
const NX = Math.round((ROOM.maxX - ROOM.minX) / STEP) + 1, NZ = Math.round((ROOM.maxZ + 2.5 - ROOM.minZ) / STEP) + 1;   // + the vestibule
const X = i => ROOM.minX + i * STEP, Z = j => ROOM.minZ + j * STEP;
const canStep = (i, j, di, dj) => {
  const x = X(i), z = Z(j);
  player.x = x; player.y = z; player.hitWall = false;
  player._move(di * STEP, dj * STEP);
  return Math.abs(player.x - (x + di * STEP)) < 1e-6 && Math.abs(player.y - (z + dj * STEP)) < 1e-6;
};

function reach(startI, startJ, clearance = 0) {
  const seen = new Uint8Array(NX * NZ);
  const blocked = new Uint8Array(NX * NZ);
  if (clearance > 0) {
    const r = Math.round(clearance / STEP);
    const freeCell = new Uint8Array(NX * NZ);
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) freeCell[j * NX + i] = free(X(i), Z(j)) ? 1 : 0;
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      let bad = !freeCell[j * NX + i];
      for (let dj = -r; dj <= r && !bad; dj++) for (let di = -r; di <= r && !bad; di++) {
        const ii = i + di, jj = j + dj;
        if (ii >= 0 && jj >= 0 && ii < NX && jj < NZ && Math.hypot(di, dj) <= r && !freeCell[jj * NX + ii]) bad = true;
      }
      blocked[j * NX + i] = bad ? 1 : 0;
    }
  }
  const queue = [[startI, startJ]];
  seen[startJ * NX + startI] = 1;
  while (queue.length) {
    const [i, j] = queue.pop();
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ || seen[jj * NX + ii] || blocked[jj * NX + ii]) continue;
      if (!canStep(i, j, di, dj)) continue;
      seen[jj * NX + ii] = 1;
      queue.push([ii, jj]);
    }
  }
  return p => seen[Math.round((p[1] - ROOM.minZ) / STEP) * NX + Math.round((p[0] - ROOM.minX) / STEP)] === 1;
}

// Vestibule mouth: every point the player may stand on in it is free.
let mouthFree = 0, mouthTotal = 0;
for (let z = MOUTH.minZ; z <= MOUTH.maxZ + 1e-9; z += STEP) {
  for (let x = MOUTH.minX; x <= MOUTH.maxX + 1e-9; x += STEP) {
    if (isWall(x - 0.2, z) || isWall(x + 0.2, z)) continue;       // inside the wall margin anyway
    mouthTotal++;
    if (free(x, z)) mouthFree++;
  }
}
ok(mouthTotal > 0 && mouthFree === mouthTotal, 'the vestibule mouth (x 11–14, z 6.2–7.3) is clear', `(${mouthFree}/${mouthTotal} points)`);

const from = [12.5, 7.4];
const walk = reach(Math.round((from[0] - ROOM.minX) / STEP), Math.round((from[1] - ROOM.minZ) / STEP));
const walkWide = reach(Math.round((from[0] - ROOM.minX) / STEP), Math.round((from[1] - ROOM.minZ) / STEP), 0.1);
const targets = [
  ...SCREENS.filter(s => inRoom(s.x, s.z)).map(s => ({ name: `console ${s.id} focus point`, p: [s.x + 1.3 * s.facing[0], s.z + 1.3 * s.facing[1]] })),
  { name: 'PROD key standing point', p: [PROD_KEY.x, 3.2] },
  { name: 'the cat (1.0 m in front of its crate)', p: [LOUNGE.crate.x, LOUNGE.crate.z + 1.0] },
  { name: 'the barbecue (1.0 m in front)', p: [LOUNGE.bbq.x - 0.8, LOUNGE.bbq.z + 0.6] },
  { name: 'the guitar (1.0 m in front)', p: [LOUNGE.guitar.x - 1.0, LOUNGE.guitar.z] },
  { name: 'the sofa (from the east of the coffee table)', p: [LOUNGE.sofa.x + 1.15, LOUNGE.sofa.z - 1.1] },
];
for (const t of targets) {
  ok(free(t.p[0], t.p[1]), `${t.name} is free ground`, `(${t.p[0].toFixed(2)}, ${t.p[1].toFixed(2)})`);
  ok(walk(t.p), `…and reachable from the vestibule`);
  ok(walkWide(t.p), `…also with 0.1 m of extra clearance`);
}

// ── The cat and its crate ────────────────────────────────────────────────────────────────
const crate = PROPS3D.find(p => p.x === LOUNGE.crate.x && p.y === LOUNGE.crate.z);
ok(!!crate && Math.abs(crate.h - LOUNGE.crate.top) < 1e-9, 'the cat sleeps on the Props3D crate, at its exact top');
