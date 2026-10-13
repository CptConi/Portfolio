// Privacy-first analytics (self-hosted Umami, no cookies). The Umami script is
// only injected in production builds (see vite.config.js), so in dev and in
// preview deployments window.umami is undefined and this is a no-op.
//
// Event names stay short and stable, values are small and non-personal.
export function track(name, data) {
  try { window.umami?.track?.(name, data); } catch { /* analytics must never break the game */ }
}

// Call once: forwards the interesting engine events to Umami.
export function wireAnalytics(events) {
  events.on('game:start',    ()          => track('game-start'));
  events.on('console:open',  ({ id })    => track('console-open', { id }));
  events.on('link:open',     ({ label }) => track('link-open', { label }));
  events.on('secret:found',  ({ id })    => track('secret-found', { id }));
  events.on('item:pickup',   ({ id })    => track('item-pickup', { id }));
}
