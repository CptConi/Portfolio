import { xf } from './kit.js';

// Two-and-a-half seat sofa in teal fabric: dark frame, three seat cushions, three back
// cushions, rolled arms, a mustard scatter cushion. 0.46 m high: only its front is readable,
// so the seams between the cushions carry the detail.
//   local frame: front toward +z, length along x, origin on the floor at the centre of the base

const SOFA = { w: 1.5, d: 0.5 };

const FRAME = 0x2c211e, TEAL = 0x2a6e78, TEAL_LIGHT = 0x347f89, TEAL_DARK = 0x1d525b, SEAM = 0x0e2226, MUSTARD = 0xcf8f26;

export function addSofa(L, { at, yaw = 0 }) {
  const { solid } = L;
  const { w, d } = SOFA;
  solid.push(xf({ pos: [at.x, at.y, at.z], rot: [0, yaw, 0] }));

  // Frame and feet.
  solid.box(w, 0.1, d, { pos: [0, 0.1, 0], color: FRAME });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) solid.box(0.04, 0.05, 0.04, { pos: [sx * (w / 2 - 0.05), 0.025, sz * (d / 2 - 0.05)], color: 0x120d0b });

  // Arms: a block topped with a roll.
  const arm = 0.12;
  for (const sx of [-1, 1]) {
    solid.box(arm, 0.2, d, { pos: [sx * (w / 2 - arm / 2), 0.25, 0], color: TEAL_DARK });
    solid.cyl(0.055, 0.055, d, 10, { pos: [sx * (w / 2 - arm / 2), 0.35, d / 2], rot: [-Math.PI / 2, 0, 0], color: TEAL_DARK });
  }

  // Backrest frame and three back cushions leaning a little.
  const inner = w - 2 * arm;
  solid.box(inner, 0.28, 0.1, { pos: [0, 0.29, -d / 2 + 0.05], color: TEAL_DARK });
  const bw = (inner - 0.016) / 3;
  for (let k = 0; k < 3; k++) {
    solid.box(bw - 0.008, 0.2, 0.09, { pos: [(k - 1) * (bw + 0.004), 0.33, -d / 2 + 0.14], rot: [-0.14, 0, 0], color: TEAL_LIGHT });
  }

  // Three seat cushions, seams in between.
  const sd = d - 0.1 - 0.02;
  for (let k = 0; k < 3; k++) {
    solid.box(bw - 0.008, 0.095, sd, { pos: [(k - 1) * (bw + 0.004), 0.205, 0.05], color: TEAL });
  }
  solid.box(inner, 0.02, sd + 0.01, { pos: [0, 0.155, 0.05], color: SEAM });

  // Scatter cushion in the corner against the left arm.
  solid.box(0.15, 0.15, 0.055, { pos: [-w / 2 + arm + 0.1, 0.33, -0.05], rot: [-0.3, 0.45, 0.1], color: MUSTARD });

  solid.pop();
}

// Footprint of the sofa for collision: the base rectangle in world axes (yaw a multiple of π/2).
export function sofaFootprint(at, yaw) {
  const quarter = Math.abs(Math.round(yaw / (Math.PI / 2))) % 2 === 1;
  const hx = (quarter ? SOFA.d : SOFA.w) / 2, hz = (quarter ? SOFA.w : SOFA.d) / 2;
  return { minX: at.x - hx, maxX: at.x + hx, minZ: at.z - hz, maxZ: at.z + hz };
}
