// Recette feature — the RAPPORT DE RECETTE. The level is the staging build, the visitor is its
// tester, and four "cas de test", named like achievements, tell whether the build is good to go:
//   CAPACITÉS  (ct-01, the Armurerie)  the skills console was opened
//   SUCCÈS     (ct-02, the Trophées)   the projects console was opened (console or plinth)
//   IDENTITÉ   (ct-03, the Quartiers)  the passions console was opened
//   CONTACT    (ct-04, the Quartiers)  the contact console or the contact sheet was opened
// The ct-0x ids are internal (events, analytics, dev helpers); the visitor only ever reads the names.
// Progress lives in memory for the visit (nothing is persisted).
//
// What the visitor gets
//   - a "RECETTE n/4" chip next to CONTACT and PLAN (key R), which opens the report; its tooltip and
//     accessible name say what the count is. It pulses for 2 s when the arrival sequence (features/intro.js)
//     points at it (intro:beat with hint 'rapport');
//   - the report: a real DOM dialog (role="dialog", aria-modal, focus trapped and restored, ESC
//     or R closes, the pointer lock is handed back) opening on two lines that explain the game, then the
//     four cas with their "Y ALLER" warps (same arrival spots as the PLAN menu), intermission-style
//     counters (cas, secrets, cafés on desktop, notes trouvées), the verdict with its dry line, and the
//     contact channels at all times. At 4/4 the verdict becomes RECETTE VALIDÉE and a button copies a
//     short plain-text summary;
//   - a system toast per first validation (the very first one also says where the count is kept), held
//     until the visitor is back in the level (a console or a sheet is not covered), and a gold flourish
//     at 4/4: the hub gauge turns gold (decor/atrium.js getHubGauge), the mug too (body.rc-gold,
//     recette.css) and a gold flash plays;
//   - the hub itself: aiming at the holo within 1.8 m offers [ E ] RAPPORT DE RECETTE.
//
// Copy: the row labels and subtitles, the lines under the verdict and the door vocabulary come from the
// final copy, verbatim (only French typography is applied: no-break spaces before : ; ? ! % » and after «).
//
// Events
//   emits   ct:validated { id: 'ct-01'..'ct-04', count }   a cas was validated for the first time
//           modal:open / modal:close { id: 'rapport' }    the report opened / closed (as the
//                                                          shell does for 'contact' and 'plan')
//           fx:flash { color, ms }                         gold, at 4/4 (never with reduced motion)
//   listens console:open { id }, contact:opened, modal:open { id: 'contact' } (shell.js), sip (ui/Hands.js
//           drink()), note:read { id }, secret:found { id }, intro:beat { hint } (features/intro.js),
//           tour:start / tour:end (features/tour.js: while the guided tour runs, nothing of the recette
//           pops up: the validations it causes are announced once it is over), game:start
// Analytics: track('rapport-open', { from }), ('ct-validated', { id, count }), ('rapport-goto',
// { id }), ('rapport-copy').
//
// Uses screens.addInteractGuard so no console steals the [E] while the hub is aimed at, and a fresh
// press is required for every action (a held E or its auto-repeat never chains). update() returns
// { prompt } or { blockMovement } while the report or a warp holds the player.
//
// DEV only (browser console), once the game has booted:
//   __game.recette.validate(n)   validate the first n cas in order (4 by default), or one id: 'ct-03'
//   __game.recette.reset()       back to 0/4 (gauge, mug and chip included)
//   __game.recette.state()       { done, secrets, sips, notes, pending }
import '../styles/recette.css';
import { contact } from '../data/contact.js';
import { notes } from '../data/notes.js';
import { getCellType } from '../engine/Map.js';
import { HUB, getHubGauge } from '../engine/decor/atrium.js';
import { prefs } from '../engine/prefs.js';
import { ARRIVALS } from './shell.js';

const NB = '\u00a0';   // no-break space: French typography (before « ? » and « : »)

// French typography on copy: a no-break space before « : ; ? ! % » » and after « « ».
const fr = s => s.replace(/ ([:;?!%»])/g, `${NB}$1`).replace(/« /g, `«${NB}`);

// `label` and `subtitle` are the final copy (rapportRows), verbatim. `arrival` = [x, z, heading°]: the PLAN
// menu's arrival spots (shell.js ARRIVALS), each one looking at the console of its case. IDENTITÉ stands on the
// Quartiers spot turned toward the console on the west wall.
const [QUARTIERS_X, QUARTIERS_Z] = ARRIVALS.quartiers;
const CASES = [
  { id: 'ct-01', label: 'CAPACITÉS', subtitle: 'Armurerie : les compétences, par famille',
    console: 'skills', color: '#00ff41', arrival: ARRIVALS.armurerie },
  { id: 'ct-02', label: 'SUCCÈS', subtitle: 'Trophées : missions, maquettes à l\'appui',
    console: 'projects', color: '#ff8c00', arrival: ARRIVALS.trophees },
  { id: 'ct-03', label: 'IDENTITÉ', subtitle: 'Quartiers : profil hors heures de bureau',
    console: 'passions', color: '#cc44ff', arrival: [QUARTIERS_X, QUARTIERS_Z, 194] },
  { id: 'ct-04', label: 'CONTACT', subtitle: 'Quartiers : 3 canaux, un destinataire',
    console: 'contact', color: '#37c0ff', arrival: ARRIVALS.quartiers },
];

// What the report says under the verdict, by number of cas validated (final copy, reportLines).
const REPORT_LINES = [
  'Rien à signaler, faute d\'avoir regardé.',
  'Couverture : 25 %. On a déjà livré avec moins.',
  'Mi-parcours. L\'auteur regarde ailleurs, très naturellement.',
  'Reste un cas, classé « trivial ». L\'expérience recommande de s\'inquiéter.',
  'Rien à signaler. Cette fois, après avoir regardé.',
];

// The two lines that open the report: what is being tested, who keeps the count, what does not count.
// Written in sentence case and set in capitals by the stylesheet (system voice): a screen reader gets words.
const EXPLAINER = 'Vous testez ce portfolio : chaque console ouverte valide un cas de test, et ce rapport en tient le compte. '
  + 'Les secrets sont facultatifs et ne comptent jamais contre vous.';
const TOTAL = CASES.length;
const BY_CONSOLE = new Map(CASES.map(c => [c.console, c]));
const BY_ID = new Map(CASES.map(c => [c.id, c]));

// Secrets worth counting (secret:found ids): the PROD wall and the three cats.
const SECRET_IDS = ['prod', 'cat-armurerie', 'cat-quartiers', 'cat-prod'];

const ATRIUM = 6;               // Map.js sector type of the hall: the gauge only sweeps while it is in view
const HUB_REACH = 1.8;          // m from the player to the hub
const HUB_FACING = 0.55;        // cosine of the aiming cone (~57°)
const HUB_MIN = 0.25;           // m: standing inside the holo, there is no meaningful direction
const DEBOUNCE = 0.4;           // s after an action during which presses are ignored
const FADE_MS = 200;
const TOUR_MAX = 90;            // s: the guided tour lasts ~40 s; past this, a missing tour:end is assumed
const DEG = Math.PI / 180;
const FLASH = { color: '#ffc233', ms: 350 };
const PROMPT = '[ E ] RAPPORT DE RECETTE';
const BLOCK = { blockMovement: true };   // returned while the report or a warp holds the player
const HINT_MS = 2000;           // how long the chip pulses when the arrival sequence points at it

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

const plural = (n, one, many) => `${n} ${n < 2 ? one : many}`;   // French: zero is singular too

export function create({ player, input, screens, events, toast, track }) {
  const container = document.getElementById('game-container');
  const canvas = document.getElementById('game-canvas');
  const gauge = getHubGauge();
  const cleanup = [];
  const listen = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    cleanup.push(() => target.removeEventListener(type, fn, opts));
  };

  const done = new Set();        // validated case ids
  const secrets = new Set();     // SECRET_IDS found
  const notesRead = new Set();
  let sips = 0;
  const pending = [];            // validations whose toast waits for a calm moment

  let started = false;           // game:start happened
  let consoleFocused = false;
  let isOpen = false;            // the report is open
  let opener = null;             // element to give the focus back to
  let wasLocked = false;         // pointer was locked when the report opened
  let warping = false;           // fade-out → teleport → fade-in in progress
  let fadeTimer = 0;
  let copyTimer = 0;
  let mailTimer = 0;
  let hintTimer = 0;

  let clock = 0;
  let quietUntil = 0;            // presses are ignored until then
  let tourUntil = 0;             // the guided tour is running until then (clock time)
  let eHeld = false;             // E or Space is physically down
  let freshKey = false;          // E or Space went down (not a repeat) since the last frame
  let wasDown = false;           // previous frame's touch contact
  let latched = false;           // an action just fired: consoles stay off until the key is released
  const out = { prompt: PROMPT };

  // The shell's CONTACT or PLAN sheet is on screen (read from the DOM: no state to get stuck).
  const sheetOpen = () => !!container.querySelector('.shell-overlay:not([hidden])');
  const lock = () => { try { canvas.requestPointerLock()?.catch?.(() => {}); } catch { /* touch / unsupported */ } };
  const isTouch = () => document.body.classList.contains('is-touch');

  // ── Clipboard (async API first, then a throw-away textarea for older webviews) ──
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* insecure context, permission denied, old webview */ }
    const ta = el('textarea', 'rc-clip');
    ta.value = text;
    ta.readOnly = true;
    const prev = document.activeElement;
    card.append(ta);   // inside the dialog, so its focus trap leaves it alone
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

  // ── The report (DOM) ───────────────────────────────────────────────────────
  const overlay = el('div', 'rc-overlay');
  overlay.id = 'recette-report';
  overlay.hidden = true;
  const card = el('div', 'rc-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.tabIndex = -1;
  const title = el('h2', 'rc-title', 'RAPPORT DE RECETTE');
  title.id = 'recette-report-title';
  card.setAttribute('aria-labelledby', title.id);
  const closeBtn = el('button', 'rc-close', '✕');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Fermer');
  closeBtn.addEventListener('click', () => closeReport());

  // The four cas de test.
  const cases = el('ul', 'rc-cases');
  const caseRows = CASES.map(c => {
    const li = el('li', 'rc-case');
    li.style.setProperty('--c', c.color);
    const text = el('div', 'rc-case-text');
    text.append(el('span', 'rc-case-name', c.label), el('span', 'rc-case-sub', fr(c.subtitle)));
    const status = el('span', 'rc-stamp');
    const go = el('button', 'rc-btn', 'Y ALLER');
    go.type = 'button';
    go.setAttribute('aria-label', `Y aller${NB}: ${c.label}`);
    go.addEventListener('click', () => warp(c));
    li.append(text, status, go);
    cases.append(li);
    return { c, li, status };
  });

  // Counters, intermission style.
  const stats = el('ul', 'rc-stats');
  const stat = (label, extra) => {
    const li = el('li', 'rc-stat' + (extra ? ' ' + extra : ''));
    const value = el('span', 'rc-stat-value');
    li.append(el('span', 'rc-stat-label', label), value);
    stats.append(li);
    return value;
  };
  const statCases = stat('CAS DE TEST');
  const statSecrets = stat('SECRETS');
  const statSips = stat('CAFÉS', 'rc-desktop');   // the mug is a desktop thing: no click, no sip on touch
  const statNotes = stat('NOTES TROUVÉES');

  // Verdict and, once complete, the copy button.
  const verdict = el('div', 'rc-verdict');
  const verdictLine = el('p', 'rc-verdict-line');
  const verdictSub = el('p', 'rc-verdict-sub');
  const copyBtn = el('button', 'rc-btn rc-btn-gold', 'COPIER MON RAPPORT');
  copyBtn.type = 'button';
  copyBtn.hidden = true;
  const copyBox = el('textarea', 'rc-copybox');
  copyBox.readOnly = true;
  copyBox.hidden = true;
  copyBox.rows = 4;
  copyBox.setAttribute('aria-label', 'Rapport à copier');
  const copyNote = el('p', 'rc-note');
  copyNote.setAttribute('role', 'status');
  verdict.append(verdictLine, verdictSub, copyBtn, copyBox, copyNote);

  const main = el('section', 'rc-main');
  main.append(cases, stats, verdict);

  // Contact, always within reach.
  const mailStatus = el('p', 'rc-note');
  mailStatus.setAttribute('role', 'status');
  // The visible label is short ("OUVRIR ↗" twice in a row): the accessible name says which one.
  const contactLink = (c, label) => {
    const a = el('a', 'rc-btn', label);
    a.href = c.url;
    if (c.url.startsWith('mailto:')) {
      a.setAttribute('aria-label', 'Écrire un e-mail');
    } else {
      a.target = '_blank';
      a.setAttribute('aria-label', `Ouvrir ${c.name} (nouvel onglet)`);
    }
    a.rel = 'noopener';
    a.dataset.umamiEvent = 'rapport-contact';
    a.dataset.umamiEventLabel = c.icon;
    return a;
  };
  const contactRow = c => {
    const row = el('li', 'rc-row');
    const info = el('div', 'rc-row-main');
    const value = el('span', 'rc-val', c.value);
    info.append(el('span', 'rc-row-name', c.name.toUpperCase()), value);
    const actions = el('div', 'rc-row-actions');
    if (c.icon === 'email') {
      const copy = el('button', 'rc-btn', 'COPIER');
      copy.type = 'button';
      copy.setAttribute('aria-label', 'Copier l\'adresse e-mail');
      copy.dataset.umamiEvent = 'rapport-contact';
      copy.dataset.umamiEventLabel = 'email-copy';
      copy.addEventListener('click', async () => {
        const ok = await copyText(c.value);
        if (!ok) selectContents(value);
        mailStatus.textContent = ok ? 'Adresse copiée.' : `Adresse sélectionnée${NB}: copiez-la avec Ctrl ou ⌘ + C.`;
        copy.textContent = ok ? 'COPIÉ ✓' : 'COPIER';
        clearTimeout(mailTimer);
        mailTimer = setTimeout(() => { copy.textContent = 'COPIER'; mailStatus.textContent = ''; }, 2400);
      });
      actions.append(copy, contactLink(c, 'ÉCRIRE'));
    } else {
      actions.append(contactLink(c, 'OUVRIR ↗'));
    }
    row.append(info, actions);
    return row;
  };
  const rows = el('ul', 'rc-rows');
  for (const c of contact) rows.append(contactRow(c));
  const contactTitle = el('h3', 'rc-sub', 'CONTACT');
  contactTitle.id = 'recette-contact-title';
  const contactSection = el('section', 'rc-contact');
  contactSection.setAttribute('aria-labelledby', contactTitle.id);
  contactSection.append(contactTitle, el('p', 'rc-lead', `Envie d'échanger${NB}? Écrivez-moi.`), rows, mailStatus);

  const body = el('div', 'rc-body');
  body.append(main, contactSection);
  card.append(closeBtn, el('p', 'rc-kicker', `TICKET #1337 · TESTEUR${NB}: VOUS`), title, el('p', 'rc-intro', fr(EXPLAINER)), body,
    el('p', 'rc-foot', `R ou ÉCHAP${NB}: fermer`));
  overlay.append(card);
  // Click outside the card closes it — unless a text selection started inside and ended on the backdrop.
  let pressedOnBackdrop = false;
  overlay.addEventListener('pointerdown', e => { pressedOnBackdrop = e.target === overlay; });
  overlay.addEventListener('click', e => { if (pressedOnBackdrop && e.target === overlay) closeReport(); });
  container.append(overlay);

  const fade = el('div');
  fade.id = 'recette-fade';
  fade.setAttribute('aria-hidden', 'true');
  container.append(fade);

  // ── Chip ───────────────────────────────────────────────────────────────────
  const chip = el('button', 'rc-chip');
  chip.type = 'button';
  chip.setAttribute('aria-haspopup', 'dialog');
  chip.setAttribute('aria-keyshortcuts', 'R');
  const chipCount = el('span', 'rc-chip-count');
  chip.append(el('span', null, 'RECETTE'), chipCount, el('kbd', null, 'R'));
  chip.addEventListener('click', () => openReport('chip'));
  // Space is the game's [E]: it must not also trigger the chip that keeps the focus.
  const noSpace = e => { if (e.key === ' ') e.preventDefault(); };
  chip.addEventListener('keydown', noSpace);
  chip.addEventListener('keyup', noSpace);
  let chipHost = null;           // own container, only when the shell's chip row is missing

  // The chip joins the shell's row (CONTACT, PLAN) at game start, which also takes care of hiding it
  // while a console is focused; without the shell it gets a row of its own in the same corner.
  function mountChip() {
    const row = document.getElementById('shell-chips');
    if (row) {
      row.prepend(chip);
      return;
    }
    chipHost = el('div');
    chipHost.id = 'recette-chips';
    chipHost.append(chip);
    container.append(chipHost);
  }

  function bumpChip() {
    if (prefs.reducedMotion) return;
    chip.classList.remove('rc-bump');
    void chip.offsetWidth;          // restart the animation
    chip.classList.add('rc-bump');
  }

  // The arrival sequence points at the chip: highlighted for 2 s (recette.css blinks it, unless reduced motion).
  function pulseChip() {
    clearTimeout(hintTimer);
    chip.classList.add('rc-hint');
    hintTimer = setTimeout(() => chip.classList.remove('rc-hint'), HINT_MS);
  }

  // ── State → DOM ────────────────────────────────────────────────────────────
  function refresh() {
    const n = done.size;
    const all = n === TOTAL;
    for (const { c, li, status } of caseRows) {
      const ok = done.has(c.id);
      li.classList.toggle('is-done', ok);
      status.textContent = ok ? '✔ VALIDÉ' : 'À TESTER';
    }
    statCases.textContent = `${n}/${TOTAL}`;
    statSecrets.textContent = `${secrets.size}/${SECRET_IDS.length}`;
    statSips.textContent = String(sips);
    statNotes.textContent = `${notesRead.size}/${notes.length}`;
    verdict.classList.toggle('is-done', all);
    verdictLine.textContent = all ? 'RECETTE VALIDÉE' : `RECETTE EN COURS ${n}/${TOTAL}`;
    verdictSub.textContent = fr(REPORT_LINES[n]);
    copyBtn.hidden = !all;
    if (!all) { copyBox.hidden = true; copyNote.textContent = ''; }

    chipCount.textContent = `${n}/${TOTAL}`;
    chip.toggleAttribute('data-done', all);
    // What the count means, for the tooltip and for a screen reader (the visible label is only "RECETTE n/4 R").
    const what = `Rapport de recette${NB}: ${plural(n, 'cas de test validé', 'cas de test validés')} sur ${TOTAL}`;
    chip.setAttribute('aria-label', what);
    chip.title = isTouch() ? what : `${what}. Touche R.`;
  }

  // Plain-text summary for the clipboard (regular spaces: it is pasted anywhere).
  function summary() {
    const n = done.size;
    const figures = [`Cas de test : ${n}/${TOTAL}`, `Secrets : ${secrets.size}/${SECRET_IDS.length}`];
    if (!isTouch()) figures.push(`Cafés : ${sips}`);
    figures.push(`Notes trouvées : ${notesRead.size}/${notes.length}`);
    return [
      'RAPPORT DE RECETTE — Portfolio de Nicolas Renard',
      `Verdict : ${n === TOTAL ? 'RECETTE VALIDÉE' : `RECETTE EN COURS ${n}/${TOTAL}`}`,
      REPORT_LINES[n],
      figures.join(' · '),
      location.origin + location.pathname,
    ].join('\n');
  }

  copyBtn.addEventListener('click', async () => {
    const text = summary();
    track('rapport-copy');
    const ok = await copyText(text);
    clearTimeout(copyTimer);
    if (ok) {
      copyBox.hidden = true;
      copyNote.textContent = '';
      copyBtn.textContent = 'COPIÉ ✓';
      toast.show('Rapport copié.', { ms: 2400 });
      copyTimer = setTimeout(() => { copyBtn.textContent = 'COPIER MON RAPPORT'; }, 2400);
    } else {
      // No clipboard access: show the text, selected, ready for Ctrl/⌘ + C.
      copyBox.value = text;
      copyBox.hidden = false;
      copyBox.focus({ preventScroll: true });
      copyBox.select();
      copyNote.textContent = `Copie automatique impossible${NB}: le rapport est sélectionné, copiez-le avec Ctrl ou ⌘ + C.`;
    }
  });

  // ── Validation ─────────────────────────────────────────────────────────────
  function syncGauge() {
    gauge?.setProgress(done.size, TOTAL);
    gauge?.setGold(done.size === TOTAL);
  }

  function validate(id) {
    const c = BY_ID.get(id);
    if (!c || done.has(id)) return;
    done.add(id);
    const count = done.size;
    syncGauge();
    refresh();
    pending.push({ c, count });
    events.emit('ct:validated', { id, count });
    track('ct-validated', { id, count });
  }

  // The toasts, the flash and the gold mug wait until nothing covers the level: the visitor sees them.
  // System voice (capitals). The very first validation also says where the count is kept; the last one
  // is followed by the report's own closing line.
  function flush() {
    for (const { c, count } of pending.splice(0)) {
      const head = `${c.label}${NB}: VALIDÉ (${count}/${TOTAL})`;
      if (count === TOTAL) {
        toast.show(`${head}. RECETTE VALIDÉE.`, { kind: 'item', ms: 4200 });
        toast.show(fr(REPORT_LINES[TOTAL]), { ms: 5200 });
        document.body.classList.add('rc-gold');
        if (!prefs.reducedMotion) events.emit('fx:flash', FLASH);
      } else if (count === 1) {
        // On a touch screen there is no key: the chip, top right, is the way in.
        toast.show(`${head}. ${isTouch() ? 'LE RAPPORT, EN HAUT À DROITE, GARDE LES COMPTES.' : 'LE RAPPORT [ R ] GARDE LES COMPTES.'}`,
          { kind: 'system', ms: 5200 });
      } else {
        toast.show(head, { kind: 'system', ms: 3200 });
      }
    }
    bumpChip();
  }

  // ── Open / close ───────────────────────────────────────────────────────────
  const busy = () => isOpen || warping;

  function openReport(from) {
    if (busy() || consoleFocused || screens.focused || !started || sheetOpen()) return;
    isOpen = true;
    opener = document.activeElement;
    wasLocked = document.pointerLockElement === canvas;
    if (wasLocked) document.exitPointerLock();
    refresh();
    overlay.hidden = false;
    overlay.scrollTop = 0;
    card.focus({ preventScroll: true });
    track('rapport-open', { from });
    events.emit('modal:open', { id: 'rapport' });
  }

  function closeReport(relock = true) {
    if (!isOpen) return;
    isOpen = false;
    overlay.hidden = true;
    copyBox.hidden = true;
    copyNote.textContent = '';
    const back = opener;
    opener = null;
    if (back?.isConnected && back !== document.body) back.focus({ preventScroll: true });
    if (relock && wasLocked) lock();
    events.emit('modal:close', { id: 'rapport' });
  }

  // Keyboard while the report is open (capture phase on the document, ahead of Input and
  // ScreenManager): nothing typed in the dialog may drive the game, and ESC must not also leave a console.
  function onKey(e) {
    if (!isOpen) return;
    e.stopPropagation();
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (e.key === 'Escape' || (plain && e.key?.toLowerCase() === 'r')) {
      e.preventDefault();
      // A held key auto-repeats: only its first press may close, or the report that R just opened
      // would vanish again once the OS repeat delay elapses.
      if (!e.repeat) closeReport();
    } else if (e.key === 'Tab') {
      trapTab(e);
    }
  }

  function trapTab(e) {
    const items = [...card.querySelectorAll('a[href], button:not([disabled]), textarea:not([hidden])')];
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === card)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }

  const isUseKey = e => e.code === 'KeyE' || e.code === 'Space';
  listen(document, 'keydown', onKey, true);
  listen(document, 'focusin', e => { if (isOpen && !card.contains(e.target)) card.focus({ preventScroll: true }); });
  // Input re-arms `interact` on every auto-repeat of a held key, so a touch tap has to be told apart
  // from a key repeat: taps only count while neither E nor Space is down.
  listen(window, 'keydown', e => { if (isUseKey(e)) { if (!e.repeat && !eHeld) freshKey = true; eHeld = true; } });
  listen(window, 'keyup', e => { if (isUseKey(e)) eHeld = false; });
  listen(window, 'blur', () => { eHeld = false; });   // the keyup of a key held while the window lost focus never comes

  // ── Warp ("Y ALLER") ───────────────────────────────────────────────────────
  function warp(c) {
    closeReport(false);
    track('rapport-goto', { id: c.id });
    const go = () => {
      player.teleport(c.arrival[0], c.arrival[1], c.arrival[2] * DEG);
      // A shell sheet opened during the fade (C, M) already owns the pointer: do not lock it from under it.
      if (wasLocked && !sheetOpen()) lock();
    };
    if (prefs.reducedMotion) { go(); return; }
    warping = true;
    fade.classList.add('on');
    fadeTimer = setTimeout(() => {
      go();
      fade.classList.remove('on');
      warping = false;
    }, FADE_MS);
  }

  // ── The hub ────────────────────────────────────────────────────────────────
  // Within reach of the holo and looking toward it.
  function hubAimed(p) {
    const dx = HUB.x - p.x, dz = HUB.z - p.y;       // the player's y is world z
    const d = Math.hypot(dx, dz);
    if (d > HUB_REACH || d < HUB_MIN) return false;
    return (Math.cos(p.angle) * dx + Math.sin(p.angle) * dz) / d > HUB_FACING;
  }

  const unguard = screens.addInteractGuard(p => busy() || latched || hubAimed(p));

  // ── Counters and validation sources ────────────────────────────────────────
  cleanup.push(
    events.on('console:open', ({ id } = {}) => { const c = BY_CONSOLE.get(id); if (c) validate(c.id); }),
    events.on('contact:opened', () => validate('ct-04')),
    events.on('modal:open', ({ id } = {}) => {
      if (id === 'rapport') return;
      if (isOpen) closeReport(false);   // another sheet took over: two dialogs would fight for the focus
      if (id === 'contact') validate('ct-04');
    }),
    events.on('intro:beat', ({ hint } = {}) => { if (hint === 'rapport') pulseChip(); }),
    events.on('sip', () => { sips++; if (isOpen) refresh(); }),
    events.on('note:read', ({ id } = {}) => { if (id !== undefined) notesRead.add(id); if (isOpen) refresh(); }),
    events.on('secret:found', ({ id } = {}) => { if (SECRET_IDS.includes(id)) secrets.add(id); if (isOpen) refresh(); }),
    events.on('tour:start', () => { tourUntil = clock + TOUR_MAX; }),
    events.on('tour:end', () => { tourUntil = 0; }),
    events.on('game:start', () => {
      started = true;
      mountChip();
      // The key that started the game must not also open the report.
      input.consumeKey('r');
    }),
  );

  if (import.meta.env.DEV) {
    const dev = {
      validate(n = TOTAL) {
        const ids = typeof n === 'string' ? [n] : CASES.slice(0, n).map(c => c.id);
        for (const id of ids) validate(id);
      },
      reset() {
        done.clear();
        pending.length = 0;
        document.body.classList.remove('rc-gold');
        syncGauge();
        refresh();
      },
      state: () => ({ done: [...done], secrets: [...secrets], sips, notes: notesRead.size, pending: pending.length }),
    };
    // __game is assigned by main.js right after the features are built.
    queueMicrotask(() => { if (window.__game) window.__game.recette = dev; });
  }

  refresh();
  syncGauge();

  return {
    update({ dt, focused }) {
      clock += dt;
      if (focused !== consoleFocused) {
        consoleFocused = focused;
        chip.toggleAttribute('data-off', focused);
      }
      // The sweep and the colour change play while the hall is around the visitor.
      if (gauge && getCellType(player.x, player.y) === ATRIUM) gauge.update(dt);

      // A fresh press only: the rising edge of E / Space (auto-repeat has none) or a new touch.
      const down = input.interact && !eHeld;
      const fresh = freshKey || (down && !wasDown);
      freshKey = false;
      wasDown = down;
      if (!eHeld) latched = false;

      if (focused && isOpen) closeReport(false);   // e.g. a hash change opened a console under the report
      if (busy()) return BLOCK;
      if (!started || focused) return undefined;   // a console owns the [E] while focused

      const touring = clock < tourUntil;
      if (pending.length && !touring && !sheetOpen()) flush();

      if (input.consumeKey('r')) {
        openReport('key');
        return BLOCK;
      }

      if (touring || !hubAimed(player)) return undefined;
      if (fresh && clock >= quietUntil && !sheetOpen()) {
        input.consumeInteract();
        quietUntil = clock + DEBOUNCE;
        latched = true;
        openReport('hub');
        return busy() ? BLOCK : undefined;
      }
      return out;
    },

    dispose() {
      closeReport(false);
      unguard();
      clearTimeout(fadeTimer);
      clearTimeout(copyTimer);
      clearTimeout(mailTimer);
      clearTimeout(hintTimer);
      for (const off of cleanup) off();
      document.body.classList.remove('rc-gold');
      for (const n of [overlay, fade, chip, chipHost]) n?.remove();
    },
  };
}
