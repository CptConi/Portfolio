// PARFUMERIE PRIVÉE — luxury perfume e-commerce. A flacon in a glass vitrine: gold
// frame, a glint sliding over the glass, a few sparkles rising around the bottle.
import * as THREE from 'three';
import { G, drawText, frac, hexCss, smooth } from './kit.js';

const GOLD = 0xd4af37, GOLD_L = 0xf5d77a, GOLD_D = 0x8a6d1c;
const GLASS_PINK = 0xf4b6cb, GLASS_L = 0xffd9e6, LIQUID = 0xe0628f;
const BLACK = 0x1a1a24;

const CUBE = 28, BASE_TOP = G + 2.7;
const SPARKS = 7;

function monogram(ctx, w, h) {
  ctx.fillStyle = hexCss(GOLD);
  ctx.fillRect(0, 0, w, h);
  drawText(ctx, 'PP', w / 2, (h - 16) / 2 + 1, 16, hexCss(BLACK), 'center');
}

export function build(kit) {
  const b = kit.main;
  kit.base(b);

  // gold plinth + vitrine frame
  b.box(0, G, 0, 31, 2.2, 31, GOLD_D);
  b.box(0, G + 2.2, 0, 29.6, 0.5, 29.6, GOLD);
  const h = CUBE / 2, y0 = BASE_TOP, y1 = BASE_TOP + CUBE, t = 0.8;
  for (const y of [y0, y1 - t]) {
    for (const s of [h - t / 2, -h + t / 2]) {
      b.box(0, y, s, CUBE, t, t, GOLD_L);
      b.box(s, y, 0, t, t, CUBE - 2 * t, GOLD_L);
    }
  }
  for (const x of [h - t / 2, -h + t / 2]) for (const z of [h - t / 2, -h + t / 2]) {
    b.box(x, y0, z, t, CUBE, t, GOLD_L);
    b.box(x, y0 - 0.3, z, 1.8, 1.6, 1.8, GOLD);
    b.box(x, y1 - 1.3, z, 1.8, 1.6, 1.8, GOLD);
  }

  // the flacon turns gently inside
  const bottle = new THREE.Group();
  bottle.position.y = BASE_TOP + 1;
  bottle.scale.setScalar(1.3);
  kit.root.add(bottle);
  const f = kit.batch(bottle);
  f.box(0, -0.8, 0, 13, 0.8, 9, GOLD);
  f.box(0, 0, 0, 11, 10, 6.6, GLASS_PINK);
  f.box(0, 0, 0, 11.4, 1.6, 7, GLASS_L);
  f.box(0, 1.8, 3.35, 8.6, 6.2, 0.2, LIQUID);
  f.box(-3.2, 2.2, 3.5, 0.9, 5.2, 0.1, 0xffe3ee);
  f.box(0, 10, 0, 8.4, 1.4, 5.2, GLASS_PINK);
  f.box(0, 11.4, 0, 3.8, 1.2, 3.8, GOLD);
  f.cyl(0, 12.6, 0, 2.9, 2.9, 5.2, BLACK, 8);
  f.cyl(0, 12.6, 0, 3.05, 3.05, 0.7, GOLD, 8);
  f.cyl(0, 17.2, 0, 2.4, 2.9, 0.6, GOLD_D, 8);
  const mono = kit.panel(5.4, 2.4, kit.surface(40, 18, monogram), GOLD, bottle);
  mono.position.set(0, 6.2, 3.46);

  // glass walls: three faces seen from the front, soft tint
  const glass = kit.part(CUBE - 0.4, CUBE - 0.4, CUBE - 0.4, 0xbfe6ff, kit.root, { transparent: true, opacity: 0.1, depthWrite: false });
  glass.position.y = BASE_TOP + CUBE / 2;

  // glints sliding over the front glass
  const glints = [[3, 0, 0.38], [1.1, 3.6, 0.22]].map(([w, lag, op]) => {
    const mat = kit.glowMat(0xffffff, 0);
    const g = kit.plane(w, CUBE - 3, mat, kit.root);
    g.rotation.z = 0.35;
    g.position.set(0, BASE_TOP + CUBE / 2, h + 0.15);
    return { g, mat, lag, op };
  });

  const rose = kit.glow(0xff7aa8, 24, 0.22);
  rose.position.set(0, BASE_TOP + 12, -4);
  const sparks = kit.sparks(SPARKS, 2.6);

  return {
    staticT: 1.7,
    pose(t) {
      bottle.rotation.y = 0.55 * Math.sin(t * 0.5);

      const x = -17 + 34 * frac(t / 5);
      for (const { g, mat, lag, op } of glints) {
        const gx = x - lag;
        const o = smooth(-h, -h + 5, gx) * (1 - smooth(h - 5, h, gx));
        g.position.x = gx;
        g.visible = o > 0.04;
        mat.opacity = op * o;
      }

      rose.material.opacity = 0.2 + 0.07 * Math.sin(t * 1.3);

      for (let i = 0; i < SPARKS; i++) {
        const a = i * 2.399 + t * (i % 2 ? 0.25 : -0.2);
        const r = 6.5 + 4 * Math.sin(t * 0.3 + i);
        const ph = frac(t * 0.1 + i * 0.31);
        const k = i * 3;
        sparks.pos[k] = r * Math.cos(a);
        sparks.pos[k + 1] = BASE_TOP + 4 + ph * 20;
        sparks.pos[k + 2] = r * Math.sin(a) * 0.8;
        const tw = Math.pow(Math.max(0, Math.sin(t * 3.1 + i * 2.7)), 3) * Math.sin(Math.PI * ph);
        sparks.col[k] = tw;
        sparks.col[k + 1] = tw * 0.9;
        sparks.col[k + 2] = tw * 0.62;
      }
      sparks.touch();
    },
  };
}
