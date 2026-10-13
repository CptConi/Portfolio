// Sector mood — every room gets its own temperature.
//
//   SECTOR_MOOD / moodOf(type)   per Map.js sector type: the floor texture and the surface tints the
//                                renderer bakes into floors, ceilings, walls and ceiling lamps, plus
//                                the ambient light and fog the room settles into.
//   create(ctx)                  on 'sector:enter' eases scene.fog and the ambient light toward the
//                                room's mood in ~0.6 s; prefs.reducedMotion applies it instantly.
//                                Also gives the sealed push-wall mesh the atrium's wall tint.
//
// Atrium cold blue-grey, armurerie metallic green, trophées a darker amber (the unlit frames and
// dioramas pop against it), quartiers warm wood. Vestibules and the secret room keep the neutral
// look the renderer was built with, which is also what the vestibule floors keep.
//
// Everything tunable lives in the table below. A surface tint is a hue (sRGB hex) and a brightness
// relative to the untinted material (1 = unchanged); it is normalised to the hue's luminance so a
// hue never changes the brightness by accident. Dark base textures take a brightness above 1.
//
// Listens to: game:start, sector:enter { type }. Emits nothing.
import * as THREE from 'three';
import { prefs } from '../engine/prefs.js';

const BASE_AMBIENT = 0.6;     // the neutral ambient intensity the renderer is built with
const EASE_TAU = 0.2;         // s; 95 % of the way after ~0.6 s

const luminance = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

// [r, g, b] linear multiplier for a surface.
function tint(hue, bright = 1) {
  const c = new THREE.Color(hue);
  const k = bright / luminance(c);
  return [c.r * k, c.g * k, c.b * k];
}

// Ambient light of a given hue whose luminance is `bright` × the neutral ambient.
function ambient(hue, bright = 1) {
  return { color: hue, intensity: BASE_AMBIENT * bright / luminance(new THREE.Color(hue)) };
}

const NEUTRAL = {
  floorTex: 40,                       // FLOOR78
  floor: [1, 1, 1], ceil: [1, 1, 1], wall: [1, 1, 1], lamp: [1, 1, 1],
  ambient: null, fog: null,           // null → what the renderer was built with
};

export const SECTOR_MOOD = {
  // Atrium — cold blue-grey, airy.
  6: {
    floorTex: 40,                     // FLOOR78 concrete tiles
    floor: tint(0xd0dcee, 1.0), ceil: tint(0xd0dcee, 1.0), wall: tint(0xd0dcee, 1.0), lamp: tint(0xbfd8ff, 1.0),
    ambient: ambient(0xdce5f4, 0.97),
    fog: { color: 0x101c2a, near: 2.5, far: 22 },
  },
  // Armurerie — metallic green, a tighter room.
  2: {
    floorTex: 56,                     // METALT1 dark metal panels (very dark: boosted)
    floor: tint(0xd0e8d6, 2.4), ceil: tint(0xd2ecd8, 1.0), wall: tint(0xd2ecd8, 1.0), lamp: tint(0xb8ffc8, 1.0),
    ambient: ambient(0xdcf0e0, 1.0),
    fog: { color: 0x08150d, near: 2, far: 16 },
  },
  // Trophées — darker amber so the lit frames and dioramas carry the room.
  3: {
    floorTex: 41,                     // CNCRT1 plain concrete
    floor: tint(0xf2d9b8, 0.8), ceil: tint(0xf2d9b8, 0.75), wall: tint(0xf2d9b8, 0.85), lamp: tint(0xffc880, 0.9),
    ambient: ambient(0xf8e4cc, 0.8),
    fog: { color: 0x150c03, near: 1.8, far: 13 },
  },
  // Quartiers — warm: wood boards underfoot, wood-grain panelling.
  4: {
    floorTex: 8,                      // CREEPNL0 brown boards
    floor: tint(0xf2d6b8, 1.1), ceil: tint(0xf0d0b0, 0.9), wall: tint(0xe8b888, 1.15), lamp: tint(0xffc890, 1.0),
    ambient: ambient(0xf8dcc0, 0.95),
    fog: { color: 0x180d06, near: 1.8, far: 14 },
  },
};

// Types without a mood (vestibules 0, the secret room 5, the push-wall slot 1) are neutral.
export const moodOf = type => SECTOR_MOOD[type] ?? NEUTRAL;

const ATRIUM = 6;

// The sealed push-wall is a mesh of its own, outside the renderer's instanced walls, so it gets the
// atrium's wall tint here: on its atrium-facing side it has to match the walls it sits between.
// Multiplies whatever shading PushWall.js baked in; returns the undo.
function tintPushWall(mesh) {
  const col = mesh?.geometry.attributes.color, nor = mesh?.geometry.attributes.normal;
  if (!col || !nor) return () => {};
  const base = col.array.slice();
  const [r, g, b] = moodOf(ATRIUM).wall;
  for (let i = 0; i < col.count; i++) {
    if (nor.getZ(i) < -0.5) col.setXYZ(i, base[i * 3] * r, base[i * 3 + 1] * g, base[i * 3 + 2] * b);
  }
  col.needsUpdate = true;
  return () => { col.array.set(base); col.needsUpdate = true; };
}

export function create({ scene, renderer, events, pushwall }) {
  const light = renderer.ambient, fog = scene.fog;
  if (!light || !fog) return undefined;
  const untintPushWall = tintPushWall(pushwall?.mesh);

  const target = (a, f) => ({ ac: new THREE.Color(a.color), ai: a.intensity, fc: new THREE.Color(f.color), near: f.near, far: f.far });
  const neutral = { ac: light.color.clone(), ai: light.intensity, fc: fog.color.clone(), near: fog.near, far: fog.far };
  const targets = {};
  for (const [type, m] of Object.entries(SECTOR_MOOD)) targets[type] = target(m.ambient, m.fog);
  const targetOf = type => targets[type] ?? neutral;

  let goal = neutral;
  let settled = true;

  // Distance left to travel, over every eased value.
  const gap = () =>
    Math.abs(goal.ai - light.intensity) + Math.abs(goal.near - fog.near) + Math.abs(goal.far - fog.far) +
    Math.abs(goal.ac.r - light.color.r) + Math.abs(goal.ac.g - light.color.g) + Math.abs(goal.ac.b - light.color.b) +
    Math.abs(goal.fc.r - fog.color.r) + Math.abs(goal.fc.g - fog.color.g) + Math.abs(goal.fc.b - fog.color.b);

  const snap = () => {
    light.color.copy(goal.ac); light.intensity = goal.ai;
    fog.color.copy(goal.fc); fog.near = goal.near; fog.far = goal.far;
    settled = true;
  };

  // The visitor spawns in the atrium: start there rather than easing out of the neutral look.
  goal = targetOf(ATRIUM);
  snap();

  // A start that lands straight in another room (deep link) must not fade in either.
  let snapNext = true;

  const off = [
    events.on('game:start', () => { snapNext = true; }),
    events.on('sector:enter', ({ type } = {}) => {
      if (type === 1) return;            // inside the sealed push-wall slot: keep the room we came from
      goal = targetOf(type);
      settled = false;
      if (snapNext || prefs.reducedMotion) snap();
      snapNext = false;
    }),
  ];

  return {
    update({ dt }) {
      if (settled) return;
      const k = 1 - Math.exp(-Math.min(dt, 0.1) / EASE_TAU);
      light.color.lerp(goal.ac, k);
      light.intensity += (goal.ai - light.intensity) * k;
      fog.color.lerp(goal.fc, k);
      fog.near += (goal.near - fog.near) * k;
      fog.far += (goal.far - fog.far) * k;
      if (gap() < 1e-3) snap();
    },
    dispose() {
      for (const unsubscribe of off) unsubscribe();
      untintPushWall();
      goal = neutral;
      snap();
    },
  };
}
