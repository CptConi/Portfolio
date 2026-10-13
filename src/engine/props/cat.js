import * as THREE from 'three';
import { Pix } from './pixels.js';

// The house cat, as camera-facing kawaii pixel-art sprites (seen at 640x360, nearest-filtered, from 1.5-3.5 m).
// Reusable wherever a cat belongs:
//
//   const cat = createCat('sleeping');      // a curled ginger tabby, closed happy eyes, tiny "z z"
//   const eyes = createCat('eyes');          // two glowing eyes with slit pupils, watching from the dark
//   cat.object.position.set(x, y, z);        // origin = bottom centre (it sits on a surface)
//   scene.add(cat.object);
//   cat.update(t, calm);                     // every frame; `calm` (reduced motion) freezes it, eyes open
//   cat.dispose();
//
// Returns { kind, object: THREE.Group, width, height, update(t, calm), dispose() }.
// Width/height are the sprite's world size in metres. Kinds: 'sleeping' | 'eyes' | 'loaf'
// ('loaf' = a ginger tabby loafing on a keyboard, eyes on the visitor; sits on a table-top, 0.42 m wide;
// it blinks slowly, twitches an ear and flicks its tail tip, and has react(t), which makes it squint
// happily for a few seconds).
// Every group carries userData.catKind, so a feature can find a cat that another module built.
//
// Art direction: a big round head (about half the sprite's width), large glossy eyes with a one-pixel
// glint, a tiny pink nose and a "w" mouth, short ears with pink insides, a cream muzzle, soft tabby
// stripes, blush, a clean 1-px dark-brown outline. At most 12 colours per cat, symmetrical faces.

const OUTLINE = 0x3b2013, ORANGE = 0xf39b40, SHADE = 0xd97a2b, STRIPE = 0xc2631f, LIGHT = 0xfbbe6e;
const CREAM = 0xfff0d4, PINK = 0xf8a3b3, BLUSH = 0xf0765f, WHITE = 0xffffff, EYE_LO = 0x8a4a2a;
const KEY_DARK = 0x2e3544, KEY_TOP = 0x5b6680;

// ── Drawing toolkit ──────────────────────────────────────────────────────────────────────

// Lays a shape on `p` with its own 1-px contour, so a head drawn over a body keeps its outline.
// `draw(mask)` paints the shape (any colour, any alpha > 0) on a scratch image; returns that mask.
function solid(p, draw, fill, edge = OUTLINE) {
  const m = new Pix(p.w, p.h);
  draw(m);
  const on = (x, y) => m.alpha(x, y) > 0;
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      if (!on(x, y) && (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1))) p.set(x, y, edge);
    }
  }
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (on(x, y)) p.set(x, y, fill);
  return m;
}

// Repaints the pixels of `p` that are `from`, inside the shape `m`, when `test(x, y)` agrees.
function recolor(p, m, from, to, test) {
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) if (m.alpha(x, y) && p.get(x, y) === from && test(x, y)) p.set(x, y, to);
  }
}

// Catmull-Rom spline through `pts` ([x, y] pairs), sampled `n + 1` times with t in 0..1 along it.
function spline(pts, n = 160) {
  const g = i => pts[Math.max(0, Math.min(pts.length - 1, i))];
  const out = [];
  for (let k = 0; k <= n; k++) {
    const u = (k / n) * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(u)), f = u - i;
    const [p0, p1, p2, p3] = [g(i - 1), g(i), g(i + 1), g(i + 2)];
    const c = j => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * f + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * f * f + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * f * f * f);
    out.push({ x: c(0), y: c(1), t: k / n });
  }
  return out;
}

// A tapered tail along `pts`: `bands` ([t0, t1] along its length) are striped, the last `tip` fraction is cream.
function tail(p, pts, { r0, r1, bands, tip }) {
  const s = spline(pts);
  const m = solid(p, mask => { for (const q of s) mask.disc(q.x, q.y, r0 + (r1 - r0) * q.t, WHITE); }, ORANGE);
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      if (!m.alpha(x, y)) continue;
      let best = Infinity, t = 0;
      for (const q of s) {
        const d = (q.x - x - 0.5) ** 2 + (q.y - y - 0.5) ** 2;
        if (d < best) { best = d; t = q.t; }
      }
      if (t > 1 - tip) p.set(x, y, CREAM);
      else if (bands.some(([a, b]) => t >= a && t < b)) p.set(x, y, STRIPE);
    }
  }
}

// ── Sleeping cat ─────────────────────────────────────────────────────────────────────────

// Curled up, seen from the front-left: big sleepy head, paws tucked under the chin, round striped back,
// tail tip curling up behind. The face's axis is x = 15 (between pixels 14 and 15).
export const SLEEPING_TEX = { w: 46, h: 33 };
export function paintSleepingCat(p) {
  const HX = 15, HY = 20.5;
  const mx = x => 2 * HX - 1 - x;       // pixel mirror about the face's axis

  // Tail first (it is behind the body), lying along the ground with its tip curled up.
  tail(p, [[33, 29.4], [39, 29.2], [42.2, 26], [42.4, 21.6], [41.4, 18.4]], { r0: 2.3, r1: 1.9, bands: [[0.28, 0.36], [0.52, 0.6]], tip: 0.14 });

  // Body: a round bun, flat underneath, shaded toward the floor; stripes hang from the spine, lit on the ridge.
  const body = solid(p, m => { m.ellipse(28, 19.5, 12, 12, WHITE); m.rect(0, 32, 46, 1, 0, 0); }, ORANGE);
  recolor(p, body, ORANGE, SHADE, (x, y) => y >= 29);
  const spine = x => { for (let y = 3; y < 30; y++) if (body.alpha(x, y)) return y; return -1; };
  for (const [x, h] of [[24, 3], [28, 4], [32, 4], [36, 3]]) {
    const y = spine(x);
    if (y >= 0) p.rect(x, y + 1, 2, h, STRIPE);
  }
  for (let x = 22; x < 36; x++) {
    const y = spine(x);
    if (y >= 0 && x % 4 > 1) p.set(x, y + 1, LIGHT);
  }

  // Head and ears (one silhouette), pink ear insides, forehead stripes, cream muzzle, blush.
  const earL = [[3.9, 16.5], [5.9, 6.1], [12.6, 11.2]];
  const earR = earL.map(([x, y]) => [2 * HX - x, y]);
  solid(p, m => {
    m.ellipse(HX, HY, 12.4, 10.5, WHITE);
    m.poly(earL, WHITE);
    m.poly(earR, WHITE);
  }, ORANGE);
  const inL = [[5.8, 14], [6.6, 8.6], [10.6, 11.6]];
  p.poly(inL, PINK);
  p.poly(inL.map(([x, y]) => [2 * HX - x, y]), PINK);
  p.rect(12, 11, 1, 3, STRIPE).rect(14, 11, 2, 4, STRIPE).rect(17, 11, 1, 3, STRIPE);
  p.ellipse(HX, 24.2, 5, 2.6, CREAM);
  for (const y of [22, 23]) p.rect(5, y, 3, 1, BLUSH).rect(mx(5) - 2, y, 3, 1, BLUSH);

  // Closed, content eyes (little downward arcs), pink nose, "w" mouth.
  for (const x0 of [6, 19]) {
    p.set(x0, 19, OUTLINE).set(x0 + 4, 19, OUTLINE);
    p.rect(x0 + 1, 20, 3, 1, OUTLINE);
  }
  p.set(14, 22, PINK).set(15, 22, PINK);
  for (const [x, y] of [[12, 23], [14, 23], [15, 23], [17, 23], [13, 24], [16, 24]]) p.set(x, y, OUTLINE);

  // Front paws under the chin.
  for (const cx of [9.5, 20.5]) solid(p, m => m.ellipse(cx, 29.4, 3.6, 1.9, WHITE), CREAM);
}

// ── Eyes in the dark ─────────────────────────────────────────────────────────────────────

// Two round glowing eyes with slit pupils and a glint (drawn additive: the dark pixels add nothing).
// `glance` slides both pupils by one pixel (-1, 0 or 1).
export const EYES_TEX = { w: 20, h: 8 };
const IRIS = ['..###..', '.#####.', '#######', '#######', '.#####.', '..###..'];
export function paintEyes(p, glance = 0) {
  for (const x0 of [2, 11]) {
    p.ellipse(x0 + 3.5, 4, 4.7, 3.8, 0x3f5a10, 70);
    IRIS.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) if (row[i] === '#') p.set(x0 + i, 1 + j, 0x9ed12a, 215);
    });
    p.rect(x0 + 2 + glance, 2, 3, 4, 0xe6ff6a);
    p.rect(x0 + 3 + glance, 2, 1, 4, 0x0a1400);
    p.set(x0 + 1, 2, 0xffffe0);
  }
}

// ── Loafing cat ──────────────────────────────────────────────────────────────────────────

// Front on, on a keyboard: round head, big glossy eyes, front paws tucked, tail curling up behind the
// right shoulder. pose = { eyes: 'open' | 'half' | 'closed' | 'happy', ear: 0 | 1, tail: 0 | 1 | 2 }:
// the blink goes open > half > closed > half; ear 1 flicks the left ear out; tail 1/2 flick its tip up/out.
export const LOAF_TEX = { w: 56, h: 44 };
export function paintLoaf(p, { eyes = 'open', ear = 0, tail: flick = 0 } = {}) {
  const AX = 26;                         // the face's axis (continuous x); the tail takes the room on the right
  const d = AX - 28;                     // the head was designed around x = 28
  const mx = x => 2 * AX - 1 - x;        // pixel mirror about that axis

  // Keyboard: top face seen from a little above (key gaps), dark front lip.
  solid(p, m => m.rect(1, 36, 52, 7, WHITE), KEY_DARK);
  p.rect(1, 36, 52, 5, KEY_TOP);
  for (let x = 4; x < 52; x += 4) p.rect(x, 38, 1, 2, KEY_DARK);

  // Tail, curling up behind the right shoulder; the tip curls in, or flicks up, or flicks out.
  const base = [[44, 34], [50, 31], [52.5, 26], [51.5, 20.5]];
  const ends = [[[48.5, 17], [45.6, 18.4]], [[50.8, 15.5], [49.4, 11.8]], [[52.6, 16.8], [53, 13.6]]];
  tail(p, [...base, ...ends[flick]], { r0: 2.5, r1: 1.9, bands: [[0.34, 0.44], [0.62, 0.72]], tip: 0.1 });

  // Body: a loaf, flat underneath and round on top, shaded toward the keys, soft stripes on the flanks.
  const body = solid(p, m => { m.ellipse(28 + d, 31, 23, 10, WHITE); m.rect(5 + d, 31, 46, 6, WHITE); m.rect(0, 37, 56, 7, 0, 0); }, ORANGE);
  recolor(p, body, ORANGE, SHADE, (x, y) => y >= 34);
  for (const [x, y] of [[9, 30], [12, 28]]) p.rect(x + d, y, 1, 4, STRIPE).rect(mx(x + d), y, 1, 4, STRIPE);

  // Head with its two ears (one silhouette); the left ear can flick outward.
  const sh = pts => pts.map(([x, y]) => [x + d, y]);
  const earL = ear ? [[12.6, 14], [11.6, 5.4], [22.5, 7.8]] : [[12.6, 13.5], [13.8, 2.4], [23.2, 7.2]];
  const earR = [[43.4, 13.5], [42.2, 2.4], [32.8, 7.2]];
  solid(p, m => {
    m.ellipse(28 + d, 17, 15.5, 11, WHITE);
    m.poly(sh(earL), WHITE);
    m.poly(sh(earR), WHITE);
  }, ORANGE);
  p.poly(sh(ear ? [[14.4, 11.4], [12.8, 6.2], [20.6, 8.6]] : [[15, 11], [15.4, 5.2], [20.6, 8.2]]), PINK);
  p.poly(sh([[41, 11], [40.6, 5.2], [35.4, 8.2]]), PINK);

  // Forehead stripes, cheek dashes, cream muzzle, blush.
  p.rect(25 + d, 6, 1, 3, STRIPE).rect(27 + d, 6, 2, 4, STRIPE).rect(30 + d, 6, 1, 3, STRIPE);
  for (const y of [15, 18]) p.rect(13 + d, y, 2, 1, STRIPE).rect(41 + d, y, 2, 1, STRIPE);
  p.ellipse(28 + d, 24, 5.6, 3.1, CREAM);
  for (const y of [22, 23]) p.rect(16 + d, y, 3, 1, BLUSH).rect(37 + d, y, 3, 1, BLUSH);

  // Eyes, 6 px wide: big dark ovals with a glint and a lighter lower rim; or a lid; or arcs.
  const eye = ex => {
    const ey = 14;
    if (eyes === 'happy') {
      p.rect(ex + 1, ey + 3, 4, 1, OUTLINE).set(ex, ey + 4, OUTLINE).set(ex + 5, ey + 4, OUTLINE);
    } else if (eyes === 'closed') {
      p.set(ex, ey + 4, OUTLINE).set(ex + 5, ey + 4, OUTLINE).rect(ex + 1, ey + 5, 4, 1, OUTLINE);
    } else {
      const rows = eyes === 'half' ? ['######', '######', '.####.'] : ['.####.', '######', '######', '######', '######', '######', '.####.'];
      const top = eyes === 'half' ? ey + 4 : ey;
      rows.forEach((row, j) => { for (let i = 0; i < 6; i++) if (row[i] === '#') p.set(ex + i, top + j, OUTLINE); });
      if (eyes === 'open') p.set(ex + 1, ey + 1, WHITE).rect(ex + 1, ey + 5, 4, 1, EYE_LO);
    }
  };
  eye(16 + d);
  eye(34 + d);

  // Pink nose and a "w" mouth.
  p.set(27 + d, 22, PINK).set(28 + d, 22, PINK);
  for (const [x, y] of [[25, 24], [27, 24], [28, 24], [30, 24], [26, 25], [29, 25]]) p.set(x + d, y, OUTLINE);

  // Cream chest tuft, and the front paws, tucked.
  p.ellipse(28 + d, 30.4, 2.6, 1.8, CREAM);
  for (const cx of [22.5, 33.5]) solid(p, m => m.ellipse(cx + d, 34.4, 3.8, 2.3, WHITE), CREAM);
}

// A small "z" glyph for the sleeping cat.
export const Z_TEX = { w: 9, h: 9 };
export function paintZ(p) {
  p.grid(['#######', '.....#.', '....#..', '...#...', '..#....', '.#.....', '#######'], { '#': 0xeef2ff }, 1, 1);
  p.outline(0x4a4f9a);
}

const frac = x => x - Math.floor(x);
const smooth = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };

function texture(size, paint, opts) {
  const p = new Pix(size.w, size.h);
  paint(p);
  return p.toTexture(opts);
}

// ── Sprites ──────────────────────────────────────────────────────────────────────────────

const BREATH_HZ = 0.32;
const Z_COUNT = 2, Z_PERIOD = 4;

function sleeping() {
  const width = 0.38, height = (width * SLEEPING_TEX.h) / SLEEPING_TEX.w;
  const map = texture(SLEEPING_TEX, paintSleepingCat, { mip: true });
  const zMap = texture(Z_TEX, paintZ);
  const body = new THREE.Sprite(new THREE.SpriteMaterial({ map, color: 0xe2dbd2, alphaTest: 0.5 }));
  body.center.set(0.5, 0);
  body.scale.set(width, height, 1);

  const group = new THREE.Group();
  group.add(body);
  const zs = [];
  for (let i = 0; i < Z_COUNT; i++) {
    const z = new THREE.Sprite(new THREE.SpriteMaterial({ map: zMap, transparent: true, opacity: 0, depthWrite: false }));
    zs.push(z);
    group.add(z);
  }

  return {
    kind: 'sleeping', object: group, width, height,
    update(t, calm) {
      const b = calm ? 0 : Math.sin(t * Math.PI * 2 * BREATH_HZ);
      body.scale.set(width * (1 - 0.012 * b), height * (1 + 0.04 * b), 1);
      for (let i = 0; i < Z_COUNT; i++) {
        const z = zs[i];
        z.visible = !calm;
        if (calm) continue;
        const u = frac(t / Z_PERIOD + i / Z_COUNT);
        const s = 0.04 + 0.035 * u;
        // The "z"s rise from just above the head (the head sits left of the sprite's centre).
        z.scale.set(s, s, 1);
        z.position.set(-width * 0.2 + 0.07 * u + Math.sin(t * 1.3 + i * 2) * 0.012, height * 0.8 + 0.02 + 0.2 * u, 0);
        z.material.opacity = 0.9 * smooth(0, 0.2, u) * (1 - smooth(0.55, 1, u));
      }
    },
    dispose() {
      map.dispose(); zMap.dispose();
      body.material.dispose();
      zs.forEach(z => z.material.dispose());
    },
  };
}

const EYES_BLINK_PERIOD = 5.3, EYES_BLINK_LENGTH = 0.2;
// Within an 11 s cycle the pupils glance right from 3 to 3.8 s, left from 6.4 to 7 s.
const glanceAt = t => { const g = t % 11; return g >= 3 && g < 3.8 ? 1 : g >= 6.4 && g < 7 ? -1 : 0; };

function eyes() {
  const width = 0.13, height = (width * EYES_TEX.h) / EYES_TEX.w;
  const maps = { '-1': texture(EYES_TEX, p => paintEyes(p, -1)), 0: texture(EYES_TEX, p => paintEyes(p, 0)), 1: texture(EYES_TEX, p => paintEyes(p, 1)) };
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: maps[0], transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  // Centred vertically on its box, so that a blink closes the lids toward the middle of the eyes.
  sprite.center.set(0.5, 0.5);
  sprite.position.y = height / 2;
  sprite.scale.set(width, height, 1);
  const group = new THREE.Group();
  group.add(sprite);

  return {
    kind: 'eyes', object: group, width, height,
    update(t, calm) {
      if (calm) {
        sprite.material.map = maps[0];
        sprite.material.opacity = 1;
        sprite.scale.set(width, height, 1);
        return;
      }
      // A blink every ~5 s, a barely perceptible shimmer, and now and then a glance to one side.
      const u = t % EYES_BLINK_PERIOD - (EYES_BLINK_PERIOD - EYES_BLINK_LENGTH);
      const lid = u > 0 ? Math.sin((u / EYES_BLINK_LENGTH) * Math.PI) : 0;
      sprite.scale.set(width, height * (1 - 0.9 * lid), 1);
      sprite.material.opacity = 0.85 + 0.15 * Math.sin(t * 1.7);
      sprite.material.map = maps[glanceAt(t)];
    },
    dispose() { Object.values(maps).forEach(m => m.dispose()); sprite.material.dispose(); },
  };
}

// The loafing cat's idle, over a 13 s cycle: two slow blinks (~5 s apart), a flick of the tail tip, one
// ear twitch. The events never overlap, so a frame is simply "the face, the ear and the tail" of one pose.
const LOAF_CYCLE = 13, HAPPY_SECONDS = 2.6;
const LOAF_POSES = {
  open: {}, half: { eyes: 'half' }, closed: { eyes: 'closed' }, happy: { eyes: 'happy' },
  ear: { ear: 1 }, tailUp: { tail: 1 }, tailOut: { tail: 2 },
};
const LOAF_BLINKS = [3.1, 10.8];
const between = (u, a, b) => u >= a && u < b;
function loafPose(t) {
  const u = t % LOAF_CYCLE;
  for (let i = 0; i < LOAF_BLINKS.length; i++) {
    const at = LOAF_BLINKS[i];
    if (between(u, at, at + 0.44)) return between(u, at + 0.12, at + 0.32) ? 'closed' : 'half';
  }
  if (between(u, 5.6, 6.35)) return between(u, 5.85, 6.1) ? 'tailOut' : 'tailUp';
  if (between(u, 9, 9.34)) return between(u, 9.12, 9.2) ? 'open' : 'ear';
  return 'open';
}

function loaf() {
  const width = 0.42, height = (width * LOAF_TEX.h) / LOAF_TEX.w;
  const maps = {};
  for (const [key, pose] of Object.entries(LOAF_POSES)) maps[key] = texture(LOAF_TEX, p => paintLoaf(p, pose), { mip: true });
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: maps.open, color: 0xe2dbd2, alphaTest: 0.5 }));
  sprite.center.set(0.5, 0);
  sprite.scale.set(width, height, 1);
  const group = new THREE.Group();
  group.add(sprite);

  let happyUntil = -Infinity;
  return {
    kind: 'loaf', object: group, width, height,
    // Squints happily (closed-eye arcs) for a few seconds, whatever `calm` says: it is a state, not motion.
    react(t) { happyUntil = t + HAPPY_SECONDS; },
    update(t, calm) {
      sprite.material.map = maps[t < happyUntil ? 'happy' : calm ? 'open' : loafPose(t)];
    },
    dispose() {
      Object.values(maps).forEach(m => m.dispose());
      sprite.material.dispose();
    },
  };
}

const KINDS = { sleeping, eyes, loaf };

export function createCat(kind = 'sleeping') {
  const make = KINDS[kind];
  if (!make) throw new RangeError(`unknown cat kind: ${kind}`);
  const cat = make();
  cat.object.userData.catKind = kind;
  return cat;
}

export const CAT_KINDS = Object.freeze(Object.keys(KINDS));
