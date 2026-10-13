import { buildThresholds } from './decor/thresholds.js';
import { buildAtriumHub, buildGuidanceLines } from './decor/atrium.js';
import { buildGallery } from './decor/gallery.js';
import { buildArmory } from './decor/armory.js';
import { buildQuartiers } from './decor/quartiers.js';
import { buildSecretRoom } from './decor/secret.js';

// Level-design decor layer — additive geometry over the existing scene.
// Each zone lives in its own module under ./decor/ (shared helpers in helpers.js):
//   thresholds  per-room palette, lit door thresholds, signage
//   atrium      central hub holo-directory + floor guidance lines
//   gallery     Trophées: mission dioramas, wall frames, contact frame
//   armory      Armurerie tech racks
//   quartiers   lounge warmth
//   secret      the dark arcade room
// buildDecor() returns { update(t) } so Renderer can spin the holograms.

// Player.js derives collision boxes from the racks.
export { ARMORY_RACK_AABBS } from './decor/armory.js';

export function buildDecor(scene, tex = null) {
  const anim = [];   // { node, ry, rx, y0, amp, spd }

  buildThresholds(scene);
  buildAtriumHub(scene, anim);
  const gallery = buildGallery(scene);
  buildArmory(scene, tex);
  buildQuartiers(scene);
  buildSecretRoom(scene);
  buildGuidanceLines(scene);

  return {
    update(t) {
      for (const a of anim) {
        a.node.rotation.y = t * a.ry;
        a.node.rotation.x = t * a.rx;
        a.node.position.y = a.y0 + Math.sin(t * a.spd) * a.amp;
      }
      gallery.update(t);
    },
  };
}
