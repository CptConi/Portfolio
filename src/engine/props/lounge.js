import * as THREE from 'three';
import { floorAt, ceilAt } from '../Map.js';
import { SCREENS } from '../Screens.js';
import { Atlas, Batch } from './kit.js';
import { Pix, glowTexture } from './pixels.js';
import { addGuitar, paintGuitar, GUITAR_TEX } from './guitar.js';
import { addAmp, createLedGlow, paintHead, paintCab, HEAD_TEX, CAB_TEX } from './amp.js';
import { addBbq, createBbqFx, paintCoals, paintPuff, COAL_TEX } from './bbq.js';
import { addLamp } from './lamp.js';
import { addSofa } from './sofa.js';
import { addTable } from './table.js';
import { addSign, drawText, signWidth, SIGN_ROWS } from './sign.js';
import { createCat } from './cat.js';
import { createPlant } from './plant.js';
import { LOUNGE } from './placement.js';

const SIGN_TEXT = 'ENVIE D\'ÉCHANGER ?';
const hexScaled = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

export function buildLounge(scene, { reducedMotion = false } = {}) {
  const lit = new Atlas(256);        // Lambert: guitar, amp, sofa…
  const hot = new Atlas(128);        // unlit: coals, the neon sign
  const solid = new Batch(lit);
  const embers = new Batch(hot);     // flickering coals and vents
  const bright = new Batch(hot);     // steady unlit parts (lamp shade, bulb)
  const glow = new Batch(null);      // static additive pools and washes
  const L = { atlas: lit, hot, solid, embers, bright, glow };
  const fx = [];
  const disposables = [];

  const floorY = (x, z) => floorAt(x, z);
  const pool = (x, z, size, hex, k) => glow.quad(size, size, { pos: [x, floorY(x, z) + 0.016, z], rot: [-Math.PI / 2, 0, 0], color: hexScaled(hex, k) });

  // ── Barbecue ──
  const b = LOUNGE.bbq;
  const bbqAt = { x: b.x, y: floorY(b.x, b.z), z: b.z };
  const coalUV = hot.uv(hot.paint(COAL_TEX.w, COAL_TEX.h, paintCoals));
  addBbq(L, { at: bbqAt, yaw: b.yaw, coalUV });
  pool(b.x - 0.25, b.z + 0.2, 1.5, 0xff6a1a, 0.5);
  // Warm wash on the two walls of the corner.
  glow.quad(1.5, 1.1, { pos: [16.99, bbqAt.y + 0.5, b.z + 0.1], rot: [0, -Math.PI / 2, 0], color: hexScaled(0xff7a2a, 0.26) });
  glow.quad(1.5, 1.1, { pos: [b.x - 0.1, bbqAt.y + 0.5, 2.01], color: hexScaled(0xff7a2a, 0.26) });

  // ── Guitar + amp ──
  const g = LOUNGE.guitar;
  const guitarRect = lit.paint(GUITAR_TEX.w, GUITAR_TEX.h, paintGuitar);
  addGuitar(L, { rect: guitarRect, at: { x: g.x, y: floorY(g.x, g.z), z: g.z }, pin: 0.13, yaw: g.yaw, scale: g.scale });
  const a = LOUNGE.amp;
  const rects = { head: lit.paint(HEAD_TEX.w, HEAD_TEX.h, paintHead), cab: lit.paint(CAB_TEX.w, CAB_TEX.h, paintCab) };
  const { led } = addAmp(L, { rects, at: { x: a.x, y: floorY(a.x, a.z), z: a.z }, yaw: a.yaw });

  // ── Neon sign above the CONTACT console ──
  const contact = SCREENS.find(c => c.id === 'contact');
  const signW = signWidth(SIGN_TEXT);
  const signRect = hot.paint(signW, SIGN_ROWS, p => drawText(p, SIGN_TEXT, 0x8fe0ff));
  addSign(L, { rect: signRect, widthPx: signW, at: { x: contact.x, y: floorY(contact.x, 2.0) + 1.12, z: 2.0 }, facing: [0, 1] });

  // ── Lamp, sofa, coffee table ──
  const l = LOUNGE.lamp;
  addLamp(L, { at: { x: l.x, y: floorY(l.x, l.z), z: l.z }, wall: { z: 2.0 }, ceilingY: ceilAt(l.x, l.z) });
  const s = LOUNGE.sofa;
  addSofa(L, { at: { x: s.x, y: floorY(s.x, s.z), z: s.z }, yaw: s.yaw });
  const tb = LOUNGE.table;
  addTable(L, { at: { x: tb.x, y: floorY(tb.x, tb.z), z: tb.z } });

  // ── Meshes ──
  const litTex = lit.texture({ mip: true }), hotTex = hot.texture();
  const glowTex = glowTexture(32);
  const puffPix = new Pix(24, 24); paintPuff(puffPix);
  const puffTex = puffPix.toTexture();
  const solidMat = new THREE.MeshLambertMaterial({ map: litTex, vertexColors: true });
  const embersMat = new THREE.MeshBasicMaterial({ map: hotTex, vertexColors: true });
  const brightMat = new THREE.MeshBasicMaterial({ map: hotTex, vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.5 });
  const glowMat = new THREE.MeshBasicMaterial({ map: glowTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  disposables.push(litTex, hotTex, glowTex, puffTex, solidMat, embersMat, brightMat, glowMat);

  const meshes = [solid.mesh(solidMat), embers.mesh(embersMat), bright.mesh(brightMat), glow.mesh(glowMat, 1)];
  for (const m of meshes) scene.add(m);
  disposables.push(...meshes.map(m => m.geometry));

  const ledGlow = createLedGlow(led, glowTex);
  scene.add(ledGlow.sprite);
  fx.push(ledGlow);

  const bbqFx = createBbqFx(bbqAt, { puffMap: puffTex, glowMap: glowTex, embersMaterial: embersMat });
  scene.add(bbqFx.group);
  fx.push(bbqFx);

  // ── The cat, asleep on its crate ──
  const c = LOUNGE.crate;
  const cat = createCat('sleeping');
  cat.object.position.set(c.x, floorY(c.x, c.z) + c.top, c.z);
  scene.add(cat.object);
  fx.push(cat);

  // ── The plant in the north-west corner ──
  const pl = LOUNGE.plant;
  const plant = createPlant();
  plant.object.position.set(pl.x, floorY(pl.x, pl.z), pl.z);
  scene.add(plant.object);
  disposables.push(plant);

  let calm = reducedMotion;
  return {
    update(t) { for (const f of fx) f.update(t, calm); },
    setReducedMotion(v) { calm = v; },
    dispose() {
      for (const m of meshes) scene.remove(m);
      scene.remove(bbqFx.group, cat.object, ledGlow.sprite, plant.object);
      fx.forEach(f => f.dispose?.());
      disposables.forEach(d => d.dispose?.());
    },
  };
}
