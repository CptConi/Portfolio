import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { floorAt, ceilAt } from '../Map.js';
import { Pix, glowTexture } from '../props/pixels.js';
import { softPool, darkPanel, darkWall } from './helpers.js';

// Secret room "PROD": very dark, lit only by the arcade console at the far wall, plus a few things
// that glow on their own — a RUNBOOK DE PROD poster and a "PROD" sign on the south wall, either
// side of the cabinet, and blinking rack LEDs on the west and east walls (the server room behind
// the staging). Everything is unlit meshes and additive planes: no PointLight.
//
// buildSecretRoom(scene) is called once by Decor.js, which has no per-frame hook for it: the
// dressing's animation (sign flicker, status LED, rack LEDs) is exposed through getProdRoom() and
// ticked by features/cats.js. Draw calls added: 6 (poster, sign, racks, cables, wall washes, LEDs).

const FONT = '"Press Start 2P", monospace';
const PINK = 0xff2a9d;

// ── Where things hang (world metres; the room spans x 9..16, z 18..23, floor −0.25, ceiling 0.9) ──
// Both hang on the south wall (face z 23.0, normal −z), 5.5 cm off it: the dark overlay is 2 cm off the wall
// and the additive washes 3.5 cm, so the panels end up in front of both. The poster is 2.0 × 0.9 m so that its
// steps stay readable from the room's middle (see RUNBOOK); its west edge (x 9.8) clears the sightline over the
// crate at (10, 21) from a visitor standing 3 m in front of its centre, and it ends 0.2 m before the cabinet's
// west side (x 12).
const POSTER = { x: 10.8, y: 0.32, z: 22.945, w: 2.0, h: 0.9, facing: [0, -1] };
const SIGN = { x: 14.55, y: 0.36, z: 22.945, w: 1.1, h: 0.4, facing: [0, -1] };
const RACKS = [
  { x: 9.06, z: 21.8, facing: [1, 0] },      // west wall, front at x 9.12
  { x: 15.94, z: 22.0, facing: [-1, 0] },    // east wall, front at x 15.88
];
// A rack is 0.12 m deep (the player's collision margin keeps the visitor 0.2 m off the wall, so it
// needs no collision of its own) and stops 3 cm above the floor.
const RACK = { depth: 0.12, w: 1.0, h: 0.84, base: -0.22 };

// World-space quad on a wall, its front toward `facing` ([fx, fz]); `right` is the viewer's right.
const rightOf = ([fx, fz]) => [fz, -fx];
function quad(w, h, [cx, cy, cz], facing) {
  const g = new THREE.PlaneGeometry(w, h);
  g.rotateY(Math.atan2(facing[0], facing[1]));
  g.translate(cx, cy, cz);
  return g;
}

function canvasTexture(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  paint(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ── RUNBOOK DE PROD poster (640 × 288 texture px, 320 per metre) ──
// The room's house rules, in the SYSTÈME voice: a numbered incident runbook whose last step is the one that
// matters. Press Start 2P is monospace (advance = font size), so each line is sized from its character count:
// the longest step line (16 characters at 32 px = 512 px) leaves 44 px of padding in its band. Sizes are
// multiples of 8, so every font dot lands on whole texture pixels (4 px at 32, 5 px at 40).
// At 640 × 360 and 36° of vertical field of view a texture pixel is 1.73 / d screen pixels (d = metres from the
// wall), so a 32 px glyph cell measures 28 px at 2 m, 22 px at 2.5 m, 18 px at 3 m and 16 px at 3.5 m; the 40 px
// title is a quarter bigger. Nothing smaller is drawn: whatever is on the poster reads from where the visitor stands.
const RUNBOOK = {
  title: 'RUNBOOK DE PROD',
  steps: [
    { n: '1', lines: ['NE PAS PANIQUER'] },
    { n: '2', lines: ['LIRE LES LOGS'] },
    { n: '3', lines: ['NE PAS DÉPLOYER', 'LE VENDREDI SOIR'], warn: true },
  ],
};
const RB = {
  titleFont: 40, titleY: 38, ruleY: 70,
  stepFont: 32, pitch: 36,                       // line pitch of a two-line step
  band: { x: 14, w: 612, top: 84, gap: 10, oneLine: 44, twoLines: 76 },
  badge: 46,                                     // width of the number tab, flush left in its band
  textX: 70,
};
const CYAN = '#37ffe0';
const AMBER = '#ffb52e';

// Diagonal hazard stripes in a clipped rectangle.
function hazard(ctx, x, y, w, h) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = '#120c02';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = AMBER;
  for (let i = -h; i < w; i += 16) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + 8, y + h);
    ctx.lineTo(x + i + 8 + h, y);
    ctx.lineTo(x + i + h, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function paintRunbook(ctx, W, H) {
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#04050c');
  bg.addColorStop(1, '#0b0719');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Blueprint grid, faint.
  ctx.fillStyle = 'rgba(55,255,224,0.05)';
  for (let x = 16; x < W; x += 24) ctx.fillRect(x, 8, 1, H - 16);
  for (let y = 8; y < H; y += 24) ctx.fillRect(8, y, W - 16, 1);

  // Title with a hard offset shadow, so it keeps its edge from a few metres away, then a soft neon halo.
  // (Centred text sits half a dot left of its box: the glyphs leave one empty dot on their right.)
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${RB.titleFont}px ${FONT}`;
  ctx.fillStyle = '#1b87a8';
  ctx.fillText(RUNBOOK.title, W / 2 + 5, RB.titleY + 3);
  ctx.shadowColor = CYAN;
  ctx.shadowBlur = 14;
  ctx.fillStyle = '#9ffcff';
  ctx.fillText(RUNBOOK.title, W / 2 + 2, RB.titleY);
  ctx.shadowBlur = 0;

  // A pink rule under the heading, with its glow.
  const { x: bx, w: bw } = RB.band;
  ctx.fillStyle = 'rgba(255,42,157,0.18)';
  ctx.fillRect(bx, RB.ruleY - 2, bw, 6);
  ctx.fillStyle = 'rgba(255,79,174,0.95)';
  ctx.fillRect(bx, RB.ruleY, bw, 2);

  // The steps: one band each, a number tab on the left and the line(s) on the right.
  let y = RB.band.top;
  for (const { n, lines, warn } of RUNBOOK.steps) {
    const h = lines.length > 1 ? RB.band.twoLines : RB.band.oneLine;
    ctx.fillStyle = warn ? 'rgba(255,181,46,0.10)' : 'rgba(55,255,224,0.07)';
    ctx.fillRect(bx, y, bw, h);
    ctx.strokeStyle = warn ? 'rgba(255,181,46,0.55)' : 'rgba(55,255,224,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, y + 0.5, bw - 1, h - 1);

    if (warn) {
      hazard(ctx, bx, y, RB.badge, h);
      ctx.fillStyle = '#120c02';
      ctx.fillRect(bx + 5, y + h / 2 - 20, RB.badge - 10, 40);
    } else {
      ctx.fillStyle = '#0b2a33';
      ctx.fillRect(bx, y, RB.badge, h);
      ctx.strokeStyle = CYAN;
      ctx.lineWidth = 2;
      ctx.strokeRect(bx + 1, y + 1, RB.badge - 2, h - 2);
    }
    ctx.textAlign = 'center';
    ctx.font = `${RB.stepFont}px ${FONT}`;
    ctx.fillStyle = warn ? '#ffd23a' : '#9ffcff';
    ctx.fillText(n, bx + RB.badge / 2 + 2, y + h / 2);

    ctx.textAlign = 'left';
    ctx.fillStyle = warn ? '#ffd23a' : '#f1ead4';
    lines.forEach((line, i) => ctx.fillText(line, RB.textX, y + h / 2 + (i - (lines.length - 1) / 2) * RB.pitch));
    y += h + RB.band.gap;
  }

  // Frame: a dark steel border and a thin neon line.
  ctx.fillStyle = '#151a28';
  ctx.fillRect(0, 0, W, 3); ctx.fillRect(0, H - 3, W, 3); ctx.fillRect(0, 0, 3, H); ctx.fillRect(W - 3, 0, 3, H);
  ctx.strokeStyle = 'rgba(55,255,224,0.55)'; ctx.lineWidth = 1;
  ctx.strokeRect(5.5, 5.5, W - 11, H - 11);
}

// ── "PROD" sign (352 × 128): a hot pink tube on a black plate; the status dot is a separate quad ──
const SIGN_PX = 320;   // texture pixels per metre
const STATUS = { u: 128, v: 104 };    // status dot centre, in texture pixels
function paintSign(ctx, W, H) {
  ctx.fillStyle = '#07040a';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#ff2a9d'; ctx.lineWidth = 3;
  ctx.strokeRect(4.5, 4.5, W - 9, H - 9);
  ctx.strokeStyle = 'rgba(255,42,157,0.35)'; ctx.lineWidth = 1;
  ctx.strokeRect(10.5, 10.5, W - 21, H - 21);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `64px ${FONT}`;
  ctx.shadowColor = '#ff2a9d';
  ctx.shadowBlur = 18;
  ctx.fillStyle = '#ff4fae';
  ctx.fillText('PROD', W / 2 + 4, 54);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,200,230,0.7)';
  ctx.fillText('PROD', W / 2 + 4, 54);
  ctx.font = `12px ${FONT}`;
  ctx.fillStyle = '#ff9ccf';
  ctx.fillText('EN LIGNE', W / 2 + 14, STATUS.v);
}

// ── Server racks (48 × 40 texture, 1 m × 0.84 m): four 1U units and a patch panel ──
const RACK_TEX = { w: 48, h: 40 };
const UNIT_Y = [3, 12, 21, 30];
// LED sockets, in texture pixels: two per unit, plus the patch panel's ports.
const RACK_LEDS = [
  ...UNIT_Y.flatMap(y => [[5, y + 3], [8, y + 3]]),
  ...[18, 24, 30, 36].map(x => [x, 38]),
];
function paintRack(p) {
  p.rect(0, 0, p.w, p.h, 0x0d0f14);
  p.frame(0, 0, p.w, p.h, 0x2d323e);
  for (const y of UNIT_Y) {
    p.rect(2, y, 44, 7, 0x1c2029);
    p.rect(2, y, 44, 1, 0x2a2f3b);
    for (let x = 14; x < 38; x += 2) { p.set(x, y + 2, 0x0a0c10); p.set(x, y + 4, 0x0a0c10); }
    p.set(5, y + 3, 0x08090c).set(8, y + 3, 0x08090c);
    p.rect(41, y + 1, 4, 5, 0x343a48);
    p.rect(42, y + 2, 2, 3, 0x1c2029);
  }
  p.rect(2, 36, 44, 3, 0x14171e);
  for (const x of [18, 24, 30, 36]) p.set(x, 38, 0x08090c);
}

// A box that is the rack: every face samples the dark top-left texel except the front, which
// shows the whole picture.
function rackGeometry({ x, z, facing }) {
  const g = new THREE.BoxGeometry(RACK.depth, RACK.h, RACK.w);   // x = depth, y = height, z = width
  const front = facing[0] > 0 ? 0 : 1;                           // BoxGeometry face order: +x, −x, +y, −y, +z, −z
  const uv = g.attributes.uv;
  for (let f = 0; f < 6; f++) {
    if (f === front) continue;
    for (let i = 0; i < 4; i++) uv.setXY(f * 4 + i, 0.5 / RACK_TEX.w, 1 - 0.5 / RACK_TEX.h);
  }
  g.translate(x, RACK.base + RACK.h / 2, z);
  return g;
}

// World position of a pixel of the rack's front face.
function rackPoint({ x, z, facing }, u, v) {
  const [rx, rz] = rightOf(facing);
  const along = (u / RACK_TEX.w - 0.5) * RACK.w;
  return [
    x + facing[0] * (RACK.depth / 2 + 0.003) + rx * along,
    RACK.base + RACK.h * (1 - v / RACK_TEX.h),
    z + facing[1] * (RACK.depth / 2 + 0.003) + rz * along,
  ];
}

// ── Cables: three drapes of dark rope ──
function cableGeometry() {
  const tube = pts => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), 28, 0.011, 5, false);
  return mergeGeometries([
    // West wall, hung between two hooks above the electronics.
    tube([[9.07, 0.7, 18.5], [9.07, 0.58, 19.2], [9.07, 0.52, 20.1], [9.07, 0.6, 20.9], [9.07, 0.72, 21.3]]),
    // East wall, the same the other way round.
    tube([[15.93, 0.72, 18.6], [15.93, 0.6, 19.4], [15.93, 0.54, 20.3], [15.93, 0.64, 21.1], [15.93, 0.74, 21.5]]),
    // Power lead from the sign along the wall and down to the east rack. Like every cable, it keeps to the 20 cm
    // strip along the walls that the visitor cannot enter.
    tube([[15.1, 0.44, 22.93], [15.4, 0.3, 22.92], [15.75, 0.14, 22.9], [15.9, 0.02, 22.7], [15.9, -0.05, 22.45]]),
  ]);
}

let prodRoom = null;

// { update(t, calm) } for the PROD dressing, or null before buildSecretRoom() ran. `calm`
// (prefers-reduced-motion): the sign and the LEDs hold a steady state.
export function getProdRoom() { return prodRoom; }

function buildDressing(scene) {
  const own = [];     // textures, geometries and materials to release
  const add = (mesh, order = 0) => { mesh.renderOrder = order; scene.add(mesh); return mesh; };

  // Poster.
  const posterTex = canvasTexture(640, 288, paintRunbook);
  const posterMat = new THREE.MeshBasicMaterial({ map: posterTex });
  const posterGeo = quad(POSTER.w, POSTER.h, [POSTER.x, POSTER.y, POSTER.z], POSTER.facing);
  add(new THREE.Mesh(posterGeo, posterMat));

  // Sign.
  const signTex = canvasTexture(352, 128, paintSign);
  const signMat = new THREE.MeshBasicMaterial({ map: signTex });
  const signGeo = quad(SIGN.w, SIGN.h, [SIGN.x, SIGN.y, SIGN.z], SIGN.facing);
  add(new THREE.Mesh(signGeo, signMat));

  // Additive washes behind both: the room is black, this is what makes them glow on the wall.
  const glowMap = glowTexture(64);
  const wash = (w, h, x, y, hex, k) => {
    const g = quad(w, h, [x, y, POSTER.z + 0.02], POSTER.facing);
    const c = new THREE.Color(hex).multiplyScalar(k);
    const col = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  };
  const washes = [
    wash(2.8, 1.5, POSTER.x, POSTER.y, 0x37c8ff, 0.16),
    wash(2.4, 1.1, POSTER.x, POSTER.y, PINK, 0.07),
    wash(2.3, 1.15, SIGN.x, SIGN.y, PINK, 0.26),
  ];
  const washGeo = mergeGeometries(washes);
  const washMat = new THREE.MeshBasicMaterial({
    map: glowMap, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  add(new THREE.Mesh(washGeo, washMat), 1);   // after the dark overlays, whatever the camera does

  // Racks.
  const rackPix = new Pix(RACK_TEX.w, RACK_TEX.h);
  paintRack(rackPix);
  const rackTex = rackPix.toTexture();
  const rackMat = new THREE.MeshBasicMaterial({ map: rackTex, color: 0x757a88 });
  const rackGeo = mergeGeometries(RACKS.map(rackGeometry));
  add(new THREE.Mesh(rackGeo, rackMat));

  // Blinking LEDs: one quad each, one vertex colour per LED, in a single additive mesh.
  const PALETTE = [0x39ff6a, 0x39ff6a, 0xffb52e, 0xff3b3b, 0x37c0ff];
  const leds = [];
  const ledQuads = [];
  RACKS.forEach((rack, ri) => RACK_LEDS.forEach(([u, v], i) => {
    const k = ri * RACK_LEDS.length + i;
    const color = new THREE.Color(PALETTE[(k * 7 + ri * 3) % PALETTE.length]);
    ledQuads.push(quad(0.03, 0.03, rackPoint(rack, u, v), rack.facing));
    // Each LED has its own rhythm: a period of 0.7–2.9 s and a duty cycle; patch-panel ports flicker faster.
    leds.push({
      color, on: true,
      period: i >= RACK_LEDS.length - 4 ? 0.35 + ((k * 37) % 10) / 40 : 0.7 + ((k * 53) % 23) / 10,
      phase: ((k * 29) % 17) / 17,
      duty: 0.35 + ((k * 11) % 5) / 10,
    });
  }));
  // The sign's status dot: green, slow pulse.
  const dot = new THREE.Color(0x39ff6a);
  const [rx] = rightOf(SIGN.facing);
  const dotPos = [SIGN.x + rx * ((STATUS.u - 176) / SIGN_PX), SIGN.y + (64 - STATUS.v) / SIGN_PX, SIGN.z + SIGN.facing[1] * 0.004];
  ledQuads.push(quad(0.05, 0.05, dotPos, SIGN.facing));
  leds.push({ color: dot, on: true, period: 1.6, phase: 0, duty: 0.7 });

  const ledGeo = mergeGeometries(ledQuads);
  const ledCol = new Float32Array(ledGeo.attributes.position.count * 3);
  ledGeo.setAttribute('color', new THREE.BufferAttribute(ledCol, 3));
  const paintLed = (i, on) => {
    const c = leds[i].color, k = on ? 1.15 : 0.08;
    for (let v = 0; v < 4; v++) ledCol.set([c.r * k, c.g * k, c.b * k], (i * 4 + v) * 3);
  };
  leds.forEach((_, i) => paintLed(i, true));
  const ledMat = new THREE.MeshBasicMaterial({
    map: glowMap, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  add(new THREE.Mesh(ledGeo, ledMat), 2);

  // Cables.
  const cableGeo = cableGeometry();
  const cableMat = new THREE.MeshBasicMaterial({ color: 0x2b1d28 });
  add(new THREE.Mesh(cableGeo, cableMat));

  own.push(posterTex, posterMat, posterGeo, signTex, signMat, signGeo, glowMap, washGeo, washMat, rackTex, rackMat, rackGeo,
    ledGeo, ledMat, cableGeo, cableMat);

  let calmPrev = null;
  return {
    update(t, calm) {
      // Sign: a faint shimmer, and now and then a double dropout like a tired tube.
      let k = 1;
      if (!calm) {
        const f = (t * 0.9) % 13;
        const dip = (f > 12.2 && f < 12.28) || (f > 12.38 && f < 12.43);
        k = (0.93 + 0.07 * Math.sin(t * 2.3)) * (dip ? 0.3 : 1);
      }
      signMat.color.setScalar(k);

      let dirty = false;
      for (let i = 0; i < leds.length; i++) {
        const l = leds[i];
        const on = calm || ((t / l.period + l.phase) % 1) < l.duty;
        if (on === l.on && calm === calmPrev) continue;
        l.on = on;
        paintLed(i, on);
        dirty = true;
      }
      calmPrev = calm;
      if (dirty) ledGeo.attributes.color.needsUpdate = true;
    },
    dispose() { own.forEach(o => o.dispose?.()); },
  };
}

// Secret room — very dark, lit only by the arcade console at the far wall.
export function buildSecretRoom(scene) {
  const AX = 12.5, AZ = 21.4, SCOL = 0xff2a9d;
  const sf = floorAt(12.5, 20.5), sc = ceilAt(12.5, 20.5);  // arcade floor/ceil
  // Dim the whole room: black overlays over floor, ceiling and the 3 solid walls
  // (north wall has the entrance, left lit).
  // Increased opacity to 0.94 for extreme darkness.
  darkPanel(scene, 12.5, 20.5, 7, 5, sf + 0.05, false, 0.94);
  darkPanel(scene, 12.5, 20.5, 7, 5, sc - 0.01, true, 0.94);
  darkWall(scene, 12.5, 23.0, 7, [0, -1], sf, sc, 0.94);    // south wall
  darkWall(scene, 9.0,  20.5, 5, [1, 0],  sf, sc, 0.94);    // west wall
  darkWall(scene, 16.0, 20.5, 5, [-1, 0], sf, sc, 0.94);    // east wall
  // Arcade glow (pool reaches slightly toward the player to the north).
  softPool(scene, SCOL, AX, AZ - 0.25, 1.9, { y: sf + 0.07, opacity: 0.42 });
  softPool(scene, 0x37ffe0, AX, AZ - 0.2, 1.1, { y: sc - 0.015, opacity: 0.5, down: true });

  prodRoom = buildDressing(scene);
}
