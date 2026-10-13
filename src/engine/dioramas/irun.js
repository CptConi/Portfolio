// IRUN — a PWA on Zebra scanners for warehouse stock movements. A rugged handheld
// hovers in front of a pallet and sweeps a red scan line over a box label; every
// third sweep the label flashes green: movement recorded.
import * as THREE from 'three';
import { G, ORANGE, wrap } from './kit.js';

const CARD = 0xb98a4e, CARD_D = 0x9a6f3a, TAPE = 0xd9c196;
const WOOD = 0x7a5a36, WOOD_D = 0x5a4126;
const RACK = 0x2756c8;
const BODY = 0x2b2f3a, YELLOW = 0xffc800;
const RED = 0xff2a2a, CYAN = 0x2ee6ff, GREEN = 0x39ff6a;

const LABEL = { x: -4.6, y: G + 6.8, z: 4.05, w: 6.4, h: 4.2 };
const BARS = [0.5, 0.3, 0.6, 0.3, 0.4, 0.6, 0.3];     // bar widths (cm); gaps are constant
const BAR_GAP = 0.45;
const T = 5.4;
const SWEEP = 1.55;

const tri = x => 1 - Math.abs(2 * (x - Math.floor(x)) - 1);

export function build(kit) {
  const b = kit.main;
  kit.base(b);

  // ── pallet + boxes ──
  for (const dx of [-7.5, 0, 7.5]) b.box(-9 + dx, G, -3, 2.4, 1.3, 14, WOOD_D);
  b.box(-9, G + 1.3, -3, 18.6, 1.2, 14, WOOD);
  const deck = G + 2.5;
  for (const [x, z] of [[-13.4, -6.6], [-4.6, -6.6], [-13.4, 0.6], [-4.6, 0.6]]) b.box(x, deck, z, 8.4, 8.5, 6.8, CARD);
  b.box(-13.4, deck + 8.5, -3, 8.2, 6.5, 10, CARD_D);
  b.box(-4.6, deck + 8.5, -3, 8.2, 5.6, 10, CARD);
  b.box(-13.4, deck, 4.02, 1.2, 8.5, 0.1, TAPE);
  b.box(-13.4, deck + 8.5, 2.02, 1.2, 6.5, 0.1, TAPE);
  b.box(-4.6, deck + 8.5, 2.02, 1.2, 5.6, 0.1, TAPE);

  // label with barcode, centred on the label
  b.box(LABEL.x, LABEL.y - LABEL.h / 2, LABEL.z, LABEL.w, LABEL.h, 0.12, 0xdadde6);
  BARS.reduce((x, w) => {
    b.box(x + w / 2, LABEL.y - 1.3, LABEL.z + 0.08, w, 2.6, 0.1, 0x14141c);
    return x + w + BAR_GAP;
  }, LABEL.x - (BARS.reduce((a, w) => a + w, 0) + BAR_GAP * (BARS.length - 1)) / 2);

  // rack bay behind the pallet
  for (const x of [-18.4, 1]) b.box(x, G, -12.5, 2, 30, 2, RACK);
  for (const y of [12, 24]) b.box(-8.7, G + y, -12.5, 21.4, 1.4, 2, ORANGE);
  b.box(-14, G + 25.4, -12.5, 6, 5, 4.4, CARD);
  b.box(-6.5, G + 25.4, -12.5, 7, 4, 4.4, CARD_D);
  b.box(-12, G + 13.4, -12.5, 7, 5.5, 4.4, CARD_D);
  b.box(-3.5, G + 13.4, -12.5, 5, 4, 4.4, CARD);

  // ── scanner (own frame so it can hover and tilt) ──
  const scanner = new THREE.Group();
  scanner.rotation.order = 'YZX';
  scanner.position.set(11, G + 16, 8);
  scanner.scale.setScalar(0.85);
  kit.root.add(scanner);
  const sb = kit.batch(scanner);
  sb.box(0, -4, 0, 10.4, 4, 5.6, BODY);
  sb.box(-5.7, -5.2, 0, 1.8, 5.2, 6.4, YELLOW);
  sb.box(-6.7, -3.6, 0, 0.3, 2.4, 4.2, RED);
  sb.box(0.6, -3.5, 0, 5.4, 3, 5.8, 0x0b0f18);                          // status display bezel, both sides
  sb.box(2.2, -12.4, 0, 3.6, 8.6, 4.6, BODY, { rz: 0.18 });
  sb.box(-0.4, -9.2, 0, 1, 2.6, 1.4, YELLOW);
  // The status display faces sideways: the visitor's eye is below the scanner and never sees its top.
  const display = kit.panel(5, 2.6, null, CYAN, scanner, 6.1);
  display.position.set(0.6, -2, 0);
  const screenMat = display.material;

  // aperture position in the diorama frame (refreshed every pose)
  const ap = new THREE.Vector3();
  const APERTURE = new THREE.Vector3(-6.9, -2.4, 0);

  // beam: one triangle from the aperture to the scan line
  const beamPos = new Float32Array(9);
  const beamGeo = kit.track(new THREE.BufferGeometry());
  const beamAttr = new THREE.BufferAttribute(beamPos, 3).setUsage(THREE.DynamicDrawUsage);
  beamGeo.setAttribute('position', beamAttr);
  beamGeo.setIndex([0, 1, 2]);
  const beamMat = kit.glowMat(RED, 0.4, { side: THREE.DoubleSide });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  kit.bound(beam);
  kit.root.add(beam);

  const bar = kit.part(LABEL.w - 0.4, 0.5, 0.3, RED, kit.root, true);
  bar.position.set(LABEL.x, LABEL.y, LABEL.z + 0.3);
  const hit = kit.glow(RED, 7, 0.5);
  const flash = kit.plane(LABEL.w, LABEL.h, kit.glowMat(GREEN, 0), kit.root);
  flash.position.set(LABEL.x, LABEL.y, LABEL.z + 0.25);
  const apGlow = kit.glow(RED, 6, 0.6);

  const cyan = new THREE.Color(CYAN), green = new THREE.Color(GREEN);

  return {
    staticT: 0.8,
    pose(t) {
      const s = wrap(t, T);
      const scanning = s < 4.45;
      const ok = s >= 4.45 && s < 5.2 ? 1 - (s - 4.45) / 0.75 : 0;

      scanner.position.y = G + 16 + 0.5 * Math.sin(t * 1.7);
      scanner.rotation.set(0, -0.32 + 0.04 * Math.sin(t * 0.9), 0.39 + 0.02 * Math.sin(t * 1.3));
      scanner.updateMatrix();
      ap.copy(APERTURE).applyMatrix4(scanner.matrix);

      const yScan = LABEL.y + (tri(s / SWEEP) - 0.5) * (LABEL.h - 0.8);
      const half = (LABEL.w - 0.4) / 2;
      bar.visible = hit.visible = beam.visible = scanning;
      bar.position.y = yScan;
      hit.position.set(LABEL.x, yScan, LABEL.z + 0.6);
      hit.material.opacity = 0.45 + 0.1 * Math.sin(t * 9);
      beamPos[0] = ap.x; beamPos[1] = ap.y; beamPos[2] = ap.z;
      beamPos[3] = LABEL.x - half; beamPos[4] = yScan; beamPos[5] = LABEL.z + 0.3;
      beamPos[6] = LABEL.x + half; beamPos[7] = yScan; beamPos[8] = LABEL.z + 0.3;
      beamAttr.needsUpdate = true;

      apGlow.position.copy(ap);
      apGlow.material.opacity = scanning ? 0.55 : 0.1;

      flash.material.opacity = 0.55 * ok;
      flash.visible = ok > 0;
      screenMat.color.copy(ok > 0 ? green : cyan);
    },
  };
}
