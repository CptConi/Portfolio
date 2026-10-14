// Dev proof for the EXTERIOR world (src/engine/exterior/), in plain node (no DOM, no GPU):
//
//   node src/engine/exterior/check-exterior.mjs            prove every rule, print PASS / FAIL (exit 1 on a FAIL), the budgets and what each window frames
//   node src/engine/exterior/check-exterior.mjs --faces    also list, face by face, what hangs on every hull face (the dresser's worksheet)
//
// The exterior is built exactly as the game builds it (buildExterior with the props module, deferred jobs flushed), then every object it holds is
// traced back to the thing that made it (props.js pours each object inside Kit.item: its id, what it stands on, its declared footprint, the vertices
// it made and the kit they are in; the two phases of the props, the dressing of the base and the plain, are two kits):
//
//   · WALL objects (hang on a face: trays, pipes, risers, vents, lamps, plates, ladders, stencils): inside the face, in front of the wall (never in it,
//     never floating off it), under the cornice (a ladder ends at the parapet, never above it), clear of every window (frame and sill) and of the
//     tubes that join the face, and clear of one another
//   · ROOF objects (hatches, vents, stacks, masts, dishes, signs, the tower): standing ON their roof, inside the parapet, clear of one another; the
//     skylight's column stays free under SKYLIGHT.clearY
//   · GROUND objects: on the plain (not sunk but for the half-buried rocks), outside every footprint (hulls, tubes, drifts), inside WORLD_RADIUS,
//     clear of one another
//   · CABLES strung across the alleys: inside their alley, off the ground, under both parapets, ending on a wall, never over a window
//   · EVERY vertex of the dressing: finite, never inside a hull or a tube, never below the plain (rocks aside), never beyond WORLD_RADIUS
//   · the hulls: the lit glass of every window of the level is on its face (and the skylight on the roof); the lit signs read the right way round
//   · the SECRET (the push-wall's corridor x 11.7-13.3, z 16-18): nothing hangs over it, on either face, nothing stands or is strung in it
//   · the PANES: nothing of the dressing stands in front of a window's glass (its opening, out to 0.6 m)
//   · glitches: coplanar faces of two different objects (z-fighting), text mirrored or upside down, ladders and pipes standing above their wall
//   · IDENTITY: every hull carries its name where its windows look (ARMURERIE + CAPACITÉS, TROPHÉES + SUCCÈS, QUARTIERS, PROD, ATRIUM), and the
//     name is in the glass of the window that looks at it from enough of the room's spots
//   · WHAT EACH WINDOW FRAMES: 5 × 4 rays through every pane from every spot of its room, on out into the dressed world (INFO), and the owner's windows
//     must frame the name of the building they look at
//   · THE PROD ANNEX: it is the lowest hull and every window that could look at it is above the visitor's eye, so only what stands over its parapet shows
//     (windowSlots.js LANDMARKS): its roof plant (a bulkhead with the red hazard door, the lit PROD plate, a red lamp) must be built where the layout says, and
//     the plate must be in the glass of the Armurerie's south ribbon, with no prop in the way, from enough of the room, big enough to read at 640 × 360
//   · the budgets: draw calls of the exterior pass (≤ 45), triangles, the tower taller than every wing, the sky still free over the skylight

import { buildExterior } from './Exterior.js';
import { buildExteriorProps } from './props.js';
import { BLOCKS, LINKS, SKYLIGHT, GROUND_Y, WORLD_RADIUS } from './exteriorLayout.js';
import { faceOf, SIDES, IDENTITY } from './hulls.js';
import { WINDOWS, LANDMARKS } from '../decor/windowSlots.js';
import { getCellType, floorAt } from '../Map.js';

const argv = process.argv.slice(2);
const SHOW_FACES = argv.includes('--faces');
let failed = 0;
const log = s => console.log(s);
const rule = (ok, name, detail = '') => { if (!ok) failed++; log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`); return ok; };
const info = (name, detail = '') => log(`INFO  ${name}${detail ? `  ${detail}` : ''}`);
const head = s => log(`\n── ${s} ──`);
const f2 = v => (Math.round(v * 100) / 100).toFixed(2);
const list = (arr, n = 8) => arr.slice(0, n).join('; ') + (arr.length > n ? `; … (+${arr.length - n})` : '');

// ── Build, exactly as the game does ─────────────────────────────────────────────────────────────────────
const t0 = performance.now();
const view = buildExterior({ tex: null, buildProps: buildExteriorProps, deferred: true });   // as in the browser: the plain is poured in slices
const tBuild = performance.now() - t0;
const queued = view.parts.queue.map(j => j.label);
const t1 = performance.now();
view.flush();
const tDeferred = performance.now() - t1;
view.parts.finalize();
const { hulls, ctx } = view.parts;
const PH = view.parts.info.props;                      // [the dressing, the plain]
const items = PH.flatMap(p => p.items);
const kitOf = it => it.kit;
const SOLIDS = [...BLOCKS, ...LINKS];
const byId = Object.fromEntries(SOLIDS.map(s => [s.id, s]));
const G = GROUND_Y;
const TOL = 0.03;

head('Build');
rule(PH.length === 2 && items.length > 0, 'the props module ran in two phases (the dressing now, the plain in slices) and described its objects', `${items.length} objects: ${PH.map(p => `${p.phase} ${p.items.length}`).join(', ')}`);
rule(PH.every(p => p.untracked === 0), 'every vertex of the dressing belongs to a described object', `${PH.map(p => p.untracked).join(' + ')} untracked pours`);
info('cold build in plain node (what blocks the start)', `${tBuild.toFixed(0)} ms (sky ${view.parts.timing.sky}, hulls ${view.parts.timing.hulls}, terrain ${view.parts.timing.terrain}, props ${view.parts.timing.props}), then ${tDeferred.toFixed(0)} ms in ${queued.length} idle slices: ${Object.entries(view.parts.timing.deferred).map(([k, v]) => `${k} ${v}`).join(', ')}`);
const refused = PH.flatMap(p => p.skipped);
if (refused.length) info('refused by the wall tools (did not fit: not drawn)', `${refused.length}: ${list(refused, 12)}`);

// A second build must be identical (no Math.random, no Date.now anywhere in the exterior)
{
  const sum = kit => { let s = 0; const a = kit.lit.pos; for (let i = 0; i + 2 < a.length; i += 7) s += a[i] * 1.31 + a[i + 1] * 2.17 + a[i + 2] * 3.11; return +s.toFixed(4); };
  const again = buildExterior({ tex: null, buildProps: buildExteriorProps, deferred: true }); again.flush();
  const second = again.parts.info.props;
  const h2 = buildExterior({ tex: null, buildProps: () => null });
  const same = PH.length === second.length && PH.every((p, i) => sum(p.kit) === sum(second[i].kit) && p.items.length === second[i].items.length);
  rule(same && hulls.lit.pos.length === h2.parts.hulls.lit.pos.length, 'deterministic: a second build is identical (objects, vertices)', `checksums ${PH.map(p => sum(p.kit)).join(' / ')}`);
}

// ── Geometry of an item ─────────────────────────────────────────────────────────────────────────────────
function verticesOf(it) {
  const v = [];
  for (const r of it.ranges) { const B = kitOf(it)[r.batch]; for (let i = r.v0; i < r.v1; i++) v.push([B.pos[3 * i], B.pos[3 * i + 1], B.pos[3 * i + 2], r.batch]); }
  for (const b of it.beacons ?? []) { const [x, y, z, rr] = b; for (const dx of [-rr, rr]) for (const dy of [-rr, rr]) v.push([x + dx, y + dy, z, 'beacon']); }
  return v;
}
const bboxOf = vs => {
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const [x, y, z] of vs) { b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y); b.z0 = Math.min(b.z0, z); b.z1 = Math.max(b.z1, z); }
  return b;
};
for (const it of items) { it.v = verticesOf(it); it.bb = bboxOf(it.v); }
const itemsOf = kind => items.filter(i => i.kind === kind);
const overlap1 = (a0, a1, b0, b1, pad = 0) => a1 > b0 + pad && a0 < b1 - pad;

// ── Wall objects ────────────────────────────────────────────────────────────────────────────────────────
head('Wall objects (hang on a hull face)');
{
  const walls = itemsOf('wall'), lights = itemsOf('light');
  const bad = { rect: [], off: [], ground: [], height: [], face: [], win: [], tube: [], ladder: [], clash: [], float: [] };
  const ladders = [];
  for (const it of [...walls, ...lights]) {
    const [hid, k] = it.host.split('.');
    const b = byId[hid];
    if (!b) { bad.face.push(`${it.id}: no hull ${hid}`); continue; }
    const F = faceOf(b, k), [s0, s1, y0, y1] = it.rect;
    const ss = it.v.map(p => (F.alongX ? p[0] : p[2])), ys = it.v.map(p => p[1]), off = it.v.map(p => F.sgn * ((F.alongX ? p[2] : p[0]) - F.plane));
    const mn = a => Math.min(...a), mx = a => Math.max(...a);
    const inRect = mn(ss) >= s0 - TOL && mx(ss) <= s1 + TOL && mn(ys) >= y0 - TOL && mx(ys) <= y1 + TOL;
    if (!inRect) bad.rect.push(`${it.id} [s ${f2(mn(ss))}..${f2(mx(ss))} y ${f2(mn(ys))}..${f2(mx(ys))}] ⊄ [${rect(it.rect)}]`);
    if (s0 < F.lo - 1e-6 || s1 > F.hi + 1e-6 || mn(ss) < F.lo - 1e-3 || mx(ss) > F.hi + 1e-3) bad.face.push(`${it.id}: past the end of ${it.host}`);
    if (mn(off) < -0.003) bad.off.push(`${it.id}: ${f2(mn(off))} m INTO the wall`);
    if (it.kind === 'wall' && mn(off) > 0.1) bad.float.push(`${it.id}: nearest point ${f2(mn(off))} m off the wall`);
    if (mx(off) > 0.4) bad.off.push(`${it.id}: ${f2(mx(off))} m proud of the wall`);
    if (mn(ys) < G - 0.005) bad.ground.push(`${it.id}: y ${f2(mn(ys))} under the plain`);
    const roof = b.roofY, isLadder = !!it.ladder;
    if (isLadder) { ladders.push({ id: it.id, top: mx(ys), roof }); if (mx(ys) > roof + 0.1 + 1e-3) bad.ladder.push(`${it.id}: top ${f2(mx(ys))} is ${f2(mx(ys) - roof)} over the roof (${f2(roof)})`); }
    else if (it.kind === 'wall' && mx(ys) > roof - 0.12 + TOL) bad.height.push(`${it.id}: top ${f2(mx(ys))} over its wall (${f2(roof)} - cornice)`);
    else if (it.kind === 'light' && mx(ys) > roof) bad.height.push(`${it.id}: light over its wall`);
    // windows (lit glass + frame + sill) of this face, and the tubes that join it
    if (it.kind === 'wall') {
      for (const q of hulls.windowsOnHulls.filter(q => q.b.id === hid && q.k === k)) {
        if (overlap1(mn(ss), mx(ss), q.s - q.hw - 0.05, q.s + q.hw + 0.05) && overlap1(mn(ys), mx(ys), q.yb - 0.07, q.yt + 0.05)) bad.win.push(`${it.id} over ${q.id}`);
      }
      for (const l of LINKS) {
        const touches = (k === 'E' && l.x0 === b.x1) || (k === 'W' && l.x1 === b.x0) || (k === 'N' && l.z1 === b.z0) || (k === 'S' && l.z0 === b.z1);
        const along = F.alongX ? [l.x0, l.x1] : [l.z0, l.z1];
        if (touches && !hid.startsWith('link') && overlap1(mn(ss), mx(ss), along[0], along[1]) && mn(ys) < l.roofY + 0.02) bad.tube.push(`${it.id} in the tube ${l.id}`);
      }
    }
  }
  // overlaps between wall objects of one face (smears of grime may lie under a solid thing)
  const byFace = {};
  for (const it of walls) (byFace[it.host] ??= []).push(it);
  for (const [face, arr] of Object.entries(byFace)) {
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i], c = arr[j], [h] = [face.split('.')[0]];
      const F = faceOf(byId[h], face.split('.')[1]);
      const sa = a.v.map(p => (F.alongX ? p[0] : p[2])), sc = c.v.map(p => (F.alongX ? p[0] : p[2]));
      const underA = /:grime@|:valve@/.test(a.id), underC = /:grime@|:valve@/.test(c.id);
      if (underA !== underC) continue;
      if (overlap1(Math.min(...sa), Math.max(...sa), Math.min(...sc), Math.max(...sc), 0.01) && overlap1(a.bb.y0, a.bb.y1, c.bb.y0, c.bb.y1, 0.01)) bad.clash.push(`${a.id.split(':')[1]} × ${c.id.split(':')[1]} on ${face}`);
    }
  }
  function rect(r) { return r.map(f2).join(' '); }
  rule(!bad.rect.length, 'each wall object stays inside the footprint it declared', `${walls.length + lights.length} objects${bad.rect.length ? ': ' + list(bad.rect) : ''}`);
  rule(!bad.face.length, 'each lies on its face (not past a corner)', list(bad.face));
  rule(!bad.off.length, 'in front of the wall: none in it, none more than 0.4 m proud of it', list(bad.off));
  rule(!bad.float.length, 'attached: the nearest point of each is within 0.1 m of the wall (no floating)', list(bad.float));
  rule(!bad.ground.length, 'none dips under the plain', list(bad.ground));
  rule(!bad.height.length, 'none stands taller than its wall (under the cornice; lights inside the face)', list(bad.height));
  rule(ladders.length >= 4, 'the roof ladders exist (4 or more: a ladder refused by the wall tools would not be proved)', `${ladders.length}`);
  rule(!bad.ladder.length, `ladders end at the parapet (≤ +0.1 m): ${ladders.length} ladders`, bad.ladder.length ? list(bad.ladder) : ladders.map(l => `${l.id.split(':')[0]} top ${f2(l.top)} / roof ${f2(l.roof)}`).join(', '));
  rule(!bad.win.length, 'clear of every window (lit glass, frame, sill)', list(bad.win));
  rule(!bad.tube.length, 'clear of the tubes that join the face', list(bad.tube));
  rule(!bad.clash.length, 'clear of one another (no two objects of a face overlap)', list(bad.clash));
}

// ── Roof objects ────────────────────────────────────────────────────────────────────────────────────────
head('Roof objects');
{
  const roofs = itemsOf('roof');
  const bad = { on: [], inside: [], clash: [], sky: [], floating: [] };
  const flat = it => /slit@|string-lights|drift@|:roof$/.test(it.id);
  for (const it of roofs) {
    const b = byId[it.host];
    if (!b) { bad.on.push(`${it.id}: no hull ${it.host}`); continue; }
    const bb = it.bb, roof = b.roofY, link = it.host.startsWith('link');
    if (bb.y0 < roof - 0.03) bad.on.push(`${it.id}: base ${f2(bb.y0)} under its roof ${f2(roof)}`);
    if (bb.y0 > roof + 0.12 && !(it.beacons?.length && !it.ranges.length)) bad.floating.push(`${it.id}: base ${f2(bb.y0)} floats over its roof ${f2(roof)}`);
    const ins = link || /string-lights/.test(it.id) ? 0.02 : 0.1;
    if (bb.x0 < b.x0 + ins - 1e-3 || bb.x1 > b.x1 - ins + 1e-3 || bb.z0 < b.z0 + ins - 1e-3 || bb.z1 > b.z1 - ins + 1e-3) bad.inside.push(`${it.id}: x ${f2(bb.x0)}..${f2(bb.x1)} z ${f2(bb.z0)}..${f2(bb.z1)} past the parapet of ${it.host}`);
  }
  const byHost = {};
  for (const it of roofs) if (!flat(it)) (byHost[it.host] ??= []).push(it);
  for (const arr of Object.values(byHost)) for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
    const a = arr[i].bb, c = arr[j].bb;
    if (overlap1(a.x0, a.x1, c.x0, c.x1, 0.02) && overlap1(a.z0, a.z1, c.z0, c.z1, 0.02) && overlap1(a.y0, a.y1, c.y0, c.y1, 0.02)) bad.clash.push(`${arr[i].id.split(':').slice(1).join(':')} × ${arr[j].id.split(':').slice(1).join(':')} on ${arr[i].host}`);
  }
  rule(!bad.on.length, 'stand ON their roof (nothing sunk into it)', `${roofs.length} objects${bad.on.length ? ': ' + list(bad.on) : ''}`);
  rule(!bad.floating.length, 'touch it (nothing floats over the roof)', list(bad.floating));
  rule(!bad.inside.length, 'inside the parapet', list(bad.inside));
  rule(!bad.clash.length, 'clear of one another', list(bad.clash));
    // the tower is the landmark: the tallest thing of the base, taller than every wing's tallest thing
  const top = {};
  for (const it of roofs) top[it.host] = Math.max(top[it.host] ?? -Infinity, it.bb.y1);
  for (const b of BLOCKS) top[b.id] = Math.max(top[b.id] ?? b.roofY, b.roofY);
  const wings = BLOCKS.filter(b => b.id !== 'atrium').map(b => `${b.id} ${f2(top[b.id])}`);
  rule(Object.entries(top).every(([id, y]) => id === 'atrium' || y < top.atrium - 0.5), 'the atrium tower (drum, dome, masts) rises over everything of every wing by at least 0.5 m', `atrium ${f2(top.atrium)} m; ${wings.join(', ')}`);
  const drum = roofs.find(i => i.id.endsWith(':drum')), mast = roofs.find(i => i.id.endsWith(':mast'));
  rule(!!drum && !!mast && drum.bb.y1 > 4.2 && mast.bb.y1 > 8, 'the tower carries a drum + dome + spire and a lattice mast', `${drum ? `drum to ${f2(drum.bb.y1)}` : 'no drum'}, ${mast ? `mast to ${f2(mast.bb.y1)}` : 'no mast'}`);
}

// ── Ground objects ──────────────────────────────────────────────────────────────────────────────────────
head('Objects on the plain');
{
  const ground = itemsOf('ground');
  const bad = { under: [], hover: [], foot: [], far: [], clash: [] };
  const C = ctx.center;
  const solidBox = it => { const v = it.v.filter(p => p[3] === 'lit'); return v.length ? bboxOf(v) : null; };
  for (const it of ground) {
    const bb = it.bb;
    if (bb.y0 < G - (it.buried ? 0.45 : 0.04)) bad.under.push(`${it.id}: y ${f2(bb.y0)} under the plain`);
    if (!it.buried && bb.y0 > G + 0.12 && !it.hover) bad.hover.push(`${it.id}: base ${f2(bb.y0)} over the plain`);
    if (it.v.some(([x, , z]) => hulls.footprints.some(f => x > f.x0 + 0.01 && x < f.x1 - 0.01 && z > f.z0 + 0.01 && z < f.z1 - 0.01))) bad.foot.push(`${it.id}`);
    const far = Math.max(...it.v.map(p => Math.hypot(p[0] - C.x, p[2] - C.z)));
    if (far > WORLD_RADIUS) bad.far.push(`${it.id}: ${f2(far)} m from the centre`);
  }
  // solid things (what is poured in the lit batch; stencils on the ground are flat) may not overlap one another (rocks may lie against rocks, a cluster)
  const solid = ground.map(it => ({ it, bb: solidBox(it) })).filter(o => o.bb);
  for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) {
    const a = solid[i], c = solid[j];
    if (a.it.rock && c.it.rock) continue;
    if (overlap1(a.bb.x0, a.bb.x1, c.bb.x0, c.bb.x1, 0.02) && overlap1(a.bb.z0, a.bb.z1, c.bb.z0, c.bb.z1, 0.02) && overlap1(a.bb.y0, a.bb.y1, c.bb.y0, c.bb.y1, 0.02)) bad.clash.push(`${a.it.id.replace('ground:', '')} × ${c.it.id.replace('ground:', '')}`);
  }
  rule(!bad.under.length, 'on the plain: nothing sunk into it (the half-buried rocks aside; 4 cm for the rim of a tilted strut)', `${ground.length} objects (${ground.filter(i => i.rock).length} rocks)${bad.under.length ? ': ' + list(bad.under) : ''}`);
  rule(!bad.hover.length, 'touching it (nothing hovers)', list(bad.hover));
  rule(!bad.foot.length, 'outside every footprint (hulls, tubes, drifts)', list(bad.foot));
  rule(!bad.far.length, `inside WORLD_RADIUS (${WORLD_RADIUS} m)`, list(bad.far));
  rule(!bad.clash.length, 'clear of one another (no rock grows through a lander)', list(bad.clash));
}

// ── Cables ──────────────────────────────────────────────────────────────────────────────────────────────
head('Cables across the alleys');
{
  const cables = itemsOf('cable'), bad = [];
  for (const it of cables) {
    const [a, b] = it.ends, bb = it.bb;
    const lo = [Math.min(a[0], b[0]), Math.min(a[2], b[2])], hi = [Math.max(a[0], b[0]), Math.max(a[2], b[2])];
    const pad = 0.17;
    if (bb.x0 < lo[0] - pad || bb.x1 > hi[0] + pad || bb.z0 < lo[1] - pad || bb.z1 > hi[1] + pad) bad.push(`${it.id}: leaves the span`);
    if (bb.y0 < G + 0.15) bad.push(`${it.id}: ${f2(bb.y0)} touches the ground`);
    const roofs = it.host.split('|').map(id => byId[id]?.roofY).filter(v => v !== undefined);
    if (roofs.length && bb.y1 > Math.min(...roofs) - 0.05) bad.push(`${it.id}: top ${f2(bb.y1)} above a parapet`);
    // the two ends sit on the faces (within the clamp's 0.17 m)
    for (const e of [a, b]) {
      const near = SOLIDS.some(s => e[0] > s.x0 - 0.2 && e[0] < s.x1 + 0.2 && e[2] > s.z0 - 0.2 && e[2] < s.z1 + 0.2 && e[1] < s.roofY && e[1] > G);
      if (!near) bad.push(`${it.id}: an end hangs in the air`);
    }
  }
  rule(!bad.length, `${cables.length} cables: inside their alley, off the ground, under both parapets, both ends on a wall`, list(bad));
}

// ── Every vertex ────────────────────────────────────────────────────────────────────────────────────────
head('Every vertex of the dressing');
{
  const C = ctx.center;
  const bad = { nan: [], inside: [], under: [], far: [], sky: [] };
  const buriedOk = new Set(items.filter(i => i.buried).map(i => i.id));
  for (const it of items) {
    let nIn = 0, nUnder = 0, nFar = 0, nSky = 0, nNan = 0;
    for (const [x, y, z] of it.v) {
      if (!Number.isFinite(x + y + z)) { nNan++; continue; }
      for (const s of SOLIDS) if (x > s.x0 + 0.005 && x < s.x1 - 0.005 && z > s.z0 + 0.005 && z < s.z1 - 0.005 && y > G + 0.005 && y < s.roofY - 0.005) { nIn++; break; }
      if (y < G - 0.04 && !buriedOk.has(it.id)) nUnder++;
      if (Math.hypot(x - C.x, z - C.z) > WORLD_RADIUS) nFar++;
    }
    if (nNan) bad.nan.push(`${it.id} (${nNan})`);
    if (nIn) bad.inside.push(`${it.id} (${nIn})`);
    if (nUnder) bad.under.push(`${it.id} (${nUnder})`);
    if (nFar) bad.far.push(`${it.id} (${nFar})`);
    if (nSky) bad.sky.push(`${it.id} (${nSky})`);
  }
  // the skylight's column: no triangle of the dressing crosses the prism over it under clearY (a box's vertices skip the band its volume fills, so the
  // test is on the triangles' own extents: conservative, a round drum whose bounding box touches the corner is not a hit unless a triangle is)
  for (const it of items) {
    const B = kitOf(it);
    let hit = 0;
    for (const r of it.ranges) {
      const M = B[r.batch];
      for (let i0 = r.i0; i0 < r.i1; i0 += 3) {
        const a = M.idx[i0], b = M.idx[i0 + 1], c = M.idx[i0 + 2];
        const lo = k => Math.min(M.pos[3 * a + k], M.pos[3 * b + k], M.pos[3 * c + k]), hi = k => Math.max(M.pos[3 * a + k], M.pos[3 * b + k], M.pos[3 * c + k]);
        if (hi(0) > SKYLIGHT.x0 && lo(0) < SKYLIGHT.x1 && hi(2) > SKYLIGHT.z0 && lo(2) < SKYLIGHT.z1 && hi(1) > byId.atrium.roofY + 0.1 && lo(1) < SKYLIGHT.clearY) hit++;
      }
    }
    if (hit) bad.sky.push(`${it.id} (${hit})`);
  }
  // the hulls' own lit/glow geometry: finite and inside the world
  const bad2 = [];
  for (const [name, M] of [['hulls.lit', hulls.lit], ['hulls.glow', hulls.glow]]) for (let i = 0; i < M.pos.length; i++) if (!Number.isFinite(M.pos[i])) { bad2.push(name); break; }
  const n = items.reduce((a, i) => a + i.v.length, 0);
  rule(!bad.nan.length && !bad2.length, 'finite: no NaN anywhere', `${n} vertices${bad.nan.length ? ': ' + list(bad.nan) : ''}${bad2.length ? ' ' + bad2 : ''}`);
  rule(!bad.inside.length, 'nothing of the dressing inside a hull or a tube (no prop through a wall)', list(bad.inside));
  rule(!bad.under.length, 'nothing below the plain (but the half-buried rocks)', list(bad.under));
  rule(!bad.far.length, `nothing beyond WORLD_RADIUS (${WORLD_RADIUS} m)`, list(bad.far));
  rule(!bad.sky.length, `the skylight's column stays free under y ${SKYLIGHT.clearY} (x ${SKYLIGHT.x0}-${SKYLIGHT.x1}, z ${SKYLIGHT.z0}-${SKYLIGHT.z1}): no triangle of the dressing crosses it`, list(bad.sky));
}

// ── Beacons ─────────────────────────────────────────────────────────────────────────────────────────────
// A beacon is a small glowing diamond. The proofs above read it as a few corner points, and a roof item made of beacons only is exempt from "touches its roof":
// a string of lights without posts floated 16 cm over the Quartiers' roof and read as hovering diamonds from the atrium's north window. So: every beacon is
// held, by a solid vertex of its own object within 8 cm of the diamond (a post, a pole, a lamp box), or it rests on the plain / on its roof (within 4 cm).
head('Beacons');
{
  // distance from a point to a triangle (Ericson, Real-Time Collision Detection, 5.1.5): a pole is two rings of vertices, so a beacon half way up it is far from every vertex
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const madd = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
  function closest(p, a, b, c) {
    const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
    const d1 = dot(ab, ap), d2 = dot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return a;
    const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return b;
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) return madd(a, ab, d1 / (d1 - d3));
    const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return c;
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) return madd(a, ac, d2 / (d2 - d6));
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return madd(b, sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6)));
    const den = 1 / (va + vb + vc);
    return madd(madd(a, ab, vb * den), ac, vc * den);
  }
  const reach = (it, p) => {   // the nearest the solid geometry of the item comes to the point p
    const B = kitOf(it);
    let best = Infinity;
    for (const r of it.ranges) {
      if (r.batch === 'glow') continue;   // the glow batch is light (lit bands, decals), not a thing that can hold a lamp
      const M = B[r.batch];
      for (let i0 = r.i0; i0 < r.i1; i0 += 3) {
        const P = k => [M.pos[3 * M.idx[i0 + k]], M.pos[3 * M.idx[i0 + k] + 1], M.pos[3 * M.idx[i0 + k] + 2]];
        const q = closest(p, P(0), P(1), P(2));
        best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
      }
    }
    return best;
  };
  const bad = [];
  let n = 0;
  for (const it of items) {
    if (!it.beacons?.length) continue;
    const roof = it.kind === 'roof' ? byId[it.host]?.roofY : null;
    for (const [x, y, z, rr] of it.beacons) {
      n++;
      const rests = y - rr <= G + 0.04 || (roof != null && y - rr <= roof + 0.04);
      if (!rests && reach(it, [x, y, z]) > rr + 0.06) bad.push(`${it.id}: beacon at (${f2(x)}, ${f2(y)}, ${f2(z)}) hangs in the air`);
    }
  }
  rule(!bad.length, 'every beacon is held by a post, a pole or a lamp, or rests on the plain / its roof (nothing glows in mid-air)', bad.length ? list(bad) : `${n} beacons`);
}

// ── Connected parts ─────────────────────────────────────────────────────────────────────────────────────
// "touches its roof / its wall / the plain" is proved for the lowest point of an object, which lets a part that hangs off the rest of it float unseen (a boom
// beside its mast, a bulb over its post). Here the solid triangles of each object are grouped into pieces (two triangles whose boxes come within 3 cm belong to
// one piece) and every piece must reach the support: the roof slab, the wall face, or the plain.
head('Connected parts');
{
  const MARGIN = 0.03;
  const bad = [];
  let pieces = 0, objects = 0;
  for (const it of items) {
    if (!['roof', 'wall', 'light', 'ground'].includes(it.kind)) continue;
    const B = kitOf(it);
    const tris = [];
    for (const r of it.ranges) {
      if (r.batch !== 'lit') continue;
      const M = B[r.batch];
      for (let i0 = r.i0; i0 < r.i1; i0 += 3) {
        const a = M.idx[i0], b = M.idx[i0 + 1], c = M.idx[i0 + 2];
        const lo = k => Math.min(M.pos[3 * a + k], M.pos[3 * b + k], M.pos[3 * c + k]) - MARGIN / 2, hi = k => Math.max(M.pos[3 * a + k], M.pos[3 * b + k], M.pos[3 * c + k]) + MARGIN / 2;
        tris.push([lo(0), hi(0), lo(1), hi(1), lo(2), hi(2)]);
      }
    }
    if (!tris.length) continue;
    objects++;
    let support;   // (box) → does this triangle touch what the object stands on or hangs from?
    if (it.kind === 'roof') { const y = byId[it.host]?.roofY ?? 0; support = t => t[2] <= y + 0.05; }
    else if (it.kind === 'ground') support = t => t[2] <= G + 0.06;
    else {
      const [hid, k] = it.host.split('.'), b = byId[hid];
      if (!b) continue;
      const F = faceOf(b, k);
      // the wall plane in the triangle's own coordinates: the nearest side of its box to the face, inside 6 cm
      support = t => { const lo = F.alongX ? t[4] : t[0], hi = F.alongX ? t[5] : t[1]; const near = F.sgn > 0 ? lo : -hi, plane = F.sgn > 0 ? F.plane : -F.plane; return near - plane <= 0.06; };
    }
    const parent = tris.map((_, i) => i);
    const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    for (let i = 0; i < tris.length; i++) for (let j = i + 1; j < tris.length; j++) {
      const a = tris[i], c = tris[j];
      if (a[0] <= c[1] && c[0] <= a[1] && a[2] <= c[3] && c[2] <= a[3] && a[4] <= c[5] && c[4] <= a[5]) { const x = find(i), y = find(j); if (x !== y) parent[x] = y; }
    }
    const held = new Set(), all = new Set();
    tris.forEach((t, i) => { const r = find(i); all.add(r); if (support(t)) held.add(r); });
    pieces += all.size;
    const loose = [...all].filter(r => !held.has(r));
    for (const r of loose) {
      const mine = tris.filter((_, i) => find(i) === r);
      const bb = [Math.min(...mine.map(t => t[0])), Math.max(...mine.map(t => t[1])), Math.min(...mine.map(t => t[2])), Math.max(...mine.map(t => t[3])), Math.min(...mine.map(t => t[4])), Math.max(...mine.map(t => t[5]))];
      bad.push(`${it.id}: a piece of ${mine.length} triangles floats (x ${f2(bb[0])}..${f2(bb[1])} y ${f2(bb[2])}..${f2(bb[3])} z ${f2(bb[4])}..${f2(bb[5])})`);
    }
  }
  rule(!bad.length, 'no part of an object floats: every piece of every object reaches its roof, its wall or the plain', bad.length ? list(bad, 14) : `${objects} objects, ${pieces} pieces`);
}

// ── The secret and the panes ────────────────────────────────────────────────────────────────────────────
head('The secret and the panes');
{
  const SEC = { x0: 11.7, x1: 13.3 };
  const hung = items.filter(i => (i.kind === 'wall' || i.kind === 'light') && (i.host === 'atrium.S' || i.host === 'annex.N') && overlap1(i.rect[0], i.rect[1], SEC.x0, SEC.x1)).map(i => i.id);
  const inside = items.filter(i => i.v.some(([x, y, z]) => x > SEC.x0 && x < SEC.x1 && z > 16 - 0.001 && z < 18 + 0.001 && y < byId.atrium.roofY)).map(i => i.id);
  rule(!hung.length && !inside.length, `the secret stays neutral: nothing on the atrium's south face or the annex's north face at x ${SEC.x0}-${SEC.x1}, nothing standing or strung in the corridor (z 16-18)`, list([...hung, ...inside]));
  // the panes: a prism in front of each wall window (its opening, the recess and 0.38 m beyond the glass) holds none of the dressing
  const clash = [];
  for (const q of hulls.windowsOnHulls) {
    const F = faceOf(q.b, q.k);
    for (const it of items) {
      if (it.kind !== 'wall') continue;   // (a pool of light is flush with the wall: the glass is in front of it; roofs and the plain are not in front of a pane)
      // the extent of the object in the face's own axes, against the prism of the pane (a vent wider than the window has no vertex inside it)
      let s0 = Infinity, s1 = -Infinity, y0 = Infinity, y1 = -Infinity, o0 = Infinity, o1 = -Infinity;
      for (const p of it.v) {
        const s = F.alongX ? p[0] : p[2], off = F.sgn * ((F.alongX ? p[2] : p[0]) - F.plane);
        s0 = Math.min(s0, s); s1 = Math.max(s1, s); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); o0 = Math.min(o0, off); o1 = Math.max(o1, off);
      }
      if (overlap1(s0, s1, q.s - q.hw + 0.02, q.s + q.hw - 0.02) && overlap1(y0, y1, q.yb + 0.02, q.yt - 0.02) && o1 > 0.001 && o0 < 0.6 && it.host.startsWith(q.b.id + '.')) clash.push(`${it.id.split(':').slice(1).join(':') || it.id} in front of ${q.id}`);
    }
    for (const it of items) if (it.kind === 'cable' && it.v.some(p => {
      const s = F.alongX ? p[0] : p[2], off = F.sgn * ((F.alongX ? p[2] : p[0]) - F.plane);
      return Math.abs(s - q.s) < q.hw + 0.05 && p[1] > q.yb - 0.05 && p[1] < q.yt + 0.05 && off > 0.001 && off < 0.3;
    })) clash.push(`${it.id} in front of ${q.id}`);
  }
  rule(!clash.length, 'nothing of the dressing stands in front of a pane (opening, recess, 0.6 m beyond the glass); cables clear of it by 5 cm', list([...new Set(clash)]));
}

// ── The hulls: windows, text, z-fighting ────────────────────────────────────────────────────────────────
head('The hulls');
{
  const walls = WINDOWS.filter(w => w.kind === 'wall'), skylights = WINDOWS.filter(w => w.kind === 'skylight');
  const onHull = new Set(hulls.windowsOnHulls.map(q => q.id));
  const missing = walls.filter(w => !onHull.has(w.id)).map(w => w.id);
  rule(!missing.length, `every wall window of the level is lit glass on its hull (${walls.length} windows)`, list(missing));
  // the lit glass lies on its face: every glow vertex of a window is within 2 cm of the face plane, inside its face, under the parapet
  const badGlass = [];
  for (const q of hulls.windowsOnHulls) {
    const F = faceOf(q.b, q.k);
    if (q.yt > q.b.roofY - 0.1 + 1e-6) badGlass.push(`${q.id}: head ${f2(q.yt)} over the cornice of ${q.b.id}`);
    if (q.s - q.hw < F.lo + 0.05 || q.s + q.hw > F.hi - 0.05) badGlass.push(`${q.id}: past the end of the face`);
    if (q.yb < G + 0.2) badGlass.push(`${q.id}: sill ${f2(q.yb)} at the ground`);
  }
  rule(!badGlass.length, 'each pane is on its face, under the cornice, off the ground', list(badGlass));
  const sky = skylights.every(w => { const b = BLOCKS.find(q => w.x > q.x0 && w.x < q.x1 && w.z > q.z0 && w.z < q.z1); return b && w.x - w.w / 2 >= SKYLIGHT.x0 - 1e-6 && w.x + w.w / 2 <= SKYLIGHT.x1 + 1e-6; });
  rule(sky && skylights.length === 1, 'the skylight is a lit pane on the atrium roof, inside the SKYLIGHT footprint');
}

// Lit text reads the right way round: a quad whose uv is a sign mask must have u growing to the viewer's right (up × normal) and v growing up
{
  const bad = [], checked = { n: 0 };
  const textItems = items.filter(i => /sign-|stencil-|:sign|roof:[a-z]+:sign/.test(i.id));
  for (const it of textItems) {
    for (const r of it.ranges) {
      const B = kitOf(it)[r.batch];
      for (let i0 = r.i0; i0 < r.i1; i0 += 6) {
        const ia = B.idx[i0], ib = B.idx[i0 + 1], ic = B.idx[i0 + 2], id = B.idx[i0 + 5];
        const ix = [ia, ib, ic, id];
        const u = ix.map(i => B.uv[2 * i]), v = ix.map(i => B.uv[2 * i + 1]);
        if (Math.max(...u) - Math.min(...u) < 1e-4 || Math.max(...v) - Math.min(...v) < 1e-4) continue;
        const p = ix.map(i => [B.pos[3 * i], B.pos[3 * i + 1], B.pos[3 * i + 2]]);
        const n = [B.nor[3 * ia], B.nor[3 * ia + 1], B.nor[3 * ia + 2]];
        if (Math.abs(n[1]) > 0.5) continue;
        // direction of growing u and growing v over the quad (least squares over the 4 corners, on a plane: enough with extreme points)
        const iu0 = u.indexOf(Math.min(...u)), iu1 = u.indexOf(Math.max(...u)), iv0 = v.indexOf(Math.min(...v)), iv1 = v.indexOf(Math.max(...v));
        const du = [p[iu1][0] - p[iu0][0], p[iu1][2] - p[iu0][2]], dv = p[iv1][1] - p[iv0][1];
        const right = [-n[2], n[0]];   // up × normal, in x/z (up = +y): (0,1,0) × (nx,ny,nz) = (nz, 0, -nx) ... sign fixed below
        const rx = n[2], rz = -n[0];
        checked.n++;
        if (du[0] * rx + du[1] * rz <= 0 || dv <= 0) bad.push(`${it.id}`);
        void right;
      }
    }
  }
  rule(!bad.length, 'every lit sign and stencil reads the right way round (not mirrored, not upside down)', `${checked.n} quads of ${textItems.length} objects${bad.length ? ': ' + list([...new Set(bad)]) : ''}`);
}

// Coplanar faces of two different objects (z-fighting): axis-aligned quads of the dressing and the hulls, grouped by plane
{
  const quads = [];   // { axis, dir, plane, a0, a1, b0, b1, owner }
  const collect = (B, owner, ranges) => {
    const nT = B.idx.length / 3;
    const own = ranges ?? [{ i0: 0, i1: B.idx.length, owner, batch: 'hull' }];
    for (const r of own) {
      for (let t = r.i0 / 3; t + 1 < r.i1 / 3; t += 1) {
        const i = [B.idx[3 * t], B.idx[3 * t + 1], B.idx[3 * t + 2], B.idx[3 * t + 3], B.idx[3 * t + 4], B.idx[3 * t + 5]];
        const uniq = [...new Set(i)];
        if (uniq.length !== 4) continue;   // two triangles sharing an edge = a quad
        const p = uniq.map(k => [B.pos[3 * k], B.pos[3 * k + 1], B.pos[3 * k + 2]]);
        const n = [B.nor[3 * i[0]], B.nor[3 * i[0] + 1], B.nor[3 * i[0] + 2]];
        const axis = [0, 1, 2].find(a => Math.abs(n[a]) > 0.999);
        if (axis === undefined) { t++; continue; }
        const plane = p[0][axis];
        if (!p.every(q => Math.abs(q[axis] - plane) < 1e-4)) continue;
        const [a, b] = [0, 1, 2].filter(x => x !== axis);
        const distinct = k => new Set(p.map(q => Math.round(q[k] / 1e-4))).size;
        if (distinct(a) > 2 || distinct(b) > 2) continue;   // a turned rectangle: its bounding box says nothing
        quads.push({ batch: r.batch, axis, dir: Math.sign(n[axis]), plane, a0: Math.min(...p.map(q => q[a])), a1: Math.max(...p.map(q => q[a])), b0: Math.min(...p.map(q => q[b])), b1: Math.max(...p.map(q => q[b])), owner: r.owner });
        t++;
      }
    }
  };
  collect(hulls.lit, 'hull');
  for (const kit of PH.map(p => p.kit)) for (const name of ['lit', 'decal', 'glow']) {
    const B = kit[name], owners = [];
    for (const it of items) if (it.kit === kit) for (const r of it.ranges) if (r.batch === name) owners.push({ i0: r.i0, i1: r.i1, owner: it.id, batch: name });
    collect(B, name, owners);
  }
  const buckets = new Map();
  for (const q of quads) {
    const key = `${q.axis}|${q.dir}|${Math.round(q.plane / 0.0015)}`;
    (buckets.get(key) ?? buckets.set(key, []).get(key)).push(q);
  }
  const fights = [], hullHull = [];
  for (const arr of buckets.values()) {
    if (arr.length < 2) continue;
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i], c = arr[j];
      if ((a.owner === c.owner && a.owner !== 'hull') || (a.batch === 'glow' && c.batch === 'glow')) continue;
      const w = Math.min(a.a1, c.a1) - Math.max(a.a0, c.a0), h = Math.min(a.b1, c.b1) - Math.max(a.b0, c.b0);
      if (a.owner === 'hull' && c.owner === 'hull') { if (w > 0.01 && h > 0.01 && w * h > 0.0004) hullHull.push(`${f2(w)}x${f2(h)} m at ${f2(a.plane)}`); continue; }
      if (w > 0.01 && h > 0.01 && w * h > 0.0004) fights.push(`${a.owner}${a.owner === 'hull' ? '' : ''} ≈ ${c.owner} (${f2(w)}×${f2(h)} m at ${f2(a.plane)})`);
    }
  }
  const uniqF = [...new Set(fights)];
  info('hull against hull: coplanar overlaps (the window bars where they cross, the mitred parapets: same material, same plane, no visible fight)', `${hullHull.length}${hullHull.length ? `: ${list([...new Set(hullHull)], 6)}` : ''}`);
  rule(!uniqF.length, 'no coplanar overlap between two objects (no z-fighting)', `${quads.length} axis-aligned quads${uniqF.length ? ': ' + list(uniqF, 12) : ''}`);
}

// ── Budgets ─────────────────────────────────────────────────────────────────────────────────────────────
head('Budgets');
{
  const meshes = [];
  view.scene.traverse(o => { if (o.isMesh && o.visible) meshes.push(o); });
  let tris = 0;
  for (const m of meshes) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
  rule(meshes.length <= 45, `draw calls of the exterior pass ≤ 45`, `${meshes.length}: ${meshes.map(m => `${m.name || '?'} ${((m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3) | 0}`).join(', ')}`);
  info('triangles of the exterior pass', `${tris | 0} (props: lit ${PH.reduce((a, p) => a + p.triangles[0], 0) | 0}, decals ${PH.reduce((a, p) => a + p.triangles[1], 0) | 0}, glow ${PH.reduce((a, p) => a + p.triangles[2], 0) | 0})`);
  info('objects described', `${items.length}: ${Object.entries(items.reduce((a, i) => (a[i.kind] = (a[i.kind] ?? 0) + 1, a), {})).map(([k, n]) => `${n} ${k}`).join(', ')}`);
}

// ── Identity ────────────────────────────────────────────────────────────────────────────────────────────
head('Identity: every hull carries its name');
const NAMES = { armurerie: ['ARMURERIE', 'CAPACITÉS'], trophees: ['TROPHÉES', 'SUCCÈS'], quartiers: ['QUARTIERS'], annex: ['PROD'], atrium: ['ATRIUM'] };
const signsOf = (hullId, text) => items.filter(i => i.kind === 'wall' && i.host.startsWith(`${hullId}.`) && i.id.includes(`sign-${text}`) || (i.kind === 'wall' && i.host.startsWith(`${hullId}.`) && i.id.includes(`stencil-${'t:' + text}`)));
for (const [hid, texts] of Object.entries(NAMES)) {
  const found = texts.map(t => `${t} ${items.filter(i => i.kind === 'wall' && i.host.startsWith(`${hid}.`) && (i.id.includes(`sign-${t}`) || i.id.includes(`+${t}`) || i.id.includes(`stencil-t:${t}`))).map(i => i.host.split('.')[1]).join('')}`);
  const missing = texts.filter(t => !items.some(i => i.kind === 'wall' && i.host.startsWith(`${hid}.`) && (i.id.includes(`sign-${t}`) || i.id.includes(`+${t}`) || i.id.includes(`stencil-t:${t}`) || i.id.includes(`stencil-${t}`))));
  rule(!missing.length, `${hid}: its name is on a wall (${IDENTITY[hid]?.label})`, missing.length ? `missing ${missing.join(', ')}` : found.join(', '));
}
void signsOf;


// ── What the windows frame of it ────────────────────────────────────────────────────────────────────────
// For every wall window and every walkable spot of its room (0.5 m grid, eye 0.5 m over the floor), 5 × 4 rays go through the pane (the glass is sunk
// 0.22 m behind the wall face, as decor/windows.js does; a ray must pass the OPENING on the wall) and on out into the exterior world: the hulls (their
// faces, the lit glass, every object hung there), the roof objects, the props on the plain, the plain, the sky. Plain slab tests; no GPU.
head('What each window frames of the dressed base');
const ROOM_OF = { 2: 'armurerie', 3: 'trophees', 4: 'quartiers', 6: 'atrium', 5: 'prod' };
const GLASS_DEPTH = 0.22;
const spotsOfRoom = room => {
  const out = [];
  for (let z = 0.25; z < 25; z += 0.5) for (let x = 0.25; x < 25; x += 0.5) {
    if (ROOM_OF[getCellType(x, z)] !== room) continue;
    if ([[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]].some(([a, b]) => ROOM_OF[getCellType(x + a, z + b)] !== room)) continue;   // 0.25 m off the walls
    out.push({ x, z, y: floorAt(x, z) + 0.5 });
  }
  return out;
};
const BOXES = SOLIDS.map(s => ({ id: s.id, link: !!LINKS.find(l => l.id === s.id), lo: [s.x0, G, s.z0], hi: [s.x1, s.roofY, s.z1], roofY: s.roofY }));
const propBoxes = items.filter(i => (i.kind === 'roof' || i.kind === 'ground') && !/slit@|string-lights|drift@|rock@|:roof$/.test(i.id)).map(i => {
  const v = i.v.filter(p => p[3] === 'lit'); if (!v.length) return null;
  const bb = bboxOf(v); return bb.y1 - bb.y0 < 0.25 ? null : { id: i.id, lo: [bb.x0, bb.y0, bb.z0], hi: [bb.x1, bb.y1, bb.z1], prop: i };
}).filter(Boolean);
function slab(o, d, lo, hi) {
  let t0 = 1e-6, t1 = Infinity, axis = -1, sgn = 0;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-12) { if (o[a] < lo[a] || o[a] > hi[a]) return null; continue; }
    let ta = (lo[a] - o[a]) / d[a], tb = (hi[a] - o[a]) / d[a], sg = -1;
    if (ta > tb) { const k = ta; ta = tb; tb = k; sg = 1; }
    if (ta > t0) { t0 = ta; axis = a; sgn = sg; }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return null;
  }
  return axis < 0 ? null : { t: t0, axis, sgn };
}
const wallItems = items.filter(i => i.kind === 'wall' && !i.id.includes(':grime@'));
const faceName = (axis, sgn) => (axis === 0 ? (sgn < 0 ? 'W' : 'E') : axis === 2 ? (sgn < 0 ? 'N' : 'S') : 'roof');
// what is hit: { label, hull?, group }
function trace(o, d) {
  let best = null;
  const take = (t, v) => { if (!best || t < best.t) best = { t, ...v }; };
  for (const b of BOXES) {
    const h = slab(o, d, b.lo, b.hi);
    if (!h) continue;
    const k = faceName(h.axis, h.sgn), p = [o[0] + d[0] * h.t, o[1] + d[1] * h.t, o[2] + d[2] * h.t];
    if (k === 'roof') { take(h.t, { hull: b.id, face: 'roof', label: `${b.id}.roof`, group: 'roof', p }); continue; }
    const F = faceOf(byId[b.id], k), s = F.alongX ? p[0] : p[2], y = p[1];
    let label = `${F.id} wall`, group = 'wall';
    const win = hulls.windowsOnHulls.find(q => q.b.id === b.id && q.k === k && Math.abs(s - q.s) <= q.hw + 0.05 && y >= q.yb - 0.07 && y <= q.yt + 0.05);
    if (win) { label = `${F.id} lit glass ${win.id}`; group = 'glass'; }
    else {
      const here = wallItems.filter(i => i.host === F.id && s >= i.rect[0] - 0.02 && s <= i.rect[1] + 0.02 && y >= i.rect[2] - 0.02 && y <= i.rect[3] + 0.02);
      here.sort((a, c) => (a.rect[1] - a.rect[0]) * (a.rect[3] - a.rect[2]) - (c.rect[1] - c.rect[0]) * (c.rect[3] - c.rect[2]));
      if (here.length) { label = `${F.id} ${here[0].id.split(':').slice(1).join(':').replace(/@.*/, '')}`; group = /sign-|stencil-/.test(here[0].id) ? 'name' : 'equipment'; }
      else if (y > b.roofY - 0.1) { label = `${F.id} cornice`; group = 'trim'; }
      else if (y > b.roofY - 0.26) { label = `${F.id} stripe`; group = 'trim'; }
    }
    take(h.t, { hull: b.id, face: k, label, group, p });
  }
  for (const b of propBoxes) { const h = slab(o, d, b.lo, b.hi); if (h) take(h.t, { label: b.id.replace(/@.*/, ''), group: 'prop', p: [o[0] + d[0] * h.t, o[1] + d[1] * h.t, o[2] + d[2] * h.t] }); }
  if (d[1] < -1e-9) { const t = (G - o[1]) / d[1]; if (t > 1e-6) take(t, { label: 'the plain', group: 'plain', p: [o[0] + d[0] * t, G, o[2] + d[2] * t] }); }
  return best ?? { label: 'sky', group: 'sky' };
}
// the rays of a window from one spot: through the opening, on out
function raysOf(w, P) {
  const [fx, fz] = w.facing, floor = floorAt(w.x + fx * 0.3, w.z + fz * 0.3), yb = floor + w.sill, yt = yb + w.h, hw = w.w / 2;
  const ox = fx !== 0, rays = [];
  const plane = ox ? w.x : w.z, glass = plane - (ox ? fx : fz) * GLASS_DEPTH;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) {
    const u = ((i + 0.5) / 5 * 2 - 1) * hw, v = yb + ((j + 0.5) / 4) * (yt - yb);
    const Q = ox ? [glass, v, w.z + u] : [w.x + u, v, glass];
    const E = [P.x, P.y, P.z], dd = [Q[0] - E[0], Q[1] - E[1], Q[2] - E[2]];
    // through the OPENING: where the segment crosses the wall plane it must lie inside the pane's rectangle
    const t = ((ox ? plane - E[0] : plane - E[2]) / (ox ? dd[0] : dd[2]));
    if (!(t > 0 && t < 1)) continue;
    const c = [E[0] + dd[0] * t, E[1] + dd[1] * t, E[2] + dd[2] * t];
    const along = ox ? c[2] - w.z : c[0] - w.x;
    if (Math.abs(along) > hw + 1e-9 || c[1] < yb - 1e-9 || c[1] > yt + 1e-9) continue;
    const len = Math.hypot(...dd);
    rays.push({ o: Q, d: dd.map(a => a / len) });
  }
  return rays;
}
const SEEN = {};
for (const w of WINDOWS.filter(w => w.kind === 'wall')) {
  const spots = spotsOfRoom(w.room);
  const tally = new Map(), groups = new Map(), spotSees = new Map();
  let total = 0;
  for (const P of spots) {
    const seen = new Set();
    for (const r of raysOf(w, P)) {
      const h = trace(r.o, r.d);
      total++;
      tally.set(h.label, (tally.get(h.label) ?? 0) + 1);
      groups.set(h.group, (groups.get(h.group) ?? 0) + 1);
      seen.add(h.label);
    }
    for (const l of seen) spotSees.set(l, (spotSees.get(l) ?? 0) + 1);
  }
  SEEN[w.id] = { total, tally, groups, spotSees, nSpots: spots.length };
}
const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);
const seenBy = (id, re) => {
  const S = SEEN[id]; let rays = 0, spots = 0;
  for (const [l, n] of S.tally) if (re.test(l)) rays += n;
  for (const [l, n] of S.spotSees) if (re.test(l)) spots = Math.max(spots, n);
  return { rays: pct(rays, S.total), spots: pct(spots, S.nSpots) };
};
for (const w of WINDOWS.filter(q => q.kind === 'wall')) {
  const S = SEEN[w.id], top = [...S.tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([l, n]) => `${l} ${pct(n, S.total)}%`);
  info(`${w.id.padEnd(8)} frames`, `${S.nSpots} spots: ${top.join(' · ')}`);
}
// The owner's windows must frame the building's NAME: the sign (or its lit plate) in the glass, from enough of the vantage spots of the room
const OWNER = [
  ['atr-w1', /armurerie\.E sign-(ARMURERIE|CAPACIT)/, 'the Armurerie from the atrium\'s west window', 'ARMURERIE / CAPACITÉS'],
  ['atr-e1', /trophees\.W sign-TROPH/, 'the Trophées from the atrium\'s east window', 'TROPHÉES / SUCCÈS'],
  ['atr-n1', /quartiers\.S sign-QUARTIERS|roof:quartiers:sign/, 'the Quartiers from the atrium\'s north window', 'QUARTIERS'],
  ['arm-n1', /quartiers\.S sign-QUARTIERS/, 'the Quartiers from the Armurerie\'s north window', 'QUARTIERS'],
  ['qua-w2', /armurerie\.N sign-ARMURERIE/, 'the Armurerie from the Quartiers\' west window', 'ARMURERIE'],
  ['qua-e1', /trophees\.N sign-TROPH/, 'the Trophées from the Quartiers\' east window', 'TROPHÉES'],
  ['qua-s1', /atrium\.N (sign-ATRIUM|ladder|vent|tray|junction|lamp)/, 'the atrium tower from the Quartiers\' window by the guitar', 'its north wall: ATRIUM, the ladder, trays, vents'],
  ['arm-e1', /annex\.N stencil-mPROD|atrium\.W /, 'the atrium (and the annex) from the Armurerie\'s south-east window', 'PROD / the tower'],
  ['arm-s1', /roof:annex:sign-PROD/, 'the PROD annex from the Armurerie\'s south ribbon', 'its roof plant: the hazard door, the lit PROD plate, the red lamp'],
];
for (const [id, re, what, name] of OWNER) {
  const r = seenBy(id, re);
  rule(r.rays >= 4 && r.spots >= 20, `owner: ${id} frames ${what}: ${name}`, `${r.rays} % of its rays, from ${r.spots} % of the room's spots`);
}

// The whole name in the glass: from how many of the room's spots do the FOUR corners of the plate (or the roof sign) all pass through the opening?
// (a 0.4 to 0.7 m pane frames about a metre of wall: a plate wider than that is read in pieces)
{
  const plates = [
    ['atr-w1', 'armurerie', 'E', id => /sign-ARMURERIE$/.test(id), 'the ARMURERIE plate'],
    ['atr-e1', 'trophees', 'W', id => /sign-TROPH/.test(id), 'the TROPHÉES / SUCCÈS plate'],
    ['atr-n1', 'quartiers', 'roof', id => /roof:quartiers:sign/.test(id), 'the QUARTIERS roof sign'],
  ];
  for (const [wid, hull, face, pick, what] of plates) {
    const w = WINDOWS.find(q => q.id === wid), b = byId[hull];
    const it = items.find(i => (i.kind === 'wall' ? i.host === `${hull}.${face}` : i.kind === 'roof' && i.host === hull) && pick(i.id));
    if (!it) { rule(false, `whole name: ${what} exists`); continue; }
    // the plate's four corners in the world: a wall plate from its face rect, a roof sign from its bounding box (its front)
    let corners;
    if (it.kind === 'wall') {
      const F = faceOf(b, face), [s0, s1, y0, y1] = it.rect;
      corners = [[s0, y0], [s1, y0], [s1, y1], [s0, y1]].map(([s, y]) => F.pt(s, y, 0.05));
    } else {
      const bb = it.bb;
      corners = [[bb.x0, bb.y0, bb.z0], [bb.x1, bb.y0, bb.z1], [bb.x1, bb.y1, bb.z1], [bb.x0, bb.y1, bb.z0]];
      const flat = (bb.x1 - bb.x0) < (bb.z1 - bb.z0);   // a sign standing along z (east/west edge) or along x (north/south edge)
      corners = flat ? [[bb.x0, bb.y0, bb.z0], [bb.x0, bb.y0, bb.z1], [bb.x0, bb.y1, bb.z1], [bb.x0, bb.y1, bb.z0]] : [[bb.x0, bb.y0, bb.z0], [bb.x1, bb.y0, bb.z0], [bb.x1, bb.y1, bb.z0], [bb.x0, bb.y1, bb.z0]];
    }
    const [fx, fz] = w.facing, floor = floorAt(w.x + fx * 0.3, w.z + fz * 0.3), yb = floor + w.sill, yt = yb + w.h, hw = w.w / 2, ox = fx !== 0;
    const through = (E, C) => {
      const plane = ox ? w.x : w.z, d = ox ? C[0] - E[0] : C[2] - E[2];
      if (Math.abs(d) < 1e-9) return false;
      const t = (plane - (ox ? E[0] : E[2])) / d;
      if (!(t > 0 && t < 1)) return false;
      const along = ox ? E[2] + (C[2] - E[2]) * t - w.z : E[0] + (C[0] - E[0]) * t - w.x, y = E[1] + (C[1] - E[1]) * t;
      return Math.abs(along) <= hw && y >= yb && y <= yt;
    };
    // the plate is sampled on a 9 × 3 grid: how much of it is in the glass from each spot?
    const grid = [];
    for (let i = 0; i < 9; i++) for (let j = 0; j < 3; j++) {
      const u = i / 8, v = (j + 0.5) / 3;
      grid.push(corners[0].map((_, k) => (corners[0][k] * (1 - u) + corners[1][k] * u) * (1 - v) + (corners[3][k] * (1 - u) + corners[2][k] * u) * v));
    }
    const spots = spotsOfRoom(w.room);
    let whole = 0, half = 0, some = 0;
    for (const P of spots) {
      const E = [P.x, P.y, P.z], n = grid.filter(C => through(E, C)).length / grid.length;
      if (n >= 0.999) whole++;
      if (n >= 0.5) half++;
      if (n > 0) some++;
    }
    const wp = pct(whole, spots.length), hp = pct(half, spots.length), sp = pct(some, spots.length);
    info(`whole name: ${wid} frames ${what}: entire from ${wp} % of the room's spots, at least half of it from ${hp} %, some of it from ${sp} %`);
    rule(hp >= 20, `legible name: at least half of ${what} is in the glass of ${wid} from at least 20 % of the room's spots (a slit frames about a metre of wall: the rest comes as the visitor walks by)`, `${hp} %`);
  }
}

// The PROD plate of the annex's roof plant, as BUILT (the item's own plate corners): in the glass of the Armurerie's south ribbon, with nothing in the way (no prop,
// no hull), and legible on a 640 × 360 screen. check-windows.mjs proves the same from the data of LANDMARKS; this proves it of the geometry that was poured.
{
  head('The PROD annex: its roof plant');
  const L = LANDMARKS.annexPlant, it = items.find(i => i.id === `roof:${L.host}:sign-PROD`), b = byId[L.host];
  rule(!!it && !!it.plate, 'the annex\'s roof plant is built (roof object sign-PROD with its plate)', it ? '' : 'missing');
  if (it?.plate) {
    const bb = it.bb;
    rule(bb.y0 >= b.roofY - 0.03 && bb.y0 <= b.roofY + 0.05 && bb.y1 > b.roofY + L.h && bb.y1 < b.roofY + L.h + 0.6, 'the plant stands on the annex roof and rises to the height of LANDMARKS (bulkhead, then the lamp over it)', `y ${f2(bb.y0)}..${f2(bb.y1)} over a roof at ${f2(b.roofY)}, bulkhead ${f2(L.h)}`);
    rule(Math.abs((bb.x0 + bb.x1) / 2 - L.x) < 0.4 && Math.abs((bb.z0 + bb.z1) / 2 - L.z) < 0.4, 'the plant stands where LANDMARKS puts it', `centre (${f2((bb.x0 + bb.x1) / 2)}, ${f2((bb.z0 + bb.z1) / 2)}) for (${L.x}, ${L.z})`);
    const w = WINDOWS.find(q => q.id === 'arm-s1');
    const c = it.plate.corners, grid = [];
    for (let i = 0; i < 9; i++) for (let j = 0; j < 4; j++) {
      const u = (i + 0.5) / 9, v = (j + 0.5) / 4;
      grid.push([0, 1, 2].map(k => c[0][k] + (c[1][k] - c[0][k]) * u + (c[3][k] - c[0][k]) * v));
    }
    const [fx, fz] = w.facing, floor = floorAt(w.x + fx * 0.3, w.z + fz * 0.3), yb = floor + w.sill, yt = yb + w.h, hw = w.w / 2, ox = fx !== 0;
    const plane = ox ? w.x : w.z, glass = plane - (ox ? fx : fz) * GLASS_DEPTH;
    const FOCAL = 320 / Math.tan(Math.PI / 6);
    const spots = spotsOfRoom(w.room), letters = [], pixels = [];
    let half = 0, whole = 0, blockedBy = new Map();
    const nrm = (() => { const a = [c[1][0] - c[0][0], c[1][2] - c[0][2]]; const l = Math.hypot(...a); return [-a[1] / l, a[0] / l]; })();   // the plate's normal (x, z), toward the viewer (the plate's right is (nz, -nx))
    for (const P of spots) {
      const E = [P.x, P.y, P.z];
      let seen = 0;
      for (const q of grid) {
        const dd = [q[0] - E[0], q[1] - E[1], q[2] - E[2]];
        const tw = (plane - (ox ? E[0] : E[2])) / (ox ? dd[0] : dd[2]), tg = (glass - (ox ? E[0] : E[2])) / (ox ? dd[0] : dd[2]);
        if (!(tw > 0 && tg > tw && tg < 1)) continue;
        const at = t => [E[0] + dd[0] * t, E[1] + dd[1] * t, E[2] + dd[2] * t];
        const inGlass = t => { const p = at(t), along = ox ? p[2] - w.z : p[0] - w.x; return Math.abs(along) <= hw + 1e-9 && p[1] >= yb - 1e-9 && p[1] <= yt + 1e-9; };
        if (!inGlass(tw) || !inGlass(tg)) continue;
        const G0 = at(tg), len = Math.hypot(...dd), h = trace(G0, dd.map(a => a / len));
        if (h.label === it.id) seen++; else blockedBy.set(h.label, (blockedBy.get(h.label) ?? 0) + 1);
      }
      const f = seen / grid.length;
      if (f >= 0.999) whole++;
      if (f >= 0.5) {
        half++;
        const mid = [0, 1, 2].map(k => (c[0][k] + c[2][k]) / 2), dp = [mid[0] - E[0], mid[1] - E[1], mid[2] - E[2]], ld = Math.hypot(...dp);
        const centre = ox ? [plane, (yb + yt) / 2, w.z] : [w.x, (yb + yt) / 2, plane], dc = [centre[0] - E[0], centre[1] - E[1], centre[2] - E[2]], lc = Math.hypot(...dc);
        const depth = (dp[0] * dc[0] + dp[1] * dc[1] + dp[2] * dc[2]) / lc, cosPhi = -(dp[0] * nrm[0] + dp[2] * nrm[1]) / ld;
        letters.push(it.plate.letter * FOCAL / depth); pixels.push(it.plate.letter / 5 * FOCAL * cosPhi / depth);
      }
    }
    const hp = pct(half, spots.length), wp = pct(whole, spots.length);
    const qn = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
    info(`PROD plate: arm-s1 frames all of it from ${wp} % of the room's spots, at least half of it from ${hp} %`, `${blockedBy.size ? `what hides it from the other rays: ${[...blockedBy].sort((p, q) => q[1] - p[1]).slice(0, 4).map(([k, n]) => `${k} ${n}`).join(', ')}` : 'nothing hides it'}`);
    rule(hp >= 25, 'legible name: at least half of the PROD plate is in the glass of arm-s1 from at least 25 % of the room\'s spots, nothing in the way (no prop on the annex roof, no hull)', `${hp} % of ${spots.length} spots (whole from ${wp} %)`);
    rule(half > 0 && qn(letters, 0) >= 8 && qn(pixels, 0.05) >= 1.5, 'the PROD plate is readable at 640 × 360: from every spot that frames half of it a letter is ≥ 8 px tall and a font pixel ≥ 1.5 px wide (95 % of the spots)',
      half ? `letters ${f2(qn(letters, 0))}..${f2(qn(letters, 1))} px (median ${f2(qn(letters, 0.5))}), font pixel ${f2(qn(pixels, 0.05))}..${f2(qn(pixels, 1))} px wide` : 'never framed');
    // the red hazard door and the red lamp are on the same front: lit red glass (the glow batch) lies within the plate's bulkhead, under the plate, and over the roof
    const glow = it.v.filter(p => p[3] === 'glow' || p[3] === 'beacon');
    const red = glow.length;
    rule(red >= 16 && it.beacons?.length >= 1, 'the plant carries its lit door, lamps and plate (glow) and a red beacon on its mast', `${red} lit vertices, ${it.beacons?.length ?? 0} beacon(s)`);
  }
}

if (SHOW_FACES) {
  head('Faces: what hangs where (s along the face, y up; worksheet)');
  for (const b of SOLIDS) for (const k of SIDES) {
    const F = faceOf(b, k), here = items.filter(i => i.host === F.id);
    if (!here.length) continue;
    log(`${F.id.padEnd(12)} s ${F.lo}..${F.hi}  y ${G}..${b.roofY}`);
    for (const q of hulls.windowsOnHulls.filter(q => q.b === b && q.k === k)) log(`     window  ${q.id}  s ${f2(q.s - q.hw)}..${f2(q.s + q.hw)}  y ${f2(q.yb)}..${f2(q.yt)}`);
    for (const it of here) log(`     ${it.kind.padEnd(7)} ${it.id.split(':').slice(1).join(':').padEnd(34)} s ${f2(it.rect[0])}..${f2(it.rect[1])}  y ${f2(it.rect[2])}..${f2(it.rect[3])}`);
  }
}

log(`\n${failed ? `${failed} FAILED` : 'ALL PASS'}`);
process.exitCode = failed ? 1 : 0;
