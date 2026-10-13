// Message bar: short narration / pickup lines shown above the HUD banner, in the
// game's pixel font. Messages queue, never block input, and fade out on their own.
// `aria-live` makes them readable by screen readers.
//
//   toast.show('Une clé avec une étiquette…', { ms: 5200, kind: 'item' })
//   kinds: 'info' (default), 'item' (amber), 'secret' (pink), 'system' (cyan)
export class Toast {
  constructor(container) {
    this._el = document.createElement('div');
    this._el.id = 'toast';
    this._el.setAttribute('role', 'status');
    this._el.setAttribute('aria-live', 'polite');
    this._el.hidden = true;
    container.appendChild(this._el);

    this._queue = [];
    this._timer = 0;
    this._current = null;
  }

  // Pickups and secrets are the moments the visitor is waiting for: they preempt
  // the message on screen and jump the queue, without dropping what is waiting.
  show(text, { ms = Math.max(2600, 55 * text.length), kind = 'info', urgent = kind === 'item' || kind === 'secret' } = {}) {
    // Same line twice in a row (e.g. a button mashed): ignore.
    const last = this._current ?? this._queue[this._queue.length - 1];
    if (last && last.text === text) return;
    if (urgent) {
      clearTimeout(this._timer);
      this._queue.unshift({ text, ms, kind });
      this._next();
      return;
    }
    this._queue.push({ text, ms, kind });
    if (!this._current) this._next();
  }

  clear() {
    clearTimeout(this._timer);
    this._queue.length = 0;
    this._current = null;
    this._el.hidden = true;
  }

  _next() {
    const m = this._queue.shift();
    if (!m) { this._current = null; this._el.classList.remove('on'); setTimeout(() => { if (!this._current) this._el.hidden = true; }, 350); return; }
    this._current = m;
    this._el.hidden = false;
    this._el.className = 'on ' + m.kind;
    this._el.textContent = m.text;
    this._timer = setTimeout(() => this._next(), m.ms);
  }
}
