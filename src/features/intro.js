// Intro — the arrival sequence. The visitor steps into the hall; the view turns to each of the
// signs in turn while a ticket card, typed out like a terminal, explains the premise: this portfolio
// is in acceptance testing, the visitor is its tester, four cas de test (CAPACITÉS, SUCCÈS, IDENTITÉ,
// CONTACT), a report that keeps the score, a mug for a weapon. About 15 s, skippable at any moment.
// The script (voice, text, where the view rests) lives in data/intro.js.
//
// When it plays
//   Once per page load, when the visitor starts the game from the title screen. Not in a dev
//   `?autostart` (add `?intro` to see it there), not when the guided tour was asked for (button,
//   #visite), not when the address carries a hash (a deep link wants its own destination), and not
//   again in a tab that already played it (sessionStorage, in a try/catch: where storage is refused
//   it simply plays on every load).
//
// How it works
//   The player never leaves the spawn. Each frame the heading is eased toward the beat's sign
//   (smoothstep: at most ~85°/s), while update() returns { blockMovement: true }: the rest of the
//   level, the mug included, follows the turn as it does when the visitor looks around. The player is
//   handed back with player.teleport() on the very same spot (nothing to relocate), looking north
//   again when the sequence ran to its end, or wherever the view was when it was skipped.
//   The first 400 ms ignore every input, so the click or key that started the game (a double click…)
//   cannot skip it.
//
// Skipping: any key, click or tap, the PASSER button, ESC releasing the pointer lock, or something
// else taking over (a console, a dialog, a warp that relocates the player). The input that skips is
// swallowed so it never also acts in the game (a held E or Space has its auto-repeat swallowed too),
// with two exceptions on purpose: the keys that walk or turn pass through (the visitor starts moving
// at once; one already held when the game started, which only sends auto-repeats, ends it as soon as
// the opening grace is over), and a button or link under the pointer still gets its click (a CONTACT
// chip skips the intro and opens the sheet). Lone modifiers, Tab (so the keyboard can reach PASSER),
// F-keys and Ctrl/⌘/Alt chords do not skip.
//
// prefs.reducedMotion: no fade, no pan (the sign names are in the text), each beat shows at once.
// It takes a little longer to read, never past MAX_TOTAL.
// Touch: the beat that names the R key says where the report chip is instead (`touch` in data/intro.js).
//
// Events emitted   intro:beat { id, hint? }          a beat starts (id = its number, hint as in data/intro.js)
//                  intro:end { completed }           the sequence is over, run to its end or skipped
//                  modal:open / modal:close { id: 'intro' }   the notes, the gaze secrets and the tour rest
// Events listened  game:start, tour:start, modal:open (a foreign dialog ends the intro)
// DOM              #intro-ui (fade, ticket card, PASSER); body.intro-on while it runs, body.intro-mug
//                  while the mug is named.
// Analytics        track('intro-start'), track('intro-end', { done, by, beat })   by = what ended it
//
// DEV only (browser console):  __game.intro.play()   __game.intro.skip()   __game.intro.info()
//                              http://localhost:3000/?autostart&intro   plays it right away

import '../styles/intro.css';
import { arrival } from '../data/intro.js';
import { HUB } from '../engine/decor/atrium.js';
import { MAP } from '../engine/Map.js';
import { prefs } from '../engine/prefs.js';
import { ARRIVALS } from './shell.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const NB = '\u00a0';    // no-break space: French typography keeps « : » glued to its word

// ── The stage ─────────────────────────────────────────────────────────────────────────────────────
// The atrium spot the shell warps to (the Player.js spawn), looking north: the sequence is staged from
// here and hands the player back on it.
const [SPAWN_X, SPAWN_Z, SPAWN_DEG] = ARRIVALS.atrium;
const SPAWN = { x: SPAWN_X, z: SPAWN_Z, angle: SPAWN_DEG * DEG };

// Centre of the soffite sign over each doorway, on its wall plane (decor/thresholds.js hangs it on the
// wall above the opening). Read off the level map rather than typed in: the hall is the block of
// type-6 cells, each doorway is the run of type-0 cells in the wall against it, and the wall plane is
// the hall's edge (x = 9 and x = 16, z = 9 today). A side with no opening falls back to mid-wall.
function signCentres() {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  MAP.forEach((row, cz) => row.forEach((cell, cx) => {
    if (cell !== 6) return;
    x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); z0 = Math.min(z0, cz); z1 = Math.max(z1, cz);
  }));
  // Middle of the run of doorway cells between lo and hi (inclusive) along a wall, else of the wall.
  const mid = (lo, hi, isDoor) => {
    let first = -1, last = -1;
    for (let i = lo; i <= hi; i++) if (isDoor(i)) { if (first < 0) first = i; last = i; }
    return first < 0 ? (lo + hi + 1) / 2 : (first + last + 1) / 2;
  };
  return {
    west: [x0, mid(z0, z1, cz => MAP[cz]?.[x0 - 1] === 0)],
    east: [x1 + 1, mid(z0, z1, cz => MAP[cz]?.[x1 + 1] === 0)],
    north: [mid(x0, x1, cx => MAP[z0 - 1]?.[cx] === 0), z0],
  };
}
const SIGN = signCentres();

// ── Pure maths (no DOM) ───────────────────────────────────────────────────────────────────────────
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const norm = a => ((a % TAU) + TAU) % TAU;           // [0, 2π), as Player.js keeps its heading
const wrap = a => a - TAU * Math.round(a / TAU);     // the short way round
const smooth = u => u * u * (3 - 2 * u);
const bearing = (x, z) => norm(Math.atan2(z - SPAWN.z, x - SPAWN.x));   // heading from the spawn to a point

// Where the view rests for each `camera` key of the script, as headings in radians (0 east, π/2 south,
// 3π/2 north: the player's own angle). From the spawn the north sign and the hub are both dead ahead.
export const LOOK = {
  spawn: norm(SPAWN.angle),
  west: bearing(...SIGN.west),
  east: bearing(...SIGN.east),
  north: bearing(...SIGN.north),
  center: bearing(HUB.x, HUB.z),
};

// Pacing. The script is 377 characters: at 35 ms each the typing alone is 13 s, and with the time to
// finish reading every line it runs past the 18 s ceiling. So the typing goes at 26 ms (a little above
// reading speed) and each finished line stays up for a hold that grows with its length.
const LEAD = 0.12;                              // s of calm before the first character
const TYPE = 0.026;                             // s per character
const HOLD = { base: 0.38, char: 0.0045 };      // s the finished line stays: enough to finish reading it
const CALM = { base: 0.9, char: 0.029 };        // reduced motion: no typing, the whole line shows at once
const PAN = { min: 0.7, rate: 55 * DEG };       // s, and rad/s on average (smoothstep peaks at 1.5×)
const SETTLE = 0.35;                            // s the view rests on its sign before the next beat
const MAX_TOTAL = 18;                           // s: a longer script is paced faster, never longer

// The script as a timeline. Every beat starts its turn the moment it starts and types its text right
// after a short lead; it lasts as long as the text needs (typing + a hold scaled by its length) or, if
// longer, its turn + a rest. `look` maps the script's camera keys to headings; `calm` = reduced motion.
// Returns { items, duration, end }: each item = the beat + { n, start, end, from, to, pan, typeStart,
// typeEnd } in seconds and radians (`to - from` is the short way round, so the heading is continuous),
// and `end` is the heading the last beat rests on, unwrapped like `from`/`to`.
export function buildTimeline(beats, look, calm = false) {
  const items = [];
  let t = 0;
  let heading = look[beats[0].camera];
  for (const b of beats) {
    const delta = calm ? 0 : wrap(look[b.camera] - heading);
    const pan = Math.abs(delta) < 1e-3 ? 0 : Math.max(PAN.min, Math.abs(delta) / PAN.rate);
    const n = b.text.length;
    const lead = calm ? 0 : LEAD;
    const typing = calm ? 0 : n * TYPE;
    const read = calm ? CALM.base + n * CALM.char : HOLD.base + n * HOLD.char;
    const duration = Math.max(lead + typing + read, pan > 0 ? pan + SETTLE : 0);
    items.push({ ...b, n, start: t, end: t + duration, from: heading, to: heading + delta, pan, typeStart: t + lead, typeEnd: t + lead + typing });
    t += duration;
    heading += delta;
  }
  const k = t > MAX_TOTAL ? MAX_TOTAL / t : 1;
  if (k < 1) {
    for (const it of items) { it.start *= k; it.end *= k; it.pan *= k; it.typeStart *= k; it.typeEnd *= k; }
  }
  return { items, duration: t * k, end: heading };
}

// ── The feature ───────────────────────────────────────────────────────────────────────────────────
const BLOCK = Object.freeze({ blockMovement: true });
const GRACE_MS = 400;           // input ignored this long after the start
const MOVED = 0.05;             // m: further than this from the spawn, the player was relocated by someone else
const SEEN_KEY = 'portfolio:intro';
const IGNORED_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'ScrollLock', 'Tab',
  'Dead', 'Unidentified', 'ContextMenu', 'PrintScreen', 'Pause']);
// What Input.js turns into walking or turning: these keys end the intro and go on to do their job.
const MOVE_CODES = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);
// The two keys Input.js turns into an interact on every keydown, auto-repeat included.
const INTERACT_CODES = new Set(['KeyE', 'Space']);
// touchstart only matters where Pointer Events are missing; pointerdown is the one that normally ends it.
const CANCEL_EVENTS = [['keydown', { capture: true }], ['pointerdown', { capture: true }],
  ['touchstart', { capture: true, passive: false }]];

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const within = (node, parent) => node instanceof Node && parent.contains(node);

const hasSeen = () => { try { return sessionStorage.getItem(SEEN_KEY) === '1'; } catch { return false; } };
const markSeen = () => { try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* storage refused: it plays on every load */ } };

export function create({ player, input, screens, events, track }) {
  const container = document.getElementById('game-container');
  if (!container) return undefined;
  const body = document.body;
  const isTouch = () => body.classList.contains('is-touch');
  // The script for this screen: a beat that names a key carries its touch wording (data/intro.js).
  const script = () => (isTouch() ? arrival.map(b => (b.touch ? { ...b, text: b.touch } : b)) : arrival);

  // ── DOM ────────────────────────────────────────────────────────────────────
  const root = el('div');
  root.id = 'intro-ui';
  root.hidden = true;

  const fade = el('div', 'intro-fade');
  fade.setAttribute('aria-hidden', 'true');

  const card = el('div', 'intro-card');
  const head = el('div', 'intro-head');
  const tag = el('span', 'intro-tag');
  tag.setAttribute('aria-hidden', 'true');
  const who = el('span', 'intro-who');
  tag.append(who);
  const pips = el('span', 'intro-pips');
  pips.setAttribute('aria-hidden', 'true');
  const pipEls = arrival.map(() => pips.appendChild(el('i')));
  const hint = el('span', 'intro-hint');
  const skip = el('button', 'intro-skip', 'PASSER');
  skip.type = 'button';
  skip.setAttribute('aria-label', 'Passer l\'introduction');
  head.append(tag, pips, hint, skip);

  // The text is typed over its own, invisible full version, so the line breaks are final from the
  // first character and nothing jumps while it types. The cursor between the two is an inline box that
  // holds a word joiner (no line break may open beside it, even in the middle of a word) and draws its
  // block from a positioned pseudo-element. Screen readers get the whole line once, in `announce`,
  // instead of one character at a time.
  const line = el('p', 'intro-text');
  line.setAttribute('aria-hidden', 'true');
  const typed = el('span', 'intro-typed');
  const rest = el('span', 'intro-rest');
  line.append(typed, el('i', 'intro-cursor', '\u2060'), rest);
  const announce = el('p', 'intro-sr');
  announce.setAttribute('role', 'status');
  announce.setAttribute('aria-live', 'polite');
  announce.setAttribute('aria-atomic', 'true');
  card.append(head, line, announce);

  root.append(fade, card);
  container.append(root);

  // ── State ──────────────────────────────────────────────────────────────────
  const cleanup = [];
  let started = false;        // game:start happened
  let tourAsked = false;      // the guided tour started on this very click
  let forced = false;         // DEV: play() on a game that has not started yet
  let running = false;
  let plan = null;
  let clock = 0;              // s into the sequence
  let index = -1;             // current beat
  let shown = -1;             // characters typed so far, to touch the DOM only when it changes
  let lit = false;            // the fade from black has been released
  let veil = false;           // there is a fade to release (not with reduced motion)
  let graceUntil = 0;
  let hadLock = false;
  let hideTimer = 0;
  let releaseRepeat = null;   // drops the guard that swallows the auto-repeat of the key that skipped

  // ── Beats ──────────────────────────────────────────────────────────────────
  function showBeat(i) {
    const b = plan.items[i];
    index = i;
    shown = -1;
    card.dataset.voice = b.voice;
    who.textContent = b.voice === 'nicolas' ? 'NICOLAS //' : 'SYSTÈME //';
    announce.textContent = `${b.voice === 'nicolas' ? 'Nicolas' : 'Système'}${NB}: ${b.text}`;
    pipEls.forEach((p, k) => {
      p.classList.toggle('done', k < i);
      p.classList.toggle('now', k === i);
    });
    card.classList.remove('blip');
    void card.offsetWidth;                         // restart the blip
    card.classList.add('on', 'blip');
    body.classList.toggle('intro-mug', b.cue === 'mug');
    events.emit('intro:beat', b.hint ? { id: b.beat, hint: b.hint } : { id: b.beat });
  }

  // ── Starting and stopping ────────────────────────────────────────────────────
  // The key that skipped may still be held: Input.js would turn its auto-repeat into a fresh interact
  // (a console, a plinth, the hub). Swallow the repeats until the key goes up.
  function guardRepeat(code) {
    releaseRepeat?.();
    const eat = e => { if (e.code === code && e.repeat) e.stopPropagation(); };
    const drop = e => { if (e.type === 'blur' || e.code === code) releaseRepeat?.(); };
    window.addEventListener('keydown', eat, true);
    window.addEventListener('keyup', drop, true);
    window.addEventListener('blur', drop);
    releaseRepeat = () => {
      window.removeEventListener('keydown', eat, true);
      window.removeEventListener('keyup', drop, true);
      window.removeEventListener('blur', drop);
      releaseRepeat = null;
    };
  }

  function onCancel(e) {
    if (!running || performance.now() < graceUntil) return;
    // The button does its own job (its click ends the intro): pointer, touch, Enter and Space on it.
    if (within(e.target, skip) && (e.type !== 'keydown' || e.key === 'Enter' || e.key === ' ')) return;
    if (e.type === 'keydown') {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || IGNORED_KEYS.has(e.key) || /^F\d{1,2}$/.test(e.key)) return;
      if (MOVE_CODES.has(e.code)) { finish(false, 'move'); return; }   // not swallowed: the visitor walks at once
      e.stopPropagation();
      if (INTERACT_CODES.has(e.code)) guardRepeat(e.code);
      finish(false, 'key');
      return;
    }
    // A pointer or finger. Over a button or a link (a chip, the fullscreen button) the click it makes
    // is kept; anywhere else the press is the visitor's alone: no sip, no ghost click.
    const control = e.target instanceof Element && e.target.closest('button, a, input, [role="button"]');
    e.stopPropagation();
    if (!control) e.preventDefault();
    finish(false, e.type);
  }

  function onLock() {
    if (document.pointerLockElement) { hadLock = true; return; }
    // ESC while the pointer is locked: the browser keeps that keydown and only lets go of the lock.
    // main.js releases the lock itself around a console, which is not ours (see step()).
    if (running && hadLock && !screens.focused) finish(false, 'unlock');
    hadLock = false;
  }

  function begin() {
    if (running || !started || screens.focused) return false;
    const calm = prefs.reducedMotion;
    plan = buildTimeline(script(), LOOK, calm);
    // Staged from the spawn, looking north (it is already there; only a dev replay from elsewhere moves).
    player.teleport(SPAWN.x, SPAWN.z, LOOK.spawn);

    running = true;
    clock = 0; index = -1; shown = -1; lit = false;
    graceUntil = performance.now() + GRACE_MS;
    hadLock = !!document.pointerLockElement;
    markSeen();

    hint.textContent = isTouch() ? 'Touchez l\'écran pour passer.' : 'Une touche ou un clic pour passer.';
    card.classList.remove('on', 'blip');
    card.classList.toggle('calm', calm);
    delete card.dataset.voice;
    typed.textContent = rest.textContent = announce.textContent = '';
    pipEls.forEach(p => p.classList.remove('done', 'now'));
    clearTimeout(hideTimer);

    // From the title screen the level is not on screen yet: it comes up out of black.
    veil = !calm;
    fade.classList.toggle('on', veil);
    root.hidden = false;
    body.classList.add('intro-on');

    for (const [type, opts] of CANCEL_EVENTS) window.addEventListener(type, onCancel, opts);
    document.addEventListener('pointerlockchange', onLock);
    events.emit('modal:open', { id: 'intro' });
    track('intro-start');
    return true;
  }

  // Hands the camera back. The player already stands where the view is, so there is nothing to
  // relocate: teleporting onto itself only resets the eye height. A sequence that ran to its end
  // leaves the view on the opening heading, north; a skipped one leaves it where it was.
  function finish(completed, why) {
    if (!running) return;
    running = false;
    for (const [type, opts] of CANCEL_EVENTS) window.removeEventListener(type, onCancel, opts);
    document.removeEventListener('pointerlockchange', onLock);
    if (completed) player.angle = norm(plan.end);
    player.teleport(player.x, player.y, player.angle);

    body.classList.remove('intro-on', 'intro-mug');
    skip.blur();
    card.classList.remove('on');
    if (completed) {
      // The last line fades out over the level the visitor already walks in.
      hideTimer = setTimeout(() => { root.hidden = true; }, 350);
    } else {
      root.hidden = true;
    }
    fade.classList.remove('on');

    events.emit('modal:close', { id: 'intro' });
    events.emit('intro:end', { completed });
    track('intro-end', { done: completed, by: why, beat: plan.items[Math.max(index, 0)].beat });
  }

  skip.addEventListener('click', () => finish(false, 'skip'));
  cleanup.push(events.on('tour:start', () => { tourAsked = true; }));
  cleanup.push(events.on('modal:open', ({ id } = {}) => { if (running && id !== 'intro') finish(false, 'interrupted'); }));

  // Why this load does not play it, or null.
  function skipReason() {
    // The tour's own game:start handler may run before or after this one: it clears the flag and
    // announces tour:start, so both are read.
    if (tourAsked || body.dataset.tour === 'start') return 'tour';
    if (location.hash.length > 1) return 'hash';
    if (import.meta.env.DEV && !forced) {
      const q = new URLSearchParams(location.search);
      if (q.has('tour')) return 'tour';
      if (q.has('intro')) return null;     // asked for: plays even where this tab has seen it
      if (q.has('autostart')) return 'autostart';
    }
    if (!forced && hasSeen()) return 'seen';
    return null;
  }

  cleanup.push(events.on('game:start', () => {
    started = true;
    if (!skipReason()) begin();
  }));

  if (import.meta.env.DEV) {
    const dev = {
      play() {
        if (!started) { forced = true; window.__game?.start?.(); return true; }
        return begin();
      },
      skip: () => finish(false, 'dev'),
      info: () => {
        const p = buildTimeline(script(), LOOK, prefs.reducedMotion);
        return {
          seconds: +p.duration.toFixed(2),
          beats: p.items.map(b => ({ beat: b.beat, camera: b.camera, start: +b.start.toFixed(2), end: +b.end.toFixed(2), pan: +b.pan.toFixed(2) })),
        };
      },
    };
    // __game is assigned by main.js right after the features are built.
    queueMicrotask(() => { if (window.__game) window.__game.intro = dev; });
  }

  // No console may take the [E] while the sequence runs.
  const unguard = screens.addInteractGuard(() => running);

  // ── Frame ─────────────────────────────────────────────────────────────────────
  function step({ dt, focused }) {
    // A console or a deep link took the player: it is not ours any more.
    if (focused) { finish(false, 'interrupted'); return undefined; }
    // Something relocated the player (a hash change warping to a room): the intention is theirs, not ours.
    if (Math.abs(player.x - SPAWN.x) > MOVED || Math.abs(player.y - SPAWN.z) > MOVED) { finish(false, 'moved'); return undefined; }
    // A walking or turning key (or the touch stick) that was already down when the sequence began
    // only ever sends auto-repeats, which onCancel() ignores: once the opening grace is over, a held
    // one ends it, the same as a fresh press would.
    if (performance.now() >= graceUntil && (input.moveX || input.moveY || input.rotLeft || input.rotRight)) {
      finish(false, 'move');
      return undefined;
    }
    if (!lit) {
      lit = true;
      if (veil) { void fade.offsetWidth; fade.classList.remove('on'); }   // out of black, over ~0.9 s
    }

    clock += dt;
    if (clock >= plan.duration) { finish(true, 'end'); return undefined; }
    while (index + 1 < plan.items.length && clock >= plan.items[index + 1].start) showBeat(index + 1);

    const b = plan.items[index];
    const u = b.pan > 0 ? smooth(clamp((clock - b.start) / b.pan, 0, 1)) : 1;
    player.angle = norm(b.from + (b.to - b.from) * u);

    const span = b.typeEnd - b.typeStart;
    const k = clock >= b.typeEnd ? b.n : clock < b.typeStart ? 0 : Math.min(b.n, 1 + Math.floor((clock - b.typeStart) / span * b.n));
    if (k !== shown) {
      shown = k;
      typed.textContent = b.text.slice(0, k);
      rest.textContent = b.text.slice(k);
    }
    return BLOCK;
  }

  return {
    update(frame) {
      if (!running) return undefined;
      try {
        return step(frame);
      } catch (err) {
        console.error('[intro] aborted', err);
        finish(false, 'error');
        return undefined;
      }
    },

    dispose() {
      finish(false, 'dispose');
      releaseRepeat?.();
      clearTimeout(hideTimer);
      unguard();
      for (const off of cleanup) off();
      root.remove();
    },
  };
}
