import * as THREE from 'three';
import { xf } from './kit.js';

// Floor lamp: brass pole on a round foot, a warm paper shade lit from inside. The shade and
// the bulb are unlit geometry (they bloom); the light on the wall, ceiling and floor is faked
// with additive washes: no PointLight.

export const LAMP = { poleH: 0.78, shadeH: 0.17, rTop: 0.07, rBot: 0.115 };
const SHADE_LOW = new THREE.Color(0xffe2b0).multiplyScalar(1.15);
const SHADE_HIGH = new THREE.Color(0xff9d4a);

// `L.solid` gets the foot and pole, `L.bright` the shade and bulb, `L.glow` the washes.
//   at   { x, y, z } floor point     wall  { z, side } optional: the wall behind (north wall z = 2)
export function addLamp(L, { at, wall = null, ceilingY = null }) {
  const { solid, bright, glow } = L;
  solid.push(xf({ pos: [at.x, at.y, at.z] }));
  bright.push(xf({ pos: [at.x, at.y, at.z] }));

  solid.cyl(0.075, 0.085, 0.014, 14, { color: 0x4a3a1e });
  solid.cyl(0.03, 0.05, 0.02, 12, { pos: [0, 0.014, 0], color: 0x6a5226 });
  solid.cyl(0.008, 0.008, LAMP.poleH, 8, { pos: [0, 0.03, 0], color: 0xb08a3a });
  solid.cyl(0.018, 0.018, 0.03, 8, { pos: [0, LAMP.poleH, 0], color: 0x6a5226 });

  const y0 = LAMP.poleH + 0.02, h = LAMP.shadeH;
  const shade = new THREE.CylinderGeometry(LAMP.rTop, LAMP.rBot, h, 16, 1, true).translate(0, y0 + h / 2, 0);
  bright.add(shade, { color: (x, y) => SHADE_LOW.clone().lerp(SHADE_HIGH, Math.min(1, Math.max(0, (y - at.y - y0) / h))) });
  bright.add(new THREE.SphereGeometry(0.032, 8, 6), { matrix: xf({ pos: [0, y0 + 0.055, 0] }), color: new THREE.Color().setRGB(1.6, 1.45, 1.1) });
  bright.pop();
  solid.pop();

  // Light on the surfaces nearby.
  const warm = hex => new THREE.Color(hex);
  glow.quad(1.3, 1.3, { pos: [at.x, at.y + 0.016, at.z], rot: [-Math.PI / 2, 0, 0], color: warm(0xff9a40).multiplyScalar(0.42) });
  if (ceilingY !== null) glow.quad(1.0, 1.0, { pos: [at.x, ceilingY - 0.012, at.z], rot: [Math.PI / 2, 0, 0], color: warm(0xff9a40).multiplyScalar(0.36) });
  if (wall) glow.quad(1.2, 1.2, { pos: [at.x, at.y + y0 + h / 2, wall.z + 0.012], color: warm(0xff9a40).multiplyScalar(0.4) });
}
