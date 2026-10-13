// Notes — small physical objects stuck here and there in the level (a post-it, an engraved plaque, a
// label, a paper tag) that the visitor reads on demand. They replace the floating bubbles: nothing glows
// toward you, nothing pops up, and it is always clear where a message comes from, because it is written
// on something you can see. The words live in data/notes.js, the objects are drawn by props/notes3d.js.
//
// How it plays
//   - Look at a note from within 1.7 m: the prompt reads `[ E ] LIRE LE POST-IT` (LA PLAQUE,
//     L'ÉTIQUETTE, LE MOT). A fresh press of E (or a tap on the action button) opens its card.
//   - The card is a small paper / metal / label / tag shown at the bottom of the screen, under the name of
//     whoever speaks (NICOLAS //, SYSTÈME //, CHAT //). It never blocks anything: the visitor keeps walking
//     and looking around. It stays while they are within 2.6 m of the note, for at least a reading time
//     (45 ms per character, 3 s minimum), and goes away when they walk off, press E again on the same note,
//     press ESC, or tap its ✕ on a touch screen. One card at a time: reading another note replaces it.
//   - A note is "unread" until its card has been opened: unread, it is a touch brighter and wears a faint
//     halo; read, it dims and shows a tick (props/notes3d.js).
//   - The card, the prompt and the 3D cue rest while a console is focused, a dialog is open (shell, report),
//     the guided tour or the arrival sequence runs.
//
// One press, one meaning
//   Some notes are stuck on something that has its own [E] (the DF and CONTACT consoles, three plinths of the
//   gallery). Close to them the visitor aims at one thing or the other, and the one they aim at wins: a note
//   claims the press only where its own aiming cone holds AND no other interaction is offered with the
//   crosshair nearer to it than to the note. Where a console would be offered, a guard keeps it out of the
//   way (screens.addInteractGuard); the plinths' prompt is overridden because this feature runs before
//   features/gallery.js in FACTORIES (the first prompt wins, and the first to consume the press): keep it
//   ahead of it. Every other note stands clear of every other interaction: a sweep of the whole level (every
//   walkable spot, every heading) proves it, and proves that aiming at the heart of a console, a plinth, the
//   contact frame or the hub never shows a note.
//   A note is read from the side it faces, never when the way to it is blocked by a wall, a prop or a standing
//   lamp, nor while most of it is out of the frame (the camera never pitches: a plate low on a plinth slides
//   off the bottom of the screen as the visitor closes in), and a fresh press is required for every action (a
//   held E or its auto-repeat never opens, closes or chains).
//
// Events emitted   note:read { id }   a card was opened for a note for the first time this visit (the
//                                     report counts them; already tracked here as 'note-read')
// Events listened  game:start · modal:open / modal:close { id } (shell sheets, report, tour, intro: any dialog)
// Analytics        track('note-read', { id })
// Draw calls       2 (paper and halos for all notes, props/notes3d.js). No light.
//
// DEV only (browser console):  __game.notes.list()      every note: slot, carrier, voice, read, where to stand
//                              __game.notes.tp(slot)    stands you in front of it (a spot proved to show its prompt)
//                              __game.notes.read(slot)  opens its card, kept until E / ESC (any distance)
//
// Exports (for the validators): AIM, FRAME, CONSOLE_COS, GALLERY, PROMPT, createAim(items, { aspect })

import '../styles/notes.css';
import { notes, PLACEMENTS } from '../data/notes.js';
import { createNoteProps, sizeOf } from '../engine/props/notes3d.js';
import { isWall, floorAt } from '../engine/Map.js';
import { PROPS3D } from '../engine/Props3D.js';
import { spriteAABBs } from '../engine/Sprites2D.js';
import { SCREENS, ARCADE, FOCUS_RANGE, consoleAABBs } from '../engine/Screens.js';
import { getDynamicPlinths, getContactFrame } from '../engine/PlinthGenerator.js';

// ── Tunables ─────────────────────────────────────────────────────────────────────────────────────
export const AIM = {
  reach: 1.7,       // m from the player to the note
  min: 0.6,         // m: closer than this the note fills the screen and aiming means nothing
  cos: 0.93,        // cosine of the aiming cone (~21°): you have to look at it
  view: 0.4,        // cosine of the widest angle between the note's normal and the way back to the eye (~66°)
};
// The camera has a fixed horizontal field of view (Renderer.js H_FOV, π/3) and never pitches, so what the
// frame holds above and below the eye depends on the window: tan(vertical half angle) = tan(30°) / aspect.
// `seen`: the share of a note's height that has to be on screen before its prompt shows. `maxAspect`: windows
// wider than this (21:9 and beyond) are treated as if they were not, or the lowest notes would be out of reach.
export const FRAME = { hfov: Math.PI / 3, seen: 0.75, maxAspect: 2.4 };
const frameTanOf = aspect => Math.tan(FRAME.hfov / 2) / Math.min(aspect, FRAME.maxAspect);
const STAY = 2.6;             // m: past this the card goes, once it has been up for its reading time
const READ_MS_PER_CHAR = 45;
const READ_MS_MIN = 3000;
const DEBOUNCE = 0.3;         // s after an action during which presses are ignored
const CLEAR_DELAY = 0.35;     // s the card needs to fade out before its text is emptied (a live region)
const HOST_SLACK = 0.08;      // m: a box this close to a note is what it is stuck to, not something in the way
const CONSOLE_TOP = 0.86;     // m: height of a console cabinet (ScreenManager.js buildMainframe)

// What the rest of the game offers on [E] (the notes must know it to yield). These mirror the constants of
// ScreenManager._candidate (FOCUS_RANGE and its 0.35 cone) and of features/gallery.js; the validator checks
// them against the sources, so a change there cannot slip by.
export const CONSOLE_COS = 0.35;
export const GALLERY = { plinth: 1.3, frame: 1.8, cos: 0.55, front: 0.12 };

export const PROMPT = Object.freeze({
  postit: '[ E ] LIRE LE POST-IT',
  plaque: '[ E ] LIRE LA PLAQUE',
  sticker: '[ E ] LIRE L\'ÉTIQUETTE',
  tag: '[ E ] LIRE LE MOT',
  close: '[ E ] FERMER',
});

const VOICES = {
  nicolas: 'NICOLAS //',
  systeme: 'SYSTÈME //',
  chat: 'CHAT //',
};

// ── Aiming (pure: no DOM, no scene; shared with the validators) ──────────────────────────────────
// items: [{ id, x, z, y, fx, fz, billboard, view?, half? }]  (x, z: where the note is; fx, fz: the way it
// faces; view: its own AIM.view; half: half its height in metres, for the frame test).
// aspect: width / height of the window (it sets how much of a wall the frame holds above and below the eye).
// Returns { targets, aimedAt(player), setAspect(aspect) }: aimedAt gives the item the player is reading-aiming
// at, or null. `player` = { x, y (world z), angle, eyeY }.
export function createAim(items, { aspect = 16 / 9 } = {}) {
  let frameTan = frameTanOf(aspect);
  const consoleBoxes = consoleAABBs(0);
  const consoles = [...SCREENS, ARCADE].map((s, i) => ({
    x: s.x, z: s.z, box: { ...consoleBoxes[i], top: floorAt(s.x, s.z) + CONSOLE_TOP },
  }));
  const frame = getContactFrame();
  const gallery = [
    ...getDynamicPlinths().map(p => ({ x: p.x, z: p.z, face: p.face, reach: GALLERY.plinth })),
    { x: frame.x, z: frame.z, face: frame.facing, reach: GALLERY.frame },
  ];
  const solids = [
    ...PROPS3D.map(p => ({ minX: p.x - p.w / 2, maxX: p.x + p.w / 2, minZ: p.y - p.d / 2, maxZ: p.y + p.d / 2, top: floorAt(p.x, p.y) + p.h })),
    ...consoles.map(c => c.box),
  ];
  // The solid sprites (tech pillars, lamps, barrels) are cut-outs that face the screen: only their centre and
  // width are known here (Sprites2D.js keeps their height to itself). They are taken at the full width of
  // their picture, which errs on the side of no prompt, and as tall as any line of sight. That is exact for
  // the only ones that can come between a visitor and a note, the 1.4 m pillars and the 0.86 m lamp (a line of
  // sight stays under 0.7 m); the lower ones are farther than AIM.reach from every note.
  const sprites = spriteAABBs(0).map(b => ({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, half: (b.maxX - b.minX) / 2 }));

  const targets = items.map(it => ({
    ...it,
    view: it.view ?? AIM.view,
    half: it.half ?? 0,
    // What stands in the way of the eye: everything but the thing the note is stuck to.
    solids: solids.filter(b => !(it.x > b.minX - HOST_SLACK && it.x < b.maxX + HOST_SLACK && it.z > b.minZ - HOST_SLACK && it.z < b.maxZ + HOST_SLACK)),
    sprites: sprites.filter(s => !(Math.abs(it.x - s.x) < s.half + HOST_SLACK && Math.abs(it.z - s.z) < s.half + HOST_SLACK)),
  }));

  // Walls, props and sprites between the eye and the note (a note behind a crate is not readable). (ax, az):
  // the way the player looks, which is the normal of the plane every sprite lies in.
  function clear(p, t, ax, az) {
    const dx = t.x - p.x, dz = t.z - p.y, d = Math.hypot(dx, dz);
    const run = Math.max(0, d - 0.03), n = Math.max(1, Math.ceil(run / 0.1));
    for (let i = 1; i <= n; i++) {
      const u = (i / n) * run / d;
      const x = p.x + dx * u, z = p.y + dz * u, y = p.eyeY + (t.y - p.eyeY) * u;
      if (isWall(x, z)) return false;
      for (const b of t.solids) if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && y < b.top) return false;
    }
    // Where the line of sight crosses a sprite's plane (a share u of the way to the note), is it within its width?
    const depth = dx * ax + dz * az;      // > 0: the note is inside the aiming cone
    for (const s of t.sprites) {
      const sx = s.x - p.x, sz = s.z - p.y;
      const u = (sx * ax + sz * az) / depth;
      if (u > 0 && u < run / d && Math.abs((dx * u - sx) * -az + (dz * u - sz) * ax) < s.half) return false;
    }
    return true;
  }

  // The camera never pitches: once the visitor is close, a note far below (or above) the eye is no longer in
  // the frame. At `depth` metres ahead the frame holds ±depth·tan above and below the eye.
  function framed(p, t, depth) {
    const lim = depth * frameTan, mid = t.y - p.eyeY;
    return Math.min(mid + t.half, lim) - Math.max(mid - t.half, -lim) >= 2 * t.half * FRAME.seen;
  }

  // The cosine of the aim of whatever else is offered on [E] here (-1 when nothing is): the nearest console in
  // range, or the best aimed plinth / contact frame, whichever the crosshair is closer to.
  function rival(p, ax, az) {
    let best = -1;
    let near = FOCUS_RANGE;
    for (const c of consoles) {
      const dx = c.x - p.x, dz = c.z - p.y, d = Math.hypot(dx, dz);
      if (d > near) continue;
      const dot = (ax * dx + az * dz) / (d || 1);
      if (dot < CONSOLE_COS) continue;
      near = d;
      best = dot;
    }
    for (const g of gallery) {
      const dx = g.x - p.x, dz = g.z - p.y, d = Math.hypot(dx, dz);
      if (d > g.reach || d < 1e-3 || -(dx * g.face[0] + dz * g.face[1]) < GALLERY.front) continue;
      const dot = (ax * dx + az * dz) / d;
      if (dot > GALLERY.cos && dot > best) best = dot;
    }
    return best;
  }

  return {
    targets,
    aimedAt(p) {
      const ax = Math.cos(p.angle), az = Math.sin(p.angle);
      let best = null, bestDot = AIM.cos, other = NaN;
      for (const t of targets) {
        const dx = t.x - p.x, dz = t.z - p.y, d = Math.hypot(dx, dz);
        if (d > AIM.reach || d < AIM.min) continue;
        const dot = (ax * dx + az * dz) / d;
        if (dot <= bestDot) continue;
        if (!t.billboard && -(dx * t.fx + dz * t.fz) / d < t.view) continue;
        if (!framed(p, t, d * dot)) continue;
        if (!clear(p, t, ax, az)) continue;
        if (Number.isNaN(other)) other = rival(p, ax, az);
        if (other > dot) continue;       // the crosshair is nearer to something else: that one wins
        best = t;
        bestDot = dot;
      }
      return best;
    },
    setAspect(a) { frameTan = frameTanOf(a); },
  };
}

// ── The feature ──────────────────────────────────────────────────────────────────────────────────
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

export function create({ scene, input, screens, events, track }) {
  if (!notes.length) return undefined;

  const host = document.getElementById('game-container') ?? document.body;
  const cleanup = [];
  const listen = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    cleanup.push(() => target.removeEventListener(type, fn, opts));
  };

  // ── The objects and what can be aimed at ──
  const byId = new Map(notes.map(n => [n.id, n]));
  const props = createNoteProps(scene, notes.map(n => ({ id: n.id, carrier: n.carrier, voice: n.voice, pose: PLACEMENTS[n.id] })));
  const windowAspect = () => (window.innerWidth > 0 && window.innerHeight > 0 ? window.innerWidth / window.innerHeight : 16 / 9);
  const aim = createAim(notes.map(n => {
    const p = PLACEMENTS[n.id];
    return { id: n.id, x: p.x, z: p.z, y: p.y, fx: p.facing[0], fz: p.facing[1], billboard: !!p.billboard, view: p.view, carrier: n.carrier, host: p.host,
      half: sizeOf(n.carrier).h * (p.scale ?? 1) / 2 };
  }), { aspect: windowAspect() });
  const hosted = aim.targets.filter(t => t.host);

  // ── The card (a polite live region: the text is set when it opens and emptied once it has faded) ──
  const card = el('div');
  card.id = 'note-card';
  card.setAttribute('role', 'status');
  card.setAttribute('aria-live', 'polite');
  card.setAttribute('aria-atomic', 'true');
  const face = el('div', 'note-face');
  const tagEl = el('span', 'note-tag');
  const leadEl = el('p', 'note-lead');
  const textEl = el('p', 'note-text');
  face.append(tagEl, leadEl, textEl);
  const closeBtn = el('button', 'note-close', '✕');
  closeBtn.type = 'button';
  closeBtn.tabIndex = -1;       // keyboard users close with E or ESC; the button is for touch
  closeBtn.setAttribute('aria-label', 'Fermer la note');
  card.append(face, closeBtn);
  host.appendChild(card);

  // The toast shares the bottom-centre slot: while it is up, the card rides above it.
  const toastEl = document.getElementById('toast');
  const syncLift = () => {
    if (!toastEl || toastEl.hidden) { card.style.bottom = ''; return; }
    const lift = host.getBoundingClientRect().bottom - toastEl.getBoundingClientRect().top;
    card.style.bottom = `${Math.round(lift + 10)}px`;
  };
  const resizeObs = typeof ResizeObserver === 'function' ? new ResizeObserver(syncLift) : null;
  if (resizeObs) { resizeObs.observe(host); if (toastEl) resizeObs.observe(toastEl); }

  // ── State ──
  let clock = 0;
  let started = false;          // game:start happened
  let open = null;              // the note whose card is up: { note, at, readFor, pinned } | null
  let clearIn = 0;              // countdown to empty the card once it has faded
  let quietUntil = 0;
  let eHeld = false;            // E or Space is physically down
  let freshKey = false;         // its keydown (not an auto-repeat) happened since the last frame
  let wasDown = false;          // previous frame's touch contact
  let lastActive = null;        // id of the console focused on the previous frame
  const read = new Set();
  const modals = new Set();     // ids of the dialogs open over the level (tracked by id: closing in any order is safe)
  const out = { prompt: '' };

  const live = () => started && modals.size === 0;

  function readingTime(note) {
    return Math.max(READ_MS_MIN, [...note.text].length * READ_MS_PER_CHAR) / 1000;
  }

  function show(note, pinned = false) {
    card.dataset.carrier = note.carrier;
    card.dataset.voice = note.voice;
    card.dataset.finish = PLACEMENTS[note.id].finish ?? '';
    tagEl.textContent = VOICES[note.voice];
    // The cat speaks first ("MROW.") and the SYSTÈME translates: two lines of one text, in two voices.
    const cat = note.voice === 'chat' && /^(MROW\.)\s+([\s\S]+)$/.exec(note.text);
    leadEl.textContent = cat ? cat[1] : '';
    textEl.textContent = cat ? cat[2] : note.text;
    card.classList.add('on');
    clearIn = 0;
    open = { note, at: clock, readFor: readingTime(note), pinned };
    if (!read.has(note.id)) {
      read.add(note.id);
      props.setRead(note.id);
      events.emit('note:read', { id: note.id });
      track('note-read', { id: note.id });
    }
  }

  function hide() {
    if (!open) return;
    open = null;
    card.classList.remove('on');
    clearIn = CLEAR_DELAY;
  }

  // ── Input: a fresh press only ──
  // Input re-arms `interact` on every auto-repeat of a held key, so a tap has to be told apart from a key
  // repeat: taps only count while neither E nor Space is down.
  const isUseKey = e => e.code === 'KeyE' || e.code === 'Space';
  listen(window, 'keydown', e => {
    if (isUseKey(e)) { if (!e.repeat && !eHeld) freshKey = true; eHeld = true; }
    else if (e.code === 'Escape' && open) hide();
  });
  listen(window, 'keyup', e => { if (isUseKey(e)) eHeld = false; });
  listen(window, 'blur', () => { eHeld = false; });   // the keyup of a key held while the window lost focus never comes
  listen(closeBtn, 'click', () => hide());

  cleanup.push(
    events.on('game:start', () => { started = true; }),
    events.on('modal:open', p => { modals.add(p?.id ?? '?'); hide(); }),
    events.on('modal:close', p => { modals.delete(p?.id ?? '?'); }),
  );

  // The guard keeps the consoles out of the way while a note is aimed at. One computation per frame and
  // pose: the guard (called by ScreenManager) and update() share it.
  let sx = NaN, sy = NaN, sa = NaN, se = NaN, seenAim = null;
  // The frame follows the window (as the renderer's field of view does): same events, and the pose seen last is dropped.
  const onResize = () => { aim.setAspect(windowAspect()); sx = NaN; };
  listen(window, 'resize', onResize);
  listen(window, 'orientationchange', onResize);
  const aimAt = p => {
    if (p.x !== sx || p.y !== sy || p.angle !== sa || p.eyeY !== se) {
      sx = p.x; sy = p.y; sa = p.angle; se = p.eyeY;
      seenAim = aim.aimedAt(p);
    }
    return seenAim;
  };
  const unguard = screens.addInteractGuard(p => live() && aimAt(p) !== null);

  if (import.meta.env.DEV) {
    const dev = {
      list: () => notes.map(n => ({ slot: n.id, carrier: n.carrier, voice: n.voice, read: read.has(n.id), stand: PLACEMENTS[n.id].stand })),
      tp(slot) {
        const s = PLACEMENTS[slot]?.stand;
        if (s) window.__game.tp(s[0], s[1], s[2]);
        return !!s;
      },
      read(slot) {
        const note = byId.get(slot);
        if (note) show(note, true);
        return !!note;
      },
    };
    // __game is assigned by main.js right after the features are built.
    queueMicrotask(() => { if (window.__game) window.__game.notes = dev; });
  }

  return {
    update({ dt, t, player, focused }) {
      clock += dt;
      props.update(t, player);

      // A note stuck on a console is out of the picture while that console is in front of the camera.
      const active = screens.activeId;
      if (active !== lastActive) {
        lastActive = active;
        for (const h of hosted) props.setHidden(h.id, h.host === active);
      }

      // A fresh press only: the rising edge of E / Space (auto-repeat has none) or a new touch.
      const down = input.interact && !eHeld;
      const fresh = freshKey || (down && !wasDown);
      freshKey = false;
      wasDown = down;

      if (focused || !live()) { hide(); }
      if (clearIn > 0 && (clearIn -= dt) <= 0) { tagEl.textContent = ''; leadEl.textContent = ''; textEl.textContent = ''; }
      if (focused || !live()) return undefined;

      // The card follows the visitor for as long as they are close, and for at least its reading time.
      if (open && !open.pinned) {
        const n = PLACEMENTS[open.note.id];
        if (Math.hypot(player.x - n.x, player.y - n.z) > STAY && clock - open.at >= open.readFor) hide();
      }

      const target = aimAt(player);
      if (!target) return undefined;
      // While a note is aimed at, the press is its own: whatever it does, no other feature (the gallery runs
      // after this one) may see a press, a held key's auto-repeat or a double tap.
      input.consumeInteract();
      const note = byId.get(target.id);
      if (fresh && clock >= quietUntil) {
        quietUntil = clock + DEBOUNCE;
        if (open?.note === note) hide(); else show(note);
      }
      out.prompt = open?.note === note ? PROMPT.close : PROMPT[note.carrier];
      return out;
    },

    dispose() {
      unguard();
      for (const off of cleanup) off();
      resizeObs?.disconnect();
      props.dispose();
      card.remove();
    },
  };
}
