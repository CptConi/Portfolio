// Tiny synchronous event bus shared by the engine and the features.
//
//   events.on('console:open', ({ id }) => …)   → returns an unsubscribe function
//   events.emit('console:open', { id: 'projects' })
//
// Event names used so far (add new ones here so they stay discoverable):
//   'game:start'                       the visitor entered the level
//   'sector:enter'   { type, name }    the player crossed into another room
//   'console:open'   { id }            a console/arcade was focused
//   'console:close'  { id }
//   'link:open'      { url, label }    an outbound link was opened from a console
//   'item:pickup'    { id }            a collectible was picked up (e.g. the PROD key)
//   'secret:found'   { id }            a secret was revealed ('prod', 'cat-1'…)
//   'fx:shake'       { amount, ms }    request a camera shake
//   'toast'          { text, ms, kind } show a line in the message bar
export class Events {
  constructor() { this._h = new Map(); }

  on(name, fn) {
    if (!this._h.has(name)) this._h.set(name, new Set());
    this._h.get(name).add(fn);
    return () => this._h.get(name)?.delete(fn);
  }

  emit(name, payload) {
    const set = this._h.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(payload); } catch (err) { console.error(`[events] ${name} handler failed`, err); }
    }
  }
}

// One shared bus for the whole app.
export const events = new Events();
