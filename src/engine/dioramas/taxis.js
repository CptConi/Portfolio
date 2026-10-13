// 1001TAXIS — passenger taxi app on iOS and Android. A checker-banded cab keeps
// driving (roadside posts and street lamps stream past, the wheels spin, the roof sign
// pulses) while a map pin bobs above it and pings the pickup point.
//
// The visitor's eye is at plinth-top height and never pitches, so a painted road would
// show nothing: the motion is carried by upright things (posts in front of the cab, tall
// lamps behind it that rise above its roof).
import * as THREE from 'three';
import { G, ORANGE, TAU, drawText, frac, hexCss, smooth, wrap } from './kit.js';

const YELLOW = 0xffc400, YELLOW_D = 0xd9a300, BLACK = 0x14141c;
const GLASS = 0x7fd7ff, TIRE = 0x15151c, HUB = 0xcfd3dc, BUMPER = 0x8a8f9a;
const ASPHALT = 0x2a2c36, LINE = 0xc9ccd6, LAMP = 0xc99a1e, STEEL = 0x4d5365;
const SIGN = 0xf4efd2, SIGN_BASE = 0x1a1a22;
const PIN = 0xff3b4a, PIN_ROWS = ['..XXX..', '.XXXXX.', 'XXXWXXX', 'XXWWWXX', 'XXXWXXX', '.XXXXX.', '..XXX..', '...X...'];

const CAR_Z = -2;
const ROAD = 35.6;                                // road length (x); scenery wraps on it
const POSTS = 4, POST_Z = 10.6, SPEED = 16.5;     // low roadside posts in front of the cab
const LAMPS = 4, LAMP_Z = -12.4, LAMP_SPEED = 9;  // street lamps behind it, slower (parallax)
const WHEEL_R = 3.3, SPIN = SPEED / WHEEL_R;      // rolling without slipping on the posts' pace
const TIRE_Z = 6.2, HUB_Z = 7.45;                 // tyre centre / outer hub face, either side
const WHEELS = [[-10.5, 1], [10.5, 1], [-10.5, -1], [10.5, -1]];
const PIN_TIP = G + 22;

// 112×32 over 11.2 cm: 24 px glyphs are ~2.4 cm wide, about 9 screen px at 1.5 m.
function signPaint(ctx, w, h) {
  ctx.fillStyle = hexCss(SIGN);
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = hexCss(ORANGE);
  ctx.fillRect(0, h - 2, w, 2);
  drawText(ctx, 'TAXI', w / 2, 3, 24, hexCss(SIGN_BASE), 'center');
}

// Scenery that enters and leaves at the road's ends grows out of / sinks into the asphalt.
const growth = x => smooth(-ROAD / 2, -ROAD / 2 + 4, x) * (1 - smooth(ROAD / 2 - 4, ROAD / 2, x));

export function build(kit) {
  const b = kit.main;
  kit.base(b);

  // road, with a kerb on its front edge (the only part of it the eye can see)
  b.box(0, G, -0.3, ROAD, 0.4, 27.4, ASPHALT);
  b.box(0, G, 12.9, ROAD, 1, 0.8, LINE);

  // the cab
  const car = new THREE.Group();
  car.position.set(0, G, CAR_Z);
  kit.root.add(car);
  const c = kit.batch(car);
  c.box(0, 2.4, 0, 34, 6.2, 14, YELLOW);
  c.box(-1.5, 8.6, 0, 18, 5.4, 12.4, YELLOW);
  c.box(-1.5, 14, 0, 16.4, 0.8, 12.6, YELLOW_D);
  for (const z of [6.25, -6.25]) {
    c.box(-6.6, 9.5, z, 6, 3.8, 0.2, GLASS);
    c.box(1, 9.5, z, 7.2, 3.8, 0.2, GLASS);
  }
  c.box(7.6, 9.5, 0, 0.2, 3.8, 10.4, GLASS);
  for (const [x, z] of [[3.2, 6.4], [-6.6, 6.4], [3.2, -6.4], [-6.6, -6.4]]) {
    c.box(x, 9.5, z, 3, 1.4, 0.15, 0x2a3b55);
    c.box(x, 10.9, z, 1.8, 1.8, 0.15, 0x2a3b55);
  }
  for (const z of [7.05, -7.05]) {
    for (let i = 0; i < 17; i++) {
      c.box(-17 + i * 2 + 1, 4.6 + 1.4 * (i % 2), z, 2, 1.4, 0.2, BLACK);
    }
  }
  for (const s of [1, -1]) {
    c.box(17.3 * s, 2.6, 0, 1, 2, 13, BUMPER);
    for (const z of [4.6, -4.6]) c.box(17.2 * s, 5.2, z, 0.4, 1.8, 2.4, s > 0 ? 0xfff4b0 : 0xff2a2a);
  }
  for (const [x, side] of WHEELS) c.cyl(x, WHEEL_R - 1.1, side * TIRE_Z, WHEEL_R, WHEEL_R, 2.2, TIRE, 10, { rx: Math.PI / 2 });
  c.box(-1, 14.8, 0, 10, 0.8, 3.4, SIGN_BASE);
  c.box(-1, 15.6, 0, 11.6, 3.6, 3.6, SIGN);
  const sign = kit.panel(11.2, 3.2, kit.surface(112, 32, signPaint), SIGN, car, 3.7);
  sign.position.set(-1, 17.4, 0);
  const signGlow = kit.glow(0xffd23a, 18, 0.2, car);
  signGlow.position.set(-1, 17.4, 0);

  // spinning hubs
  const hb = kit.batch(null);
  hb.box(0, -0.45, 0, 5, 0.9, 0.3, HUB);
  hb.box(0, -2.5, 0, 0.9, 5, 0.3, HUB);
  hb.cyl(0, -0.2, 0, 0.9, 0.9, 0.5, BUMPER, 8, { rx: Math.PI / 2 });
  const hubs = kit.instances(kit.geometryOf(hb), WHEELS.length, 0xffffff, car);

  // roadside posts (front) and street lamps (back), instanced and scrolled along the road
  const pb = kit.batch(null);
  pb.box(0, 0, 0, 0.9, 3.4, 0.9, LINE);
  pb.box(0, 2.6, 0, 1, 0.9, 1.02, ORANGE);
  const posts = kit.instances(kit.geometryOf(pb), POSTS);
  const lb = kit.batch(null);
  lb.box(0, 0, 0, 0.9, 21, 0.9, STEEL);
  lb.box(0, 21, 0, 2.6, 0.9, 2.6, STEEL);
  lb.box(0, 21.9, 0, 2.2, 1.1, 2.2, LAMP);
  const lamps = kit.instances(kit.geometryOf(lb), LAMPS);

  // map pin + ping
  const pin = new THREE.Group();
  pin.position.set(0, PIN_TIP + 6.2, CAR_Z);
  kit.root.add(pin);
  kit.batch(pin).voxels(PIN_ROWS, 0, -6.2, 0, 1.55, 2.6, { X: PIN, W: 0xffffff });
  const ping = kit.glow(PIN, 10, 0, kit.root, 'ring');
  ping.position.set(0, PIN_TIP, CAR_Z);

  const dummy = new THREE.Object3D();

  return {
    staticT: 0.4,
    pose(t) {
      car.position.y = G + 0.25 * Math.sin(t * 9);
      car.rotation.z = 0.006 * Math.sin(t * 7);

      for (let i = 0; i < WHEELS.length; i++) {
        const [x, side] = WHEELS[i];
        dummy.position.set(x, WHEEL_R, side * HUB_Z);
        dummy.rotation.set(0, 0, -wrap(t * SPIN, TAU));
        dummy.updateMatrix();
        hubs.setMatrixAt(i, dummy.matrix);
      }
      hubs.instanceMatrix.needsUpdate = true;

      dummy.rotation.set(0, 0, 0);
      for (let i = 0; i < POSTS; i++) {
        const x = ROAD / 2 - wrap(t * SPEED + i * ROAD / POSTS, ROAD);
        dummy.position.set(x, G + 0.4, POST_Z);
        dummy.scale.set(1, Math.max(0.001, growth(x)), 1);
        dummy.updateMatrix();
        posts.setMatrixAt(i, dummy.matrix);
      }
      posts.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < LAMPS; i++) {
        const x = ROAD / 2 - wrap(t * LAMP_SPEED + i * ROAD / LAMPS, ROAD);
        dummy.position.set(x, G + 0.4, LAMP_Z);
        dummy.scale.set(1, Math.max(0.001, growth(x)), 1);
        dummy.updateMatrix();
        lamps.setMatrixAt(i, dummy.matrix);
      }
      lamps.instanceMatrix.needsUpdate = true;
      dummy.scale.set(1, 1, 1);

      signGlow.material.opacity = 0.2 + 0.12 * Math.sin(t * 3);

      pin.position.y = PIN_TIP + 6.2 + 1.4 * (0.5 + 0.5 * Math.sin(t * 2.6));
      pin.rotation.y = 0.35 * Math.sin(t * 1.1);
      const q = frac(t / 1.6);
      ping.scale.setScalar(4 + 10 * q);
      ping.material.opacity = 0.7 * (1 - q) * (1 - q);
    },
  };
}
