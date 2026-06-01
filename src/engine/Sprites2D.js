import * as THREE from 'three';
import { floorAt } from './Map.js';

// 2D billboard props (Freedoom sprites) — camera-facing THREE.Sprites anchored to
// the floor. `bright` props stay full-bright (fire / lit lamps → they bloom);
// others are tinted down to sit in the lit/dark scene. Animated ones cycle frames.
//  tex / frames : TextureManager id(s)   h : world height   ar : width/height
const DEFS = {
  elec:   { tex: 100, h: 1.40, ar: 26 / 128, solid: true },
  barrel: { tex: 101, h: 0.38, ar: 23 / 32,  solid: true },
  col1:   { tex: 102, h: 0.62, ar: 35 / 56,  solid: true },
  col5:   { tex: 103, h: 0.55, ar: 36 / 49,  solid: true },
  cbra:   { tex: 104, h: 0.66, ar: 31 / 61,  solid: true, bright: true, lc: 0xff9a44, li: 6 },
  candle: { tex: 105, h: 0.22, ar: 16 / 19,  solid: false, bright: true, lc: 0xffb060, li: 2.5 },
  lamp:   { tex: 106, h: 0.86, ar: 18 / 80,  solid: true, bright: true, lc: 0xbfe0ff, li: 6 },
  fcan:   { frames: [110, 111, 112], h: 0.70, ar: 25 / 63, solid: true, bright: true, fps: 8, lc: 0xff7a2a, li: 7 },
  tlamp:  { frames: [120, 121, 122, 123], h: 0.62, ar: 16 / 57, solid: true, bright: true, fps: 6, lc: 0x7fd0ff, li: 6 },
};

const SPRITES = [
  // Atrium corners — tall tech pillars
  { x: 9.7, z: 9.7, d: 'elec' },  { x: 15.3, z: 9.7, d: 'elec' },
  { x: 9.7, z: 15.3, d: 'elec' }, { x: 15.3, z: 15.3, d: 'elec' },
  // Armurerie
  { x: 3.5, z: 10.3, d: 'barrel' }, { x: 3.5, z: 14.7, d: 'barrel' },
  { x: 6.8, z: 10.3, d: 'col1' },   { x: 6.8, z: 14.7, d: 'lamp' },
  // Quartiers — warm candelabra + candles on the sides (entry centre kept clear)
  { x: 9.5, z: 6.0, d: 'cbra' }, { x: 15.5, z: 6.0, d: 'cbra' },
  { x: 10.7, z: 6.4, d: 'candle' }, { x: 14.3, z: 6.4, d: 'candle' },
  // Arcade — tech lamps (no fire)
  { x: 10.0, z: 19.0, d: 'tlamp' }, { x: 15.0, z: 19.0, d: 'tlamp' },
];

const spriteW = def => def.h * def.ar;

export function spriteAABBs(margin = 0.1) {
  return SPRITES.filter(s => DEFS[s.d].solid).map(s => {
    const half = spriteW(DEFS[s.d]) / 2 + margin;
    return { minX: s.x - half, maxX: s.x + half, minZ: s.z - half, maxZ: s.z + half };
  });
}

export function buildSprites(scene, tex) {
  const anim = [], lights = [];
  for (const s of SPRITES) {
    const def = DEFS[s.d];
    const fy = floorAt(s.x, s.z);
    const firstTex = def.frames ? tex.get(def.frames[0]) : tex.get(def.tex);
    // Opaque cutout (alphaTest, not transparent): hard edges, correct depth,
    // no half-transparency, no post-process quad artifacts.
    const mat = new THREE.SpriteMaterial({
      map: firstTex, transparent: false, alphaTest: 0.5,
      color: def.bright ? 0xffffff : 0xb0b0b0,
    });
    const spr = new THREE.Sprite(mat);
    spr.center.set(0.5, 0);                       // anchor bottom to the floor
    spr.scale.set(spriteW(def), def.h, 1);
    spr.position.set(s.x, fy, s.z);
    scene.add(spr);
    if (def.frames) anim.push({ mat, frames: def.frames, fps: def.fps });

    // Flickering point light on flares / lit / animated props.
    if (def.lc) {
      const light = new THREE.PointLight(def.lc, def.li, 4.5, 2);
      light.position.set(s.x, fy + def.h * 0.7, s.z);
      scene.add(light);
      lights.push({ light, base: def.li, phase: lights.length * 1.7 });
    }
  }

  return {
    update(t) {
      for (const a of anim) {
        const m = tex.get(a.frames[Math.floor(t * a.fps) % a.frames.length]);
        if (a.mat.map !== m) { a.mat.map = m; a.mat.needsUpdate = true; }
      }
      for (const l of lights) {
        const f = 0.6 + 0.25 * Math.sin(t * 13 + l.phase) + 0.2 * Math.sin(t * 31 + l.phase * 1.7);
        l.light.intensity = l.base * Math.max(0.3, Math.min(1.2, f));
      }
    },
  };
}
