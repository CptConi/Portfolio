// The PROD secret: a small adventure instead of "press [E] on the hidden wall".
//
// The south push-wall behind the spawn is sealed. To open it the visitor must
//   1. take the key hanging on its hook on the Quartiers' north wall (comms room),
//   2. use it on the glass cover of the hidden PROD panel, on the east side face of
//      the Digital Factory STATUS console in the atrium,
//   3. press the red button under it — the camera shakes, an alarm flickers, and
//      a moment later the wall slides up (dust, rumble, pink light eases in).
//
// State machine:  key   none → held → used
//                 panel locked → unlocked (key turning, cover lifting) → open → pressed → spent
//
// Events emitted: item:pickup { id: 'prod-key' } · fx:shake · fx:flash · toast (via ctx.toast)
//                 secret:found { id: 'prod' } (when the wall starts to slide)
//                 analytics: track('secret-step', { step: 'cover' | 'button' })
// Uses screens.addInteractGuard so the neighbouring consoles never steal the [E] while
// the visitor is aiming at the key or the panel (a narrower claim while the panel is locked
// and keyless, so the STATUS console stays reachable). Every action needs a fresh press:
// a held E or its auto-repeat never chains steps nor falls through to a console.
// update() returns { prompt }.
//
// DEV only (browser console), once the game has booted:
//   __game.secret.giveKey()     pick the key up (toast + HUD badge)
//   __game.secret.openCover()   give the key if needed and play "key turns, cover lifts"
//   __game.secret.press()       the whole thing: key, cover, button, wall opens
//   __game.secret.state()       { key, panel, wallOpening }
// Then walk to the panel with __game.tp(12.1, 9.6, 180) to watch the animations.

import { PROD_PANEL, PROD_KEY, SECRET_WALL } from '../engine/layout.js';
import { SecretDevice } from '../engine/SecretDevice.js';
import { prefs } from '../engine/prefs.js';

// Aiming tolerances. reach: m from the player to the object; facing: cosine of the aiming
// cone; wedge: sideways spread allowed per metre in front of a wall prop. The locked, keyless
// panel only offers a hint and shares its side with the STATUS console: TIGHT claims [E] only
// while the visitor looks at the plate itself.
const LOOSE = { reach: 1.35, facing: 0.55, wedge: 1.2 };     // ~57° cone, ~50° wedge
const TIGHT = { reach: 1.15, facing: 0.94, wedge: 0.7 };     // ~20° cone, ~35° wedge
const DEBOUNCE = 0.4;   // s after an action (and once the cover is up) during which presses are ignored

const NB = ' ';    // no-break space: French typography, keeps « » glued to their words
const TEXT = {
  key: `Une clé avec une étiquette sur laquelle il est écrit${NB}: «${NB}Ne pas utiliser les vendredis soirs…${NB}»`,
  locked: 'CAPOT VERROUILLÉ. LA CLÉ DOIT TRAÎNER DU CÔTÉ DES COMMS.',
  click: 'Clac. Le capot se soulève. Le bouton attend.',
  noise: 'Vous entendez un bruit dans la salle derrière vous.',
  wall: ['Le mur est étrangement tiède. Rien ne bouge.', 'Toujours un mur. Toujours tiède.', 'Vous insistez. Le mur aussi.'],
};
const PROMPT = {
  take: '[ E ] PRENDRE LA CLÉ',
  examine: '[ E ] EXAMINER',
  unlock: '[ E ] OUVRIR LE CAPOT (CLÉ)',
  press: '[ E ] ACCÉDER À LA PROD',
};

// The sealed wall, seen from the atrium side (outward normal = north).
const WALL = { x: SECRET_WALL.x, z: SECRET_WALL.z, facing: [0, -1] };

// Is the player standing in front of a wall prop `o` ({ x, z, facing }), close enough,
// roughly on its axis (so a neighbouring console can still be aimed at from the side),
// and looking at it?
function aimedAt(p, o, a = LOOSE) {
  const [nx, nz] = o.facing;
  const dx = p.x - o.x, dz = p.y - o.z;       // player's y is world z
  const out = dx * nx + dz * nz;
  if (out < 0.12 || Math.abs(dx * nz - dz * nx) > out * a.wedge) return false;
  const d = Math.hypot(dx, dz);
  return d <= a.reach && -(Math.cos(p.angle) * dx + Math.sin(p.angle) * dz) / d > a.facing;
}

export function create({ scene, hud, screens, pushwall, events, toast, track }) {
  const device = new SecretDevice(scene);

  let key = 'none';
  let panel = 'locked';
  let clock = 0;
  let quietUntil = 0;       // presses are ignored until then
  let eHeld = false;        // E or Space is physically down
  let wasDown = false;      // previous frame's touch contact
  let latched = false;      // an action just fired: consoles stay off until the key is released
  let nudges = 0;           // dry lines already given by the sealed wall
  let autoPress = false;    // dev helper: press as soon as the cover is up
  const timers = [];
  const out = { prompt: '' };

  const later = (sec, fn) => timers.push({ at: clock + sec, fn });
  const pace = () => (prefs.reducedMotion ? 0.6 : 1);

  function takeKey() {
    if (key !== 'none') return;
    key = 'held';
    device.takeKey();
    hud.setKey(true);
    toast.show(TEXT.key, { ms: 6500, kind: 'item' });
    events.emit('item:pickup', { id: 'prod-key' });
  }

  function examine() {
    toast.show(TEXT.locked, { kind: 'system' });
  }

  function openCover() {
    if (key !== 'held' || panel !== 'locked') return;
    key = 'used';
    panel = 'unlocked';
    hud.setKey(false);
    track('secret-step', { step: 'cover' });
    device.unlockCover({
      onClick: () => { toast.clear(); toast.show(TEXT.click, { kind: 'info' }); },
      onDone: () => {
        panel = 'open';
        quietUntil = clock + DEBOUNCE;
        if (autoPress) { autoPress = false; press(); }
      },
    });
  }

  function press() {
    if (panel !== 'open') return;
    panel = 'pressed';
    track('secret-step', { step: 'button' });
    device.pressButton(() => { panel = 'spent'; });
    events.emit('fx:shake', { amount: 0.95, ms: 1100 });   // PostFX scales the displacement by amount²
    events.emit('fx:flash', { color: '#ff2a9d', ms: 500 });
    // The line has to land with the shake, not behind whatever toast is still on screen.
    later(0.7 * pace(), () => { toast.clear(); toast.show(TEXT.noise, { kind: 'secret', ms: 4200 }); });
    later(1.2 * pace(), () => {
      pushwall.open();
      events.emit('secret:found', { id: 'prod' });
    });
  }

  function nudgeWall() {
    toast.show(TEXT.wall[nudges++], { ms: 3200 });
  }

  const panelAimed = p => aimedAt(p, PROD_PANEL, panel === 'locked' && key === 'none' ? TIGHT : LOOSE);

  const unguard = screens.addInteractGuard(p =>
    latched || (key === 'none' && aimedAt(p, PROD_KEY)) || (panel !== 'spent' && panelAimed(p)));

  // Input re-arms `interact` on every auto-repeat of a held key, so a touch tap has to be
  // told apart from a key repeat: taps only count while neither E nor Space is down.
  const isUseKey = e => e.code === 'KeyE' || e.code === 'Space';
  const onKeyDown = e => { if (isUseKey(e)) eHeld = true; };
  const onKeyUp = e => { if (isUseKey(e)) eHeld = false; };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  if (import.meta.env.DEV) {
    const dev = {
      giveKey: takeKey,
      openCover() { takeKey(); openCover(); },
      press() {
        takeKey();
        if (panel === 'open') press();
        else if (panel === 'locked' || panel === 'unlocked') { autoPress = true; openCover(); }
      },
      state: () => ({ key, panel, wallOpening: pushwall.opening }),
    };
    // __game is assigned by main.js right after the features are built.
    queueMicrotask(() => { if (window.__game) window.__game.secret = dev; });
  }

  return {
    update({ dt, t, player, input, focused }) {
      clock += dt;
      for (let i = 0; i < timers.length;) {
        if (clock >= timers[i].at) { const [{ fn }] = timers.splice(i, 1); fn(); } else i++;
      }
      device.update(dt, t);

      // A fresh press only: the rising edge of E / Space (auto-repeat has none) or a new touch.
      const edge = input.consumeKey('e') || input.consumeKey(' ');
      const down = input.interact && !eHeld;
      const fresh = edge || (down && !wasDown);
      wasDown = down;
      if (focused) return undefined;     // a console owns the [E] while focused
      if (!eHeld) latched = false;

      let prompt = '', act = null;
      if (key === 'none' && aimedAt(player, PROD_KEY)) {
        prompt = PROMPT.take; act = takeKey;
      } else if (panel !== 'spent' && panelAimed(player)) {
        if (panel === 'locked') {
          if (key === 'held') { prompt = PROMPT.unlock; act = openCover; }
          else { prompt = PROMPT.examine; act = examine; }
        } else if (panel === 'open') {
          prompt = PROMPT.press; act = press;
        }
      } else if (pushwall.sealed && !pushwall.opening && panel !== 'pressed' && nudges < TEXT.wall.length
        && aimedAt(player, WALL)) {
        act = nudgeWall;       // no prompt: the wall does not advertise itself
      }

      if (act && fresh && clock >= quietUntil) {
        input.consumeInteract();
        quietUntil = clock + DEBOUNCE;
        latched = true;
        act();
      }
      out.prompt = prompt;
      return prompt ? out : undefined;
    },

    dispose() {
      unguard();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      timers.length = 0;
      device.dispose();
      hud.setKey(false);
    },
  };
}
