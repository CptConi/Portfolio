// Trophées interactions: the plinths and the contact frame.
//
//   [ E ] DOSSIER — <MISSION>    aiming at a plinth from within 1.3 m opens that mission's
//                                page on the MISSIONS console (screens.focusConsole).
//   [ E ] ÉCRIRE À NICOLAS       aiming at the dashed "Envie d'échanger ?" frame on the west
//                                wall asks the shell for the contact sheet.
//
// Events emitted: 'contact:open' (existing; features/shell.js opens the contact sheet).
// Analytics: track('gallery-open', { name }) and track('gallery-contact').
// Uses screens.addInteractGuard so the MISSIONS console never steals the [E] while a plinth
// or the frame is aimed at. update() returns { prompt }; the same object is reused.

import { getDynamicPlinths, getContactFrame } from '../engine/PlinthGenerator.js';

const PLINTH_REACH = 1.3;     // m from the player to the plinth centre
const CONTACT_REACH = 1.8;    // the frame is wide and hung low: it is read from a bit further
const FACING = 0.55;          // cosine of the aiming cone (~57°)
const IN_FRONT = 0.12;        // m: the player must be on the facing side of the target
const REPEAT_GUARD = 0.4;     // s after an action during which [E] is ignored (held key repeat)

export function create({ screens, events, track }) {
  const contact = getContactFrame();
  const targets = [
    ...getDynamicPlinths().map(p => ({
      x: p.x, z: p.z, face: p.face, reach: PLINTH_REACH, mission: p,
      out: { prompt: `[ E ] DOSSIER — ${p.name}` },
    })),
    {
      x: contact.x, z: contact.z, face: contact.facing, reach: CONTACT_REACH, mission: null,
      out: { prompt: '[ E ] ÉCRIRE À NICOLAS' },
    },
  ];

  // The target the player is looking at and close enough to (best aligned wins), or null.
  function aimedAt(p) {
    const ax = Math.cos(p.angle), az = Math.sin(p.angle);
    let best = null, bestDot = FACING;
    for (const t of targets) {
      const dx = t.x - p.x, dz = t.z - p.y;       // the player's y is world z
      const d = Math.hypot(dx, dz);
      if (d > t.reach || d < 1e-3 || -(dx * t.face[0] + dz * t.face[1]) < IN_FRONT) continue;
      const dot = (ax * dx + az * dz) / d;
      if (dot > bestDot) { best = t; bestDot = dot; }
    }
    return best;
  }

  const unguard = screens.addInteractGuard(p => aimedAt(p) !== null);
  let quietUntil = 0;

  return {
    update({ t, player, input, focused }) {
      if (focused) return undefined;           // a console owns the [E] while focused
      const target = aimedAt(player);
      if (!target) return undefined;
      if (input.consumeInteract() && t >= quietUntil) {
        quietUntil = t + REPEAT_GUARD;
        if (target.mission) {
          if (screens.focusConsole(player, 'projects', target.mission.page)) {
            track('gallery-open', { name: target.mission.name });
          }
        } else {
          events.emit('contact:open');
          track('gallery-contact');
        }
        return undefined;
      }
      return target.out;
    },

    dispose() { unguard(); },
  };
}
