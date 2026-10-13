// NEEMBA THEBRIDGE — a bridge between SAP Ariba and the IRIUM ERP. Orders (orange
// packets) cross the deck, are checked at the control gate (they turn green), and
// acknowledgements (cyan) come back the other way.
import * as THREE from 'three';
import { G, ORANGE, drawText, hexCss, pulse, wrap } from './kit.js';

const BLUE = 0x2f7bff, BLUE_D = 0x16419c, BLUE_L = 0x8fb8ff;
const TEAL = 0x14c8a0, TEAL_D = 0x0b6b58, TEAL_L = 0x7ff5d6;
const DECK = 0x3b4150, DECK_D = 0x262a36;
const CABLE = 0xd9760a;
const WATER = 0x10305a, WATER_L = 0x2a6bb5;
const GREEN = 0x39ff6a, CYAN = 0x37c0ff;

const PYLON_X = 14.5, PYLON_H = 21;
const DECK_Y = G + 10, DECK_TOP = G + 12.4;
const SPAN = 28, SPEED = 6.5, PACKET = 3;
const LETTERS = 5, LETTER_PITCH = 18;                         // label canvas: 5 stacked letters
const LABEL_W = 32, LABEL_H = LETTERS * LETTER_PITCH + 6;      // texels; 5 texels per cm

function pylon(b, x, main, dark) {
  b.box(x, G, 0, 9, 3, 9, dark);
  b.box(x, G + 3, 0, 8, PYLON_H, 8, main);
  b.box(x, G + 3 + PYLON_H, 0, 9, 2, 9, dark);
  b.box(x, G + 5 + PYLON_H, 0, 3, 1, 3, 0x2a2a35);
}

// The name is stacked top to bottom: a pylon is tall and narrow, so 16 px glyphs can be 3.6 cm
// each (~13 screen px at 1.5 m) where a horizontal word would be squeezed to under 2 cm.
function labelPaint(ctx, w, h, text, fg, border) {
  ctx.fillStyle = '#0a0f1c';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = hexCss(border);
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
  for (let i = 0; i < text.length; i++) drawText(ctx, text[i], w / 2, 5 + i * LETTER_PITCH, 16, hexCss(fg), 'center');
}

export function build(kit) {
  const b = kit.main;
  kit.base(b);

  // river under the deck. The deck crosses it, so it flows towards and away from the camera:
  // what reads at eye level is its cross-section, with light wave dashes on both end faces
  // and a few crests poking over the top edge (a surface seen from below shows nothing)
  b.box(0, G, 0, 21, 3, 32, WATER);
  for (const z of [16.05, -16.05]) {
    for (const [x, y, w] of [[-7.5, 0.7, 4], [-0.5, 0.7, 5], [7, 0.7, 3.5], [-3.5, 1.8, 3.5], [3.5, 1.8, 4.5], [-8.5, 2.5, 2]]) b.box(x, G + y, z, w, 0.45, 0.1, WATER_L);
    for (const [x, w] of [[-6, 2.5], [1, 3], [7.5, 2.5]]) b.box(x, G + 3, z - Math.sign(z) * 0.8, w, 0.7, 0.8, WATER_L);
  }

  pylon(b, -PYLON_X, BLUE, BLUE_D);
  pylon(b, PYLON_X, TEAL, TEAL_D);

  // deck and truss, with the lane studs on the deck's side faces (paint on top would be invisible)
  b.box(0, DECK_Y, 0, 26, 2.4, 8, DECK);
  b.box(0, DECK_Y - 1, 0, 23, 1, 5, DECK_D);
  b.box(0, DECK_TOP, 3.7, 23, 0.7, 0.6, DECK_D);
  b.box(0, DECK_TOP, -3.7, 23, 0.7, 0.6, DECK_D);
  for (let x = -9; x <= 9; x += 3) for (const z of [4.05, -4.05]) b.box(x, DECK_Y + 0.9, z, 1.6, 0.6, 0.1, 0xd8dce6);

  // suspension cables with hangers, front and back
  const top = G + 25, mid = G + 16;
  const cableY = x => mid + (top - mid) * (x / 14) * (x / 14);
  for (const z of [3.7, -3.7]) {
    for (let x = -14; x < 14; x += 2) b.beam(x, cableY(x), z, x + 2, cableY(x + 2), z, 0.8, ORANGE);
    for (let x = -9; x <= 9; x += 3) b.box(x, DECK_TOP, z, 0.5, cableY(x) - DECK_TOP, 0.5, CABLE);
  }

  // control gate in mid-span
  for (const z of [3.5, -3.5]) b.box(0, DECK_TOP, z, 1, 8.4, 1, 0x5a6275);
  b.box(0, DECK_TOP + 8.4, 0, 1.2, 1.2, 8, 0x5a6275);

  // labels, readable from both sides of each pylon
  for (const [x, text, fg, border, fb] of [[-PYLON_X, 'ARIBA', BLUE_L, BLUE, BLUE_D], [PYLON_X, 'IRIUM', TEAL_L, TEAL, TEAL_D]]) {
    const surf = kit.surface(LABEL_W, LABEL_H, labelPaint, text, fg, border);
    const p = kit.panel(LABEL_W / 5, LABEL_H / 5, surf, fb, kit.root, 8.4);
    p.position.set(x, G + 13.4, 0);
  }

  // packets
  const orange = kit.shared(ORANGE), green = kit.shared(GREEN);
  const fwd = Array.from({ length: 4 }, () => kit.part(PACKET, PACKET, PACKET, ORANGE));
  const back = Array.from({ length: 2 }, () => kit.part(2.2, 2.2, 2.2, CYAN));
  for (const p of fwd) p.position.z = 1.5;

  // gate light, pylon beacons
  const led = kit.part(2, 1.2, 2, 0x1f6b34, kit.root, true);
  led.position.set(0, DECK_TOP + 10.2, 0);
  const gateGlow = kit.glow(GREEN, 9, 0.2);
  gateGlow.position.copy(led.position);
  const ledDim = new THREE.Color(0x1f6b34), ledBright = new THREE.Color(0x9dffb4);

  const beaconOn = new THREE.Color(ORANGE), beaconOff = new THREE.Color(0x4a2a05);
  const beacons = [-PYLON_X, PYLON_X].map(x => {
    const m = kit.part(1.6, 1.6, 1.6, ORANGE, kit.root, true);
    m.position.set(x, G + 27.8, 0);
    return m;
  });

  return {
    staticT: 2.4,
    pose(t) {
      const y = DECK_TOP + PACKET / 2;
      let gate = 0;
      for (let i = 0; i < fwd.length; i++) {
        const x = -14 + wrap(t * SPEED + i * SPAN / fwd.length, SPAN);
        const p = fwd[i];
        const near = pulse(x, 0, 2.4);
        gate = Math.max(gate, near);
        p.position.x = x;
        p.position.y = y + 0.2 * Math.sin(t * 5 + i * 1.9);
        p.material = x < 0 ? orange : green;
        p.scale.setScalar(PACKET * (1 + 0.3 * near));
        p.rotation.y = near * 0.8;
      }
      for (let i = 0; i < back.length; i++) {
        const p = back[i];
        p.position.set(14 - wrap(t * SPEED * 0.8 + i * SPAN / back.length, SPAN), DECK_TOP + 1.1, -1.5);
      }
      led.material.color.copy(ledDim).lerp(ledBright, gate);
      gateGlow.material.opacity = 0.12 + 0.75 * gate;
      gateGlow.scale.setScalar(7 + 5 * gate);
      const phase = wrap(t, 1.6) < 0.8;
      beacons[0].material.color.copy(phase ? beaconOn : beaconOff);
      beacons[1].material.color.copy(phase ? beaconOff : beaconOn);
    },
  };
}
