// Feel pack glue: forwards fx events to renderer.fx and tints the screen very softly
// whenever the visitor enters a coloured room.
//
// Listens to (all optional payload fields):
//   fx:shake { amount 0..1, ms }                    → renderer.fx.shake
//   fx:flash { color: css colour, ms, alpha? }      → renderer.fx.flash (alpha = peak opacity, default 0.3)
//   sector:enter { type }                           → 150 ms room tint (types 2..6; 0/1 are ignored)
// reducedMotion is honoured inside renderer.fx (no shake, no flash).

const SECTOR_TINT = {
  2: '#00ff41',   // armurerie
  3: '#ff8c00',   // trophées
  4: '#cc44ff',   // quartiers
  5: '#ff2a9d',   // secret
  6: '#37c0ff',   // atrium
};
const TINT_MS = 150;
const TINT_ALPHA = 0.07;

export function create({ renderer, events }) {
  const fx = renderer.fx;
  // The spawn sector is announced on the first frame; it must not flash.
  let skipNext = true;

  const off = [
    events.on('game:start', () => { skipNext = true; }),
    events.on('fx:shake', ({ amount, ms } = {}) => fx.shake(amount, ms)),
    events.on('fx:flash', ({ color, ms, alpha } = {}) => fx.flash(color, ms, alpha)),
    events.on('sector:enter', ({ type } = {}) => {
      if (skipNext) { skipNext = false; return; }
      const color = SECTOR_TINT[type];
      if (color) fx.flash(color, TINT_MS, TINT_ALPHA);
    }),
  ];

  return {
    // A focused console fills the view: keep its text clean of vignette and colour fringes.
    update({ focused }) { fx.setFocused(focused); },
    dispose() { for (const unsubscribe of off) unsubscribe(); },
  };
}
