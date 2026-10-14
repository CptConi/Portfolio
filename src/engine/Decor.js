import { buildThresholds } from './decor/thresholds.js';
import { buildAtriumHub, buildGuidanceLines } from './decor/atrium.js';
import { buildGallery } from './decor/gallery.js';
import { buildArmory } from './decor/armory.js';
import { buildQuartiers } from './decor/quartiers.js';
import { buildSecretRoom } from './decor/secret.js';
import { buildWindows } from './decor/windows.js';

// Level-design decor layer — additive geometry over the existing scene.
// Each zone lives in its own module under ./decor/ (shared helpers in helpers.js):
//   thresholds  per-room palette, lit door thresholds, signage
//   atrium      central hub holo-directory + floor guidance lines
//   gallery     Trophées: mission dioramas, wall frames, contact frame
//   armory      Armurerie tech racks
//   quartiers   lounge warmth
//   secret      the dark arcade room
//   windows     panes onto the exterior world (+ the atrium skylight): they read the exterior render target
// buildDecor() returns { update(t), windows } so Renderer can spin the holograms and ask the windows whether any pane is on screen.

// Player.js derives collision boxes from the racks.
export { ARMORY_RACK_AABBS } from './decor/armory.js';

export function buildDecor(scene, tex = null, exterior = null) {
  const anim = [];   // { node, ry, rx, y0, amp, spd }

  buildThresholds(scene);
  buildAtriumHub(scene, anim);
  const gallery = buildGallery(scene);
  buildArmory(scene, tex);
  buildQuartiers(scene);
  buildSecretRoom(scene);
  buildGuidanceLines(scene);
  const windows = buildWindows(scene, exterior);

  return {
    windows,
    update(t) {
      for (const a of anim) {
        a.node.rotation.y = t * a.ry;
        a.node.rotation.x = t * a.rx;
        a.node.position.y = a.y0 + Math.sin(t * a.spd) * a.amp;
      }
      gallery.update(t);
      windows.update(t);
    },
  };
}
