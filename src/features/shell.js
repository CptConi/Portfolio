// Shell feature — the DOM layer around the level: the CONTACT chip + sheet (key C),
// the PLAN warp menu (key M), mission deep links with a "copy link" button, and the
// hand-off of the start screen from "CHARGEMENT…" to "INSÉRER UN JETON".
//
// The 3D gives mood, the DOM carries what must be read or clicked: both dialogs are
// real DOM (role="dialog", aria-modal, focus trapped and restored, ESC closes) and
// live inside #game-container so they survive fullscreen.
//
// Hash routes (read on game:start and on hashchange while exploring):
//   #atrium #armurerie #trophees #quartiers   → teleport into the room
//   #contact → contact console   #competences → skills console   #digital-factory → STATUS console
//   #<mission-slug> (e.g. #phenix-formation)  → projects console on that mission's page
// While the projects console is focused the hash follows the page on screen (so the
// address bar is always a shareable link) and is restored on exit.
//
// Events: listens to game:start, console:open, console:close, contact:open, plan:open, modal:open
// (only to stay off the pointer lock while another module's dialog is up); emits 'toast'
// and the three below.
//   contact:open   (no payload)             another module asks for the contact sheet
//   plan:open      (no payload)             another module asks for the PLAN menu
//   modal:open     { id: 'contact'|'plan' } a sheet appeared: whatever floats over the level
//   modal:close    { id: 'contact'|'plan' } (notes) pauses until it is gone again
//   contact:opened (no payload)             the contact sheet appeared, however it was reached
//                                           (chip, C, contact:open); sent right after modal:open
// contact:open / plan:open run the exact code path of the chip / the C and M keys, so they are
// ignored before game start, while a console is focused, and while a dialog or a warp is already
// running. Other dialogs (the report) emit their own modal:open / modal:close with their own id.
// Dev handle: __game.key('c') / __game.key('m') toggle the dialogs.
import '../styles/shell.css';
import { projects } from '../data/projects.js';
import { contact } from '../data/contact.js';
import { getCellType } from '../engine/Map.js';
import { prefs } from '../engine/prefs.js';

// "Phenix Formation" → "phenix-formation" (also used by the dossier page for its links).
export const missionSlug = name => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const PAGE_TO_SLUG = projects.map(p => missionSlug(p.name));
const SLUG_TO_PAGE = new Map();
PAGE_TO_SLUG.forEach((slug, page) => { if (!SLUG_TO_PAGE.has(slug)) SLUG_TO_PAGE.set(slug, page); });

// Arrival spots [x, z, heading°]: about one metre inside each room, looking into it.
// Checked against Map.js / Player.js collision (walkable, connected, clear ahead). Exported so
// the other warps (the report's "Y aller") land on the very same spots.
export const ARRIVALS = {
  atrium:    [12.5, 15.4, 270],
  armurerie: [7.0, 12.5, 180],
  trophees:  [17.8, 12.5, 0],
  quartiers: [12.5, 5.4, 270],
};

// Plan entries. `cell` is the Map.js sector type, used to mark where the visitor is.
const DESTS = [
  { id: 'atrium',    name: 'ATRIUM',          sub: 'Le hall, point de départ',   color: '#37c0ff', cell: 6 },
  { id: 'armurerie', name: 'ARMURERIE',       sub: 'Compétences',                color: '#00ff41', cell: 2 },
  { id: 'trophees',  name: 'TROPHÉES',        sub: 'Missions',                   color: '#ff8c00', cell: 3 },
  { id: 'quartiers', name: 'QUARTIERS',       sub: 'Profil et contact',          color: '#cc44ff', cell: 4 },
  { id: 'digital-factory', name: 'DIGITAL FACTORY', sub: 'Le tableau de bord STATUS', color: '#ffdd00', cell: -1, console: 'dashboard' },
];

// Non-room, non-mission hash routes → console id.
const CONSOLE_LINKS = { contact: 'contact', competences: 'skills', 'digital-factory': 'dashboard' };

// Own-property test: a hash like '#constructor' must not match Object.prototype members.
const own = (table, key) => Object.prototype.hasOwnProperty.call(table, key);

const FADE_MS = 200;
const DEG = Math.PI / 180;
const BLOCK = { blockMovement: true };   // returned while a dialog or a warp holds the player

// '#Trophées' / '#troph%C3%A9es' / '#phenix-formation' → { key, room } | { key, console, page? } | null
function resolveHash(hash) {
  let raw = hash.replace(/^#/, '');
  try { raw = decodeURIComponent(raw); } catch { /* keep the raw text */ }
  const key = missionSlug(raw);
  if (own(ARRIVALS, key)) return { key, room: key };
  if (own(CONSOLE_LINKS, key)) return { key, console: CONSOLE_LINKS[key] };
  if (SLUG_TO_PAGE.has(key)) return { key, console: 'projects', page: SLUG_TO_PAGE.get(key) };
  return null;
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

export function create({ player, input, screens, events, track }) {
  const container = document.getElementById('game-container');
  const canvas = document.getElementById('game-canvas');
  const cleanup = [];
  const listen = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    cleanup.push(() => target.removeEventListener(type, fn, opts));
  };

  // The features are built once every asset is loaded: the start screen can offer the coin. They
  // are all built in one synchronous run of main.js, which also binds the start handlers, so the
  // first paint that shows 'ready' follows every factory whatever its place in FACTORIES.
  document.body.dataset.boot = 'ready';

  let started = false;      // game:start happened (nothing here is reachable before)
  let consoleFocused = false;
  let current = null;       // the open dialog
  let opener = null;        // element to give the focus back to
  let wasLocked = false;    // pointer was locked when the dialog opened
  let warping = false;      // fade-out → teleport → fade-in in progress

  const lock = () => { try { canvas.requestPointerLock()?.catch?.(() => {}); } catch { /* touch / unsupported */ } };

  // ── Clipboard (async API first, then a throw-away textarea for older webviews) ──
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* insecure context, permission denied, old webview */ }
    const ta = el('textarea', 'shell-clip');
    ta.value = text;
    ta.readOnly = true;
    const prev = document.activeElement;
    (current?.card ?? container).append(ta);   // inside the open dialog, so its focus trap leaves it alone
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignored */ }
    ta.remove();
    prev?.focus?.({ preventScroll: true });
    return ok;
  }

  const selectContents = node => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };

  // ── Dialog scaffold ────────────────────────────────────────────────────────
  // `name` is the id the modal events carry; `key` the letter that toggles the sheet.
  function makePanel(name, key, title) {
    const overlay = el('div', 'shell-overlay');
    overlay.id = `shell-${name}`;
    overlay.hidden = true;
    const card = el('div', 'shell-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.tabIndex = -1;
    const heading = el('h2', 'shell-title', title);
    heading.id = `${overlay.id}-title`;
    card.setAttribute('aria-labelledby', heading.id);
    const close = el('button', 'shell-close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'Fermer');
    close.addEventListener('click', () => closePanel());
    card.append(close, heading);
    overlay.append(card);
    // Click outside the card closes it — unless a text selection started inside and
    // ended on the backdrop.
    let pressedOnBackdrop = false;
    overlay.addEventListener('pointerdown', e => { pressedOnBackdrop = e.target === overlay; });
    overlay.addEventListener('click', e => { if (pressedOnBackdrop && e.target === overlay) closePanel(); });
    container.append(overlay);
    return { name, key, overlay, card };
  }

  // ── CONTACT sheet ──────────────────────────────────────────────────────────
  const contactPanel = makePanel('contact', 'c', 'CONTACT');
  const status = el('p', 'shell-status');
  status.setAttribute('role', 'status');
  let copyTimer = 0;

  // The visible label is short ("OUVRIR ↗" twice in a row): the accessible name says which one.
  function contactLink(c, label) {
    const a = el('a', 'shell-btn', label);
    a.href = c.url;
    if (c.url.startsWith('mailto:')) {
      a.setAttribute('aria-label', 'Écrire un e-mail');
    } else {
      a.target = '_blank';
      a.setAttribute('aria-label', `Ouvrir ${c.name} (nouvel onglet)`);
    }
    a.rel = 'noopener';
    a.dataset.umamiEvent = 'contact-click';
    a.dataset.umamiEventLabel = c.icon;
    return a;
  }

  function contactRow(c) {
    const row = el('li', 'shell-row');
    const main = el('div', 'shell-row-main');
    const value = el('span', 'shell-val', c.value);
    main.append(el('span', 'shell-row-name', c.name.toUpperCase()), value);
    const actions = el('div', 'shell-row-actions');
    if (c.icon === 'email') {
      const copy = el('button', 'shell-btn', 'COPIER');
      copy.type = 'button';
      copy.setAttribute('aria-label', 'Copier l\'adresse e-mail');
      copy.dataset.umamiEvent = 'contact-click';
      copy.dataset.umamiEventLabel = 'email-copy';
      copy.addEventListener('click', async () => {
        const ok = await copyText(c.value);
        if (!ok) selectContents(value);
        status.textContent = ok ? 'Adresse copiée.' : 'Adresse sélectionnée\u00a0: copiez-la avec Ctrl ou ⌘ + C.';
        copy.textContent = ok ? 'COPIÉ ✓' : 'COPIER';
        clearTimeout(copyTimer);
        copyTimer = setTimeout(() => { copy.textContent = 'COPIER'; status.textContent = ''; }, 2400);
      });
      actions.append(copy, contactLink(c, 'ÉCRIRE'));
    } else {
      actions.append(contactLink(c, 'OUVRIR ↗'));
    }
    row.append(main, actions);
    return row;
  }

  const rows = el('ul', 'shell-rows');
  for (const c of contact) rows.append(contactRow(c));
  contactPanel.card.append(el('p', 'shell-lead', 'Envie d\'échanger\u00a0? Écrivez-moi.'), rows, status);
  contactPanel.onOpen = () => track('contact-open');

  // ── PLAN menu ──────────────────────────────────────────────────────────────
  const planPanel = makePanel('plan', 'm', 'PLAN');
  const list = el('ul', 'shell-list');
  const destButtons = DESTS.map((d, i) => {
    const b = el('button', 'shell-dest');
    b.type = 'button';
    b.style.setProperty('--c', d.color);
    const text = el('span', 'shell-dest-text');
    text.append(el('span', 'shell-dest-name', d.name), el('span', 'shell-dest-sub', d.sub));
    b.append(el('span', 'shell-dest-key', String(i + 1)), text);
    b.addEventListener('click', () => warp(d));
    const li = el('li');
    li.append(b);
    list.append(li);
    return b;
  });
  planPanel.card.append(
    el('p', 'shell-lead', 'Où souhaitez-vous aller\u00a0?'),
    list,
    el('p', 'shell-foot', `1 à ${DESTS.length}\u00a0: choisir · M ou ÉCHAP\u00a0: fermer`),
  );
  planPanel.onOpen = () => {
    const here = getCellType(player.x, player.y);
    destButtons.forEach((b, i) => {
      if (DESTS[i].cell === here) b.setAttribute('aria-current', 'location');
      else b.removeAttribute('aria-current');
    });
    planPanel.focusTarget = destButtons[Math.max(0, DESTS.findIndex(d => d.cell === here))];
  };

  // ── Open / close ───────────────────────────────────────────────────────────
  const busy = () => !!current || warping;

  function openPanel(p) {
    if (busy() || consoleFocused || screens.focused || !started) return;
    current = p;
    opener = document.activeElement;
    wasLocked = document.pointerLockElement === canvas;
    if (wasLocked) document.exitPointerLock();
    p.onOpen?.();
    p.overlay.hidden = false;
    (p.focusTarget ?? p.card).focus({ preventScroll: true });
    events.emit('modal:open', { id: p.name });
    if (p === contactPanel) events.emit('contact:opened');
  }

  function closePanel(relock = true) {
    if (!current) return;
    const { name } = current;
    current.overlay.hidden = true;
    current = null;
    const back = opener;
    opener = null;
    if (back?.isConnected && back !== document.body) back.focus({ preventScroll: true });
    if (relock && wasLocked) lock();
    events.emit('modal:close', { id: name });
  }

  const togglePanel = p => (current === p ? closePanel() : openPanel(p));

  // Keyboard while a dialog is open (capture phase on the document, ahead of Input and
  // ScreenManager): nothing typed in a dialog may drive the game, and ESC must not also
  // leave a console.
  function onKey(e) {
    if (!current) return;
    e.stopPropagation();
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (e.key === 'Escape' || (plain && e.key?.toLowerCase() === current.key)) {
      e.preventDefault();
      // A held key auto-repeats: only its first press may close, or the sheet that C
      // just opened would vanish again once the OS repeat delay elapses.
      if (!e.repeat) closePanel();
    } else if (e.key === 'Tab') {
      trapTab(e);
    } else if (current === planPanel) {
      planKeys(e);
    }
  }

  function trapTab(e) {
    const items = [...current.card.querySelectorAll('a[href], button:not([disabled])')];
    const first = items[0], last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === current.card)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }

  function planKeys(e) {
    const i = destButtons.indexOf(document.activeElement);
    const n = destButtons.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      destButtons[(i + 1) % n].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      destButtons[i < 0 ? n - 1 : (i - 1 + n) % n].focus();
    } else {
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      // Ctrl/⌘/Alt + digit belong to the browser (tab switching): leave them alone.
      if (m && DESTS[m[1] - 1] && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); warp(DESTS[m[1] - 1]); }
    }
  }

  listen(document, 'keydown', onKey, true);
  listen(document, 'focusin', e => {
    if (current && !current.card.contains(e.target)) current.card.focus({ preventScroll: true });
  });

  // ── Warp (plan menu) ───────────────────────────────────────────────────────
  const fade = el('div');
  fade.id = 'shell-fade';
  fade.setAttribute('aria-hidden', 'true');
  container.append(fade);

  const arrive = ([x, z, deg]) => player.teleport(x, z, deg * DEG);

  function warp(dest) {
    closePanel(false);
    track('plan-use', { to: dest.id });
    const go = () => {
      // The STATUS console may not exist yet: fall back to the atrium.
      if (dest.console && screens.focusConsole(player, dest.console)) return;   // consoles release the pointer themselves
      arrive(ARRIVALS[dest.id] ?? ARRIVALS.atrium);
      if (wasLocked) lock();
    };
    if (prefs.reducedMotion) { go(); return; }
    warping = true;
    fade.classList.add('on');
    setTimeout(() => {
      go();
      fade.classList.remove('on');
      warping = false;
    }, FADE_MS);
  }

  screens.addInteractGuard(busy);

  // ── Chips (CONTACT, PLAN) ──────────────────────────────────────────────────
  const chips = el('div');
  chips.id = 'shell-chips';
  chips.inert = true;       // not reachable by Tab behind the start screen
  const chip = (label, key, panel, aria) => {
    const b = el('button', 'shell-chip');
    b.type = 'button';
    b.setAttribute('aria-label', aria);
    b.setAttribute('aria-keyshortcuts', key.toUpperCase());
    b.append(el('span', null, label), el('kbd', null, key.toUpperCase()));
    b.addEventListener('click', () => openPanel(panel));
    // Space is the game's [E]: it must not also trigger the chip that keeps the focus.
    const noSpace = e => { if (e.key === ' ') e.preventDefault(); };
    b.addEventListener('keydown', noSpace);
    b.addEventListener('keyup', noSpace);
    return b;
  };
  chips.append(
    chip('CONTACT', 'c', contactPanel, 'Contact (raccourci C)'),
    chip('PLAN', 'm', planPanel, 'Plan du niveau (raccourci M)'),
  );
  container.append(chips);

  // ── Missions: shareable hash + "COPIER LE LIEN" ────────────────────────────
  let missionOpen = false;
  let hashBefore = '';
  let shownSlug = '';
  const replaceHash = hash => {
    try { history.replaceState(history.state, '', location.pathname + location.search + hash); } catch { /* sandboxed frame */ }
  };

  const copyLink = el('button', 'shell-copylink', 'COPIER LE LIEN');
  copyLink.type = 'button';
  copyLink.hidden = true;
  // While a console is focused Enter opens its outbound link and Space leaves it:
  // pressing them on this button must do the button's job only.
  copyLink.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); });
  copyLink.addEventListener('click', async () => {
    const slug = PAGE_TO_SLUG[screens.activePage];
    if (!slug) return;
    copyLink.blur();
    const ok = await copyText(`${location.origin}${location.pathname}#${slug}`);
    events.emit('toast', {
      text: ok ? 'Lien copié.' : 'Copie impossible\u00a0: prenez l\'adresse dans la barre du navigateur.',
      ms: 2400,
    });
  });
  container.append(copyLink);

  cleanup.push(events.on('console:open', ({ id }) => {
    if (id !== 'projects') return;
    missionOpen = true;
    hashBefore = location.hash;
    shownSlug = '';
  }));
  cleanup.push(events.on('console:close', ({ id }) => {
    if (id !== 'projects') return;
    missionOpen = false;
    replaceHash(hashBefore);
  }));

  // ── Deep links ─────────────────────────────────────────────────────────────
  function applyHash() {
    const target = resolveHash(location.hash);
    if (!target) return;
    if (target.room) arrive(ARRIVALS[target.room]);
    else if (!screens.focusConsole(player, target.console, target.page ?? null)) return;
    track('deeplink', { target: target.key });
  }

  cleanup.push(events.on('game:start', () => {
    started = true;
    chips.inert = false;
    // The key that started the game must not also open a dialog.
    input.consumeKey('c');
    input.consumeKey('m');
    applyHash();
  }));
  listen(window, 'hashchange', () => { if (started && !busy() && !screens.focused) applyHash(); });

  // ── Requests from other modules ────────────────────────────────────────────
  cleanup.push(events.on('contact:open', () => openPanel(contactPanel)));
  cleanup.push(events.on('plan:open', () => openPanel(planPanel)));

  // A foreign dialog (the report) that opens during a warp's fade has already released the pointer:
  // the warp must not grab it back from under that dialog.
  cleanup.push(events.on('modal:open', ({ id } = {}) => {
    if (id !== contactPanel.name && id !== planPanel.name) wasLocked = false;
  }));

  return {
    update(frame) {
      if (frame.focused !== consoleFocused) {
        consoleFocused = frame.focused;
        chips.toggleAttribute('data-off', consoleFocused);
      }

      if (missionOpen) {
        const slug = PAGE_TO_SLUG[screens.activePage];
        if (slug && slug !== shownSlug) { shownSlug = slug; replaceHash('#' + slug); }
      }
      if (copyLink.hidden !== !missionOpen) copyLink.hidden = !missionOpen;

      if (!consoleFocused && !warping) {
        if (frame.input.consumeKey('c')) togglePanel(contactPanel);
        else if (frame.input.consumeKey('m')) togglePanel(planPanel);
      }
      return busy() ? BLOCK : undefined;
    },

    dispose() {
      closePanel(false);
      for (const off of cleanup) off();
      for (const n of [contactPanel.overlay, planPanel.overlay, chips, copyLink, fade]) n.remove();
    },
  };
}
