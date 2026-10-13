// Quartiers lounge feature: builds the furniture and props of the comms room (sofa, amp, guitar,
// barbecue, floor lamp, plant, the neon sign over the CONTACT console, the sleeping cat on its
// crate), registers their collision and animates them (coals, smoke, standby LED, the cat's
// breathing).
//
// Events: none emitted. Listens to 'prefs:change' (reduced motion: no smoke, no breathing,
// no "z"s, steady coals and LED). No PointLight. Draw calls: 4 merged meshes (lit solids, coals,
// unlit parts, additive glows) + 10 sprites (LED halo, barbecue halo and 4 smoke puffs, the cat
// and its 2 "z"s, the plant).
//
// Related: Props3D.js keeps the coffee table and the cat's crate (plain textured boxes);
// decor/quartiers.js paints the rug, the blueprint, the banner and the hearth glow.

import { addSolidBox } from '../Player.js';
import { events } from '../Events.js';
import { prefs } from '../prefs.js';
import { buildLounge } from './lounge.js';
import { LOUNGE_SOLIDS } from './placement.js';

export function create({ scene }) {
  const lounge = buildLounge(scene, { reducedMotion: prefs.reducedMotion });
  for (const b of Object.values(LOUNGE_SOLIDS)) addSolidBox(b);   // only once the props exist
  const off = events.on('prefs:change', p => lounge.setReducedMotion(p.reducedMotion));
  return {
    update({ t }) { lounge.update(t); },
    dispose() { off(); lounge.dispose(); },
  };
}
