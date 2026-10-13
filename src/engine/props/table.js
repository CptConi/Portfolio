import { xf } from './kit.js';

// Low coffee table in dark walnut: top slab, four legs, a lower shelf with two books.
//   local frame: origin on the floor at the centre, width along x. The candle that stands on it
//   (Sprites2D.js, yoff = TABLE.h) is lit by its own flicker light.

export const TABLE = { w: 0.85, d: 0.5, h: 0.32 };

const TOP = 0.035;

export function addTable(L, { at, yaw = 0 }) {
  const { solid } = L;
  const { w, d, h } = TABLE;
  solid.push(xf({ pos: [at.x, at.y, at.z], rot: [0, yaw, 0] }));

  solid.box(w, TOP, d, { pos: [0, h - TOP / 2, 0], color: 0x6b4630 });
  solid.box(w + 0.01, 0.012, d + 0.01, { pos: [0, h - TOP - 0.006, 0], color: 0x3f2a1c });   // apron shadow line
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    solid.box(0.04, h - TOP, 0.04, { pos: [sx * (w / 2 - 0.05), (h - TOP) / 2, sz * (d / 2 - 0.05)], color: 0x3a2618 });
  }
  solid.box(w - 0.1, 0.018, d - 0.1, { pos: [0, 0.09, 0], color: 0x4a301f });
  solid.box(0.15, 0.032, 0.11, { pos: [-0.2, 0.115, 0.02], rot: [0, 0.1, 0], color: 0x8a2f2a });
  solid.box(0.13, 0.026, 0.1, { pos: [-0.19, 0.144, 0.02], rot: [0, -0.15, 0], color: 0x2a5a8a });

  solid.pop();
}
