// TBE — mobile bottling trucks serving wine estates, every bottling operation tracked
// in an app. A truck feeds a conveyor, bottles ride through a scan gate (the LED
// blinks, the phone above counts them) and sink into a crate. Vines in the back.
import * as THREE from 'three';
import { G, drawText, hexCss, pulse, wrap } from './kit.js';

const WINE = 0x8a1e3e, WINE_D = 0x5e1228, CREAM = 0xe9dcc0;
const GLASS = 0x7fd3ff, TIRE = 0x15151c, HUB = 0xb8b8c4, DARK = 0x20222c;
const STEEL = 0x59606e, STEEL_D = 0x3a3f4b, BELT = 0x23262e;
const WOOD = 0x9a6b3c, WOOD_D = 0x6b4526, VINE = 0x3f9a45, VINE_D = 0x2b6f33;
const BOTTLE = 0x1f8a47, BOTTLE_LABEL = 0xf1e3c8, FOIL = 0xe3b341;

const BELT_Y = G + 5.5;
const BELT_END = 14;
const GATE_X = 8;
const N = 6, PITCH = 3.3, LOOP = N * PITCH, SPEED = 5;
const MARKS = 8;
const BELT_Z = 2;                                       // half width of the belt
const SCAN = (GATE_X + 3) % PITCH;                       // belt phase (cm) at which a bottle crosses the gate

function wheel(b, x, z) {
  b.cyl(x, G + 3.2 - 1.1, z, 3.2, 3.2, 2.2, TIRE, 10, { rx: Math.PI / 2 });
  b.cyl(x, G + 3.2 - 1.2, z, 1.5, 1.5, 2.4, HUB, 8, { rx: Math.PI / 2 });
}

function plateLabel(ctx, w, h) {
  ctx.fillStyle = hexCss(WINE);
  ctx.fillRect(0, 0, w, h);
  drawText(ctx, 'TBE', w / 2, (h - 16) / 2 + 1, 16, hexCss(CREAM), 'center');
}

// Big count, progress pips and a drawn tick: anything finer than a 16 px glyph is lost at distance.
function phonePaint(ctx, w, h, count) {
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ff8c00';
  ctx.fillRect(0, 0, w, 10);
  drawText(ctx, String(count).padStart(2, '0'), w / 2, 22, 16, '#ffffff', 'center');
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i <= count % 5 ? '#39ff6a' : '#1d2a40';
    ctx.fillRect(5 + i * 8, 48, 6, 6);
  }
  ctx.fillStyle = '#39ff6a';
  for (const [x, y] of [[12, 68], [14, 70], [16, 72], [18, 74], [20, 72], [22, 70], [24, 68], [26, 66], [28, 64], [30, 62], [32, 60]]) ctx.fillRect(x, y, 4, 4);
}

export function build(kit) {
  const b = kit.main;
  kit.base(b);

  // ── truck (cab on the left, cargo box, open rear feeding the conveyor) ──
  b.box(-9.75, G + 2.2, 0, 19.5, 1.2, 12, DARK);
  b.box(-6.75, G + 3.4, 0, 13.5, 15, 14, CREAM);
  for (const z of [7.1, -7.1]) b.box(-6.75, G + 8.2, z, 13.6, 2.4, 0.2, WINE);
  b.box(-16.25, G + 3.4, 0, 5.5, 10, 13.4, WINE);
  b.box(-16.25, G + 13.4, 0, 5.9, 0.8, 13.8, WINE_D);
  b.box(-19.05, G + 8.4, 0, 0.2, 4, 10.4, GLASS);
  for (const z of [6.8, -6.8]) b.box(-16.6, G + 8.4, z, 3.4, 4, 0.2, GLASS);
  b.box(-19.4, G + 2.4, 0, 1, 1.6, 13.6, DARK);
  for (const z of [4.6, -4.6]) b.box(-19.1, G + 4.8, z, 0.3, 1.6, 2, 0xfff3b0);
  b.box(0.1, G + 3.6, 0, 0.4, 9, 11, DARK);                                 // open rear hatch
  b.cyl(-6.5, G + 18.4, 0, 3.2, 3.2, 3.8, STEEL, 10);                         // wine tank on the roof
  b.cyl(-6.5, G + 22.2, 0, 1.2, 3.2, 1.2, STEEL_D, 10);
  for (const x of [-16, -7, -3.5]) for (const z of [6.2, -6.2]) wheel(b, x, z);

  // ── conveyor: the belt's side faces carry the moving ticks (a mark on its top would be invisible) ──
  b.box(BELT_END / 2, G + 3.5, 0, BELT_END, 0.8, 4.6, STEEL_D);
  b.box(BELT_END / 2, G + 4.3, 0, BELT_END, 1.2, BELT_Z * 2, BELT);
  for (const z of [2.2, -2.2]) b.box(BELT_END / 2, BELT_Y, z, BELT_END, 0.8, 0.5, STEEL);
  for (const x of [2, 7.2, 12.4]) for (const z of [1.8, -1.8]) b.box(x, G, z, 0.8, 3.5, 0.8, STEEL_D);

  // scan gate
  for (const z of [2.4, -2.4]) b.box(GATE_X, BELT_Y, z, 0.9, 10, 0.9, STEEL);
  b.box(GATE_X, BELT_Y + 10, 0, 0.9, 0.9, 5.7, STEEL);

  // crate at the end of the line
  b.box(16.4, G, 0, 4.8, 10, 8, WOOD);
  for (const y of [2.2, 5.4, 8.4]) b.box(16.4, G + y, 4.02, 4.8, 0.45, 0.1, WOOD_D);
  b.box(16.4, G + 10, 0, 4.9, 0.5, 8.4, WOOD_D);

  // vines: kept inside the chamfered tile (x + |z| <= 33) so they never overhang a plinth
  for (const [x, z, s] of [[3, -12, 1], [7.5, -12, 1], [12, -12, 1], [16.3, -12, 1], [4.5, -16, 0.85], [9, -16, 0.85], [13.2, -16, 0.85]]) {
    b.box(x, G, z, 0.8, 8 * s, 0.8, WOOD_D);
    b.box(x, G + 3.2 * s, z, 4.4 * s, 4.2 * s, 3.4 * s, VINE);
    b.box(x, G + 6.2 * s, z, 3 * s, 1.6 * s, 2.6 * s, VINE_D);
  }
  b.box(9.6, G + 7, -12, 15.2, 0.4, 0.4, STEEL);

  // truck label, both sides
  const plate = kit.panel(11, 4.125, kit.surface(64, 24, plateLabel), WINE, kit.root, 14.3);
  plate.position.set(-6.75, G + 13.6, 0);

  // ── bottles (one instanced draw call) + belt ticks, one pair per mark (front and back face) ──
  const bb = kit.batch(null);
  bb.cyl(0, 0, 0, 1.15, 1.15, 4.2, BOTTLE, 8);
  bb.cyl(0, 1.3, 0, 1.2, 1.2, 1.5, BOTTLE_LABEL, 8);
  bb.cyl(0, 4.2, 0, 0.55, 1.15, 1.1, BOTTLE, 8);
  bb.cyl(0, 5.3, 0, 0.55, 0.55, 2.2, BOTTLE, 8);
  bb.cyl(0, 7.5, 0, 0.7, 0.7, 0.9, FOIL, 8);
  const bottles = kit.instances(kit.geometryOf(bb), N);

  const mb = kit.batch(null);
  mb.box(0, 0, BELT_Z + 0.06, 0.7, 0.9, 0.12, 0x8d95a8);
  mb.box(0, 0, -BELT_Z - 0.06, 0.7, 0.9, 0.12, 0x8d95a8);
  const marks = kit.instances(kit.geometryOf(mb), MARKS);

  const dummy = new THREE.Object3D();

  // gate LED + glow
  const led = kit.part(1.8, 1, 1.8, 0x1f6b34, kit.root, true);
  led.position.set(GATE_X, BELT_Y + 10.9, 0);
  const ledGlow = kit.glow(0x39ff6a, 8, 0.15);
  ledGlow.position.copy(led.position);
  const ledDim = new THREE.Color(0x1f6b34), ledBright = new THREE.Color(0x9dffb4);

  // phone
  const phone = new THREE.Group();
  phone.position.set(GATE_X, G + 25, 0);
  kit.root.add(phone);
  kit.part(9, 14.6, 1.2, 0x202233, phone);
  const screenSurf = kit.surface(48, 84, phonePaint, 0);
  const screen = kit.panel(7.4, 12.95, screenSurf, 0x0b1220, phone);
  screen.position.z = 0.65;
  const phoneGlow = kit.glow(0x39ff6a, 20, 0.14);
  phoneGlow.position.set(GATE_X, G + 25, -2);

  let lastCount = -1;

  return {
    staticT: 3.1,
    pose(t) {
      let near = 0;
      for (let i = 0; i < N; i++) {
        const x = -3 + wrap(t * SPEED + i * PITCH, LOOP);
        const sink = x > BELT_END ? Math.min(5, (x - BELT_END) * 3.2) : 0;
        dummy.position.set(x, BELT_Y - sink, 0);
        dummy.updateMatrix();
        bottles.setMatrixAt(i, dummy.matrix);
        near = Math.max(near, pulse(x, GATE_X, 1.1));
      }
      bottles.instanceMatrix.needsUpdate = true;

      for (let i = 0; i < MARKS; i++) {
        dummy.position.set(wrap(t * SPEED + i * (BELT_END / MARKS), BELT_END), G + 4.9, 0);
        dummy.updateMatrix();
        marks.setMatrixAt(i, dummy.matrix);
      }
      marks.instanceMatrix.needsUpdate = true;

      led.material.color.copy(ledDim).lerp(ledBright, near);
      ledGlow.material.opacity = 0.1 + 0.8 * near;
      ledGlow.scale.setScalar(6 + 6 * near);

      phone.position.y = G + 25 + 0.8 * Math.sin(t * 1.6);
      phone.rotation.y = 0.28 * Math.sin(t * 0.7);
      phoneGlow.position.y = phone.position.y;

      // one more bottle counted each time one crosses the scan gate
      const count = Math.floor((t * SPEED - SCAN) / PITCH + 1) % 100;
      if (count !== lastCount) {
        lastCount = count;
        screenSurf?.paint(count);
      }
    },
  };
}
