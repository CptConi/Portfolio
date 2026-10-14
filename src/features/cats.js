// Three cats hide in the level, and the secrets counter. A cat is found by "debugging by staring":
// keep the crosshair on it for 1.2 s and a thin ring fills around the crosshair.
//
//   cat-armurerie   a ginger tabby loafing on a keyboard, on the central workbench of the Armurerie
//   cat-quartiers   the sleeping cat on its crate in the Quartiers (built by props/lounge.js: found
//                   in the scene by its userData.catKind, nothing else is assumed about it)
//   cat-prod        two glowing eyes peeking from behind the east-side crates of the PROD room
//
// Aiming is by heading only (the camera never pitches): within 3.5 m, inside a 10° cone, with a clear
// line of sight (walls and the Props3D boxes block it, so the PROD cat can only be seen from where it
// can really be seen). The ring drains twice as fast as it fills if the eyes wander. Nothing needs a
// key: it works the same with a touch screen. On completion: a system toast in the cat's voice
// ("MROW." first), 'secret:found', and one reaction (purr bob and rising pickup glyphs, Doom-style health "+";
// slow blinks for the eyes; no motion under prefers-reduced-motion, only a still pickup).
//
// Events emitted: 'secret:found' { id: 'cat-armurerie' | 'cat-quartiers' | 'cat-prod' } (main.js turns
//                 it into the 'secret-found' analytics event, so nothing is tracked twice here).
// Listens to:     'secret:found' (counts the unique ids of the four secrets, the PROD wall included),
//                 'modal:open' / 'modal:close' (the gaze pauses while a dialog is open),
//                 'tour:start' / 'tour:end' (it pauses during the guided tour, whose camera is not the player's),
//                 'arcade:end' { won, score } (BUG HUNTER: analytics only).
// Exports:        getSecretsFound() → 0..4, SECRETS_TOTAL, SECRET_IDS, CATS (positions, for the proofs).
// Also ticks the PROD room's dressing (decor/secret.js: sign flicker, rack LEDs), which has no hook of its own.
// DEV only: __game.cats.found() → { count, total, ids }; __game.cats.tp(id) → stands you in front of that cat;
//           __game.cats.arcade() → the BUG HUNTER game object (set .killed = 16 for the boss, .time = 1 for the deadline…).
// Draw calls: the loaf cat and the eyes are one sprite each; a reaction adds at most 3 pickup sprites for 2.6 s.
import '../styles/cats.css';
import * as THREE from 'three';
import { createCat } from '../engine/props/cat.js';
import { Pix } from '../engine/props/pixels.js';
import { RAMPS, ditherRamp, bayer4 } from '../engine/props/dither.js';
import { LOUNGE } from '../engine/props/placement.js';
import { PROPS3D } from '../engine/Props3D.js';
import { isWall, floorAt } from '../engine/Map.js';
import { getProdRoom } from '../engine/decor/secret.js';
import { prefs } from '../engine/prefs.js';

// ── The four secrets: the PROD wall (features/secret.js) and the three cats ──
export const SECRET_IDS = ['prod', 'cat-armurerie', 'cat-quartiers', 'cat-prod'];
export const SECRETS_TOTAL = SECRET_IDS.length;
const found = new Set();
export const getSecretsFound = () => found.size;

// ── Gaze ──
const GAZE = {
  range: 3.5,       // m
  cos: 0.985,       // aiming cone, ~10°
  seconds: 1.2,     // staring time that fills the ring
  relax: 0.6,       // s for a full ring to empty once the eyes wander
  elevation: 0.2,   // largest height difference per metre of distance (~11°): it must be on screen, not at its edge
  near: 0.6,        // m: closer than this the cat fills the screen anyway
};
const PICKUP_SECONDS = 2.6;
// Transparent things are drawn far to near by their centre, which lets the big black overlays of the PROD
// room (decor/secret.js) land on top of a small glow that is nearer to the camera than their centre. Anything
// glowing there takes a later render order than every overlay.
const AFTER_OVERLAYS = 3;
const NB = '\u00a0';   // no-break space: French typography wants one before « : »

// The central workbench of the Armurerie (Props3D.js): the loaf sits on its east half, so that seen
// from the door the candle burning at the middle is behind it, not in front of its face. It is a
// billboard 0.42 m wide, so whatever the viewing direction its base line must stay on the top: that
// holds for |x − bench x| ≤ (bench length − 0.42) / 2 = 0.29 and |z − bench z| ≤ (bench depth − 0.42) / 2 = 0.09.
const nearestProp = (x, z) => PROPS3D.reduce((best, p) => (Math.hypot(p.x - x, p.y - z) < Math.hypot(best.x - x, best.y - z) ? p : best));
const BENCH = nearestProp(4.7, 12.5);

// `base`: world height of the surface the cat stands on; `aim`: height of its face above `base`;
// `top`: where the pickups start; `stand`: a spot a visitor can aim from (also the dev teleport);
// `toast`: the line shown when it is found, the final copy verbatim (the cat first, then the system's
// ticket; the "(SECRETS n/4)" count is appended when it is shown).
const surface = (x, z, h) => floorAt(x, z) + h;
export const CATS = [
  {
    id: 'cat-armurerie', kind: 'loaf', x: BENCH.x + 0.27, z: BENCH.y, base: surface(BENCH.x, BENCH.y, BENCH.h),
    aim: 0.2, top: 0.33, stand: [7.0, 12.5],
    toast: `MROW. TICKET #404 FERMÉ${NB}: CLAVIER INTROUVABLE. IL ÉTAIT SOUS LE CHAT.`,
  },
  {
    id: 'cat-quartiers', kind: 'sleeping', x: LOUNGE.crate.x, z: LOUNGE.crate.z, base: surface(LOUNGE.crate.x, LOUNGE.crate.z, LOUNGE.crate.top),
    aim: 0.12, top: 0.27, stand: [13.7, 4.9],
    toast: `MROW. TICKET #503 FERMÉ${NB}: SERVICE INDISPONIBLE. REPRISE ESTIMÉE${NB}: À SA CONVENANCE.`,
  },
  {
    id: 'cat-prod', kind: 'eyes', x: 15.55, z: 18.45, base: surface(15.55, 18.45, 0.2), scale: 1.5,
    aim: 0.04, top: 0.14, stand: [13.4, 19.9],
    toast: `MROW. TICKET #500 FERMÉ${NB}: CHAT EN PROD. AUCUN ACCÈS ACCORDÉ. IL EST ENTRÉ QUAND MÊME.`,
  },
];

// Is the straight line from the eye to the target free of walls and props? (Props3D boxes block while
// the line is below their top, so a cat sitting on one is seen over it.)
export function lineClear(ax, ay, az, bx, by, bz) {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.1));
  for (let i = 1; i < n; i++) {
    const u = i / n, x = ax + (bx - ax) * u, z = az + (bz - az) * u, y = ay + (by - ay) * u;
    if (isWall(x, z)) return false;
    for (const p of PROPS3D) {
      if (Math.abs(x - p.x) < p.w / 2 && Math.abs(z - p.y) < p.d / 2 && y < floorAt(p.x, p.y) + p.h) return false;
    }
  }
  return true;
}

// Can a visitor at (px, pz) looking along `angle`, eyes at `eye`, see `cat` dead ahead?
export function gazeAt(px, pz, angle, eye, cat) {
  const dx = cat.x - px, dz = cat.z - pz;
  const d = Math.hypot(dx, dz);
  if (d > GAZE.range || d < GAZE.near) return false;
  if ((Math.cos(angle) * dx + Math.sin(angle) * dz) / d < GAZE.cos) return false;
  const y = cat.base + cat.aim;
  if (Math.abs(y - eye) > d * GAZE.elevation) return false;
  return lineClear(px, eye, pz, cat.x, y, cat.z);
}

const smooth = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };

// A health-bonus "+" in the style of Doom's pickups: a chunky bevelled cross, light from the upper left, a
// dithered green body, a hard drop shadow. 9 x 9, fullbright (no tint), crisp.
const PICKUP = ['..###..', '..###..', '#######', '#######', '#######', '..###..', '..###..'];
function pickupTexture() {
  const p = new Pix(9, 9);
  const on = (x, y) => PICKUP[y]?.[x] === '#';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) if (!on(x, y) && (on(x - 1, y - 1) || on(x - 1, y) || on(x, y - 1))) p.set(x + 1, y + 1, RAMPS.olive[0]);
  }
  PICKUP.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== '#') continue;
      const lit = !on(x - 1, y) || !on(x, y - 1), dim = !on(x + 1, y) || !on(x, y + 1);
      p.set(x + 1, y + 1, lit && !dim ? RAMPS.olive[5] : dim ? RAMPS.olive[2] : ditherRamp(RAMPS.olive.slice(3, 6), 0.45 + 0.1 * (6 - x - y) / 6, x, y, bayer4));
    }
  });
  return p.toTexture();
}

export function create({ scene, events, toast, track, screens }) {
  const container = document.getElementById('game-container');
  const cleanup = [];
  const owned = [];            // cats built here (the Quartiers one belongs to the lounge)

  const prod = getProdRoom();

  // ── Cats ──
  const cats = CATS.map(spec => ({ ...spec, api: null, object: null, scale: spec.scale ?? 1 }));
  for (const c of cats) {
    if (c.kind === 'sleeping') continue;
    const api = createCat(c.kind);
    api.object.position.set(c.x, c.base, c.z);
    api.object.scale.setScalar(c.scale);
    if (c.kind === 'eyes') api.object.traverse(o => { o.renderOrder = AFTER_OVERLAYS; });
    scene.add(api.object);
    c.api = api;
    c.object = api.object;
    owned.push(c);
  }

  // The Quartiers cat is the lounge's. Look it up by what createCat tags it with and where it lies.
  const lounge = cats.find(c => c.kind === 'sleeping');
  let lookups = 0, nextLookup = 0;
  function findLoungeCat() {
    scene.traverse(o => {
      if (!lounge.object && o.userData?.catKind === 'sleeping' && Math.hypot(o.position.x - lounge.x, o.position.z - lounge.z) < 0.1) lounge.object = o;
    });
  }
  findLoungeCat();

  // ── The ring around the crosshair ──
  const ring = document.createElement('div');
  ring.id = 'cat-gaze';
  ring.setAttribute('aria-hidden', 'true');
  container.append(ring);
  let ringOn = false, ringStep = -1, doneTimer = 0, pulsing = false;

  function drawRing(progress) {
    const on = progress > 0.02;
    if (on !== ringOn) { ringOn = on; ring.classList.toggle('on', on); }
    const step = Math.round(progress * 100);
    if (on && step !== ringStep) { ringStep = step; ring.style.setProperty('--p', String(step / 100)); }
  }

  // Full ring, one flash, gone. (Under reduced motion the flash collapses to nothing: the toast carries it.)
  function pulseRing() {
    clearTimeout(doneTimer);
    pulsing = true;
    ring.style.setProperty('--p', '1');
    ring.classList.add('on', 'done');
    doneTimer = setTimeout(() => {
      ring.classList.remove('on', 'done');
      pulsing = false; ringOn = false; ringStep = -1;
    }, 520);
  }

  // ── Reactions ──
  let pickupMap = null;
  const reactions = [];

  function startReaction(c, t, calm) {
    c.api?.react?.(t);
    pickupMap ??= pickupTexture();
    const pickups = [];
    for (let i = 0; i < (calm ? 1 : 3); i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: pickupMap, transparent: true, depthWrite: false, opacity: 0 }));
      sprite.visible = false;
      sprite.renderOrder = AFTER_OVERLAYS;
      scene.add(sprite);
      pickups.push(sprite);
    }
    reactions.push({ c, t0: t, pickups });
  }

  function stepReactions(t, calm) {
    for (let k = reactions.length - 1; k >= 0; k--) {
      const r = reactions[k], c = r.c, u = t - r.t0;
      const over = u >= PICKUP_SECONDS;

      if (c.object && !calm) {
        // Purr: a fast little bob that fades out. The eyes have no body to bob: they blink slowly, twice.
        const decay = 1 - smooth(0, 2.2, u);
        const bob = over ? 0 : Math.sin(u * Math.PI * 2 * 4.2) * 0.045 * decay;
        const dip = (a, b) => (u > a && u < b ? Math.sin(((u - a) / (b - a)) * Math.PI) : 0);
        const blink = c.kind === 'eyes' ? 1 - 0.9 * Math.max(dip(0.2, 0.75), dip(1.05, 1.6)) : 1 + bob;
        c.object.scale.set(c.scale * (c.kind === 'eyes' ? 1 : 1 - bob * 0.35), c.scale * blink, c.scale);
      } else if (c.object) {
        c.object.scale.setScalar(c.scale);
      }

      r.pickups.forEach((h, i) => {
        const v = calm ? u / 1.6 : (u - i * 0.4) / 1.5;
        h.visible = !over && v > 0 && v < 1;
        if (!h.visible) return;
        const rise = calm ? 0.1 : 0.06 + 0.26 * v;
        const sway = calm ? 0 : Math.sin(v * 6 + i * 2) * 0.03;
        h.position.set(c.x + sway + (i - 1) * (calm ? 0 : 0.04), c.base + c.top + rise, c.z);
        h.material.opacity = smooth(0, 0.15, v) * (1 - smooth(0.6, 1, v));
        const s = 0.07 * (0.8 + 0.3 * smooth(0, 0.2, v));
        h.scale.set(s, s, 1);
      });

      if (over) {
        for (const h of r.pickups) { scene.remove(h); h.material.dispose(); }
        reactions.splice(k, 1);
      }
    }
  }

  // ── Found! ──
  function complete(c, t, calm) {
    found.add(c.id);
    events.emit('secret:found', { id: c.id });
    const text = `${c.toast} (SECRETS ${found.size}/${SECRETS_TOTAL})`;
    toast.show(text, { kind: 'system', urgent: true, ms: Math.max(6500, 65 * text.length) });
    startReaction(c, t, calm);
    pulseRing();
  }

  // ── Gaze state ──
  const modals = new Set();
  let touring = false;
  let target = null, progress = 0;

  cleanup.push(
    events.on('secret:found', ({ id } = {}) => { if (SECRET_IDS.includes(id)) found.add(id); }),
    events.on('modal:open', p => { modals.add(p?.id ?? '?'); }),
    events.on('modal:close', p => { modals.delete(p?.id ?? '?'); }),
    events.on('tour:start', () => { touring = true; }),
    events.on('tour:end', () => { touring = false; }),
    events.on('arcade:end', ({ won, score } = {}) => track('arcade-end', { won: !!won, score })),
  );

  if (import.meta.env.DEV) {
    const dev = {
      found: () => ({ count: found.size, total: SECRETS_TOTAL, ids: [...found] }),
      tp(id) {
        const c = CATS.find(k => k.id === id);
        if (!c || !window.__game) return false;
        const [sx, sz] = c.stand;
        window.__game.tp(sx, sz, (Math.atan2(c.z - sz, c.x - sx) * 180) / Math.PI);
        return true;
      },
      arcade: () => screens._items?.find(i => i.id === 'arcade')?.game ?? null,
    };
    queueMicrotask(() => { if (window.__game) window.__game.cats = dev; });
  }

  let clock = 0;
  return {
    update({ dt, t, player, focused }) {
      clock += dt;
      const calm = prefs.reducedMotion;

      prod?.update(t, calm);
      for (const c of owned) c.api.update(t, calm);
      if (!lounge.object && lookups < 5 && clock >= nextLookup) { lookups++; nextLookup = clock + 1; findLoungeCat(); }
      stepReactions(t, calm);

      // Who is the visitor staring at, if anyone?
      let aimed = null;
      if (!focused && !touring && modals.size === 0) {
        let best = Infinity;
        for (const c of cats) {
          if (found.has(c.id)) continue;
          const d = Math.hypot(c.x - player.x, c.z - player.y);
          if (d < best && gazeAt(player.x, player.y, player.angle, player.eyeY, c)) { best = d; aimed = c; }
        }
      }

      if (aimed && aimed !== target) { target = aimed; progress = 0; }   // another cat: start over
      if (aimed) progress = Math.min(1, progress + dt / GAZE.seconds);
      else progress = Math.max(0, progress - dt / GAZE.relax);

      if (aimed && progress >= 1) {
        complete(aimed, t, calm);
        progress = 0;
        target = null;
      } else if (!pulsing) {
        drawRing(progress);
      }
      return undefined;
    },

    dispose() {
      for (const off of cleanup) off();
      clearTimeout(doneTimer);
      ring.remove();
      for (const r of reactions) for (const h of r.pickups) { scene.remove(h); h.material.dispose(); }
      reactions.length = 0;
      pickupMap?.dispose();
      for (const c of cats) c.object?.scale.setScalar(1);
      for (const c of owned) { scene.remove(c.object); c.api.dispose(); }
    },
  };
}
