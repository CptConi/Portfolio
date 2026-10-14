import * as THREE from 'three';
import { EARTH } from '../props/sky.js';
import { Kit, rng, D2R, mulC, mixC, rockGeo, dishGeo, domeGeo, sphereGeo, signKey } from './propsKit.js';
import { IDENTITY, faceOf } from './hulls.js';
import { LANDMARKS } from '../decor/windowSlots.js';   // read-only data: where the windows are cut to frame something (the annex's roof plant)

// The DRESSING of the exterior world (the builder, Exterior.js, calls buildExteriorProps(scene, ctx) once): everything that hangs on the walls,
// stands on the roofs and on the plain, merged into a few meshes that share one painted atlas (propsKit.js) and three materials:
//   lit    Lambert solids: equipment, masts, dishes, tanks, the lander, rocks (they cast and receive the sun's hard shadows)
//   decal  flush graphics: stencils, paint, tyre tracks, boot prints, the pad (alpha-tested, never casts)
//   glow   unlit light: lit signs, lamps, indicator LEDs, dithered pools of light on the walls (additive)
// The beacons go through ctx.addBeacon (the builder's own glow mesh: no extra call).
//
// TWO PHASES (a faster start): the dressing of the base (what hangs on the faces, the tubes and cables of the alleys, the roofs, the tower: what the
// windows look at from close) is poured at once, as the first three meshes; the plain (antennas, solar field, tank farm, lander, rocks) is poured in four
// slices of the builder's idle queue (ctx.defer) and ends as three more meshes with the same materials. Without ctx.defer both run at once.
//
// Every object is poured inside Kit.item(), which records what it made, what it stands on and the vertices it made, so that check-exterior.mjs can prove it:
//   'wall'   hangs on a face (host 'block.F'): inside the face, in front of the wall, under the cornice (ladders end at the parapet), clear of the windows,
//            of the tubes that join the face, of the secret's corridor and of one another (the wall tools REFUSE what does not fit: D.skipped says why)
//   'roof'   stands on a roof (host = block id): inside the parapet, on the plate; the atrium's leaves the skylight's column free
//   'cable'  strung between two walls: stays inside its alley, over the ground, under both parapets, where both clamps find room
//   'ground' on the plain: on the ground, outside every footprint (hulls, tubes, drifts, alleys), inside WORLD_RADIUS; a rock is an object of its own
//   'light'  a flush pool of light (additive): inside its face (it starts over the roof of a tube that joins it)
//
// What the windows see decided where the care went (v3): the hulls are real buildings 2 to 3 m tall, so a window of one room looks across a
// 1 m or 2 m alley at the WALL of its neighbour. Each building is recognisable by its colours (hulls.js IDENTITY) and by its NAME: lit letters on a
// plate on the wall the windows look at (ARMURERIE + CAPACITÉS, TROPHÉES + SUCCÈS, QUARTIERS, PROD, ATRIUM), a sign on the roof edge, and the
// equipment a building like that would have. The plates are sized for the slits they are seen through (a 0.4 to 0.7 m pane frames a metre of wall).
// The atrium is the tower: a drum, a dome and masts, taller than every wing. The secret's corridor (x 12-13 between the atrium and the annex) is
// left plain on both sides. The annex is the lowest hull and no wing sees its walls (every window that looks its way is above the visitor's eye and
// its rays pass over the roof line): it is announced by a ROOF PLANT, a bulkhead with the red hazard door, the lit PROD plate and a red lamp, turned
// to face the Armurerie's south ribbon (annexPlant; windowSlots.js LANDMARKS says where, check-windows.mjs and check-exterior.mjs prove it is framed).

const STEEL = 0x69727d, STEEL_D = 0x2d333a, STEEL_L = 0x9aa2ab, COPPER = 0x9a5a2e, CABLE = [0x23262b, 0x8a2a22, 0x2a4c80];
const AMBER = 0xffc880, WHITE_W = 0xffeccc;
const REGOLITH = 0x5b564e;
const PAD = { x: 33.5, z: 25.5 };                        // the landing pad (south-east)
const ROVER = { x: PAD.x - 6.2, z: PAD.z - 3.4, yaw: 0.9 };   // parked on the way to the base; the lamp posts follow its track
const SECRET = { s0: 11.7, s1: 13.3 };                   // x of the corridor behind the push-wall, with a margin: nothing is hung there, on either side

const hdr = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
const lerp = (a, b, t) => a + (b - a) * t;
const fx = v => v.toFixed(2);

// Two phases, so that the game starts sooner: the DRESSING of the base (names, equipment on the walls, the alleys, the roofs, the tower: what the windows
// look at from close) is poured at once; the PLAIN (antennas, solar field, lander, rocks...) is poured in slices when `ctx.defer` is there (the builder
// hands the slices to the browser's idle time) and at once when it is not (tests, other callers). Both phases share one atlas and the same three
// materials, so the second one adds meshes, never shaders.
export function buildExteriorProps(scene, ctx) {
  // the builder's ctx has everything; the defaults keep the module usable with a bare one (tests, other callers)
  ctx = {
    clear: () => true, pixelFog: m => m, footprints: [], windows: [], center: { x: 12.5, z: 12.5 }, addBeacon: () => {},
    sunDir: new THREE.Vector3(0.838, 0.259, 0.484), ...ctx,
  };
  const _now = () => (typeof performance !== 'undefined' ? performance.now() : 0);
  let _t = _now();
  const timing = {};
  const lap = k => { const n = _now(); timing[k] = +(n - _t).toFixed(1); _t = n; };
  const K = new Kit();
  lap('kit');
  const B = Object.fromEntries(ctx.BLOCKS.map(b => [b.id, b]));
  // a beacon belongs to the object being poured (the proofs read it as a small sphere)
  const beaconOf = kit => (x, y, z, color, size) => {
    const sc = kit._scope;
    if (sc) (sc.beacons ??= []).push([x, y, z, size / 2]);
    ctx.addBeacon(x, y, z, color, size);
  };
  const D = { K, ctx, B, rand: rng(20261014), beacon: beaconOf(K), skipped: [] };

  dressFaces(D);
  windowGlows(D); lap('faces');
  dressLinks(D);
  alleyCables(D); lap('links+cables');
  dressRoofs(D);
  dressTower(D); lap('roofs+tower');

  // ── Materials: one atlas for all, fog in six dithered steps like the rest of the exterior ──
  const tex = K.atlas.texture({ mip: true });
  tex.anisotropy = 4;
  const litMat = ctx.pixelFog(new THREE.MeshLambertMaterial({ map: tex, vertexColors: true }));
  const decalMat = ctx.pixelFog(new THREE.MeshLambertMaterial({ map: tex, vertexColors: true, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  // light: additive; the alpha of a texel (a pool's falloff) is turned into on/off game pixels by the exterior's ordered dither, so the
  // light of a lamp is a Doom stipple, not a gradient. Solid LEDs and stencils (alpha 1) are untouched.
  const glowMat = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, alphaTest: 0.01, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  glowMat.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n  if ( diffuseColor.a < extBayer() ) discard;\n  diffuseColor.a = 1.0;');
  };
  glowMat.customProgramCacheKey = () => 'props-glow-dither';   // (the patch above is not part of three's own cache key)
  ctx.pixelFog(glowMat);   // (fog is off here; this gives the shader the dither: uPx + extBayer())

  const pour = (kit, tag) => {
    const add = (batch, mat, name, noCast = false) => {
      if (!batch.idx.length) return;
      const m = batch.mesh(mat);
      m.name = name;
      m.frustumCulled = false;   // merged over the whole world: one bounding sphere would not cull anything anyway
      if (noCast) m.userData.noCast = true;
      scene.add(m);
    };
    add(kit.lit, litMat, `exterior:props${tag}`);
    add(kit.decal, decalMat, `exterior:props-decals${tag}`, true);
    add(kit.glow, glowMat, `exterior:props-glow${tag}`, true);
  };
  pour(K, '');
  lap('meshes');
  // `kit` and the items stay for the proofs; nothing in the game reads them
  const out = { triangles: K.count(), items: K.items, kit: K, skipped: D.skipped, untracked: K.untracked, timing, phase: 'dressing' };

  // ── Phase 2: the plain, in slices ──
  const K2 = new Kit({ atlas: K.atlas, cell: K.cell });
  const D2 = { K: K2, ctx, B, rand: rng(20261014 ^ 0x5eed), beacon: beaconOf(K2), skipped: [], taken: [] };
  const timing2 = {};   // (filled by the builder's queue: how long each slice took)
  const steps = plainSteps(D2);
  const finish = () => {
    pour(K2, '-plain');
    return { triangles: K2.count(), items: K2.items, kit: K2, skipped: D2.skipped, untracked: K2.untracked, timing: timing2, phase: 'plain' };
  };
  const slices = [...steps, finish];
  if (ctx.defer) slices.forEach((fn, i) => ctx.defer(i < slices.length - 1 ? `props:plain ${i + 1}/${steps.length}` : 'props:plain meshes', fn));
  else { for (const fn of steps) fn(); out.plain = finish(); }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
//  The tools of a wall
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// wallOf(D, block, 'N' | 'S' | 'E' | 'W') → the tools that hang things on that face. `s` runs along the face in world axes (x on N/S, z on E/W),
// `off` is the distance in front of the wall. Every tool refuses (and notes it in D.skipped) what would not fit: outside the face, over a window
// (the lit glass and its frame), above the cornice (a ladder may end at the parapet).
function wallOf(D, b, k) {
  const { K, ctx } = D;
  const F = faceOf(b, k), G = ctx.GROUND_Y, id = IDENTITY[b.id] ?? IDENTITY.atrium;
  const wins = (ctx.windows ?? []).filter(q => q.b.id === b.id && q.k === k);
  // the tubes that abut this face: what they cover (x/z range along the face, up to their roof and a collar) is not wall any more
  const hits = (ctx.LINKS ?? []).filter(l => !F.id.startsWith('link') && (
    (k === 'E' && l.x0 === b.x1 && l.z0 < b.z1 && l.z1 > b.z0) || (k === 'W' && l.x1 === b.x0 && l.z0 < b.z1 && l.z1 > b.z0) ||
    (k === 'N' && l.z1 === b.z0 && l.x0 < b.x1 && l.x1 > b.x0) || (k === 'S' && l.z0 === b.z1 && l.x0 < b.x1 && l.x1 > b.x0)));
  const tubes = hits.map(l => ({ s0: F.alongX ? l.x0 : l.z0, s1: F.alongX ? l.x1 : l.z1, top: l.roofY + 0.04 }));
  const { lit, decal, glow } = K;
  const floorY = G + 0.5 + (id.kerb ? 0.17 : 0);   // the top of the foundation, and of the hazard kerb where the hull has one
  const capY = b.roofY - 0.29;                      // the bottom of the accent stripe, with a hair of air: plates and signs stay under it
  const W = { F, b, wins, tubes, floorY, top: b.roofY, capY };
  const placed = (D.placed ??= new Map()).get(F.id) ?? (D.placed.set(F.id, []), D.placed.get(F.id));
  W.placed = placed;

  // is the wall rectangle free of windows (their frames and sills included) and of the tubes that join it?
  W.free = (s0, s1, y0, y1, pad = 0.06) => !wins.some(q => s1 > q.s - q.hw - 0.05 - pad && s0 < q.s + q.hw + 0.05 + pad && y1 > q.yb - 0.07 - pad && y0 < q.yt + 0.05 + pad) &&
    !tubes.some(t => s1 > t.s0 - 0.02 && s0 < t.s1 + 0.02 && y0 < t.top + 0.02);
  // is there room for a small thing here (a cable's clamp)? Not over a window or a tube, not on anything already hung there.
  W.room = (s0, s1, y0, y1) => s0 > F.lo + 0.05 && s1 < F.hi - 0.05 && W.free(s0, s1, y0, y1, 0.04) && !((F.id === 'atrium.S' || F.id === 'annex.N') && s1 > SECRET.s0 && s0 < SECRET.s1) &&
    !placed.some(o => !o.under && s1 > o.rect[0] && s0 < o.rect[1] && y1 > o.rect[2] && y0 < o.rect[3]);
  // an object on the face inside the rectangle [s0, s1, y0, y1]. `under` = a smear of grime (it may lie under a solid thing, never under another smear),
  // `ladder` = it may reach the parapet. Anything else may not overlap another thing of the face (the check proves it).
  W.put = (name, rect, fn, meta = {}) => {
    const [s0, s1, y0, y1] = rect;
    const maxY = meta.ladder ? b.roofY + 0.1 : b.roofY - 0.12;
    const pad = meta.pad ?? 0.06;
    const secret = (F.id === 'atrium.S' || F.id === 'annex.N') && s1 > SECRET.s0 && s0 < SECRET.s1;
    const hit = placed.find(o => s1 - 0.005 > o.rect[0] && s0 + 0.005 < o.rect[1] && y1 - 0.005 > o.rect[2] && y0 + 0.005 < o.rect[3] && !(meta.under && !o.under) && !(o.under && !meta.under));
    const why = secret ? 'the secret' : s0 < F.lo + 0.05 || s1 > F.hi - 0.05 ? 'past the end' : y0 < G - 1e-6 ? 'under the plain' : y1 > maxY + 1e-6 ? 'over the cornice' : !W.free(s0, s1, y0, y1, pad) ? 'a window or a tube' : hit ? `overlaps ${hit.name}` : null;
    if (why) { D.skipped.push(`${F.id}:${name} [${rect.map(fx).join(' ')}] ${why}`); return false; }
    placed.push({ name, rect, under: !!meta.under });
    K.item(`${F.id}:${name}`, { kind: 'wall', host: F.id, rect, ...meta }, fn);
    return true;
  };
  // a pool of light on the wall, shrunk to fit the face (it must never hang in the air past a corner or under the ground)
  W.light = (name, s, y, w, h, color, strength = 0.4) => {
    const s0 = Math.max(s - w / 2, F.lo + 0.03), s1 = Math.min(s + w / 2, F.hi - 0.03), y0 = Math.max(y - h / 2, G + 0.03), y1 = Math.min(y + h / 2, b.roofY - 0.03);
    if ((F.id === 'atrium.S' || F.id === 'annex.N') && s1 > SECRET.s0 && s0 < SECRET.s1) return;   // the secret's corridor stays neutral
    // (a pool never lights the inside of a tube that joins the face: it starts over the tube's roof there)
    let ya = y0;
    for (const t of tubes) if (s1 > t.s0 && s0 < t.s1) ya = Math.max(ya, t.top + 0.01);
    if (s1 - s0 < 0.1 || y1 - ya < 0.1) return;
    K.item(`${F.id}:${name}`, { kind: 'light', host: F.id, rect: [s0, s1, ya, y1] }, () => {
      K.quadAt(glow, F.pt((s0 + s1) / 2, (ya + y1) / 2, 0.02), F.n, s1 - s0, y1 - ya, { uv: K.uv('pool'), color: hdr(color, strength) });
    });
  };

  const box = (s0, s1, y0, y1, o0, o1, opts) => K.boxMM(lit, ...F.box(s0, s1, y0, y1, o0, o1), opts);
  const tube = (s0, y0, o0, s1, y1, o1, r, opts) => K.tube(lit, F.pt(s0, y0, o0), F.pt(s1, y1, o1), r, opts);
  const flush = (s, y, w, h, opts, off = 0.016) => K.quadAt(decal, F.pt(s, y, off), F.n, w, h, opts);
  W.box = box; W.tube = tube; W.flush = flush;

  // a printed cable tray: the tray cell once per metre, two rails, brackets, three fat cables
  W.tray = (s0, s1, y, w = 0.26) => W.put(`tray@${fx(s0)},${fx(y)}`, [s0, s1, y - w / 2, y + w / 2], () => {
    const u = K.uv('tray');
    for (let s = s0; s < s1 - 1e-6; s += 1) {
      const e = Math.min(s1, s + 1), f = e - s;
      K.quadAt(lit, F.pt((s + e) / 2, y, 0.045), F.n, f, w, { uv: { u0: u.u0, u1: u.u0 + (u.u1 - u.u0) * f, v0: u.v0, v1: u.v1 } });
    }
    for (const dy of [-w / 2, w / 2 - 0.03]) box(s0, s1, y + dy, y + dy + 0.03, 0, 0.07, { color: STEEL });
    for (let s = s0 + 0.15; s < s1; s += 1) box(s - 0.02, s + 0.02, y - w / 2, y + w / 2, 0, 0.045, { color: STEEL_D });
    CABLE.forEach((c, i) => tube(s0, y + (i - 1) * 0.07, 0.085, s1, y + (i - 1) * 0.07, 0.085, 0.021, { seg: 6, color: c }));
  });

  // where a tray goes into the wall: a box with a green LED, over the tray's end (one object, so it can be refused as one)
  W.trayEnd = (s, y, w = 0.4, h = 0.44) => W.put(`tray-end@${fx(s)},${fx(y)}`, [s - w / 2, s + w / 2, y - h / 2, y + h / 2], () => {
    box(s - w / 2, s + w / 2, y - h / 2, y + h / 2, 0, 0.14, { cell: 'plate' });
    K.quadAt(glow, F.pt(s, y + h / 2 - 0.1, 0.143), F.n, 0.05, 0.05, { color: hdr(0x3dff7a, 1.0) });
  });

  // a vertical conduit, clamped every 0.45 m
  W.riser = (s, y0, y1, r = 0.03, color = STEEL_D) => W.put(`riser@${fx(s)}`, [s - r * 1.4, s + r * 1.4, y0, y1], () => {
    tube(s, y0, 0.05, s, y1, 0.05, r, { seg: 7, color });
    for (let y = y0 + 0.2; y < y1 - 0.05; y += 0.45) box(s - r * 1.4, s + r * 1.4, y, y + 0.045, 0, 0.05 + r * 0.9, { color: STEEL });
  });

  // a horizontal pipe on stand-offs
  W.pipe = (s0, s1, y, r = 0.065, color = STEEL, front = 0.11) => W.put(`pipe@${fx(s0)},${fx(y)}`, [s0, s1, y - r - 0.01, y + r + 0.01], () => {
    tube(s0, y, front, s1, y, front, r, { seg: 8, color });
    for (let s = s0 + 0.2; s < s1; s += 0.9) box(s - 0.03, s + 0.03, y - r - 0.01, y + r + 0.01, 0, front, { color: STEEL_D });
  });

  // a louvred vent panel in a dark frame
  W.vent = (s, y, w = 0.55, h = 0.4) => W.put(`vent@${fx(s)},${fx(y)}`, [s - w / 2 - 0.03, s + w / 2 + 0.03, y - h / 2 - 0.03, y + h / 2 + 0.03], () => {
    box(s - w / 2 - 0.03, s + w / 2 + 0.03, y - h / 2 - 0.03, y + h / 2 + 0.03, 0, 0.06, { cell: 'plateDark' });
    K.quadAt(lit, F.pt(s, y, 0.062), F.n, w, h, { uv: K.uv('louvre') });
  });

  // a work lamp on a bracket: arm, hood, a bulb that blooms, and its dithered pool of light on the wall
  W.lamp = (s, y, { reach = 0.3, pool = 1.2, tint = AMBER, strength = 0.55 } = {}) => {
    const ok = W.put(`lamp@${fx(s)},${fx(y)}`, [s - 0.1, s + 0.1, y - 0.2, y + 0.04], () => {
      tube(s, y, 0.02, s, y, reach, 0.016, { seg: 6, color: STEEL });
      tube(s, y, reach, s, y - 0.03, reach, 0.012, { seg: 6, color: STEEL });
      K.cone(lit, F.pt(s, y - 0.12, reach), 0.085, 0.03, 0.1, { seg: 8, color: STEEL_D });
      K.put(glow, sphereGeo(8, 6), { pos: F.pt(s, y - 0.15, reach), scale: [0.045, 0.045, 0.045], color: hdr(WHITE_W, 1.6) });
    });
    if (ok) W.light(`lamp-pool@${fx(s)},${fx(y)}`, s, y - 0.45 - pool * 0.1, pool, pool * 1.25, tint, strength);
    return ok;
  };

  // an indicator box with LEDs
  W.junction = (s, y, w = 0.32, h = 0.42, leds = [0x3dff7a, 0xffb040, 0xff4a3a]) => W.put(`junction@${fx(s)},${fx(y)}`, [s - w / 2, s + w / 2, y - h / 2, y + h / 2], () => {
    box(s - w / 2, s + w / 2, y - h / 2, y + h / 2, 0, 0.12, { cell: 'stripBox' });
    leds.forEach((c, i) => K.quadAt(glow, F.pt(s, y + h / 2 - 0.09 - i * 0.1, 0.123), F.n, 0.05, 0.05, { color: hdr(c, 1.1) }));
  });

  // a valve wheel on a pipe whose front is at `front` off the wall
  W.valve = (s, y, front, color = 0x9a4a22) => W.put(`valve@${fx(s)},${fx(y)}`, [s - 0.12, s + 0.12, y - 0.12, y + 0.12], () => {
    tube(s, y, 0.02, s, y, front + 0.08, 0.018, { seg: 6, color: STEEL_L });   // a stand-off from the wall through the pipe to the wheel
    K.put(lit, new THREE.TorusGeometry(0.09, 0.014, 5, 10), { pos: F.pt(s, y, front + 0.09), rot: [0, F.n[0] ? Math.PI / 2 : 0, 0], color });
    // two spokes across the wheel: without them the ring hung round the tip of its stem, touching nothing
    tube(s - 0.09, y, front + 0.09, s + 0.09, y, front + 0.09, 0.009, { seg: 5, color });
    tube(s, y - 0.09, front + 0.09, s, y + 0.09, front + 0.09, 0.009, { seg: 5, color });
  }, { under: true });

  // a plate bolted over a dent / a patch of grime
  W.patch = (s0, s1, y0, y1, cell = 'plateRust') => W.put(`patch@${fx(s0)},${fx(y0)}`, [s0, s1, y0, y1], () => box(s0, s1, y0, y1, 0, 0.04, { cell }));
  W.grime = (s, y, w, h, color = 0x1c2024) => W.put(`grime@${fx(s)},${fx(y)}`, [s - w / 2, s + w / 2, y - h / 2, y + h / 2], () => flush(s, y, w, h, { uv: K.uv('mGrime'), color }), { under: true });
  // a stencil: one atlas mask at `px` metres per font pixel, tinted by `color`
  W.stencil = (s, y, name, px, color) => {
    const c = K.cell[name], w = c.w * px, h = c.h * px;
    return W.put(`stencil-${name}@${fx(s)},${fx(y)}`, [s - w / 2, s + w / 2, y - h / 2, y + h / 2], () => flush(s, y, w, h, { uv: K.uv(name), color }));
  };

  // the ladder to the roof: two rails, rungs every 0.28, stand-offs; it ends at the parapet (never above it)
  W.ladder = (s, w = 0.3) => {
    const top = b.roofY + 0.08;
    return W.put(`ladder@${fx(s)}`, [s - 0.02, s + w + 0.02, G, top], () => {
      for (const ds of [0, w]) tube(s + ds, G, 0.17, s + ds, top, 0.17, 0.016, { seg: 6, color: STEEL_L });
      for (let y = G + 0.2; y < top - 0.03; y += 0.28) tube(s, y, 0.17, s + w, y, 0.17, 0.011, { seg: 5, color: STEEL_L });
      for (let y = G + 0.1; y < top - 0.1; y += 0.9) for (const ds of [0, w]) tube(s + ds, y, 0.02, s + ds, y, 0.17, 0.012, { seg: 5, color: STEEL_D });
    }, { ladder: true });
  };

  // The NAME of the building: lit letters on a dark plaque, with a trim of the same light and a wash on the wall around it.
  //   lines   [{ text, px }]  stacked from the top, centred on s (px = metres per font pixel; the text is one of SIGN_TEXTS)
  //   icon    'cup'           an emblem at the viewer's left of the text (a square of `iconSize` metres)
  W.sign = (lines, s, y, { icon = null, iconSize = 0.5, accent = id.accent, strength = 0.85, pad = 0.12, wash = true } = {}) => {
    const cells = lines.map(l => K.cell[signKey(l.text)]);
    const lw = lines.map((l, i) => cells[i].w * l.px), lh = lines.map((l, i) => cells[i].h * l.px);
    const gap = 0.05, textW = Math.max(...lw), textH = lh.reduce((a, v) => a + v, 0) + gap * (lines.length - 1);
    const totalW = textW + (icon ? iconSize + 0.12 : 0), plateW = totalW + 2 * pad, plateH = Math.max(textH, icon ? iconSize : 0) + 2 * pad;
    const s0 = s - plateW / 2, s1 = s + plateW / 2, y0 = y - plateH / 2, y1 = y + plateH / 2;
    const name = lines.map(l => l.text).join('+');
    const dir = F.right;   // world direction of the viewer's right along the wall
    if (y1 > capY + 1e-6) { D.skipped.push(`${F.id}:sign-${name} (over the stripe: ${fx(y1)} > ${fx(capY)})`); return false; }
    const ok = W.put(`sign-${name}`, [s0, s1, y0, y1], () => {
      box(s0, s1, y0, y1, 0, 0.05, { cell: 'plateDark' });
      // trim: four thin lit lines inside the plaque's edge
      const t = 0.018, o = 0.053, tc = hdr(accent, strength * 0.45);
      for (const [a0, a1, b0, b1] of [[s0 + 0.04, s1 - 0.04, y1 - 0.04 - t, y1 - 0.04], [s0 + 0.04, s1 - 0.04, y0 + 0.04, y0 + 0.04 + t], [s0 + 0.04, s0 + 0.04 + t, y0 + 0.04, y1 - 0.04], [s1 - 0.04 - t, s1 - 0.04, y0 + 0.04, y1 - 0.04]]) {
        K.quadAt(glow, F.pt((a0 + a1) / 2, (b0 + b1) / 2, o), F.n, a1 - a0, b1 - b0, { color: tc });
      }
      // the lines of text, centred on the text block (to the viewer's right of the icon)
      const textC = s + dir * (icon ? (iconSize + 0.12) / 2 : 0);
      let yy = y + textH / 2;
      lines.forEach((l, i) => {
        K.quadAt(glow, F.pt(textC, yy - lh[i] / 2, 0.056), F.n, lw[i], lh[i], { uv: K.sign(l.text), color: hdr(accent, strength) });
        yy -= lh[i] + gap;
      });
      if (icon) K.quadAt(glow, F.pt(s - dir * (textW + 0.12) / 2, y, 0.056), F.n, iconSize, iconSize, { uv: K.uv(icon), color: new THREE.Color(0.85, 0.85, 0.85) });
    });
    if (ok && wash) W.light(`sign-wash-${name}`, s, y, plateW * 1.7, plateH * 2.4, accent, 0.3);
    return ok;
  };

  return W;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
//  The walls of the hulls
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// What the windows look at (check-windows.mjs, "WORTH DRESSING" and the `dress` notes) decided where the care went:
//   trophees.W   atr-e1 from 1 m, qua-s1, prod-p1 · armurerie.E   atr-w1 from 1 m, prod-p1 · trophees.N   qua-s1, qua-e1 · atrium.S   prod-p1
//   atrium.E     tro-w1 from 1 m · quartiers.S   atr-n1 from 2 m · armurerie.N   qua-w2, qua-w1 · atrium.N   qua-s1 · armurerie.S   prod-p1
function dressFaces(D) {
  const { K, B, ctx } = D;
  const at = (id, k) => wallOf(D, B[id], k);
  const lamp = (W, s, y, A, o = {}) => W.lamp(s, y, { pool: 1.4, tint: A, strength: 0.45, ...o });
  const slit = (W, name, s0, s1, y, A, k = 0.5) => W.put(name, [s0, s1, y - 0.03, y + 0.03], () => K.quadAt(K.glow, W.F.pt((s0 + s1) / 2, y, 0.012), W.F.n, s1 - s0, 0.05, { color: hdr(A, k) }));

  // ── ATRIUM: the tower, cool grey-blue plates with cyan slits ──────────────────────────────────────────────
  {
    // EAST (x 16): tro-w1 stares at it from 1 m (z 9.2-10.5, y 0.95-1.8; the whole face z 9-13.6, up to 2.5); atr-e1 is the hall's window at z 14.6;
    // the link-e tube (z 11-14) joins it below 0.79. THE NAME stands over the tray, lit by the lamp beside it.
    const W = at('atrium', 'E'), A = IDENTITY.atrium.accent, y0 = W.floorY;
    W.tray(9.06, 13.9, 1.5, 0.22);
    W.sign([{ text: 'ATRIUM', px: 0.04 }], 10.3, 1.93, { accent: A, pad: 0.07 });
    lamp(W, 11.85, 1.9, A, { pool: 1.3, strength: 0.55 });
    W.stencil(9.6, 1.0, 'mHull2', 0.045, 0xb9b08a);
    W.junction(10.6, 0.8);
    W.riser(12.05, 0.83, 1.38); W.riser(12.9, 0.83, 1.38, 0.034, STEEL);
    W.vent(13.4, 1.05, 0.4, 0.34);
    slit(W, 'lit-slit', 9.3, 13.7, 2.17, A);
    W.grime(9.4, 0.5, 0.3, 0.3); W.grime(13.2, 1.75, 0.5, 0.3);
    W.pipe(9.1, 10.9, y0 + 0.1); W.valve(9.75, y0 + 0.1, 0.175);
  }
  {
    // SOUTH (z 16): prod-p1 stares at it from 2 m (x 9.5-12.6, y 0.3-0.95). The push-wall (x 12-13) is a SECRET: nothing is hung over it on either
    // side of the alley (the wall tools refuse x 11.7-13.3). The service hatch of the tower is at the west end.
    const W = at('atrium', 'S'), y0 = W.floorY, A = IDENTITY.atrium.accent;
    const doorB = y0 + 0.07, doorT = 1.42, dx = 10.25;
    W.put('hatch', [dx - 0.6, dx + 0.6, y0, 1.5], () => {
      W.box(dx - 0.6, dx + 0.6, y0 + 0.03, 1.5, 0, 0.05, { cell: 'plateDark' });
      K.quadAt(K.lit, W.F.pt(dx, (doorB + doorT) / 2, 0.055), W.F.n, 0.88, doorT - doorB, { uv: K.uv('door') });
      W.box(dx - 0.5, dx - 0.3, y0 + 0.4, y0 + 0.52, 0.05, 0.12, { color: 0xb08a3a });   // a padlock hasp
    });
    lamp(W, 9.3, 1.62, A, { pool: 1.4, strength: 0.55 });
    W.stencil(11.25, 1.28, 'mHull2', 0.04, 0xb9b08a);
    W.junction(14.0, 0.98, 0.34, 0.46, [0xff4a3a, 0xff4a3a, 0xffb040]);
    W.vent(14.9, 1.35, 0.5, 0.4); W.vent(15.55, 0.88, 0.5, 0.36);
    W.pipe(13.4, 15.9, 0.3); W.pipe(13.4, 15.9, 0.46, 0.04, COPPER, 0.09);
    W.tray(13.45, 15.9, 1.75, 0.2);
    W.grime(9.6, 0.4, 0.5, 0.2, 0x1c2024); W.grime(14.6, 1.0, 0.5, 0.4);
    W.pipe(9.1, 9.6, 0.45);
    slit(W, 'lit-slit', 9.3, 11.5, 2.05, A);
  }
  {
    // NORTH (z 9): qua-s1 stares at it from 2 m (x 14.1-15.8, y 0.2-1.65; the whole face x 9.3-16, up to 2.3); atr-n1 is the hall's window at x 14.7.
    // THE LADDER climbs to the roof and stops at the parapet. The link-n tube (x 11-14) joins it below 0.79.
    const W = at('atrium', 'N'), y0 = W.floorY, A = IDENTITY.atrium.accent;
    W.ladder(15.5);
    W.vent(14.75, 0.5, 0.7, 0.45);
    W.riser(15.27, y0, 2.1, 0.03); W.riser(15.36, y0, 2.1, 0.026);
    lamp(W, 14.05, 1.7, A, { pool: 1.3, strength: 0.55 });
    W.sign([{ text: 'ATRIUM', px: 0.04 }], 12.4, 1.55, { accent: A, pad: 0.07 });
    W.tray(9.15, 10.85, 1.1, 0.22);
    W.vent(9.8, 0.55, 0.7, 0.45); W.vent(10.55, 0.55, 0.4, 0.34);
    W.junction(13.5, 1.15, 0.34, 0.46, [0x3dff7a, 0x3dff7a, 0xffb040]);
    W.stencil(14.67, 2.08, 'mDF', 0.03, 0xc8aa3c);
    W.grime(12.4, 0.98, 0.6, 0.3, 0x181b1e);
    slit(W, 'lit-slit', 9.3, 12.7, 2.15, A);
  }
  {
    // WEST (x 9): arm-e1 stares at it from 1 m (z 14.9-15.8, y 0.05-0.95: the lit glass of atr-w1 itself and the wall at its right); the link-w tube (z 11-14) joins it
    const W = at('atrium', 'W'), A = IDENTITY.atrium.accent, y0 = W.floorY;
    W.riser(15.72, y0, 2.0, 0.04, STEEL);
    W.junction(15.4, 0.55, 0.32, 0.42, [0x3dff7a, 0x3dff7a, 0xffb040]);
    W.stencil(13.4, 1.3, 'mDF2', 0.045, 0xb9b08a);
    W.vent(10.2, 1.25, 0.5, 0.4); W.tray(9.1, 10.9, 0.6, 0.22);
    lamp(W, 13.0, 1.8, A, { pool: 1.3, strength: 0.55 });
    W.pipe(9.1, 10.9, 0.3); W.valve(9.9, 0.3, 0.175);   // (low and to the north: a pipe at eye height would run across the Armurerie's plates, seen from the hall's window)
    slit(W, 'lit-slit', 9.3, 13.0, 2.15, A);
  }

  // ── ARMURERIE: olive-green plates, green lights ───────────────────────────────────────────────────────────
  {
    // EAST (x 8): atr-w1 stares at it from 1 m (z 14.5-15.7, y 0.4-1.5; the whole face z 11.8-16). THE NAME stands over arm-e1 (the glass at z 14.7-15.2), the second
    // line of it on the plate at the left, over the link-w tube (z 11-14, under 0.79).
    const W = at('armurerie', 'E'), A = IDENTITY.armurerie.accent, y0 = W.floorY;
    W.sign([{ text: 'ARMURERIE', px: 0.027 }], 15.0, 1.25, { accent: A, pad: 0.07 });
    W.sign([{ text: 'CAPACITÉS', px: 0.0245 }], 13.58, 1.0, { accent: A, pad: 0.05 });
    lamp(W, 13.58, 1.59, A);
    W.junction(12.55, 1.1, 0.34, 0.44, [0x3dff7a, 0x3dff7a, 0xffb040]);
    W.tray(9.15, 12.2, 1.28, 0.22);
    W.riser(9.4, y0, 1.15); W.riser(15.72, y0, 1.02, 0.034, STEEL);
    W.vent(10.5, 0.62, 0.5, 0.36);
    W.grime(14.4, 0.5, 0.3, 0.3);
    slit(W, 'lit-slit', 9.3, 12.2, 1.55, A, 0.35);
  }
  {
    // NORTH (z 9): seen across the plain from the Quartiers' west windows (x 2.6-6.5, y 0.6-1.6)
    const W = at('armurerie', 'N'), A = IDENTITY.armurerie.accent, y0 = W.floorY;
    W.sign([{ text: 'ARMURERIE', px: 0.052 }], 4.5, 0.9, { accent: A, pad: 0.1 });
    W.vent(6.4, 1.12); W.junction(2.7, 1.05, 0.32, 0.42, [0x3dff7a, 0xffb040, 0x3dff7a]);
    lamp(W, 6.0, 1.59, A);
    W.riser(2.35, y0, 1.4); W.riser(7.89, y0, 1.4, 0.034, STEEL);
    W.tray(5.65, 7.0, 0.45, 0.18);
    slit(W, 'lit-slit', 2.3, 5.75, 1.55, A, 0.35);
  }
  {
    // WEST (x 2): the outside of the wing, towards the antenna field; the name again for whoever comes from the plain
    const W = at('armurerie', 'W'), A = IDENTITY.armurerie.accent, y0 = W.floorY;
    W.sign([{ text: 'ARMURERIE', px: 0.04 }], 11.6, 0.85, { accent: A, pad: 0.07 });
    W.vent(10.4, 0.95); W.junction(15.55, 1.0, 0.3, 0.4);
    lamp(W, 13.0, 1.59, A); W.riser(9.5, y0, 1.3);
    W.pipe(9.65, 13.0, y0 + 0.12); W.tray(9.65, 12.8, 1.35, 0.2);
  }
  {
    // SOUTH (z 16): the ribbon arm-s1 (x 5.0-7.7, y 0.89-1.33) takes the east half; the ladder stands at the west end (the plate prod-p1 sees from 3.7 m, x 6.2-7.9, is now under the glass)
    const W = at('armurerie', 'S'), A = IDENTITY.armurerie.accent;
    W.ladder(2.15);
    W.junction(4.5, 1.1, 0.3, 0.4, [0xffb040, 0x3dff7a, 0x3dff7a]); W.vent(3.2, 0.62, 0.5, 0.36); W.vent(6.6, 0.5, 0.5, 0.36);
    lamp(W, 4.6, 1.59, A);
    W.pipe(2.6, 6.2, 0.3); W.tray(2.7, 4.0, 1.0, 0.18);
    W.stencil(3.3, 1.33, 'mHull2', 0.04, 0xb9d6b0); W.grime(5.0, 0.4, 0.5, 0.3);
  }

  // ── TROPHEES: amber, a gold cup ───────────────────────────────────────────────────────────────────────────
  {
    // WEST (x 17): the most looked-at face of the world (atr-e1 from 1 m z 14.4-15.7; qua-s1; prod-p1; y 0.45-1.9). THE NAME stands where the hall's window looks
    // (z 14.2-15.7), two lines; tro-w1 is the window at z 10.2; the link-e tube (z 11-14) joins it below 0.79.
    const W = at('trophees', 'W'), A = IDENTITY.trophees.accent, y0 = W.floorY;
    W.sign([{ text: 'TROPHÉES', px: 0.027 }, { text: 'SUCCÈS', px: 0.027 }], 14.95, 1.2, { accent: A, pad: 0.06 });
    lamp(W, 13.4, 1.72, A);
    W.tray(11.1, 13.9, 1.4, 0.2);
    W.junction(12.5, 1.03, 0.34, 0.44, [0xffb040, 0xffb040, 0x3dff7a]);
    W.riser(9.3, y0, 1.5); W.riser(15.8, 0.45, 1.4, 0.034, STEEL);
    W.vent(13.4, 1.05, 0.4, 0.3);
    W.pipe(14.2, 15.9, 0.32); W.valve(14.6, 0.32, 0.175);
    W.grime(15.4, 0.45, 0.5, 0.3);
    slit(W, 'lit-slit', 11.1, 13.2, 1.62, A, 0.35);
  }
  {
    // NORTH (z 9): seen across the plain from the Quartiers' windows qua-s1 and qua-e1 (x 17.5-22.5, y 0.2-1.9)
    const W = at('trophees', 'N'), A = IDENTITY.trophees.accent, y0 = W.floorY;
    W.sign([{ text: 'TROPHÉES', px: 0.06 }], 19.9, 0.97, { accent: A, icon: 'cup', iconSize: 0.5 });
    lamp(W, 18.0, 1.62, A); lamp(W, 22.0, 1.62, A);
    W.vent(22.35, 0.7, 0.5, 0.4); W.junction(17.55, 0.95, 0.3, 0.4, [0xffb040, 0x3dff7a, 0xffb040]);
    W.tray(18.0, 22.0, 0.35, 0.16); W.riser(17.35, y0, 1.5); W.riser(22.7, y0, 1.5, 0.034, STEEL);
    W.stencil(19.9, 1.58, 'mHull', 0.04, 0xd6b06a);
  }
  {
    const W = at('trophees', 'E'), A = IDENTITY.trophees.accent, y0 = W.floorY;   // EAST (x 23): tro-e1, tro-e2, the plain, the solar field
    W.vent(9.7, 0.7, 0.5, 0.36); W.vent(15.2, 0.65, 0.5, 0.36); W.junction(12.6, 0.85, 0.3, 0.4, [0xffb040, 0x3dff7a, 0xffb040]);
    lamp(W, 10.0, 1.65, A); lamp(W, 14.9, 1.65, A);
    W.pipe(9.2, 10.2, y0 + 0.1); W.riser(15.7, y0, 1.5, 0.034, STEEL);
    W.sign([{ text: 'TROPHÉES', px: 0.04 }], 12.6, 1.4, { accent: A, pad: 0.06 });
  }
  {
    const W = at('trophees', 'S'), A = IDENTITY.trophees.accent, y0 = W.floorY;   // SOUTH (z 16): the ribbon tro-s1 is on it
    W.ladder(22.2);
    W.junction(18.6, 0.95, 0.3, 0.4); W.vent(20.5, 0.85, 0.6, 0.4); lamp(W, 21.7, 1.72, A);
    W.pipe(17.2, 21.0, y0 + 0.1); W.tray(18.9, 21.8, 0.5, 0.18);
    W.stencil(17.9, 1.15, 'mHull2', 0.04, 0xd6b06a);
  }

  // ── QUARTIERS: brick, warm lights, a chimney ──────────────────────────────────────────────────────────────
  {
    // SOUTH (z 7): arm-n1 sees its west end (x 8.2-10.2, y 1.1-1.6), atr-n1 its east end over the roof line (x 14.4-16.6, y 1.25-1.6); qua-s1 is the window at x 15.2.
    // Only the top band of the wall shows (the glass is above the eye): THE NAME is written in it, twice (the roof sign over it is the third).
    const W = at('quartiers', 'S'), A = IDENTITY.quartiers.accent, y0 = W.floorY;
    W.sign([{ text: 'QUARTIERS', px: 0.028 }], 9.4, 1.21, { accent: A, pad: 0.04, wash: false });
    W.sign([{ text: 'QUARTIERS', px: 0.024 }], 16.45, 1.21, { accent: A, pad: 0.04, wash: false });
    lamp(W, 14.3, 1.4, A, { pool: 1.2, strength: 0.5 }); lamp(W, 13.1, 1.4, A, { pool: 1.2, strength: 0.5 });
    W.junction(16.5, 0.7, 0.28, 0.38, [0xffb040, 0x3dff7a, 0xffb040]);
    W.vent(8.9, 0.8, 0.5, 0.36);
    W.riser(14.2, y0, 1.15, 0.034, STEEL); W.riser(16.8, y0, 1.0, 0.03);
    W.tray(11.1, 13.9, 0.95, 0.2);
  }
  {
    const W = at('quartiers', 'W'), A = IDENTITY.quartiers.accent, y0 = W.floorY;   // WEST (x 8): qua-w1, qua-w2 are on it; the plain, the asteroids; arm-n1 sees its top at the corner
    lamp(W, 2.6, 1.38, A, { pool: 1.3, strength: 0.5 }); W.vent(2.6, 0.75, 0.4, 0.36); W.junction(5.1, 0.8, 0.28, 0.38);
    W.riser(2.3, y0, 1.35); W.riser(6.8, y0, 1.35, 0.034, STEEL);
    W.sign([{ text: 'QUARTIERS', px: 0.03 }], 4.55, 1.2, { accent: A, pad: 0.04, wash: false });
  }
  {
    const W = at('quartiers', 'E'), A = IDENTITY.quartiers.accent, y0 = W.floorY;   // EAST (x 17): qua-e1; seen from the plain and from the Trophees' north windows
    lamp(W, 3.5, 1.38, A, { pool: 1.3, strength: 0.5 }); W.vent(4.5, 0.7, 0.45, 0.36); W.junction(2.5, 0.85, 0.28, 0.38);
    W.riser(2.25, y0, 1.35); W.riser(6.88, y0, 1.35, 0.034, STEEL); W.ladder(5.3);
    W.tray(2.4, 4.2, 0.45, 0.18);
  }
  {
    const W = at('quartiers', 'N'), A = IDENTITY.quartiers.accent, y0 = W.floorY;   // NORTH (z 2): the far side; the ringed giant over the roof
    W.sign([{ text: 'QUARTIERS', px: 0.06 }], 12.5, 0.95, { accent: A });
    lamp(W, 9.7, 1.38, A, { pool: 1.3, strength: 0.5 }); lamp(W, 15.3, 1.38, A, { pool: 1.3, strength: 0.5 });
    W.vent(16.0, 0.7, 0.5, 0.36); W.junction(8.7, 0.85, 0.28, 0.38); W.riser(8.5, y0, 1.35); W.riser(16.6, y0, 1.35, 0.034, STEEL);
  }

  // ── ANNEX (PROD): dark hull, a red hazard door on its west face ───────────────────────────────────────────
  {
    // WEST (x 9): seen from the Armurerie's south windows at an angle (z 18-23); the door, with its stencil
    const W = at('annex', 'W'), A = IDENTITY.annex.accent, y0 = W.floorY;
    W.put('door', [20.0, 21.1, y0, y0 + 0.7], () => {
      W.box(20.0, 21.1, y0 + 0.02, y0 + 0.7, 0, 0.05, { cell: 'plateDark' });
      W.box(20.1, 21.0, y0 + 0.04, y0 + 0.64, 0.05, 0.08, { cell: 'plateRust', color: 0xff5a4a });
      for (const z of [20.05, 21.05]) W.box(z - 0.05, z + 0.05, y0 + 0.02, y0 + 0.7, 0.05, 0.09, { cell: 'hazard' });
      K.quadAt(K.glow, W.F.pt(20.55, y0 + 0.35, 0.085), W.F.n, 0.11, 0.11, { color: hdr(A, 1.0) });   // a red lamp over the lock
    });
    W.stencil(21.95, 0.6, 'mPROD', 0.05, 0xd8c050);
    lamp(W, 19.4, 0.88, A, { pool: 1.3, strength: 0.4 });
    W.vent(22.65, 0.62, 0.3, 0.3); W.junction(18.65, 0.6, 0.26, 0.34, [0xff4a3a, 0xff4a3a, 0xff4a3a]);
    W.pipe(19.0, 19.9, y0 + 0.1);
  }
  {
    // NORTH (z 18): faces the atrium's south wall across 2 m; prod-p1 is the porthole at x 11.1-11.6. NOTHING at the corridor (x 11.7-13.3).
    // arm-e1 sees its west end past the tower's corner (x 9.3-10.7): THE NAME in red stencil.
    const W = at('annex', 'N'), A = IDENTITY.annex.accent, y0 = W.floorY;
    W.stencil(10.1, 0.6, 'mPROD', 0.06, 0xd8c050);
    W.junction(9.38, 0.5, 0.26, 0.34, [0xff4a3a, 0xffb040, 0xff4a3a]);
    W.pipe(13.5, 15.9, y0 + 0.08); W.tray(13.6, 15.7, 0.55, 0.16); lamp(W, 15.4, 0.88, A, { pool: 1.3, strength: 0.4 });
    W.riser(15.85, 0.4, 0.9, 0.034, STEEL);
  }
  {
    const W = at('annex', 'E'), A = IDENTITY.annex.accent, y0 = W.floorY;   // EAST (x 16): seen from tro-s1's side at an angle
    W.sign([{ text: 'PROD', px: 0.05 }], 20.5, 0.6, { accent: A, pad: 0.06 });
    W.vent(18.6, 0.66, 0.5, 0.32); W.vent(22.2, 0.6, 0.4, 0.3); lamp(W, 19.4, 0.88, A, { pool: 1.3, strength: 0.4 });
    W.ladder(22.6); W.pipe(18.3, 19.2, y0 + 0.12);
  }
  {
    const W = at('annex', 'S'), A = IDENTITY.annex.accent, y0 = W.floorY;   // SOUTH (z 23): the far side
    W.vent(10.5, 0.62, 0.5, 0.32); W.vent(14.5, 0.62, 0.5, 0.32); W.junction(12.5, 0.6, 0.26, 0.34); lamp(W, 11.5, 0.88, A, { pool: 1.3, strength: 0.4 });
    W.pipe(10.0, 15.0, y0 + 0.12);
  }
}

// The light of every lit window falls on the wall across its alley: a dithered pool in the building's colour, centred on the window (the glass of arm-e1
// washes the tower's west face, the glass of atr-w1 the Armurerie's east face and the plate that carries its name...).
function windowGlows(D) {
  const { ctx, B } = D;
  const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };
  for (const q of ctx.windows ?? []) {
    const F = faceOf(q.b, q.k), [nx, , nz] = F.n;
    // the block across the alley that this face looks at: its parallel face, within 2 m, over the window's position
    const o = ctx.BLOCKS.find(c => c !== q.b && (
      (nx > 0 && c.x0 >= q.b.x1 - 1e-6 && c.x0 - q.b.x1 <= 2.01 && q.s > c.z0 && q.s < c.z1) || (nx < 0 && c.x1 <= q.b.x0 + 1e-6 && q.b.x0 - c.x1 <= 2.01 && q.s > c.z0 && q.s < c.z1) ||
      (nz > 0 && c.z0 >= q.b.z1 - 1e-6 && c.z0 - q.b.z1 <= 2.01 && q.s > c.x0 && q.s < c.x1) || (nz < 0 && c.z1 <= q.b.z0 + 1e-6 && q.b.z0 - c.z1 <= 2.01 && q.s > c.x0 && q.s < c.x1)));
    if (!o) continue;
    const gap = Math.abs(nx ? (nx > 0 ? o.x0 - q.b.x1 : q.b.x0 - o.x1) : (nz > 0 ? o.z0 - q.b.z1 : q.b.z0 - o.z1));
    const W = wallOf(D, o, OPP[q.k]), size = 1.1 + 0.5 * gap;
    W.light(`window-glow:${q.id}`, q.s, (q.yb + q.yt) / 2, size, size, IDENTITY[q.b.id]?.accent ?? 0xffffff, 0.3);
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
//  The tubes that cross the alleys
// ══════════════════════════════════════════════════════════════════════════════════════════════════
function dressLinks(D) {
  const { K, ctx } = D;
  const G = ctx.GROUND_Y;
  for (const l of ctx.LINKS) {
    const cx = (l.x0 + l.x1) / 2, cz = (l.z0 + l.z1) / 2, y = l.roofY;
    const alongX = (l.x1 - l.x0) < (l.z1 - l.z0);          // the tube crosses the alley along x (link-w, link-e) or z (link-n)
    const len = alongX ? l.z1 - l.z0 : l.x1 - l.x0;        // the tube's width across
    const yaw = alongX ? Math.PI / 2 : 0;
    // a hatch and two strips of light on the roof (the roof is under the eyes of the hall, but from the plain's side it is seen)
    K.item(`${l.id}:roof`, { kind: 'roof', host: l.id, rect: [l.x0, l.x1, l.z0, l.z1] }, () => {
      K.box(K.lit, cx, y + 0.03, cz, 0.62, 0.06, 0.62, { yaw, cell: 'plate' });
      K.box(K.lit, cx, y + 0.07, cz, 0.5, 0.025, 0.5, { yaw, cell: 'plateRust' });
      for (const d of [-len / 2 + 0.38, len / 2 - 0.38]) {
        const px = alongX ? cx : cx + d, pz = alongX ? cz + d : cz;
        K.quadAt(K.glow, [px, y + 0.004, pz], [0, 1, 0], alongX ? 0.5 : 0.14, alongX ? 0.14 : 0.5, { color: hdr(AMBER, 0.45) });
      }
    });
    // the two long sides, as walls: a lit seam of the tube's colour and a conduit
    for (const k of alongX ? ['N', 'S'] : ['E', 'W']) {
      const W = wallOf(D, l, k), mid = W.F.mid;
      W.put('lit-seam', [mid - 0.4, mid + 0.4, G + 0.5, G + 0.54], () => K.quadAt(K.glow, W.F.pt(mid, G + 0.52, 0.012), W.F.n, 0.8, 0.04, { color: hdr(AMBER, 0.5) }));
      W.put('conduit', [W.F.lo + 0.12, W.F.hi - 0.12, y - 0.2, y - 0.14], () => W.tube(W.F.lo + 0.12, y - 0.17, 0.05, W.F.hi - 0.12, y - 0.17, 0.05, 0.03, { seg: 6, color: STEEL_D }));
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
//  Cables strung across the alleys, from clamp to clamp
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// Three strands hang in a catenary from a clamp on one wall to a clamp on the facing one. A cable goes where both clamps find room (not over a window, a tube,
// the secret's corridor or anything already hung on the wall); it stays in its alley, off the ground, under both parapets, clear of the tubes that cross it.
function alleyCables(D) {
  const { K, B } = D;
  const wall = (b, k) => wallOf(D, b, k);
  const span = (name, host, a, b, sag, [dx, dz], wa, wb) => {
    const fit = (W, p) => W.room(W.F.alongX ? p[0] - 0.12 : p[2] - 0.12, W.F.alongX ? p[0] + 0.12 : p[2] + 0.12, p[1] - 0.12, p[1] + 0.12);
    if (!fit(wa, a) || !fit(wb, b)) return false;
    K.item(`cable:${name}`, { kind: 'cable', host, ends: [a, b] }, () => {
      CABLE.forEach((c, i) => {
        const o = i - 1;
        let prev = [a[0] + dx * o, a[1], a[2] + dz * o];
        for (let n = 1; n <= 7; n++) {
          const t = n / 7, p = [lerp(a[0], b[0], t) + dx * o, lerp(a[1], b[1], t) - sag * 4 * t * (1 - t), lerp(a[2], b[2], t) + dz * o];
          K.tube(K.lit, prev, p, 0.02, { seg: 5, color: c });
          prev = p;
        }
      });
      for (const p of [a, b]) K.box(K.lit, p[0], p[1], p[2], 0.1 + Math.abs(dx) * 2.4, 0.12, 0.1 + Math.abs(dz) * 2.4, { color: STEEL_D });
    });
    return true;
  };
  const AT = B.atrium, AR = B.armurerie, TR = B.trophees, QU = B.quartiers, AN = B.annex;
  // up to `count` cables of an alley: along = the candidate positions, the first height at which both clamps fit
  const alley = (tag, host, count, sag, spread, along, ends) => {
    let n = 0;
    for (const t of along) for (const y of [0.9, 0.7, 1.1, 0.55, 1.25]) {
      if (n >= count) return;
      const [a, b, wa, wb] = ends(t, y);
      if (span(`${tag}@${fx(t)}`, host, a, b, sag, spread, wa, wb)) { n++; break; }
    }
  };
  const wAT = k => wall(AT, k);
  // west alley (x 8-9): atrium face -> the Armurerie's east face (z 9-11 and 14-16: the tube link-w crosses z 11-14)
  alley('west', 'armurerie|atrium', 2, 0.1, [0, 0.04], [9.9, 10.6, 14.2, 15.5, 9.4], (z, y) => [[AT.x0 - 0.06, y, z], [AR.x1 + 0.06, y - 0.1, z], wAT('W'), wall(AR, 'E')]);
  // east alley (x 16-17): atrium face -> the Trophees' west face
  alley('east', 'atrium|trophees', 2, 0.1, [0, 0.04], [9.4, 10.2, 14.3, 15.4], (z, y) => [[AT.x1 + 0.06, y - 0.1, z], [TR.x0 - 0.06, y, z], wAT('E'), wall(TR, 'W')]);
  // north alley (z 7-9, 2 m): atrium face -> the Quartiers' south face (x 9-11 and 14-16: the tube link-n crosses x 11-14)
  alley('north', 'atrium|quartiers', 3, 0.28, [0.04, 0], [9.7, 10.5, 16.25, 15.6, 9.2], (x, y) => [[x, y - 0.3, AT.z0 - 0.06], [x, y, QU.z1 + 0.06], wAT('N'), wall(QU, 'S')]);
  // south alley (z 16-18, 2 m): atrium face -> the annex's north face; never near the corridor of the secret (x 11.7-13.3)
  alley('south', 'annex|atrium', 2, 0.25, [0.04, 0], [9.6, 15.1, 14.5, 10.9], (x, y) => [[x, y - 0.4, AT.z1 + 0.06], [x, y - 0.3, AN.z0 - 0.06], wAT('S'), wall(AN, 'N')]);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
//  Roofs
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// The eye of every room is under every roof, so a roof is never seen from above: what shows is what stands higher than the line from the eye
// over the parapet (a tall sign, a mast, a chimney, a dish) and the skyline from the plain. Each wing has a silhouette of its own.
const roofItem = (D, name, b, rect, fn, meta = {}) => D.K.item(`roof:${b.id}:${name}`, { kind: 'roof', host: b.id, rect, ...meta }, fn);

// A tall sign on the roof, facing a side (face = the wall it looks over: 'E' the sign faces +x ...): two struts, a dark board, lit letters on BOTH
// sides (the plain sees its back).
function roofSign(D, b, face, text, c, { px = 0.057, base = 0.22, inset = 0.34 } = {}) {
  const { K } = D;
  const id = IDENTITY[b.id], cell = K.cell[signKey(text)], w = cell.w * px, h = cell.h * px;
  const F = faceOf(b, face), R = b.roofY + 0.12;   // the parapet's top
  const along = F.alongX, sgn = F.sgn;
  const plane = F.plane - sgn * inset;              // the board stands `inset` back from the edge
  const bw = w + 0.2, bh = h + 0.16, y0 = R + base, y1 = y0 + bh, yc = (y0 + y1) / 2;
  const P = (s, y, off = 0) => (along ? [s, y, plane + sgn * off] : [plane + sgn * off, y, s]);
  const bs0 = c - bw / 2, bs1 = c + bw / 2;
  roofItem(D, `sign-${text}`, b, along ? [bs0, bs1, plane - 0.06, plane + 0.06] : [plane - 0.06, plane + 0.06, bs0, bs1], () => {
    const box = (s0, s1, ya, yb, o0, o1, opts) => {
      const a = plane + sgn * o0, e = plane + sgn * o1, lo = Math.min(a, e), hi = Math.max(a, e);
      K.boxMM(K.lit, ...(along ? [s0, s1, ya, yb, lo, hi] : [lo, hi, ya, yb, s0, s1]), opts);
    };
    box(bs0, bs1, y0, y1, -0.025, 0.025, { cell: 'plateDark' });
    for (const s of [bs0 + 0.2, bs1 - 0.2]) K.tube(K.lit, P(s, b.roofY, 0), P(s, y0, 0), 0.02, { seg: 6, color: STEEL_D });
    const col = hdr(id.accent, 0.85);
    for (const side of [1, -1]) {
      const n = along ? [0, 0, sgn * side] : [sgn * side, 0, 0];
      K.quadAt(K.glow, P(c, yc, 0.029 * side), n, w, h, { uv: K.sign(text), color: col });
    }
    // a light above the board that washes the letters, and its bulb
    K.put(K.glow, sphereGeo(6, 5), { pos: P(c, y1 + 0.06, 0.1), scale: [0.04, 0.04, 0.04], color: hdr(WHITE_W, 1.4) });
    K.tube(K.lit, P(c, y1, 0.0), P(c, y1 + 0.06, 0.1), 0.012, { seg: 5, color: STEEL });
  });
}

function dressRoofs(D) {
  const { K, ctx, B, rand, beacon } = D;
  const hatch = (b, x, z, yaw = 0, s = 1) => roofItem(D, `hatch@${fx(x)},${fx(z)}`, b, [x - 0.5 * s, x + 0.5 * s, z - 0.5 * s, z + 0.5 * s], () => {
    K.box(K.lit, x, b.roofY + 0.09, z, 0.95 * s, 0.18, 0.95 * s, { yaw, cell: 'plate' });
    K.box(K.lit, x, b.roofY + 0.23, z, 0.8 * s, 0.1, 0.8 * s, { yaw, cell: 'plateRust' });
    K.box(K.lit, x, b.roofY + 0.29, z, 0.28, 0.03, 0.05, { yaw, color: STEEL_L });                      // the handle
  });
  const vent = (b, x, z, h = 0.45, w = 0.5, d = 0.4, yaw = 0) => roofItem(D, `vent@${fx(x)},${fx(z)}`, b, [x - w / 2, x + w / 2, z - d / 2, z + d / 2], () => {
    K.box(K.lit, x, b.roofY + h / 2, z, w, h, d, { yaw, faces: { py: 'louvre' }, cell: 'plateDark' });
  });
  const stack = (b, x, z, r, h, { ring = null, cell = 'plate', color = 0xffffff } = {}) => roofItem(D, `stack@${fx(x)},${fx(z)}`, b, [x - r * 1.3, x + r * 1.3, z - r * 1.3, z + r * 1.3], () => {
    K.cyl(K.lit, x, b.roofY, z, r * 1.25, 0.1, { seg: 12, color: STEEL_D });
    K.cyl(K.lit, x, b.roofY + 0.1, z, r, h - 0.1, { seg: 12, cell, color });
    K.cone(K.lit, [x, b.roofY + h, z], r * 1.2, r * 0.9, 0.08, { seg: 12, color: STEEL_D });
    if (ring) K.put(K.glow, new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.07, 12, 1, true), { pos: [x, b.roofY + h * 0.62, z], color: hdr(ring, 0.6) });
  });
  const mast = (b, x, z, h, col, booms = 2) => roofItem(D, `mast@${fx(x)},${fx(z)}`, b, [x - 0.4, x + 0.4, z - 0.4, z + 0.4], () => {
    K.box(K.lit, x, b.roofY + 0.2, z, 0.34, 0.4, 0.34, { cell: 'plate' });
    K.tube(K.lit, [x, b.roofY + 0.4, z], [x, b.roofY + h, z], 0.03, { seg: 8, color: STEEL_L });
    for (let i = 0; i < booms; i++) {
      const y = b.roofY + h - 0.25 - i * 0.4, len = 0.9 - i * 0.2, a = 0.5 + i * 1.1, c = Math.cos(a) * len / 2, s = Math.sin(a) * len / 2;
      K.tube(K.lit, [x - c, y, z - s], [x + c, y, z + s], 0.014, { seg: 6, color: STEEL_L });
    }
    beacon(x, b.roofY + h + 0.07, z, col, 0.16);
  });
  const dish = (b, x, z, R, post) => roofItem(D, `dish@${fx(x)},${fx(z)}`, b, [x - R, x + R, z - R, z + R], () => {
    K.cone(K.lit, [x, b.roofY, z], 0.22, 0.14, post, { seg: 10, cell: 'plate' });
    placeDish(K, [x, b.roofY + post + 0.05, z], R, { counter: true });
  });
  const duct = (b, x0, z0, x1, z1, r = 0.045) => roofItem(D, `duct@${fx(x0)},${fx(z0)}`, b, [Math.min(x0, x1) - r, Math.max(x0, x1) + r, Math.min(z0, z1) - r, Math.max(z0, z1) + r], () => {
    K.tube(K.lit, [x0, b.roofY + r + 0.025, z0], [x1, b.roofY + r + 0.025, z1], r, { seg: 8, color: STEEL });
    const n = Math.max(1, Math.floor(Math.hypot(x1 - x0, z1 - z0) / 1.1));
    for (let i = 0; i <= n; i++) { const t = i / n; K.box(K.lit, lerp(x0, x1, t), b.roofY + 0.02, lerp(z0, z1, t), 0.07, 0.04, 0.07, { color: STEEL_D }); }
  });
  const slit = (b, x, z, len, yaw = 0, col = AMBER) => roofItem(D, `slit@${fx(x)},${fx(z)}`, b, [x - len / 2 - 0.05, x + len / 2 + 0.05, z - 0.1, z + 0.1].map((v, i) => (yaw ? [x - 0.1, x + 0.1, z - len / 2 - 0.05, z + len / 2 + 0.05][i] : v)), () => {
    const ca = Math.cos(yaw), sa = Math.sin(yaw);
    K.quadAt(K.glow, [x, b.roofY + 0.006, z], [0, 1, 0], len * Math.abs(ca) + 0.1 * Math.abs(sa), len * Math.abs(sa) + 0.1 * Math.abs(ca), { color: hdr(col, 0.4) });
  });
  // a row of small amber lamp posts along a parapet (the beacons of the exterior: they bloom a little). Each bulb stands on its own thin post: a bulb alone,
  // 16 cm over the roof, read as a floating diamond from the atrium's north window.
  const lights = (b, pts, col = 0xffa040, size = 0.07) => roofItem(D, 'string-lights', b, [b.x0, b.x1, b.z0, b.z1], () => {
    for (const [x, z] of pts) {
      const top = b.roofY + 0.2 - size / 2;
      K.tube(K.lit, [x, b.roofY, z], [x, top, z], 0.014, { seg: 5, color: STEEL_L });
      // the post glows a little (its own light, under the bloom threshold): in the shade of the tower an unlit post vanished against the black sky and the bulb read as floating
      K.tube(K.glow, [x, b.roofY + 0.01, z], [x, top, z], 0.018, { seg: 5, color: hdr(col, 0.4) });
      beacon(x, b.roofY + 0.2, z, col, size);
    }
  });
  // a drift of dust that crept over the lip (three lumps)
  const drift = (b, x, z, r, h = 0.08) => roofItem(D, `drift@${fx(x)},${fx(z)}`, b, [x - r, x + r, z - r, z + r], () => {
    for (let i = 0; i < 3; i++) {
      const a = rand() * 6.28, d = i ? r * (0.2 + 0.25 * rand()) : 0, k = i ? 0.45 + 0.3 * rand() : 0.8;
      K.mound(K.lit, x + Math.cos(a) * d, b.roofY, z + Math.sin(a) * d * 0.7, r * k, h * (0.6 + 0.4 * k), r * k * 0.7, mulC(REGOLITH, 0.65 + 0.3 * rand()), ctx.sunDir);
    }
  });

  const QU = B.quartiers, AR = B.armurerie, TR = B.trophees, AN = B.annex;

  // ── ARMURERIE (x 2-8, z 9-16, roof 1.75): forge stacks ringed with green light, a mast, the name on the roof's east edge ──
  hatch(AR, 4.4, 12.7, 0.2);
  stack(AR, 7.15, 14.0, 0.2, 1.5, { ring: IDENTITY.armurerie.accent, cell: 'plateRust' });
  stack(AR, 6.6, 15.1, 0.15, 1.1, { ring: IDENTITY.armurerie.accent, cell: 'plateRust' });
  stack(AR, 7.2, 10.2, 0.16, 1.2, { cell: 'plate' });
  mast(AR, 6.1, 13.4, 3.0, 0x56ff86);
  vent(AR, 3.0, 10.1); vent(AR, 3.3, 14.8, 0.4, 0.4, 0.4); vent(AR, 5.2, 10.6, 0.4, 0.45, 0.35);
  duct(AR, 2.5, 9.7, 5.0, 9.7); dish(AR, 3.0, 12.7, 0.4, 0.5);
  slit(AR, 3.2, 14.0, 1.0, Math.PI / 2, IDENTITY.armurerie.accent);
  roofSign(D, AR, 'E', 'ARMURERIE', 14.85, { px: 0.03 });
  drift(AR, 2.5, 15.5, 0.35); drift(AR, 5.0, 9.6, 0.3);

  // ── TROPHEES (x 17-23, z 9-16, roof 2.0): the gold cup on its plinth, vents, the name on the west edge ──
  hatch(TR, 20.2, 12.4, 0);
  roofItem(D, 'cup', TR, [17.55, 18.65, 14.1, 15.2], () => {
    const x = 18.1, z = 14.65, y = TR.roofY;
    K.box(K.lit, x, y + 0.12, z, 0.9, 0.24, 0.9, { cell: 'plateDark' });
    K.box(K.lit, x, y + 0.29, z, 0.7, 0.1, 0.7, { cell: 'plate' });
    // the cup: a lathe of its profile (foot, stem, node, bowl), gold foil
    const pts = [[0, 0], [0.34, 0], [0.34, 0.05], [0.14, 0.1], [0.07, 0.25], [0.07, 0.4], [0.13, 0.46], [0.13, 0.52], [0.34, 0.8], [0.46, 1.05], [0.43, 1.12], [0.4, 1.1], [0.0, 1.02]]
      .map(([r, h]) => new THREE.Vector2(r, h));
    const g = new THREE.LatheGeometry(pts, 14);
    g.computeVertexNormals();
    K.put(K.lit, g, { pos: [x, y + 0.34, z], cell: 'foilGold', color: 0xffe8b0 });
    // the two handles: loops (1.4 pi of a ring) in the vertical plane that holds the cup's axis, opening toward the bowl, their ends sunk in it
    for (const sgn of [-1, 1]) K.put(K.lit, new THREE.TorusGeometry(0.2, 0.025, 5, 12, Math.PI * 1.4), { pos: [x + sgn * 0.3, y + 0.34 + 0.78, z], rot: [0, 0, sgn > 0 ? -Math.PI * 0.7 : Math.PI * 0.3], color: 0xd6a232 });
    K.put(K.glow, new THREE.RingGeometry(0.5, 0.58, 20).rotateX(-Math.PI / 2), { pos: [x, y + 0.245, z], color: hdr(IDENTITY.trophees.accent, 0.5) });
  });
  vent(TR, 18.1, 10.0, 0.45, 0.5, 0.4, 0.2); vent(TR, 22.1, 10.6); vent(TR, 21.0, 15.1, 0.4, 0.45, 0.4); vent(TR, 22.0, 13.4, 0.5, 0.5, 0.4, 0.4);
  duct(TR, 19.0, 9.6, 19.0, 12.0); duct(TR, 19.0, 13.3, 21.4, 13.3, 0.035);
  slit(TR, 21.4, 11.0, 1.2, Math.PI / 2); slit(TR, 19.9, 14.4, 0.9);
  mast(TR, 22.2, 15.2, 2.4, 0xff6a3a, 1);
  roofSign(D, TR, 'W', 'TROPHÉES', 14.85, { px: 0.032 });
  drift(TR, 22.4, 9.5, 0.35); drift(TR, 20.4, 15.5, 0.3);

  // ── QUARTIERS (x 8-17, z 2-7, roof 1.65): a brick chimney, a TV aerial, a row of warm lamp posts, the name on the south edge ──
  hatch(QU, 10.4, 4.4, 0); hatch(QU, 14.5, 3.0, 0.3);
  roofItem(D, 'chimney', QU, [15.0, 15.8, 5.7, 6.5], () => {
    const x = 15.4, z = 6.1, y = QU.roofY;
    K.box(K.lit, x, y + 0.55, z, 0.5, 1.1, 0.5, { cell: 'plateRust', color: 0xc07a58 });
    K.box(K.lit, x, y + 1.14, z, 0.62, 0.1, 0.62, { cell: 'plateDark' });
    K.put(K.glow, new THREE.PlaneGeometry(0.4, 0.4).rotateX(-Math.PI / 2), { pos: [x, y + 1.2, z], color: hdr(IDENTITY.quartiers.accent, 0.8) });   // the embers, seen from the stack's mouth
    K.tube(K.lit, [x - 0.2, y + 1.2, z - 0.2], [x - 0.2, y + 1.32, z - 0.2], 0.012, { seg: 5, color: STEEL });
  });
  roofItem(D, 'aerial', QU, [13.9, 14.7, 5.9, 6.7], () => {
    const x = 14.3, z = 6.3, y = QU.roofY;
    K.tube(K.lit, [x, y, z], [x, y + 1.6, z], 0.018, { seg: 6, color: STEEL_L });
    for (const [h, len] of [[1.0, 0.7], [1.25, 0.55], [1.5, 0.4]]) K.tube(K.lit, [x - len / 2, y + h, z], [x + len / 2, y + h, z], 0.012, { seg: 5, color: STEEL_L });
    K.tube(K.lit, [x, y + 0.3, z], [x + 0.35, y, z + 0.1], 0.006, { seg: 4, color: STEEL });
  });
  vent(QU, 9.2, 3.2); vent(QU, 13.2, 5.0, 0.4, 0.5, 0.4, 0.2); vent(QU, 12.3, 3.0, 0.4, 0.45, 0.35);
  duct(QU, 9.0, 5.4, 12.5, 5.4); duct(QU, 12.9, 5.4, 12.9, 3.5, 0.035);
  slit(QU, 11.4, 4.2, 1.5); slit(QU, 16.0, 4.6, 0.9, Math.PI / 2);
  { const pts = []; for (let x = 8.5; x < 16.9; x += 0.7) pts.push([x, 6.88], [x, 2.12]); for (let z = 2.9; z < 6.9; z += 0.7) pts.push([8.12, z], [16.88, z]); lights(QU, pts); }
  roofSign(D, QU, 'S', 'QUARTIERS', 15.45, { px: 0.028 });
  drift(QU, 9.2, 6.6, 0.35); drift(QU, 16.4, 2.6, 0.3);

  // ── ANNEX (x 9-16, z 18-23, roof 1.2): a vent stack, a whip antenna with a red light, and THE PLANT: a bulkhead with the PROD sign ──
  // The annex is the lowest hull and every window that could look at it is above the visitor's eye: its rays go up and over its roof line, so its walls (the
  // hazard door, the stencils) are seen from no wing. What stands higher than the parapet is what a south window frames of it: see annexPlant.
  hatch(AN, 12.5, 20.6, 0.1);
  vent(AN, 10.0, 19.1, 0.4, 0.6, 0.5); vent(AN, 15.0, 22.0, 0.4, 0.6, 0.5, 0.4); vent(AN, 12.3, 22.2, 0.4, 0.5, 0.4);
  stack(AN, 14.2, 19.5, 0.12, 0.8, { cell: 'plateDark' });
  mast(AN, 14.9, 20.6, 2.0, 0xff2a22, 1);
  duct(AN, 9.4, 18.6, 11.4, 18.6, 0.05); duct(AN, 13.7, 18.6, 15.6, 18.6, 0.05);
  annexPlant(D, AN, LANDMARKS.annexPlant);
  drift(AN, 9.5, 22.5, 0.35); drift(AN, 15.5, 18.5, 0.3);
}

// The PROD annex's roof plant (windowSlots.js LANDMARKS): the stair-head of the secret room, a grey bulkhead on the west part of its roof, turned to face the
// middle of the Armurerie (the ribbon arm-s1 frames it from the whole centre-north of that room). On its front face, from the bottom up: a hazard-striped kerb,
// the RED HAZARD DOOR (a leaf, hazard jambs and lintel, a lit red frame), two red work lamps with their pools of light, the PROD SIGN (lit letters on a dark
// plate, a lit rim), and over it a red lamp on a short mast (a beacon: it blooms). It is ONE object of the roof ('sign-PROD'): its plate is in the item's
// metadata (`plate`, four world corners and the height of a letter) for the proofs that say it is legible.
function annexPlant(D, b, L) {
  const { K, beacon } = D;
  const hr = L.heading * D2R, n = [Math.cos(hr), 0, Math.sin(hr)], r = [n[2], 0, -n[0]];   // n: the way the front looks; r: to the right of a viewer who faces it (up × n)
  const R = b.roofY, yaw = Math.atan2(n[0], n[2]), A = IDENTITY.annex.accent;          // (a box's +z axis turned onto n has its +x axis on r)
  const at = (u, y, o = 0) => [L.x + r[0] * u + n[0] * o, y, L.z + r[2] * u + n[2] * o];     // u across the front, o out of it (0 = the footprint's centre)
  const F = L.d / 2, P = L.plate;
  const hx = (L.w * Math.abs(r[0]) + L.d * Math.abs(n[0])) / 2, hz = (L.w * Math.abs(r[2]) + L.d * Math.abs(n[2])) / 2;
  const bx = (u0, u1, y0, y1, o0, o1, opts) => { const c = at((u0 + u1) / 2, (y0 + y1) / 2, (o0 + o1) / 2); K.box(K.lit, c[0], c[1], c[2], u1 - u0, y1 - y0, o1 - o0, { yaw, ...opts }); };
  const q = (u, y, o, w, h, opts) => K.quadAt(K.glow, at(u, y, o), n, w, h, opts);
  const px = (P.w - 0.16) / K.cell[signKey('PROD')].w, tw = K.cell[signKey('PROD')].w * px, th = K.cell[signKey('PROD')].h * px;   // metres per font pixel; the mask's size
  const yc = P.y0 + P.h / 2, y1 = R + L.h, red = hdr(A, 0.85);
  const corner = (u, y) => at(u, y, F + 0.056);
  const plate = { corners: [corner(-P.w / 2, P.y0), corner(P.w / 2, P.y0), corner(P.w / 2, P.y0 + P.h), corner(-P.w / 2, P.y0 + P.h)], letter: 5 * px, width: 15 * px };
  roofItem(D, 'sign-PROD', b, [L.x - hx, L.x + hx, L.z - hz, L.z + hz], () => {
    // the bulkhead: grey plates, a darker cap, a hazard kerb at the foot of the front
    bx(-L.w / 2, L.w / 2, R, y1, -L.d / 2, F, { cell: 'plate', color: 0xb4b8c2 });
    bx(-L.w / 2 - 0.04, L.w / 2 + 0.04, y1, y1 + 0.06, -L.d / 2 - 0.04, F + 0.04, { cell: 'plateDark' });
    K.quadAt(K.lit, at(0, R + 0.08, F + 0.012), n, L.w, 0.14, { uv: K.uv('hazard') });
    // the door: a frame, the red leaf, hazard jambs and lintel, a lit red outline
    bx(-0.35, 0.35, R + 0.14, R + 0.6, F, F + 0.04, { cell: 'plateDark' });
    bx(-0.27, 0.27, R + 0.16, R + 0.54, F + 0.04, F + 0.07, { cell: 'plateRust', color: 0xff5a4a });
    for (const [a, c] of [[-0.35, -0.27], [0.27, 0.35]]) bx(a, c, R + 0.14, R + 0.6, F + 0.04, F + 0.085, { cell: 'hazard' });
    bx(-0.35, 0.35, R + 0.54, R + 0.6, F + 0.04, F + 0.085, { cell: 'hazard' });
    bx(-0.05, 0.05, R + 0.3, R + 0.34, F + 0.07, F + 0.1, { color: 0x2a2a30 });       // the lock
    for (const [a, c, y0, y1_] of [[-0.265, 0.265, R + 0.505, R + 0.525], [-0.265, -0.245, R + 0.17, R + 0.525], [0.245, 0.265, R + 0.17, R + 0.525]]) q((a + c) / 2, (y0 + y1_) / 2, F + 0.08, c - a, y1_ - y0, { color: hdr(A, 0.9) });
    // two red work lamps, one at each side of the door, and the pool of light they throw on the plates (inside the face: over the slab, under the cap)
    for (const u of [-0.6, 0.6]) {
      bx(u - 0.05, u + 0.05, R + 0.3, R + 0.46, F, F + 0.07, { cell: 'plateDark' });
      q(u, R + 0.38, F + 0.075, 0.06, 0.09, { color: hdr(A, 1.3) });
    }
    K.quadAt(K.glow, at(0, R + 0.43, F + 0.02), n, L.w - 0.04, 0.8, { uv: K.uv('pool'), color: hdr(A, 0.35) });
    // the sign: a dark plate, a lit rim, the lit letters PROD
    bx(-P.w / 2, P.w / 2, P.y0, P.y0 + P.h, F, F + 0.05, { cell: 'plateDark' });
    for (const [a, c, y0, y1_] of [[-P.w / 2 + 0.03, P.w / 2 - 0.03, P.y0 + P.h - 0.05, P.y0 + P.h - 0.03], [-P.w / 2 + 0.03, P.w / 2 - 0.03, P.y0 + 0.03, P.y0 + 0.05],
      [-P.w / 2 + 0.03, -P.w / 2 + 0.05, P.y0 + 0.03, P.y0 + P.h - 0.03], [P.w / 2 - 0.05, P.w / 2 - 0.03, P.y0 + 0.03, P.y0 + P.h - 0.03]]) q((a + c) / 2, (y0 + y1_) / 2, F + 0.053, c - a, y1_ - y0, { color: hdr(A, 0.45) });
    q(0, yc, F + 0.056, tw, th, { uv: K.sign('PROD'), color: red });
    K.quadAt(K.glow, at(0, (P.y0 - 0.2 + y1 - 0.03) / 2, F + 0.02), n, L.w - 0.04, y1 - 0.03 - (P.y0 - 0.2), { uv: K.uv('pool'), color: hdr(A, 0.3) });   // the wash of the sign on the plates around it, inside the face
    // the lamp on the cap: a short mast and a red beacon
    const m = at(0, y1 + 0.06, 0.1), top = y1 + 0.3;
    K.tube(K.lit, m, [m[0], top, m[2]], 0.018, { seg: 6, color: STEEL_L });
    K.box(K.lit, m[0], y1 + 0.09, m[2], 0.14, 0.06, 0.14, { yaw, cell: 'plateDark' });
    beacon(m[0], top + 0.06, m[2], 0xff2a22, 0.16);
  }, { plate });
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
//  The tower: the atrium's roof
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// The only tall roof, taller than every wing by far: an observatory drum with a lit band, a dome and a spire; a lattice mast; a dish aimed at the Earth; air
// handlers, stacks, solar panels. Everything stays out of the skylight's column (x 11-14, z 11-13), which the proof checks under SKYLIGHT.clearY.
function dressTower(D) {
  const { K, ctx, B, beacon } = D;
  const AT = B.atrium, R = AT.roofY, A = IDENTITY.atrium.accent;
  const item = (name, rect, fn) => roofItem(D, name, AT, rect, fn);

  // the mast: a pedestal, a pole three times the height of the wings, cross-booms, a red beacon on top
  item('mast', [14.75, 15.55, 9.9, 10.7], () => {
    const m = { x: 15.15, z: 10.3 };
    K.box(K.lit, m.x, R + 0.25, m.z, 0.4, 0.5, 0.4, { cell: 'plate' });
    K.tube(K.lit, [m.x, R + 0.5, m.z], [m.x, R + 6.0, m.z], 0.035, { seg: 8, color: STEEL_L });
    for (const [y, len, yaw] of [[4.4, 1.5, 0.4], [5.0, 1.1, 1.2], [5.6, 0.8, 2.0]]) {
      const c = Math.cos(yaw) * len / 2, s = Math.sin(yaw) * len / 2;
      K.tube(K.lit, [m.x - c, R + y, m.z - s], [m.x + c, R + y, m.z + s], 0.016, { seg: 6, color: STEEL_L });
      K.tube(K.lit, [m.x - c * 0.9, R + y + 0.18, m.z - s * 0.9], [m.x + c * 0.9, R + y + 0.18, m.z + s * 0.9], 0.011, { seg: 5, color: STEEL_L });
    }
    K.tube(K.lit, [m.x, R + 6.0, m.z], [m.x, R + 6.7, m.z], 0.012, { seg: 5, color: STEEL_L });
    beacon(m.x, R + 6.78, m.z, 0xff2a22, 0.2);
    for (const y of [2.4, 3.8]) beacon(m.x, R + y, m.z, 0xff2a22, 0.1);
  });

  // the dish aimed at the Earth (south, a little over the horizon): pedestal, yoke, a mesh dish, feed horn on three struts
  item('dish', [13.65, 15.45, 13.85, 15.65], () => {
    const dish = { x: 14.55, z: 14.75, R: 0.85, h: 1.15 };
    K.cone(K.lit, [dish.x, R, dish.z], 0.28, 0.16, 0.7, { seg: 10, cell: 'plate' });
    K.tube(K.lit, [dish.x, R + 0.7, dish.z], [dish.x, R + dish.h, dish.z], 0.07, { seg: 8, color: STEEL_D });
    placeDish(K, [dish.x, R + dish.h + 0.1, dish.z], dish.R, { counter: true });
  });

  // the observatory drum: a cylinder with a lit band, a cornice ring, a dome with a slit toward the Earth, a spire
  item('drum', [9.2, 11.1, 9.2, 11.1], () => {
    const d = { x: 10.15, z: 10.15, r: 0.9 };
    K.cyl(K.lit, d.x, R, d.z, d.r + 0.06, 0.12, { seg: 16, cell: 'plateDark' });
    K.cyl(K.lit, d.x, R + 0.12, d.z, d.r, 0.63, { seg: 16, cell: 'plateRust' });
    K.put(K.glow, new THREE.CylinderGeometry(d.r + 0.012, d.r + 0.012, 0.16, 16, 1, true), { pos: [d.x, R + 0.42, d.z], color: hdr(A, 0.55) });      // the lit band
    K.cyl(K.lit, d.x, R + 0.75, d.z, d.r + 0.07, 0.07, { seg: 16, cell: 'plateDark' });
    K.put(K.lit, domeGeo(16, 7), { pos: [d.x, R + 0.82, d.z], scale: [d.r, 0.8, d.r], cell: 'plateLight' });
    K.box(K.lit, d.x - 0.05, R + 1.2, d.z + 0.78, 0.18, 0.62, 0.1, { color: 0x0c0f13 });   // the slit
    K.tube(K.lit, [d.x, R + 1.62, d.z], [d.x, R + 2.5, d.z], 0.016, { seg: 6, color: STEEL_L });
    K.tube(K.lit, [d.x - 0.25, R + 2.2, d.z], [d.x + 0.25, R + 2.2, d.z], 0.011, { seg: 5, color: STEEL_L });
    beacon(d.x, R + 2.56, d.z, 0xff2a22, 0.12);
  });
  // a whip pair and a lit antenna tower on the south-west corner, as tall as the drum
  item('whips', [9.4, 9.9, 15.1, 15.7], () => {
    for (const [x, z, h] of [[9.55, 15.35, 2.4], [9.75, 15.55, 1.6]]) { K.tube(K.lit, [x, R, z], [x, R + h, z], 0.01, { seg: 5, color: STEEL_L }); K.cyl(K.lit, x, R, z, 0.06, 0.12, { seg: 6, color: STEEL_D }); }
    beacon(9.55, R + 2.45, 15.35, 0xff2a22, 0.12);
  });

  // an air handler, vent stacks, a roof hatch, a duct, four solar panels leaning to the Sun
  item('air-handler', [9.35, 10.55, 13.15, 13.95], () => {
    K.box(K.lit, 9.95, R + 0.35, 13.55, 1.2, 0.7, 0.8, { faces: { pz: 'louvre', nz: 'louvre' }, cell: 'plate' });
    K.box(K.lit, 9.95, R + 0.75, 13.55, 0.4, 0.1, 0.4, { cell: 'plateDark' });
  });
  for (const [x, z, h, r] of [[9.65, 11.9, 0.7, 0.1], [15.4, 12.6, 0.95, 0.12], [15.65, 13.6, 0.6, 0.09], [12.2, 9.55, 0.5, 0.08]]) {
    item(`stack@${fx(x)},${fx(z)}`, [x - r * 1.7, x + r * 1.7, z - r * 1.7, z + r * 1.7], () => {
      K.tube(K.lit, [x, R, z], [x, R + h, z], r, { seg: 8, color: STEEL });
      K.cone(K.lit, [x, R + h, z], r * 1.7, r * 0.8, 0.07, { seg: 8, color: STEEL_D });
    });
  }
  item('hatch', [14.45, 15.45, 11.2, 12.2], () => {
    K.box(K.lit, 14.95, R + 0.05, 11.7, 0.95, 0.1, 0.95, { yaw: 0.2, cell: 'plate' });
    K.box(K.lit, 14.95, R + 0.115, 11.7, 0.8, 0.03, 0.8, { yaw: 0.2, cell: 'plateRust' });
  });
  item('duct', [9.2, 9.4, 11.3, 12.4], () => K.tube(K.lit, [9.3, R + 0.07, 12.3], [9.3, R + 0.07, 11.4], 0.05, { seg: 8, color: STEEL }));
  const sun = ctx.sunDir, hs = Math.hypot(sun.x, sun.z);
  const nrm = [sun.x / hs * Math.cos(0.5), Math.sin(0.5), sun.z / hs * Math.cos(0.5)];
  for (let i = 0; i < 4; i++) {
    const x = 10.3 + i * 0.95, z = 14.55;
    item(`solar@${i}`, [x - 0.5, x + 0.5, z - 0.45, z + 0.45], () => solarPanel(K, [x, R + 0.45, z], nrm, 0.85, 0.6, R));
  }
  // corner lights: amber posts at the four corners of the parapet
  for (const [x, z] of [[15.8, 9.2], [15.8, 15.8], [9.2, 15.8]]) {
    item(`corner-light@${fx(x)},${fx(z)}`, [x - 0.06, x + 0.06, z - 0.06, z + 0.06], () => {
      K.box(K.lit, x, R + 0.1, z, 0.1, 0.2, 0.1, { cell: 'plateDark' });   // a post standing on the roof slab
      beacon(x, R + 0.24, z, 0xffa040, 0.08);
    });
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
//  Pieces used on the roof and on the plain
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// A dish whose axis points at the Earth (props/sky.js EARTH): the bowl (both faces), a feed horn on three struts.
function placeDish(K, centre, R, { counter = false } = {}) {
  const e = EARTH.el * D2R, a = EARTH.az * D2R;
  const d = new THREE.Vector3(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a));
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
  const geo = dishGeo(0.34, 20, 6);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...centre), q, new THREE.Vector3(R, R, R));
  K.twoSided(K.lit, geo, { matrix: m, cell: 'plateLight', color: 0xd8dde2 });
  const tip = new THREE.Vector3(...centre).addScaledVector(d, R * 0.34 + 0.45 * R);
  K.tube(K.lit, centre, [tip.x, tip.y, tip.z], 0.02 * R + 0.012, { seg: 6, color: STEEL_D });
  K.box(K.lit, tip.x, tip.y, tip.z, 0.14 * R + 0.06, 0.14 * R + 0.06, 0.14 * R + 0.06, { color: STEEL_D });
  // struts from the rim to the horn
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q), fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  for (let i = 0; i < 3; i++) {
    const t = i * (Math.PI * 2 / 3) + 0.5, rim = new THREE.Vector3(...centre).addScaledVector(right, Math.cos(t) * R).addScaledVector(fwd, Math.sin(t) * R).addScaledVector(d, R * 0.34);
    K.tube(K.lit, [rim.x, rim.y, rim.z], [tip.x, tip.y, tip.z], 0.01 * R + 0.007, { seg: 5, color: STEEL_L });
  }
  if (counter) K.box(K.lit, centre[0], centre[1] - R * 0.1, centre[2], 0.25, 0.2, 0.25, { cell: 'plateDark' });
}

// A solar panel (front = cells, back = pale sheet): centre, normal, width x height, the ground under it; legs (roof panels) or one post (trackers).
function solarPanel(K, c, n, w, h, groundY, { legs = true, post = false } = {}) {
  const nn = new THREE.Vector3(...n).normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), nn).normalize();
  const up = new THREE.Vector3().crossVectors(nn, right).normalize();
  const f = (u, v, k = 0) => [c[0] + right.x * u + up.x * v + nn.x * k, c[1] + right.y * u + up.y * v + nn.y * k, c[2] + right.z * u + up.z * v + nn.z * k];
  K.quadAt(K.lit, f(0, 0, 0.022), [nn.x, nn.y, nn.z], w, h, { uv: K.uv('solarF'), up: [0, 1, 0] });
  K.quadAt(K.lit, f(0, 0, -0.022), [-nn.x, -nn.y, -nn.z], w, h, { uv: K.uv('solarB'), up: [0, 1, 0] });
  const t = 0.05;
  for (const [a, b] of [[[-w / 2, -h / 2], [w / 2, -h / 2]], [[-w / 2, h / 2], [w / 2, h / 2]], [[-w / 2, -h / 2], [-w / 2, h / 2]], [[w / 2, -h / 2], [w / 2, h / 2]]]) {
    K.tube(K.lit, f(a[0], a[1]), f(b[0], b[1]), t, { square: true, color: 0xb4bbc4 });
  }
  K.tube(K.lit, f(0, -h / 2), f(0, h / 2), 0.035, { square: true, color: 0x9aa1aa });
  K.tube(K.lit, f(-w / 2, 0), f(w / 2, 0), 0.03, { square: true, color: 0x9aa1aa });
  if (post) {
    // one post under the middle of the panel, a base plate, a diagonal brace and the tracking motor box
    const back = f(0, 0, -0.05);
    K.tube(K.lit, [back[0], groundY, back[2]], [back[0], back[1] - 0.02, back[2]], 0.05, { seg: 8, color: STEEL_D });
    K.box(K.lit, back[0], groundY + 0.03, back[2], 0.55, 0.06, 0.55, { color: 0x3a4048 });
    K.box(K.lit, back[0] - nn.x * 0.12, back[1] - 0.05, back[2] - nn.z * 0.12, 0.22, 0.2, 0.22, { cell: 'plate' });
    const lo = f(0, -h * 0.4, -0.04);
    K.tube(K.lit, [back[0], groundY + 0.55, back[2]], lo, 0.02, { seg: 5, color: STEEL_L });
  } else if (legs) {
    const lo = f(0, -h * 0.28, -0.03), hi = f(0, h * 0.28, -0.03);
    K.tube(K.lit, [lo[0], groundY, lo[2]], lo, 0.04, { seg: 6, color: STEEL_D });
    K.tube(K.lit, [hi[0], groundY, hi[2]], hi, 0.035, { seg: 6, color: STEEL_D });
    K.box(K.lit, lo[0], groundY + 0.025, lo[2], 0.36, 0.05, 0.36, { color: STEEL_D });
    K.box(K.lit, hi[0], groundY + 0.025, hi[2], 0.3, 0.05, 0.3, { color: STEEL_D });
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
//  The plain
// ══════════════════════════════════════════════════════════════════════════════════════════════════
const ground = (D, name, fn, meta = {}) => D.K.item(`ground:${name}`, { kind: 'ground', ...meta }, fn);

// The plain, as slices of about the same weight (each is poured on its own idle slice): [antennas + flag + south station], [tank farm + landing + solar field],
// [lattice tower + lamps + supply dumps], [rocks]. Every slice shares the claims (`taken`) of the ones before it.
function plainSteps(D) {
  const { K, ctx } = D;
  const claim = (x, z, r) => D.taken.push([x, z, r]);
  const free = (x, z, r) => ctx.clear(x, z, r) && D.taken.every(([tx, tz, tr]) => Math.hypot(tx - x, tz - z) > tr + r);
  return [
    () => { antennaArray(D, claim); flagAndSign(D, claim); southStation(D, claim); },
    () => { tankFarm(D, claim); landingSite(D, claim); solarField(D, claim, free); },
    () => {
      latticeTower(D, claim);
      lampPosts(D, claim);
      ground(D, 'supply-east', () => supplyDump(K, ctx, claim, 24.5, 27.0, 0.5, true));
      ground(D, 'supply-west', () => supplyDump(K, ctx, claim, -9.0, 28.5, 2.5, false));
    },
    () => { boulders(D, free); },
  ];
}

// ── West: the antenna array: three dishes aimed at the Earth, a field of yagis, a radio hut ──
function antennaArray(D, claim) {
  const { K, ctx, beacon } = D;
  const G = ctx.GROUND_Y, lit = K.lit;
  // yagi: mast, a boom pointing south (at the Earth), five elements
  const yagi = (x, z, h, yaw = 0) => {
    claim(x, z, 1.0);
    ground(D, `yagi@${fx(x)},${fx(z)}`, () => {
      K.cyl(lit, x, G, z, 0.14, 0.05, { seg: 8, color: STEEL_D });
      K.tube(lit, [x, G, z], [x, G + h, z], 0.03, { seg: 6, color: STEEL_L });
      const ca = Math.sin(yaw), sa = Math.cos(yaw);       // boom direction (south = +z when yaw 0)
      K.tube(lit, [x - ca * 0.65, G + h, z - sa * 0.65], [x + ca * 0.65, G + h, z + sa * 0.65], 0.02, { seg: 5, color: STEEL_L });
      [[-0.55, 0.6], [-0.25, 0.5], [0.05, 0.46], [0.3, 0.42], [0.55, 0.38]].forEach(([d, len]) => {
        const px = x + ca * d, pz = z + sa * d;
        K.tube(lit, [px - sa * len, G + h, pz + ca * len], [px + sa * len, G + h, pz - ca * len], 0.016, { seg: 5, color: STEEL_L });
      });
    });
  };
  const gridX = [-9, -12.5, -16, -19.5], gridZ = [8.5, 11.2, 14, 16.8, 19.5];
  gridX.forEach((x, i) => gridZ.forEach((z, j) => {
    const jx = x + Math.sin(i * 3.1 + j * 1.7) * 0.5, jz = z + Math.cos(i * 1.3 + j * 2.9) * 0.5;
    if (ctx.clear(jx, jz, 1)) yagi(jx, jz, 1.7 + 0.5 * ((i + j) % 3 === 0 ? 1 : 0) + 0.25 * (j % 2), (i % 2 ? 0.08 : -0.05));
  }));
  bigDish(D, claim, -11.5, 4.8, 1.5, 1.4);
  bigDish(D, claim, -15, 24.5, 1.8, 1.6);
  bigDish(D, claim, -26, 13.5, 3.0, 2.4);
  // the radio hut: a box with a lit slit window, a door, a roof vent, a beacon
  ground(D, 'radio-hut', () => {
    const hx = -6.6, hz = 23.6;
    claim(hx, hz, 2.4);
    K.box(lit, hx, G + 0.85, hz, 2.6, 1.7, 1.9, { yaw: 0.15, cell: 'plate', faces: { py: 'plateRust' } });
    K.box(lit, hx + 0.06, G + 1.74, hz, 2.8, 0.1, 2.1, { yaw: 0.15, cell: 'plateDark' });
    K.box(lit, hx + 0.5, G + 1.88, hz - 0.2, 0.6, 0.16, 0.5, { yaw: 0.15, faces: { py: 'louvre' }, cell: 'plateDark' });
    const hy = 0.15, ca = Math.cos(hy), sa = Math.sin(hy);
    // front = east side (toward the base)
    K.quadAt(K.glow, [hx + 1.3 * ca + 0.02, G + 1.05, hz - 1.3 * sa - 0.45], [ca, 0, -sa], 0.8, 0.28, { color: hdr(AMBER, 0.55) });
    K.box(lit, hx + 1.3 * ca + 0.02, G + 0.75, hz - 1.3 * sa + 0.4, 0.06, 1.5, 0.78, { yaw: hy, cell: 'plateDark' });
    beacon(hx + 0.5, G + 2.05, hz - 0.2, 0xff2a22, 0.14);
  });
}

// A dish on a tower: pedestal, yoke, bowl aimed at the Earth.
function bigDish(D, claim, x, z, R, tower) {
  const { K, ctx } = D;
  const G = ctx.GROUND_Y, lit = K.lit;
  claim(x, z, R + 1);
  ground(D, `dish@${fx(x)},${fx(z)}`, () => {
    K.cone(lit, [x, G, z], 0.55 + R * 0.12, 0.28, tower, { seg: 8, cell: 'plate' });
    K.box(lit, x, G + 0.06, z, 1.6 + R * 0.2, 0.12, 1.6 + R * 0.2, { color: 0x4b4f55 });
    K.tube(lit, [x, G + tower, z], [x, G + tower + R * 0.55, z], 0.1, { seg: 8, color: STEEL_D });
    placeDish(K, [x, G + tower + R * 0.62, z], R, { counter: true });
  });
}

// ── South: two dishes under the Earth, silhouetted against it from the Armurerie's and the Trophees' south windows ──
function southStation(D, claim) {
  const { K, ctx, beacon } = D;
  const G = ctx.GROUND_Y, lit = K.lit;
  bigDish(D, claim, 5.2, 40.5, 2.0, 1.9);
  bigDish(D, claim, -2.4, 35.5, 1.4, 1.5);
  bigDish(D, claim, 17.6, 43.0, 1.7, 1.7);
  // a cabin between the two nearer dishes, a cable run to each, a beacon
  ground(D, 'cabin', () => {
    const hx = 1.4, hz = 38.0;
    claim(hx, hz, 2);
    K.box(lit, hx, G + 0.75, hz, 2.0, 1.5, 1.6, { yaw: 0.25, cell: 'plate', faces: { py: 'plateRust' } });
    K.box(lit, hx, G + 1.55, hz, 2.2, 0.1, 1.8, { yaw: 0.25, cell: 'plateDark' });
    K.quadAt(K.glow, [hx + 0.62, G + 0.95, hz + 0.88], [0.25, 0, 1], 0.7, 0.24, { color: hdr(AMBER, 0.5) });
    groundStrip(K, G, [hx, hz], [5.2, 40.5], 0.1, 0x1a1b1d);
    groundStrip(K, G, [hx, hz], [-2.4, 35.5], 0.1, 0x1a1b1d);
    beacon(hx, G + 1.67, hz, 0xff2a22, 0.14);   // on the roof slab (its top is G + 1.6)
  });
}

// ── West: the flag (a tiny DF) and a road sign pointing at the Earth ──
function flagAndSign(D, claim) {
  const { K, ctx } = D;
  const G = ctx.GROUND_Y, lit = K.lit;
  const fx0 = -5.6, fz = 12.2;
  claim(fx0, fz, 1.2);
  ground(D, 'flag', () => {
    K.tube(lit, [fx0, G, fz], [fx0, G + 2.35, fz], 0.016, { seg: 6, color: STEEL_L });
    K.put(lit, sphereGeo(6, 5), { pos: [fx0, G + 2.38, fz], scale: [0.04, 0.04, 0.04], color: 0xd8dde2 });
    K.tube(lit, [fx0, G + 2.1, fz + 0.02], [fx0, G + 2.1, fz - 1.0], 0.012, { seg: 5, color: STEEL_L });   // the rod that holds it out
    // the cloth hangs north of the pole (hoist on the left of a viewer standing east, toward the base): six slices that wave a little, each
    // a different height, so that its edge is ragged like cloth held out by a rod
    const u = K.uv('flag'), N = 6, FW = 0.9, FH = 0.58;
    for (let i = 0; i < N; i++) {
      const z0 = fz - 0.04 - (i / N) * FW, z1 = fz - 0.04 - ((i + 1) / N) * FW, zc = (z0 + z1) / 2;
      const wob = Math.sin(i * 1.25 + 0.4) * 0.045, hh = FH * (0.96 + 0.06 * Math.sin(i * 2.1 + 1)), cy = G + 1.84 + Math.sin(i * 0.9) * 0.025 - (FH - hh) / 2;
      const east = { u0: lerp(u.u0, u.u1, i / N), u1: lerp(u.u0, u.u1, (i + 1) / N), v0: u.v0, v1: u.v1 };
      const west = { u0: lerp(u.u0, u.u1, 1 - (i + 1) / N), u1: lerp(u.u0, u.u1, 1 - i / N), v0: u.v0, v1: u.v1 };
      K.quadAt(lit, [fx0 + 0.012 + wob, cy, zc], [1, 0, 0], Math.abs(z1 - z0) + 0.004, hh, { uv: east });
      K.quadAt(lit, [fx0 - 0.012 + wob, cy, zc], [-1, 0, 0], Math.abs(z1 - z0) + 0.004, hh, { uv: west });
    }
    // a little cairn of stones and the boot prints that lead to it
    for (let i = 0; i < 5; i++) K.put(lit, rockGeo(300 + i, 0, 0.3), { pos: [fx0 + Math.cos(i * 1.3) * 0.28, G + 0.06, fz + Math.sin(i * 1.3) * 0.28], rot: [0, i, 0], scale: [0.14, 0.1, 0.14], cell: 'rock', color: 0xb8b8b8 });
    for (let i = 0; i < 12; i++) {
      const t = i / 12, x = lerp(-1.5, fx0 + 0.5, t) + Math.sin(i * 2.3) * 0.04, z = lerp(15.6, fz + 0.7, t), side = i % 2 ? 1 : -1;
      K.quadAt(K.decal, [x - side * 0.07, G + 0.014, z], [0, 1, 0], 0.12, 0.28, { uv: K.uv('boot'), color: 0x2c2a27, up: [0.35, 0, -1] });
    }
  }, { buried: true });
  // the sign: a post and a green board, the arrow to the viewer's left (south) = the Earth
  const sx = -6.3, sz = 17.2;
  claim(sx, sz, 1.2);
  ground(D, 'road-sign', () => {
    K.tube(lit, [sx, G, sz], [sx, G + 2.15, sz], 0.035, { seg: 6, color: STEEL_D });
    K.box(lit, sx, G + 0.03, sz, 0.4, 0.06, 0.4, { color: STEEL_D });
    K.quadAt(lit, [sx + 0.04, G + 1.78, sz], [1, 0, 0], 2.2, 0.46, { uv: K.uv('signEarth') });
    K.quadAt(lit, [sx - 0.04, G + 1.78, sz], [-1, 0, 0], 2.2, 0.46, { color: 0x3a4048 });
    K.box(lit, sx, G + 1.78, sz, 0.05, 0.5, 2.24, { color: STEEL_D });
  });
}

// ── East: the solar field: trackers (a panel on a post) leaning toward the Sun, seen from behind from the base ──
function solarField(D, claim, free) {
  const { K, ctx, beacon } = D;
  const G = ctx.GROUND_Y, sun = ctx.sunDir, hs = Math.hypot(sun.x, sun.z), C = ctx.center;
  const s = [sun.x / hs, sun.z / hs], r = [-s[1], s[0]];   // toward the Sun, along a row
  const tilt = 0.42, nrm = [s[0] * Math.cos(tilt), Math.sin(tilt), s[1] * Math.cos(tilt)];
  const F = { x: 43.5, z: 10 };
  const rows = 5, perRow = 7, w = 1.9, h = 1.2, pitchR = 3.2, pitchS = 4.8;
  const placed = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < perRow; j++) {
      const u = (j - (perRow - 1) / 2) * pitchR, v = (i - (rows - 1) / 2) * pitchS;
      const x = F.x + r[0] * u + s[0] * v, z = F.z + r[1] * u + s[1] * v;
      if (Math.hypot(x - C.x, z - C.z) > 42 || !free(x, z, 1.5)) continue;
      const cy = G + 1.05 + (h / 2) * Math.cos(tilt);
      ground(D, `tracker@${fx(x)},${fx(z)}`, () => solarPanel(K, [x, cy, z], nrm, w, h, G, { post: true }));
      placed.push([x, z]);
    }
    const a = [F.x + r[0] * (-3.4 * pitchR) + s[0] * ((i - (rows - 1) / 2) * pitchS - 0.9), F.z + r[1] * (-3.4 * pitchR) + s[1] * ((i - (rows - 1) / 2) * pitchS - 0.9)];
    const b = [F.x + r[0] * (3.4 * pitchR) + s[0] * ((i - (rows - 1) / 2) * pitchS - 0.9), F.z + r[1] * (3.4 * pitchR) + s[1] * ((i - (rows - 1) / 2) * pitchS - 0.9)];
    if (Math.hypot(a[0] - C.x, a[1] - C.z) < 41 && Math.hypot(b[0] - C.x, b[1] - C.z) < 41) ground(D, `cable-row@${i}`, () => groundStrip(K, G, a, b, 0.1, 0x1a1b1d));
  }
  placed.forEach(([x, z]) => claim(x, z, 1.4));
  // a cabinet at the west end
  const cab = { x: F.x - s[0] * 2.6 - r[0] * 11.5, z: F.z - s[1] * 2.6 - r[1] * 11.5 };
  if (free(cab.x, cab.z, 0.8)) {
    ground(D, 'solar-cabinet', () => {
      K.box(K.lit, cab.x, G + 0.65, cab.z, 0.9, 1.3, 0.6, { cell: 'plate', faces: { py: 'plateDark' } });
      beacon(cab.x, G + 1.4, cab.z, 0xffa040, 0.1);
    });
  }
}

// A flat dark strip on the ground from a to b (a cable laid on the regolith).
function groundStrip(K, G, a, b, w, color) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
  K.quadAt(K.decal, [(a[0] + b[0]) / 2, G + 0.018, (a[1] + b[1]) / 2], [0, 1, 0], w, L, { color, up: [dx, 0, dz] });
}

// ── North-east: a small tank farm with a pipe rack and a control hut ──
function tankFarm(D, claim) {
  const { K, ctx, beacon } = D;
  const G = ctx.GROUND_Y, lit = K.lit;
  const T = { x: 31, z: 1.5 };
  const tanks = [['tankA', 0, 0, 0.85, 2.7], ['tankB', 2.3, 0.5, 0.85, 2.7], ['tankC', 4.6, 1.0, 0.7, 2.2]];
  tanks.forEach(([cell, dx, dz, r, h]) => {
    const x = T.x + dx, z = T.z + dz;
    claim(x, z, r + 0.8);
    ground(D, `tank@${cell}`, () => {
      K.cyl(lit, x, G + 0.35, z, r, h, { seg: 14, cell });
      K.put(lit, domeGeo(14, 4), { pos: [x, G + 0.35 + h, z], scale: [r, r * 0.45, r], cell: 'plateLight' });
      K.put(lit, domeGeo(14, 4), { pos: [x, G + 0.35, z], rot: [Math.PI, 0, 0], scale: [r, r * 0.35, r], cell: 'plateLight' });
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.78; K.tube(lit, [x + Math.cos(a) * r * 0.8, G, z + Math.sin(a) * r * 0.8], [x + Math.cos(a) * r * 0.9, G + 0.7, z + Math.sin(a) * r * 0.9], 0.04, { seg: 5, color: STEEL_D }); }
      K.tube(lit, [x, G + 0.35 + h + r * 0.45, z], [x, G + 0.35 + h + r * 0.45 + 0.5, z], 0.02, { seg: 5, color: STEEL_L });
      if (cell === 'tankB') beacon(x, G + 0.35 + h + r * 0.45 + 0.5 + 0.06, z, 0xff2a22, 0.16);   // the red light on the antenna of the middle tank
    });
  });
  ground(D, 'pipe-rack', () => {
    K.tube(lit, [T.x - 0.2, G + 0.5, T.z + 2.1], [T.x + 5.0, G + 0.5, T.z + 3.1], 0.07, { seg: 8, color: STEEL });
    K.tube(lit, [T.x - 0.2, G + 0.7, T.z + 2.1], [T.x + 5.0, G + 0.7, T.z + 3.1], 0.045, { seg: 8, color: COPPER });
    for (let i = 0; i < 4; i++) { const t = i / 3, x = lerp(T.x + 0.4, T.x + 4.6, t), z = lerp(T.z + 2.15, T.z + 3.05, t); K.box(lit, x, G + 0.35, z, 0.12, 0.7, 0.12, { color: STEEL_D }); }   // posts up to the upper (copper) pipe, which hung in the air above the steel one
  });
  ground(D, 'control-hut', () => {
    const hx = T.x + 7.4, hz = T.z + 2.6;
    claim(hx, hz, 2);
    K.box(lit, hx, G + 0.8, hz, 2.2, 1.6, 1.7, { yaw: -0.1, cell: 'plate' });
    K.box(lit, hx, G + 1.65, hz, 2.4, 0.1, 1.9, { yaw: -0.1, cell: 'plateDark' });
    K.quadAt(K.glow, [hx - 1.11, G + 1.0, hz + 0.1], [-1, 0, 0.1], 0.9, 0.3, { color: hdr(AMBER, 0.5) });
  });
}

// ── South-east: the landing pad, the lander, the rover, tracks ──
function landingSite(D, claim) {
  const { K, ctx, beacon } = D;
  const G = ctx.GROUND_Y, lit = K.lit, decal = K.decal;
  const P = PAD, PR = 5.2;
  claim(P.x, P.z, PR + 1.2);
  ground(D, 'pad', () => {
    // the pad: a scorched disc, two painted rings, a cross, chevrons
    const flat = (geo, y, color) => K.put(decal, geo.rotateX(-Math.PI / 2), { pos: [P.x, G + y, P.z], color });
    flat(new THREE.CircleGeometry(PR, 44), 0.004, 0x2e2c2a);
    flat(new THREE.RingGeometry(PR - 0.32, PR - 0.1, 44), 0.008, 0xb9a23a);
    flat(new THREE.RingGeometry(2.6, 2.74, 36), 0.008, 0xb9a23a);
    K.quadAt(decal, [P.x, G + 0.01, P.z], [0, 1, 0], 0.18, PR * 1.8, { color: 0xb9a23a });
    K.quadAt(decal, [P.x, G + 0.01, P.z], [0, 1, 0], PR * 1.8, 0.18, { color: 0xb9a23a });
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      K.quadAt(decal, [P.x + Math.cos(a) * 3.8, G + 0.01, P.z + Math.sin(a) * 3.8], [0, 1, 0], 0.7, 0.7, { uv: K.uv('chevron'), color: 0xb9a23a, up: [-Math.cos(a), 0, -Math.sin(a)] });
    }
    for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; beacon(P.x + Math.cos(a) * (PR + 0.45), G + 0.07, P.z + Math.sin(a) * (PR + 0.45), i % 7 === 0 ? 0xff5a3a : 0x9ad0ff, 0.12); }
  });
  // the lander: a gold descent stage on four legs, an engine bell, a silver ascent stage, a dish and two spherical tanks
  ground(D, 'lander', () => {
    const gold = { cell: 'foilGold', color: 0xe8e0d0 };
    K.put(lit, new THREE.CylinderGeometry(1.35, 1.22, 1.0, 8), { pos: [P.x, G + 1.55, P.z], rot: [0, 0.4, 0], ...gold });
    K.cone(lit, [P.x, G + 0.55, P.z], 0.62, 0.22, 0.5, { seg: 10, color: 0x25272b });
    K.put(lit, new THREE.CylinderGeometry(0.98, 1.06, 0.95, 6), { pos: [P.x, G + 2.5, P.z], rot: [0, 0.1, 0], cell: 'foilSilver', color: 0xe6e6e6 });
    K.put(lit, domeGeo(6, 2), { pos: [P.x, G + 2.97, P.z], scale: [0.98, 0.25, 0.98], rot: [0, 0.1, 0], cell: 'plateLight' });
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + 0.4 + Math.PI / 4, c = Math.cos(a), s = Math.sin(a);
      const top = [P.x + c * 1.25, G + 1.15, P.z + s * 1.25], foot = [P.x + c * 2.55, G + 0.06, P.z + s * 2.55];
      K.tube(lit, top, foot, 0.06, { seg: 6, color: STEEL_L });
      K.tube(lit, [P.x + c * 0.7, G + 1.0, P.z + s * 0.7], [P.x + c * 2.0, G + 0.45, P.z + s * 2.0], 0.03, { seg: 5, color: STEEL_D });
      K.cyl(lit, foot[0], G, foot[2], 0.32, 0.06, { seg: 10, color: 0x6a6e74 });
      K.put(lit, sphereGeo(10, 7), { pos: [P.x + Math.cos(a + 0.9) * 1.55, G + 1.9, P.z + Math.sin(a + 0.9) * 1.55], scale: [0.4, 0.4, 0.4], cell: 'foilSilver', color: 0xf0f0f0 });
    }
    // the ladder and the porch face west (toward the base), a dark window, antennas
    K.tube(lit, [P.x - 1.15, G + 1.5, P.z - 0.28], [P.x - 1.75, G + 0.06, P.z - 0.28], 0.025, { seg: 5, color: STEEL_L });
    K.tube(lit, [P.x - 1.15, G + 1.5, P.z + 0.28], [P.x - 1.75, G + 0.06, P.z + 0.28], 0.025, { seg: 5, color: STEEL_L });
    for (let i = 0; i < 6; i++) { const t = i / 5, x = lerp(P.x - 1.2, P.x - 1.72, t), y = lerp(G + 1.4, G + 0.16, t); K.tube(lit, [x, y, P.z - 0.28], [x, y, P.z + 0.28], 0.014, { seg: 4, color: STEEL_L }); }
    K.box(lit, P.x - 1.45, G + 2.05, P.z, 0.7, 0.07, 0.8, { color: STEEL_D });
    K.box(lit, P.x - 0.97, G + 2.7, P.z + 0.38, 0.05, 0.28, 0.3, { yaw: 0.1, color: 0x0b0f14 });
    K.box(lit, P.x - 0.97, G + 2.7, P.z - 0.38, 0.05, 0.28, 0.3, { yaw: -0.1, color: 0x0b0f14 });
    K.tube(lit, [P.x + 0.3, G + 3.0, P.z + 0.2], [P.x + 0.3, G + 3.9, P.z + 0.2], 0.014, { seg: 5, color: STEEL_L });
    K.tube(lit, [P.x - 0.4, G + 3.0, P.z - 0.3], [P.x - 0.6, G + 3.55, P.z - 0.35], 0.012, { seg: 5, color: STEEL_L });
    placeDish(K, [P.x + 0.2, G + 3.35, P.z - 0.45], 0.32);
    beacon(P.x + 0.3, G + 3.95, P.z + 0.2, 0xff2a22, 0.12);
  });

  // the rover: a silver body, a solar skin, six wheels, a mast with a camera, a small dish aimed at the Earth
  const R = ROVER;
  claim(R.x, R.z, 1.6);
  ground(D, 'rover', () => {
    const rv = (dx, dz) => [R.x + Math.cos(R.yaw) * dx - Math.sin(R.yaw) * dz, R.z + Math.sin(R.yaw) * dx + Math.cos(R.yaw) * dz];
    K.box(lit, R.x, G + 0.62, R.z, 1.5, 0.34, 0.85, { yaw: -R.yaw, cell: 'foilSilver', faces: { py: 'solarF' } });
    K.box(lit, R.x, G + 0.83, R.z, 1.2, 0.04, 0.7, { yaw: -R.yaw, faces: { py: 'solarF' }, cell: 'foilSilver' });
    for (const dx of [-0.62, 0, 0.62]) for (const dz of [-0.52, 0.52]) {
      const [wx, wz] = rv(dx, dz);
      K.put(lit, new THREE.CylinderGeometry(0.26, 0.26, 0.16, 12), { pos: [wx, G + 0.26, wz], rot: [Math.PI / 2, -R.yaw, 0], color: 0x1d2024 });
      const [sx, sz] = rv(dx, dz * 0.72);
      K.tube(lit, [sx, G + 0.55, sz], [wx, G + 0.28, wz], 0.025, { seg: 5, color: STEEL_D });
    }
    const [mx, mz] = rv(0.5, 0.1);
    K.tube(lit, [mx, G + 0.83, mz], [mx, G + 1.55, mz], 0.025, { seg: 5, color: STEEL_L });
    K.box(lit, mx, G + 1.6, mz, 0.2, 0.12, 0.14, { yaw: -R.yaw, color: STEEL_D });
    const [dx2, dz2] = rv(-0.45, -0.1);
    K.tube(lit, [dx2, G + 0.83, dz2], [dx2, G + 1.05, dz2], 0.02, { seg: 5, color: STEEL_D });
    placeDish(K, [dx2, G + 1.12, dz2], 0.22);
    // the duck: a yellow rubber duck rides on the back of the rover (a wink to the one tumbling in the sky)
    const [ux, uz] = rv(-0.35, 0.22);
    K.put(lit, sphereGeo(8, 6), { pos: [ux, G + 0.98, uz], scale: [0.1, 0.075, 0.075], rot: [0, -R.yaw, 0], color: 0xe8b81a });
    K.put(lit, sphereGeo(8, 6), { pos: [ux + Math.cos(R.yaw) * 0.07, G + 1.07, uz + Math.sin(R.yaw) * 0.07], scale: [0.055, 0.055, 0.055], color: 0xe8b81a });
    K.box(lit, ux + Math.cos(R.yaw) * 0.13, G + 1.065, uz + Math.sin(R.yaw) * 0.13, 0.05, 0.015, 0.03, { yaw: -R.yaw, color: 0xe0701a });
  });

  // tyre tracks from the pad past the rover and on toward the base, boot prints round the lander
  ground(D, 'tracks', () => {
    trackPath(K, G, [[P.x - 2.4, P.z - 3.1], [P.x - 5, P.z - 4.4], [R.x + 0.6, R.z + 0.7], [R.x - 4, R.z - 1.2], [R.x - 8.4, R.z + 0.1]]);
    trackPath(K, G, [[R.x - 0.6, R.z - 0.6], [P.x - 4.2, P.z - 5.6], [P.x - 3.6, P.z - 8.7], [P.x - 3.9, P.z - 12.5]]);
    for (let i = 0; i < 16; i++) {
      const a = 2.0 + i * 0.28, rr = 3.1 + i * 0.03, side = i % 2 ? 1 : -1;
      K.quadAt(decal, [P.x + Math.cos(a) * rr + side * 0.07, G + 0.014, P.z + Math.sin(a) * rr], [0, 1, 0], 0.12, 0.28, { uv: K.uv('boot'), color: 0x2c2a27, up: [-Math.sin(a), 0, Math.cos(a)] });
    }
  });
}

// Tyre tracks along a polyline: two ribbons 0.9 m apart, one tread cell per metre.
function trackPath(K, G, pts, gauge = 0.9) {
  const u = K.uv('tread');
  for (let k = 0; k + 1 < pts.length; k++) {
    const [x0, z0] = pts[k], [x1, z1] = pts[k + 1];
    const L = Math.hypot(x1 - x0, z1 - z0), dx = (x1 - x0) / L, dz = (z1 - z0) / L;
    for (let s = 0; s < L - 1e-6; s += 1) {
      const e = Math.min(L, s + 1), f = e - s, c = (s + e) / 2;
      for (const side of [-1, 1]) {
        const px = x0 + dx * c - dz * side * gauge / 2, pz = z0 + dz * c + dx * side * gauge / 2;
        K.quadAt(K.decal, [px, G + 0.014, pz], [0, 1, 0], 0.26, f, { uv: { u0: u.u0, u1: u.u1, v0: u.v0, v1: u.v0 + (u.v1 - u.v0) * f }, color: 0x2d2b28, up: [dx, 0, dz] });
      }
    }
  }
}

// ── North-west: a lattice tower with a red beacon ──
function latticeTower(D, claim) {
  const { K, ctx, beacon } = D;
  const G = ctx.GROUND_Y, lit = K.lit;
  const T = { x: -14, z: -3 }, H = 9, b0 = 0.62, b1 = 0.22, levels = 6;
  claim(T.x, T.z, 2.5);
  ground(D, 'lattice-tower', () => {
    const half = y => lerp(b0, b1, y / H);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) K.tube(lit, [T.x + sx * b0, G, T.z + sz * b0], [T.x + sx * b1, G + H, T.z + sz * b1], 0.035, { seg: 6, color: 0x7b838d });
    for (let i = 0; i < levels; i++) {
      const y0 = (i / levels) * H, y1 = ((i + 1) / levels) * H, h0 = half(y0), h1 = half(y1);
      const c = (sx, sz, y, h) => [T.x + sx * h, G + y, T.z + sz * h];
      for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
        K.tube(lit, c(ax, az, y1, h1), c(bx, bz, y1, h1), 0.017, { seg: 4, color: 0x6f7780 });
        K.tube(lit, c(ax, az, y0, h0), c(bx, bz, y1, h1), 0.014, { seg: 4, color: 0x6f7780 });
      }
    }
    K.box(lit, T.x, G + H + 0.1, T.z, 0.7, 0.2, 0.7, { cell: 'plateDark' });
    K.tube(lit, [T.x, G + H + 0.2, T.z], [T.x, G + H + 1.8, T.z], 0.018, { seg: 5, color: STEEL_L });
    for (const y of [G + H + 0.6, G + H + 1.1]) { K.tube(lit, [T.x - 0.5, y, T.z], [T.x + 0.5, y, T.z], 0.014, { seg: 4, color: STEEL_L }); }
    beacon(T.x, G + H + 1.9, T.z, 0xff2a22, 0.2);
    beacon(T.x, G + H * 0.5, T.z + 0.45, 0xff2a22, 0.1);
  });
}

// ── Rocks: half-buried, flat-shaded, thickest around the base, never in a footprint or under a prop; each one is an object of its own ──
function boulders(D, free0) {
  const { K, ctx, rand } = D;
  const G = ctx.GROUND_Y, C = ctx.center;
  // a window of an outer wall looks out over the plain: no stone of 18 cm or more in the 8 m before it (a boulder two metres out would hide the horizon from the eye)
  const sights = (ctx.windows ?? []).map(q => {
    const F = faceOf(q.b, q.k), [nx, , nz] = F.n;
    const [px, pz] = F.alongX ? [q.s, F.plane] : [F.plane, q.s];
    return { px, pz, nx, nz, hw: q.hw };
  });
  const inSight = (x, z, r) => sights.some(w => { const dx = x - w.px, dz = z - w.pz, along = dx * w.nx + dz * w.nz, across = Math.abs(-dx * w.nz + dz * w.nx); return along > -r && along < 8 && across < w.hw + 0.9 + 0.12 * Math.max(0, along) + r; });
  const free = (x, z, r) => free0(x, z, r) && (r < 0.18 || !inSight(x, z, r));   // (a pebble hides nothing; only the stones from 18 cm of radius keep out)
  // small stones are 20 faces, the big ones 80: a pebble at 10 m is a handful of pixels
  const small = [], big = [];
  for (let i = 0; i < 4; i++) small.push(rockGeo(500 + i * 13, 0, 0.3));
  for (let i = 0; i < 4; i++) big.push(rockGeo(600 + i * 17, 1, 0.27));
  let placed = 0;
  const put = (x, z, r, flat = 0.7) => {
    const pool = r < 0.24 ? small : big, g = pool[(rand() * pool.length) | 0];
    const k = 0.82 + 0.4 * rand(), tone = mixC(0x6a665f, 0x575a60, rand());
    const rot = [(rand() - 0.5) * 0.35, rand() * 6.28, (rand() - 0.5) * 0.35], sc = [r * (0.9 + 0.3 * rand()), r * flat, r * (0.9 + 0.3 * rand())];
    ground(D, `rock@${fx(x)},${fx(z)}`, () => K.put(K.lit, g, { pos: [x, G + r * flat * 0.45, z], rot, scale: sc, cell: 'rock', color: mulC(tone, k * 1.35) }), { buried: true, rock: true });
    placed++;
  };
  // scatter: a ring around the base (6..40 m), dense near, with the occasional big one and a few clusters
  for (let i = 0, tries = 0; i < 110 && tries < 3000; tries++) {
    const a = rand() * Math.PI * 2, d = 6 + Math.pow(rand(), 1.6) * 34;
    const x = C.x + Math.cos(a) * d, z = C.z + Math.sin(a) * d;
    const big = rand() < 0.06, r = big ? 0.5 + rand() * 0.55 : 0.1 + Math.pow(rand(), 2.2) * 0.42;
    if (!free(x, z, r + 0.3)) continue;
    put(x, z, r, big ? 0.72 : 0.65);
    i++;
    if (!big && rand() < 0.2) for (let j = 0; j < 4; j++) { const px = x + (rand() - 0.5) * 1.6, pz = z + (rand() - 0.5) * 1.6, pr = 0.06 + rand() * 0.14; if (free(px, pz, pr)) put(px, pz, pr, 0.6); }
  }
  // the toes of the drifts: small stones that rolled down
  for (const f of ctx.footprints.filter(f => f.kind === 'berm')) {
    for (let i = 0; i < 5; i++) {
      const side = (rand() * 4) | 0, t = rand();
      const x = side === 0 ? lerp(f.x0, f.x1, t) : side === 1 ? lerp(f.x0, f.x1, t) : side === 2 ? f.x0 - 0.15 - rand() * 0.4 : f.x1 + 0.15 + rand() * 0.4;
      const z = side === 2 || side === 3 ? lerp(f.z0, f.z1, t) : side === 0 ? f.z0 - 0.15 - rand() * 0.4 : f.z1 + 0.15 + rand() * 0.4;
      const r = 0.08 + rand() * 0.2;
      if (ctx.clear(x, z, r) && free(x, z, r)) put(x, z, r, 0.6);
    }
  }
  return placed;
}

// ── A string of lamp posts along the track from the pad to the annex, with their pools of light on the ground ──
function lampPosts(D, claim) {
  const { K, ctx } = D;
  const G = ctx.GROUND_Y, lit = K.lit, glow = K.glow;
  const post = (x, z, h = 2.5, face = 0) => {
    claim(x, z, 0.7);
    ground(D, `lamp-post@${fx(x)},${fx(z)}`, () => {
      K.cyl(lit, x, G, z, 0.1, 0.12, { seg: 8, color: STEEL_D });
      K.tube(lit, [x, G, z], [x, G + h, z], 0.03, { seg: 6, color: STEEL_D });
      const ax = x + Math.cos(face) * 0.42, az = z + Math.sin(face) * 0.42;
      K.tube(lit, [x, G + h, z], [ax, G + h + 0.04, az], 0.022, { seg: 5, color: STEEL_D });
      K.cone(lit, [ax, G + h - 0.12, az], 0.13, 0.05, 0.12, { seg: 8, color: STEEL_D });
      K.put(glow, sphereGeo(8, 6), { pos: [ax, G + h - 0.14, az], scale: [0.06, 0.06, 0.06], color: hdr(WHITE_W, 1.7) });
      K.quadAt(glow, [ax, G + 0.012, az], [0, 1, 0], 4.2, 4.2, { uv: K.uv('pool'), color: hdr(AMBER, 0.4) });
    });
  };
  const R = ROVER;
  const line = [[R.x - 4.2, R.z - 3.3], [R.x - 8.4, R.z - 2.4], [R.x - 12.2, R.z - 1.7]];
  line.forEach(([x, z], i) => { if (ctx.clear(x, z, 2.2)) post(x, z, 2.5, i % 2 ? 2.4 : 0.8); });
  post(-3.3, 18.9, 2.6, 3.14);
  post(-3.5, 7.9, 2.6, 3.14);
}

// ── A supply dump: a shipping container, crates, barrels, traffic cones (a cable drum on the western one) ──
function supplyDump(K, ctx, claim, x0, z0, yaw, container) {
  const G = ctx.GROUND_Y, lit = K.lit;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (dx, dz) => [x0 + c * dx - s * dz, z0 + s * dx + c * dz];
  claim(x0, z0, 4.2);
  if (container) {
    const [cx, cz] = at(0, 0);
    K.box(lit, cx, G + 0.65, cz, 2.9, 1.3, 1.2, { yaw: -yaw, cell: 'container', faces: { py: 'plateDark', ny: 'plateDark' } });
    K.box(lit, cx, G + 1.32, cz, 2.94, 0.04, 1.24, { yaw: -yaw, cell: 'plateDark' });
    const [dx, dz] = at(1.46, 0);
    K.box(lit, dx, G + 0.65, dz, 0.06, 1.2, 1.1, { yaw: -yaw, cell: 'plateRust' });
  }
  // crates (one stacked), barrels, cones
  const crates = container ? [[-0.5, 1.45, 0.75, 0.2], [0.55, 1.5, 0.55, -0.1], [1.4, 1.65, 0.6, 0.4]] : [[0.0, 1.6, 0.75, 0.2], [0.0, 2.5, 0.55, -0.1], [1.0, 1.8, 0.6, 0.4]];
  crates.forEach(([dx, dz, sz, rot], i) => {
    const [px, pz] = at(dx, dz);
    K.box(lit, px, G + sz / 2, pz, sz, sz, sz, { yaw: -yaw + rot, cell: 'crate', color: i === 1 ? 0xd8c08a : 0xffffff });
    if (i === 0) K.box(lit, px + 0.03, G + sz + 0.23, pz, 0.45, 0.46, 0.45, { yaw: -yaw + 0.6, cell: 'crate' });
  });
  [[-1.1, -1.5, 0x2a5f8a], [-0.5, -1.7, 0xb5541c], [0.1, -1.55, 0xb5541c], [-0.8, -2.2, 0x2a5f8a]].forEach(([dx, dz, col]) => {
    const [px, pz] = at(dx, dz);
    K.cyl(lit, px, G, pz, 0.27, 0.85, { seg: 10, color: col });
    for (const y of [0.18, 0.62]) K.cyl(lit, px, G + y, pz, 0.285, 0.04, { seg: 10, color: mulC(col, 0.7) });
  });
  for (const [dx, dz] of [[2.1, 1.4], [2.7, 0.7], [2.9, -0.2]]) {
    const [px, pz] = at(dx, dz);
    K.box(lit, px, G + 0.02, pz, 0.34, 0.04, 0.34, { color: 0x1a1b1d });
    K.cone(lit, [px, G + 0.04, pz], 0.14, 0.03, 0.45, { seg: 8, color: 0xe0591c });
    K.cone(lit, [px, G + 0.2, pz], 0.1, 0.07, 0.1, { seg: 8, color: 0xcfd2d4 });
  }
  if (!container) {
    const [px, pz] = at(-1.8, 1.2);
    K.put(lit, new THREE.CylinderGeometry(0.62, 0.62, 0.12, 14), { pos: [px, G + 0.06, pz], color: 0x5a3f22 });
    K.put(lit, new THREE.CylinderGeometry(0.62, 0.62, 0.12, 14), { pos: [px, G + 0.62, pz], color: 0x5a3f22 });
    K.cyl(lit, px, G + 0.12, pz, 0.3, 0.5, { seg: 10, color: 0x2a2d31 });
  }
}
