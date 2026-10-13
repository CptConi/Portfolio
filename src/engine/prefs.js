// User comfort preferences, read once and kept live. Features must honour them:
//   prefs.reducedMotion  → no camera shake, no flashes/glitches, no auto camera moves
//                          beyond what is strictly needed, gentler animation.
import { events } from './Events.js';

const mq = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;

export const prefs = {
  reducedMotion: !!mq?.matches,
};

mq?.addEventListener?.('change', e => {
  prefs.reducedMotion = e.matches;
  events.emit('prefs:change', prefs);
});
