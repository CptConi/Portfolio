// Guided tour — "VISITE GUIDÉE · 40 s". The camera walks the level on rails while French subtitles
// comment on it: the hall, the Armurerie (the SKILLS console opens for a few seconds), the Trophées
// (the MISSIONS console opens on the flagship mission), the Quartiers, and back to the hall. The
// subtitles are the final copy, verbatim; the four cas de test they refer to (CAPACITÉS, SUCCÈS,
// IDENTITÉ, CONTACT) are the ones of the report (features/recette.js).
//
// How it starts
//   - the VISITE GUIDÉE button of the title screen (index.html) sets body[data-tour="start"] and
//     clicks the screen; the tour begins on game:start. A "#visite" hash does the same;
//   - key V while exploring (idle: no console, no dialog), or events.emit('tour:request') (any other
//     module may offer a button for it; a request that cannot be served at that moment is dropped).
//
// How it works
//   The player IS moved along the rail every frame (position, heading, eye height), so the HUD sector,
//   the room mood and the hands all follow as they do when walking. The camera is the
//   player's, flying a level horizon (never pitched): handing control back needs no relocation, the
//   visitor simply stands where the camera was. update() returns { cameraOverride, blockMovement }.
//   A console stop calls screens.focusConsole(): ScreenManager's own glide wins, the rail resumes from
//   the very pose the console parked the player in (the rail's last waypoint IS that pose).
//
// Cancelling: any key (not a repeat, not a lone modifier or Tab), pointer, touch or wheel input, the
// PASSER button, ESC releasing the pointer lock, or something else taking over (a dialog, a console
// opened by a deep link). The input that cancels is swallowed, so it never also acts in the game (a
// held E or Space has its auto-repeat swallowed too, until the key is released).
// The rail only visits ground the player can walk on with 0.25 m to spare (proved in node, see the
// route notes below), so the hand-back never clips the visitor into a wall or a prop.
//
// prefs.reducedMotion: the tour still runs (the visitor asked for it) but slower and gentler: no
// fades, no head bob, a lower cruise speed and softer starts and stops.
//
// Events emitted   tour:start { via: 'link' | 'key' | 'request' | 'dev' }
//                  tour:end   { completed: boolean }
//                  modal:open / modal:close { id: 'tour' }   (the notes and the gaze secrets rest while the tour runs)
// Events listened  game:start, tour:request (ignored while a tour runs), prefs:change, modal:open / modal:close
// DOM              #tour-ui (progress line, PASSER pill, #subtitle bar, fade); body.tour-on while running.
// Analytics        track('tour-start', { via }), track('tour-end', { done, by, at })   by = what ended it
// Side effects the visitor may notice: the tour opens the SKILLS and MISSIONS consoles, so the recette
// validates CAPACITÉS and SUCCÈS (the opening subtitle says the camera's validations count): recette.js
// holds their toasts back while the tour runs and announces them once it is over, so the tour adds no
// verdict of its own.
//
// DEV only (browser console):  __game.tour.start()   __game.tour.stop()   __game.tour.info()
//                              http://localhost:3000/?autostart&tour   starts the tour right away

import '../styles/tour.css';
import { floorAt } from '../engine/Map.js';
import { SCREENS } from '../engine/Screens.js';
import { prefs } from '../engine/prefs.js';
import { skills } from '../data/skills.js';
import { projects, featuredProjects } from '../data/projects.js';
import { passions } from '../data/passions.js';

const DEG = Math.PI / 180;
const NB = '\u00a0';    // no-break space: French typography keeps « ? », « : » and digit groups glued

// ── Tunables ──────────────────────────────────────────────────────────────────────────────────────
const STEP = 0.02;           // m between the dense samples of a path
const CORNER = 0.55;         // m, how early the path starts rounding a waypoint
const ACCEL = 2.2;           // m/s², start, stop and slow-downs
const REST = { from: 0.2, to: 0.3 };   // m/s the rail starts and ends at: a true zero would creep for seconds
const CALM = { speed: 0.74, accel: 0.55, dwell: 1.15 };   // reduced motion: slower, softer, longer reads
const FOCUS_REACH = 1.3;     // ScreenManager.focusConsole parks the player at console + 1.3 × facing
const CONSOLE_GLIDE = 0.4;   // ScreenManager's glide in (and out), in seconds
const CONSOLE_DWELL = 2.0;   // s a console stays up once the glide in is over
const FADE_OUT = 0.3;        // s to black before a replay teleports to the start
const GRACE = 0.5;           // s after the start during which stray input (a double click…) is ignored
const EYE = 0.5;             // camera height above the local floor, as Player.js
const BOB = { rate: 9.9, amp: 0.022, walkSpeed: 3 };   // Player.js head bob, scaled by the walking speed

const SPAWN = [12.5, 15.4, 270, 0];   // Player.js spawn: the tour starts and ends there, looking north

// ── Pure maths (no DOM) ───────────────────────────────────────────────────────────────────────────
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, u) => a + (b - a) * u;
const blend = (k60, dt) => 1 - Math.pow(1 - k60, dt * 60);   // Player.js: frame-rate independent smoothing

// Monotone cubic through (xs, ys), Fritsch–Carlson: no overshoot between keys (a held look stays held)
// and a zero slope at both ends (the camera starts and stops at rest).
function monotone(xs, ys) {
  const n = xs.length;
  const d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) continue;
    const h0 = xs[i] - xs[i - 1], h1 = xs[i + 1] - xs[i];
    const w1 = 2 * h1 + h0, w2 = h1 + 2 * h0;
    m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
  }
  return x => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i]
      + (3 * t2 - 2 * t3) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

// Headings are written as plain degrees; each one is brought within ±180° of the previous so a key
// list never spins the long way round.
function unwrap(deg) {
  const out = [deg[0]];
  for (let i = 1; i < deg.length; i++) {
    let d = deg[i] - out[i - 1];
    d -= 360 * Math.round(d / 360);
    out.push(out[i - 1] + d);
  }
  return out;
}

// Waypoints → a smooth path as dense, evenly spaced samples. Corners are rounded with a quadratic
// Bézier (it stays inside the corner's triangle, so rounding never leaves the walkable strip around
// the polyline). Returns { xs, zs, length, keyS }: keyS[k] = arc length at waypoint k.
function buildPath(points, corner = CORNER) {
  const n = points.length;
  const raw = [];                       // [x, z] fine samples, in order
  const mark = [0];                     // raw index nearest each waypoint
  const push = (x, z) => raw.push([x, z]);
  const unit = (a, b) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l, l]; };
  const line = (a, b) => {
    const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.01));
    for (let i = 1; i <= k; i++) push(lerp(a[0], b[0], i / k), lerp(a[1], b[1], i / k));
  };
  let cursor = points[0];
  push(cursor[0], cursor[1]);
  for (let k = 1; k < n - 1; k++) {
    const [ix, iz, il] = unit(points[k - 1], points[k]);
    const [ox, oz, ol] = unit(points[k], points[k + 1]);
    const r = Math.min(corner, il / 2, ol / 2);
    const A = [points[k][0] - ix * r, points[k][1] - iz * r];
    const B = [points[k][0] + ox * r, points[k][1] + oz * r];
    line(cursor, A);
    const q = Math.max(8, Math.ceil(r / 0.01));
    for (let i = 1; i <= q; i++) {
      const u = i / q, v = 1 - u;
      push(v * v * A[0] + 2 * u * v * points[k][0] + u * u * B[0], v * v * A[1] + 2 * u * v * points[k][1] + u * u * B[1]);
      if (i === Math.round(q / 2)) mark[k] = raw.length - 1;
    }
    cursor = B;
  }
  line(cursor, points[n - 1]);
  mark[n - 1] = raw.length - 1;

  const cum = [0];
  for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  const length = cum[cum.length - 1];
  const count = Math.max(1, Math.round(length / STEP));
  const xs = new Float64Array(count + 1), zs = new Float64Array(count + 1);
  let j = 0;
  for (let i = 0; i <= count; i++) {
    const s = (i / count) * length;
    while (j < raw.length - 2 && cum[j + 1] < s) j++;
    const u = cum[j + 1] > cum[j] ? clamp((s - cum[j]) / (cum[j + 1] - cum[j]), 0, 1) : 0;
    xs[i] = lerp(raw[j][0], raw[j + 1][0], u);
    zs[i] = lerp(raw[j][1], raw[j + 1][1], u);
  }
  return { xs, zs, length, keyS: mark.map(i => cum[i]) };
}

// Speed along the path → time. `want[k]` is the cruise speed at waypoint k (m/s). The profile is the
// requested speed, smoothed, then capped so that it never accelerates or brakes harder than `accel`
// and starts and ends almost at rest (`rest` scales REST). Returns { duration, sAt(t), speedAt(s) }:
// the arc length reached t seconds in, and the speed at an arc length.
function buildTiming(length, keyS, want, accel, rest) {
  const n = Math.max(2, Math.round(length / STEP));
  const ds = length / n;
  const v = new Float64Array(n + 1);
  let k = 0;
  for (let i = 0; i <= n; i++) {
    const s = i * ds;
    while (k < keyS.length - 2 && s > keyS[k + 1]) k++;
    const u = keyS[k + 1] > keyS[k] ? clamp((s - keyS[k]) / (keyS[k + 1] - keyS[k]), 0, 1) : 0;
    v[i] = lerp(want[k], want[k + 1], u);
  }
  const cap = () => {
    v[0] = REST.from * rest; v[n] = REST.to * rest;
    for (let i = 1; i <= n; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] * v[i - 1] + 2 * accel * ds));
    for (let i = n - 1; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * accel * ds));
  };
  cap();
  const w = Math.max(1, Math.round(0.3 / ds));          // box smoothing, then the caps again
  const tmp = Float64Array.from(v);
  for (let i = 1; i < n; i++) {
    let sum = 0, cnt = 0;
    for (let q = Math.max(0, i - w); q <= Math.min(n, i + w); q++) { sum += tmp[q]; cnt++; }
    v[i] = sum / cnt;
  }
  cap();
  const t = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) t[i + 1] = t[i] + (2 * ds) / (v[i] + v[i + 1]);
  return {
    duration: t[n],
    sAt(time) {
      if (time <= 0) return 0;
      if (time >= t[n]) return length;
      let lo = 0, hi = n;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (t[mid] <= time) lo = mid; else hi = mid; }
      return (lo + (time - t[lo]) / (t[hi] - t[lo])) * ds;
    },
    speedAt: s => v[clamp(Math.round(s / ds), 0, n)],
  };
}

// ── The route ─────────────────────────────────────────────────────────────────────────────────────
// Waypoint = [x, z, heading°, cruise m/s]. Heading: 0 east, 90 south, 180 west, 270 north (the player's
// angle in degrees). The rail looks where the waypoint says and eases between looks; the speed is the
// cruise speed there, braked and accelerated by ACCEL, and the first and last waypoints are at rest.
//
// A node proof (scratchpad/tour/proof.mjs, run it again whenever furniture, plinths or consoles move)
// walks this very rail with Map.js and Player.js collision and shows that
//   · every sample, one per 0.1 m, is walkable with 0.25 m to spare (walls, props, consoles, racks,
//     plinths, the lounge) and the real Player can walk every step of it;
//   · the hub holo (12.5, 12) keeps ≥ 0.9 m, the rail starts and ends at the spawn, and each console
//     stop is exactly the pose ScreenManager.focusConsole parks the player in;
//   · no look rests on the sleeping cats, the key hook or the hidden panel for more than a glance.
// By design: the soffite signs are met from 3 m or more (they sit low on the header, see
// decor/thresholds.js), the Trophées rail runs 3 m from the wall row it shows (the frames read from
// there), and a head never turns faster than about 80°/s.

// A console's focus pose, exactly as ScreenManager.focusConsole parks the player there.
function focus(id) {
  const { x, z, facing: [fx, fz] } = SCREENS.find(s => s.id === id);
  return [x + fx * FOCUS_REACH, z + fz * FOCUS_REACH, Math.atan2(-fz, -fx) / DEG, 0];
}

// Copy, in the two voices that speak here (SYSTÈME in capitals, NICOLAS dry and first person): the final
// copy, verbatim. Every figure is read from the data files, so a joke stays true when the data moves.
const FAMILIES = skills.length;
const MISSIONS = projects.length;
const SHOWN = featuredProjects.length;
const LIVE = projects.filter(p => p.df && p.status?.phase === 'run').length;   // Digital Factory missions in production (not the ongoing ones)
const GUITAR = passions.find(p => p.name === 'GUITARE')?.description.match(/près de (\d+) ans/i)?.[1];
const FLAGSHIP_PAGE = Math.max(0, projects.indexOf(featuredProjects[0]));   // same page as its plinth

const COPY = {
  opening: 'LA CAMÉRA REMPLACE LE TESTEUR. SES VALIDATIONS COMPTENT.',   // no length: the title screen already states it
  left: 'Quatre cas de test. Je commence à gauche.',
  capacites: `CAPACITÉS : ${FAMILIES} FAMILLES. LISTE SANS ADJECTIFS.`,
  succes: `SUCCÈS : ${MISSIONS} MISSIONS, ${SHOWN} EN VITRINE.`,
  maquettes: `Mes ${SHOWN} maquettes. Aucune n'est contractuelle.`,
  factory: `DIGITAL FACTORY : ${LIVE} MISSIONS EN PRODUCTION. LE RUN DURE.`,
  quartiers: 'Les quartiers : on y parle de moi, puis à moi.',
  lounge: GUITAR && `Près de ${GUITAR} ans de guitare. Le barbecue progresse plus vite.`,   // no figure, no line
  closing: 'VISITE TERMINÉE. LA SUITE EST À VOTRE CHARGE.',
};

// A cue shows from `from` to `to`, both as a share of its segment (so it follows the pace of the walk).
// `text` is a string; a falsy one skips the cue.
const say = (voice, from, to, text) => ({ voice, from, to, text });
const nicolas = (from, to, text) => say('nicolas', from, to, text);
const systeme = (from, to, text) => say('systeme', from, to, text);

// The windows are sized for reading: at most ~17 characters a second, and on screen while the camera shows
// what the line is about (checked by the node proof, see the route notes above).
// The segments are built on demand: a console that moved or vanished fails the feature, never the import.
const segmentDefs = () => [
  // 1 · A look round the hall, then the Armurerie, up to the SKILLS console.
  {
    kind: 'walk', id: 'armurerie',
    // The hall first, from the spawn: the banner, the hub and the north sign, then round to the west door.
    pan: { seconds: 3.0, keys: [[0, 270], [0.2, 270], [0.9, 215], [1, 215]] },
    route: [
      [12.5, 15.4, 215, 1.6],
      [12.2, 14.7, 212, 2.2],
      [11.8, 14.1, 208, 2.6],
      [11.2, 13.5, 203, 2.8],
      [10.0, 12.8, 195, 3.0],
      [8.6, 12.5, 187, 3.0],
      [7.3, 12.7, 214, 2.6],
      [6.0, 13.1, 246, 2.2],
      [4.9, 13.6, 222, 1.7],
      [3.9, 13.75, 195, 1.3],
      focus('skills'),
    ],
    cues: [
      systeme(0.015, 0.36, COPY.opening),
      nicolas(0.375, 0.64, COPY.left),   // the four cas of recette.js CASES, the first on the left
      systeme(0.655, 0.975, COPY.capacites),
    ],
  },
  { kind: 'console', id: 'skills', page: 0 },

  // 2 · Back across the hall, into the Trophées, along the north row, up to the MISSIONS console.
  {
    kind: 'walk', id: 'trophees',
    route: [
      focus('skills'),
      [3.9, 13.4, 150, 2.1],
      [5.2, 13.5, 118, 2.3],
      [6.6, 13.3, 80, 2.4],
      [8.0, 12.8, 38, 2.5],
      [9.1, 12.5, 10, 2.7],
      [10.6, 13.2, 355, 3.1],
      [12.5, 13.6, 352, 3.3],
      [14.4, 13.2, 356, 3.3],
      [15.8, 12.6, 0, 3.0],
      [16.6, 12.5, 0, 2.5],
      [17.5, 12.3, 336, 2.2],
      [18.5, 12.1, 312, 1.8],
      [19.5, 12.0, 300, 1.5],
      [20.4, 12.05, 322, 1.3],
      focus('projects'),
    ],
    cues: [
      systeme(0.44, 0.71, COPY.succes),
      nicolas(0.72, 1.0, COPY.maquettes),
    ],
  },
  { kind: 'console', id: 'projects', page: FLAGSHIP_PAGE },

  // 3 · Along the south row, through the hall past the DF dashboard, up to the Quartiers' CONTACT console.
  {
    kind: 'walk', id: 'quartiers', linger: 0.5,
    route: [
      focus('projects'),
      [20.3, 12.9, 40, 2.2],
      [19.2, 13.0, 80, 2.4],
      [18.4, 13.0, 102, 2.5],
      [17.5, 12.8, 130, 2.6],
      [16.5, 12.55, 160, 2.8],
      [15.4, 12.5, 186, 3.0],
      [14.4, 12.2, 203, 3.0],
      [13.6, 11.6, 224, 2.9],
      [13.2, 10.6, 246, 2.8],
      [12.9, 9.5, 268, 2.8],
      [12.6, 8.3, 270, 2.8],
      [12.5, 7.0, 270, 2.8],
      [12.5, 5.5, 270, 2.3],
      [12.5, 4.2, 270, 0],
    ],
    cues: [
      systeme(0.243, 0.652, COPY.factory),   // starts as the hall comes back into view; the DF console is dead ahead half way
      nicolas(0.664, 1.0, COPY.quartiers),   // the arrival at the contact console
    ],
  },

  // 4 · A loop through the lounge (guitar, amp, barbecue), then back to the hall, and the spawn.
  {
    kind: 'walk', id: 'retour', linger: 1.3,
    route: [
      [12.5, 4.2, 270, 1.1],
      [12.9, 4.35, 292, 1.4],
      [13.6, 4.55, 322, 1.6],
      [14.3, 5.0, 354, 1.8],
      [14.5, 5.8, 24, 1.8],
      [13.9, 6.7, 56, 1.9],
      [13.2, 7.4, 88, 2.1],
      [12.7, 8.4, 106, 2.5],
      [12.3, 9.6, 125, 2.9],
      [11.7, 11.2, 160, 2.9],
      [11.4, 12.7, 195, 2.5],
      [11.8, 14.0, 238, 2.0],
      SPAWN,
    ],
    cues: [
      nicolas(0.02, 0.40, COPY.lounge),
      systeme(0.70, 1.0, COPY.closing),
    ],
  },
];

// French typography: no-break space before « ? : ; ! » and inside digit groups.
const fr = s => s.replace(/(\S) ([:;?!»])/g, `$1${NB}$2`).replace(/(\d) (?=\d{3}\b)/g, `$1${NB}`);

// The plan: every segment with its duration, its pose function and its cues resolved to seconds.
// `calm` = reduced motion. Pure and deterministic, so the node proof can walk the very same rail.
export function buildPlan(calm = false) {
  const k = calm ? CALM : { speed: 1, accel: 1, dwell: 1 };
  const segments = [];
  for (const def of segmentDefs()) {
    if (def.kind === 'console') {
      const seconds = CONSOLE_GLIDE * 2 + CONSOLE_DWELL * k.dwell;
      segments.push({ kind: 'console', id: def.id, page: def.page, duration: seconds, dwell: CONSOLE_GLIDE + CONSOLE_DWELL * k.dwell, cues: [] });
      continue;
    }
    const path = buildPath(def.route);
    const timing = buildTiming(path.length, path.keyS, def.route.map(w => w[3] * k.speed), ACCEL * k.accel, k.speed);
    const heading = monotone(path.keyS, unwrap(def.route.map(w => w[2])));
    // An optional look-around from the first waypoint before the walk starts: [[share of the pan, heading°], …].
    const pan = def.pan ? {
      seconds: def.pan.seconds * k.dwell,
      look: monotone(def.pan.keys.map(c => c[0]), unwrap(def.pan.keys.map(c => c[1]))),
    } : { seconds: 0 };
    const linger = (def.linger ?? 0) * k.dwell;
    const move = pan.seconds + timing.duration;
    const duration = move + linger;
    segments.push({
      kind: 'walk', id: def.id, route: def.route, path, panSeconds: pan.seconds, move, linger, duration,
      cues: def.cues.map(c => ({ ...c, t0: c.from * duration, t1: c.to * duration })),
      // The camera pose `t` seconds into the segment → out = { x, z, a (radians), speed (m/s) }.
      pose(t, out) {
        if (t < pan.seconds) {
          out.x = path.xs[0]; out.z = path.zs[0];
          out.a = pan.look(t / pan.seconds) * DEG;
          out.speed = 0;
          return out;
        }
        const w = t - pan.seconds;
        const s = timing.sAt(w), f = s / path.length * (path.xs.length - 1);
        const i = Math.min(path.xs.length - 2, Math.floor(f)), u = f - i;
        out.x = lerp(path.xs[i], path.xs[i + 1], u);
        out.z = lerp(path.zs[i], path.zs[i + 1], u);
        out.a = heading(s) * DEG;
        out.speed = t < move ? timing.speedAt(s) : 0;
        return out;
      },
    });
  }
  const duration = segments.reduce((sum, s) => sum + s.duration, 0);
  return { segments, duration, seconds: Math.round(duration / 5) * 5 };
}

// The cue as shown: typography applied; null when it has nothing to say.
export function cueText(cue) {
  return cue.text ? fr(cue.text) : null;
}

// ── The feature ───────────────────────────────────────────────────────────────────────────────────
const BLOCK = Object.freeze({ blockMovement: true });
const IGNORED_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'Tab', 'Dead', 'Unidentified']);
// The two keys Input.js turns into an interact on every keydown, auto-repeat included.
const INTERACT_CODES = new Set(['KeyE', 'Space']);
// touchstart is the only one whose default is cancelled (no ghost click after the tap that ends the tour).
const CANCEL_EVENTS = [['keydown', { capture: true }], ['pointerdown', { capture: true }],
  ['touchstart', { capture: true, passive: false }], ['wheel', { capture: true }]];

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

export function create({ player, input, screens, events, track }) {
  const container = document.getElementById('game-container');
  if (!container) return undefined;
  const body = document.body;
  const isTouch = () => body.classList.contains('is-touch');

  // ── DOM ────────────────────────────────────────────────────────────────────
  const root = el('div');
  root.id = 'tour-ui';
  root.hidden = true;
  const progress = el('div', 'tour-progress');
  progress.setAttribute('aria-hidden', 'true');
  const fill = el('i');
  progress.append(fill);

  const pill = el('div', 'tour-pill');
  const row = el('div', 'tour-row');
  const skip = el('button', 'tour-skip', 'PASSER');
  skip.type = 'button';
  skip.setAttribute('aria-label', 'Passer la visite guidée');
  row.append(el('span', 'tour-tag', 'VISITE GUIDÉE'), skip);
  const hint = el('span', 'tour-hint');
  pill.append(row, hint);

  const sub = el('div');
  sub.id = 'subtitle';
  sub.setAttribute('role', 'status');
  sub.setAttribute('aria-live', 'polite');
  sub.setAttribute('aria-atomic', 'true');
  const who = el('span', 'sub-who');
  const mark = el('span', 'sub-mark', '//');
  mark.setAttribute('aria-hidden', 'true');
  const words = el('span', 'sub-text');
  sub.append(who, mark, words);
  root.append(progress, pill, sub);

  const fade = el('div', 'tour-fade');
  fade.setAttribute('aria-hidden', 'true');
  container.append(root, fade);

  // The title screen's label carries the real length (the calm plan is longer), rounded to 5 s.
  const stampSeconds = () => {
    const seconds = String(buildPlan(prefs.reducedMotion).seconds);
    for (const n of document.querySelectorAll('.tour-secs')) n.textContent = seconds;
  };
  stampSeconds();

  // ── State ──────────────────────────────────────────────────────────────────
  const cleanup = [];
  const pose = { x: SPAWN[0], z: SPAWN[1], a: SPAWN[2] * DEG, speed: 0 };
  const cam = { pos: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } };
  const out = { cameraOverride: cam, blockMovement: true };
  const modals = new Set();

  let started = false;        // game:start happened
  let requested = false;      // tour:request, handled on the next idle frame
  let running = false;
  let phase = 'dim';          // 'dim' (fading to black, or waiting for a console to let go) → 'run'
  let wait = 0;               // s left in 'dim'
  let plan = null;
  let si = 0, st = 0;         // segment index, seconds into it
  let done = 0;               // seconds of the finished segments, for the progress line
  let cstate = 0, ct = 0;     // console segment: 0 enter, 1 on screen, 2 leaving; seconds in the state
  let shown = null;           // the cue on screen
  let lastP = -1;
  let eyeBase = 0, bob = 0, bobAmp = 0;
  let hadLock = false;
  let graceUntil = 0;
  let hideTimer = 0;
  let releaseRepeat = null;   // drops the guard that swallows the auto-repeat of the key that ended the tour

  const calmNow = () => prefs.reducedMotion;

  // ── Subtitles ────────────────────────────────────────────────────────────────
  function showCue(cue) {
    if (cue === shown) return;
    shown = cue;
    if (!cue) { sub.classList.remove('on'); return; }
    const text = cueText(cue);
    if (!text) { shown = null; sub.classList.remove('on'); return; }
    sub.dataset.voice = cue.voice;
    who.textContent = cue.voice === 'nicolas' ? 'Nicolas\u00a0: ' : 'Système\u00a0: ';
    mark.hidden = cue.voice !== 'nicolas';
    words.textContent = text;
    sub.classList.add('on');
  }

  function activeCue(seg) {
    for (const c of seg.cues) if (st >= c.t0 && st < c.t1) return c;
    return null;
  }

  // ── Starting and stopping ────────────────────────────────────────────────────
  function modalOpen() {
    if (modals.size) return true;
    for (const d of container.querySelectorAll('[role="dialog"]')) if (d.offsetParent !== null) return true;
    return false;
  }

  // The key that ended the tour may still be held: Input.js would turn its auto-repeat into a fresh
  // interact (a console, a plinth, the hub). Swallow the repeats until the key goes up.
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
    // The button does its own job when it is pressed (pointer, touch, Enter, Space); any other key,
    // even with the button focused, ends the tour like everywhere else.
    if (skip.contains(e.target) && (e.type === 'pointerdown' || e.type === 'touchstart' || e.key === 'Enter' || e.key === ' ')) return;
    if (e.type === 'keydown' && (e.repeat || e.ctrlKey || e.metaKey || e.altKey || IGNORED_KEYS.has(e.key))) return;
    if (e.type === 'wheel' && !e.deltaX && !e.deltaY) return;
    // The input that ends the tour must not also act in the game (open a sheet, drink, interact…).
    e.stopPropagation();
    if (e.type === 'pointerdown' || e.type === 'touchstart') e.preventDefault();
    if (e.type === 'keydown' && INTERACT_CODES.has(e.code)) guardRepeat(e.code);
    finish(false, e.type);
  }

  function onLock() {
    if (document.pointerLockElement) { hadLock = true; return; }
    // The visitor pressed ESC (the browser eats that keydown while the pointer is locked). main.js lets
    // go of the lock itself while a console is on screen: not a cancel.
    if (running && phase === 'run' && hadLock && !screens.focused) finish(false, 'unlock');
    hadLock = false;
  }

  function begin(via) {
    if (running || !started) return false;
    plan = buildPlan(calmNow());
    running = true;
    si = 0; st = 0; done = 0; cstate = 0; ct = 0; shown = null; lastP = -1;
    bob = 0; bobAmp = 0;
    hadLock = !!document.pointerLockElement;
    graceUntil = performance.now() + GRACE * 1000;

    hint.textContent = isTouch() ? 'Touchez l\'écran pour reprendre la main.' : 'Une touche ou un clic reprend la main.';
    clearTimeout(hideTimer);
    root.classList.remove('ending');
    sub.classList.remove('on');
    fill.style.transform = 'scaleX(0)';
    root.hidden = false;
    body.classList.add('tour-on');

    // From the title screen the level is not on screen yet: start from black. From the game, go to
    // black first. Reduced motion has no fades.
    phase = 'dim';
    if (calmNow()) wait = 0;
    else if (via === 'link') { fade.className = 'tour-fade cut on'; wait = 0.05; }
    else { fade.className = 'tour-fade on'; wait = FADE_OUT; }

    for (const [type, opts] of CANCEL_EVENTS) window.addEventListener(type, onCancel, opts);
    document.addEventListener('pointerlockchange', onLock);
    events.emit('modal:open', { id: 'tour' });
    events.emit('tour:start', { via });
    track('tour-start', { via });
    return true;
  }

  // Ends the tour and hands the camera back. The player already stands where the camera is, on
  // ground the proof guarantees, so there is nothing to relocate: teleporting onto itself only resets
  // the eye height. Never to the rail's last pose: a console or a deep link that took over may have
  // parked the player elsewhere (ScreenManager keeps its own idea of where to give the view back).
  function finish(completed, why) {
    if (!running) return;
    running = false;
    for (const [type, opts] of CANCEL_EVENTS) window.removeEventListener(type, onCancel, opts);
    document.removeEventListener('pointerlockchange', onLock);
    // A tour that ran to its end lets its last line fade out; a cancelled one clears the screen at once.
    sub.classList.remove('on');
    if (completed) {
      root.classList.add('ending');
      hideTimer = setTimeout(() => { root.hidden = true; root.classList.remove('ending'); }, 350);
    } else {
      root.hidden = true;
    }
    fade.className = 'tour-fade';
    body.classList.remove('tour-on');
    skip.blur();
    if (phase === 'run') player.teleport(player.x, player.y, player.angle);
    if (plan.segments[si]?.kind === 'console' && cstate > 0 && screens.focused) input.escape = true;   // leave the console the tour opened
    events.emit('modal:close', { id: 'tour' });
    events.emit('tour:end', { completed });
    track('tour-end', { done: completed, by: why, at: plan?.segments[Math.min(si, plan.segments.length - 1)]?.id ?? '' });
  }

  skip.addEventListener('click', () => finish(false, 'skip'));
  cleanup.push(events.on('tour:request', () => { if (!running) requested = true; }));
  cleanup.push(events.on('prefs:change', stampSeconds));
  cleanup.push(events.on('modal:open', ({ id } = {}) => { if (id !== 'tour') modals.add(id ?? '?'); }));
  cleanup.push(events.on('modal:close', ({ id } = {}) => { modals.delete(id ?? '?'); }));
  cleanup.push(events.on('game:start', () => {
    started = true;
    input.consumeKey('v');                                      // the key that started the game must not start the tour
    const wanted = body.dataset.tour === 'start' || location.hash.toLowerCase() === '#visite'
      || (import.meta.env.DEV && new URLSearchParams(location.search).has('tour'));
    delete body.dataset.tour;
    if (wanted) begin('link');
  }));

  if (import.meta.env.DEV) {
    const dev = {
      start() {
        if (!started) { body.dataset.tour = 'start'; window.__game?.start?.(); return true; }
        return begin('dev');
      },
      stop: () => finish(false, 'dev'),
      info: () => {
        const p = buildPlan(calmNow());
        return { seconds: p.duration, segments: p.segments.map(g => ({ id: g.id, kind: g.kind, seconds: +g.duration.toFixed(2) })) };
      },
    };
    // __game is assigned by main.js right after the features are built.
    queueMicrotask(() => { if (window.__game) window.__game.tour = dev; });
  }

  const unguard = screens.addInteractGuard(() => running);

  // ── Frame ─────────────────────────────────────────────────────────────────────
  function place(seg, t) {
    seg.pose(t, pose);
    player.x = pose.x;
    player.y = pose.z;
    player.angle = pose.a;
  }

  function step(frame) {
    const { dt } = frame;

    if (phase === 'dim') {
      // A dialog that comes up during the fade wins before the player is moved to the start.
      if (modals.size) { finish(false, 'interrupted'); return undefined; }
      // A console opened by a deep link on the same click must let go first.
      if (screens.focused) { input.escape = true; return BLOCK; }
      if ((wait -= dt) > 0) return BLOCK;
      player.teleport(SPAWN[0], SPAWN[1], SPAWN[2] * DEG);
      eyeBase = player.eyeY;
      phase = 'run';
      if (fade.classList.contains('on')) {
        fade.classList.remove('cut');
        void fade.offsetWidth;                                    // let the transition start from black
        fade.classList.add('slow');
        fade.classList.remove('on');
      }
    }

    // Something else took the player (a deep link opened a console, a dialog came up): not ours any more.
    const seg = plan.segments[si];
    if (seg.kind === 'walk' && (frame.focused || modals.size)) { finish(false, 'interrupted'); return undefined; }

    let result = out;
    if (seg.kind === 'walk') {
      st += dt;
      place(seg, Math.min(st, seg.duration));
      showCue(activeCue(seg));
      if (st >= seg.duration) { done += seg.duration; si++; st = 0; cstate = 0; ct = 0; }
    } else {
      showCue(null);
      result = BLOCK;                                             // ScreenManager's own camera takes over
      if (cstate === 0) {
        if (screens.focusConsole(player, seg.id, seg.page)) { cstate = 1; ct = 0; }
        else { done += seg.duration; si++; st = 0; }              // refused (busy): skip this stop
      } else {
        ct += dt;
        if (cstate === 1 && !screens.focused) { done += seg.duration; si++; st = 0; cstate = 0; }
        else if (cstate === 1 && ct >= seg.dwell) { input.escape = true; cstate = 2; ct = 0; }
        else if (cstate === 2 && !screens.focused) { done += seg.duration; si++; st = 0; cstate = 0; }
        else if (cstate === 2 && ct > 1.5) { input.escape = true; ct = 0; }   // never leave the visitor stuck
      }
    }

    if (si >= plan.segments.length) { finish(true, 'end'); return undefined; }

    // Eye height follows the floor like the player's, plus the head bob while walking.
    const calm = calmNow();
    eyeBase += (floorAt(pose.x, pose.z) + EYE - eyeBase) * blend(0.25, dt);
    bobAmp += ((!calm && pose.speed > 0.4 && seg.kind === 'walk' ? 1 : 0) - bobAmp) * blend(0.12, dt);
    bob += BOB.rate * (pose.speed / BOB.walkSpeed) * dt;
    const eye = eyeBase + Math.sin(bob) * BOB.amp * bobAmp;
    player.eyeY = eye;

    cam.pos.x = pose.x; cam.pos.y = eye; cam.pos.z = pose.z;
    cam.target.x = pose.x + Math.cos(pose.a); cam.target.y = eye; cam.target.z = pose.z + Math.sin(pose.a);

    const p = clamp((done + (seg.kind === 'walk' ? st : 0)) / plan.duration, 0, 1);
    if (Math.abs(p - lastP) >= 0.002) { lastP = p; fill.style.transform = `scaleX(${p.toFixed(3)})`; }
    return result;
  }

  return {
    update(frame) {
      if (!running) {
        const key = input.consumeKey('v');
        if (key || requested) {
          // Idle only: no console, no dialog. A request that cannot be served now is dropped, not kept.
          if (started && !frame.focused && !modalOpen()) begin(key ? 'key' : 'request');
          requested = false;
        }
        if (!running) return undefined;
      }
      try {
        return step(frame);
      } catch (err) {
        console.error('[tour] aborted', err);
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
      fade.remove();
    },
  };
}
