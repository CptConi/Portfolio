// PHENIX FORMATION — three apps in one. Three cubes (organisations, trainers,
// calendars) orbit, spiral in and fuse into one translucent cube while the board
// counts up to ~3 000 trainings a year. Embers rise, because phoenix.
//
// `t` is the page uptime and can reach thousands of seconds, so every angle that gets
// lerped or scaled is built from a cycle-periodic phase (`u`, `wrap`), never from raw `t`.
import * as THREE from 'three';
import { G, ORANGE, TAU, drawText, frac, hexCss, lerp, smooth, wrap } from './kit.js';

const AMBER = 0xffc23a, CYAN = 0x37c0ff, PINK = 0xff2a9d;
const SLATE = 0x2a2a3a, ORANGE_D = 0xd9760a;

const CY = G + 22;          // height of the cluster centre
const T = 9;                // cycle length (s)
const R = 13;               // orbit radius
const ORBIT = 1.5;          // orbit angular speed (rad/s)
const SPIN = TAU / T;       // one extra turn per cycle: how the cube yaw drifts off the cluster yaw
const YAW = ORBIT - SPIN;   // cluster yaw rate, so that orbit yaw - cluster yaw = SPIN * t exactly
const CUBE = 7, MERGED = 5.2;
const CLUSTER = [[-3.9, -2.1, 1.4], [3.9, -2.1, -1.4], [0, 3.7, 0]];
const SHELL = 17;
const EMBERS = 10;
const BOARD_W = 34;

const fmt = n => (n < 1000 ? String(n) : `${Math.floor(n / 1000)} ${String(n % 1000).padStart(3, '0')}`);

// 160×32 over 34 cm: 16 px glyphs are ~3 cm tall, still ~10 screen px at 1.5 m.
function boardPaint(ctx, w, h, text, bright) {
  ctx.fillStyle = '#0a0a10';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = hexCss(ORANGE);
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
  drawText(ctx, text, 92, 8, 16, bright ? '#fff1b8' : '#ffb347', 'right');
  drawText(ctx, '/AN', w - 8, 8, 16, hexCss(ORANGE), 'right');
}

export function build(kit) {
  const b = kit.main;
  kit.base(b);

  // emitter pedestal
  b.box(0, G, 0, 10, 3, 10, SLATE);
  b.box(0, G + 3, 0, 6.4, 1.2, 6.4, ORANGE_D);
  b.box(0, G + 4.2, 0, 3.2, 0.6, 3.2, AMBER);
  // board feet
  for (const x of [-13, 13]) b.box(x, G, 13.4, 1.6, 3, 2.6, SLATE);

  // the orbit track, at the height of the cubes: a ring on the floor would be edge-on (the eye
  // is at plinth-top height), up here it is seen from below as a clear ellipse
  const ring = new THREE.Mesh(kit.geo('ring'), kit.glowMat(ORANGE, 0.35, { side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.scale.setScalar(R + 0.8);
  ring.position.y = CY;
  kit.root.add(ring);

  // counter board, tilted back so it reads from eye level and from above
  const surf = kit.surface(160, 32, boardPaint, '3 000', false);
  const board = kit.panel(BOARD_W, BOARD_W / 5, surf, 0x0a0a10);
  board.position.set(0, G + 4.4, 13);
  board.rotation.x = -0.5;

  // the three apps
  const cubes = [ORANGE, CYAN, PINK].map(c => kit.part(CUBE, CUBE, CUBE, c));

  // the fused cube: a shell that pops in around the cluster
  const core = new THREE.Group();
  core.position.y = CY;
  kit.root.add(core);
  const shell = kit.part(1, 1, 1, 0xfff0c8, core, { transparent: true, opacity: 0.3, depthWrite: false });
  const wire = kit.edges(1, 1, 1, AMBER, 1, core);
  wire.material.transparent = true;

  const embers = kit.sparks(EMBERS, 2.2);
  const halo = kit.glow(AMBER, 28, 0.3);
  halo.position.y = CY;
  const base = kit.glow(ORANGE, 12, 0.35);
  base.position.y = G + 5;

  let lastKey = -1;

  return {
    staticT: 0.72 * T,
    pose(t) {
      const u = wrap(t, T) / T;
      const m = smooth(0.40, 0.55, u) * (1 - smooth(0.87, 0.99, u));      // 1 = fused
      const a = smooth(0.54, 0.60, u) * (1 - smooth(0.86, 0.95, u));      // shell visibility
      const yaw = wrap(t * YAW, TAU);
      const cs = Math.cos(yaw), sn = Math.sin(yaw);

      for (let i = 0; i < 3; i++) {
        const ang = t * ORBIT + i * TAU / 3 + m * 6;
        const ox = R * Math.cos(ang), oz = R * Math.sin(ang), oy = 5 * Math.sin(ang * 0.8 + i * 2.1);
        const [cx, cy, cz] = CLUSTER[i];
        const c = cubes[i];
        c.position.set(
          lerp(ox, cx * cs + cz * sn, m),
          CY + lerp(oy, cy, m),
          lerp(oz, -cx * sn + cz * cs, m));
        c.scale.setScalar(lerp(CUBE, MERGED, m));
        // lerp(ang, yaw, m) written on the bounded difference: `ang - yaw` is SPIN * t, which
        // is the cycle phase u * TAU modulo a full turn (a no-op for a cube at m = 0)
        c.rotation.set(lerp(0.5, 0.3, m), yaw + (1 - m) * (u * TAU + i * TAU / 3 + 6 * m), lerp(0.2 * i, 0.2, m));
      }

      core.visible = a > 0.01;
      core.rotation.set(0.3, wrap(t * 0.56, TAU), 0.2);
      core.scale.setScalar(SHELL * (0.6 + 0.4 * a + 0.12 * Math.sin(a * Math.PI)));
      shell.material.opacity = 0.3 * a;
      wire.material.opacity = 0.95 * a;

      halo.material.opacity = 0.18 + 0.4 * a + 0.06 * Math.sin(t * 3);
      halo.scale.setScalar(24 + 4 * a);

      for (let i = 0; i < EMBERS; i++) {
        const ph = frac(t * 0.3 + i * 0.173);
        const spread = 2 + 5 * ph;
        const k = i * 3;
        embers.pos[k] = Math.sin(i * 12.9 + t * 0.8) * spread;
        embers.pos[k + 1] = G + 7 + ph * 27;
        embers.pos[k + 2] = Math.cos(i * 7.3 + t * 0.7) * spread;
        const al = Math.sin(Math.PI * ph) * (0.4 + 0.6 * a);
        embers.col[k] = al;
        embers.col[k + 1] = al * (0.5 + 0.2 * (i % 2));
        embers.col[k + 2] = al * 0.12;
      }
      embers.touch();

      // counter: climbs while the cubes spiral in, holds (blinking) once fused, resets on release
      const shown = u >= 0.55 && u < 0.9 ? 3000 : u >= 0.9 ? 0 : Math.round(3000 * smooth(0.04, 0.54, u) / 50) * 50;
      const bright = u >= 0.55 && u < 0.7 && (Math.floor(t * 4) & 1) === 1;
      const key = shown * 2 + (bright ? 1 : 0);
      if (key !== lastKey) {
        lastKey = key;
        surf?.paint(fmt(shown), bright);
      }
    },
  };
}
