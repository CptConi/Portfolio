// Feature registry — each feature is a self-contained module built from a shared
// context and ticked once per frame by main.js. Keeping features out of main.js
// lets them evolve independently (secret device, dioramas, notes…).
//
// A feature is created with `create(ctx)` and returns an object with optional hooks:
//
//   update(frame, screens) → void | { cameraOverride?, prompt?, blockMovement? }
//       frame   = { dt, t, player, input, focused }
//       screens = result of ScreenManager.update (read-only) for this frame
//       Returned fields are merged by main.js: the first cameraOverride wins (a
//       focused console always has priority), blockMovement is OR-ed, the first
//       non-empty prompt wins.
//   dispose() → void
//
// ctx = { scene, textures, renderer, player, input, hud, hands, screens, pushwall,
//         events, toast, track }

import { create as createFx } from './fx.js';
import { create as createNotes } from './notes.js';
import { create as createShell } from './shell.js';
import { create as createSecret } from './secret.js';
import { create as createGallery } from './gallery.js';
import { create as createMood } from './mood.js';
import { create as createLounge } from '../engine/props/index.js';
import { create as createRecette } from './recette.js';
import { create as createCats } from './cats.js';
import { create as createTour } from './tour.js';
import { create as createIntro } from './intro.js';

const FACTORIES = [
  createFx,
  createNotes,   // before createGallery: where a note sits on a plinth, the one aimed at wins the [E] (features/notes.js)
  createShell,
  createSecret,
  createGallery,
  createMood,
  createLounge,
  createRecette,
  createCats,
  createTour,
  createIntro,
  // (feature factories are added here as they are built)
];

// A feature that throws while being built, in update(), or in one of its event handlers is
// disabled and logged: a broken ornament must never take the whole level down. Handlers
// registered through the `events` passed in ctx are scoped to the feature, so a failure
// unsubscribes all of them and calls dispose().
export function buildFeatures(ctx) {
  const built = [];
  for (const create of FACTORIES) {
    let feature = null;
    let failed = false;
    const offs = [];
    const disable = (where, err) => {
      if (failed) return;
      failed = true;
      console.error(`[features] ${where} failed, feature disabled`, err);
      for (const off of offs.splice(0)) { try { off(); } catch { /* already gone */ } }
      try { feature?.dispose?.(); } catch (e) { console.error('[features] dispose failed', e); }
    };
    const scoped = {
      ...ctx,
      events: {
        emit: (name, payload) => ctx.events.emit(name, payload),
        on: (name, fn) => {
          const off = ctx.events.on(name, payload => {
            if (failed) return;
            try { fn(payload); } catch (err) { disable(`handler for '${name}'`, err); }
          });
          offs.push(off);
          return off;
        },
      },
    };
    try {
      feature = create(scoped);
      if (!feature) continue;
      if (feature.update) {
        const update = feature.update.bind(feature);
        feature.update = (frame, screens) => {
          if (failed) return undefined;
          try { return update(frame, screens); } catch (err) { disable('update', err); return undefined; }
        };
      }
      built.push(feature);
    } catch (err) {
      disable('create', err);
    }
  }
  return built;
}
