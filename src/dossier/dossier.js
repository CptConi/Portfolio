// Progressive enhancement for the dossier page. The copy and print buttons are
// pre-rendered hidden and only revealed here, so without JavaScript the page has no
// dead control. Nothing else on the page needs a script.
const live = document.getElementById('dossier-status');
let liveTimer;

// Screen-reader feedback (the button label also changes, but its accessible name stays put).
function announce(message) {
  if (!live) return;
  live.textContent = '';
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => {
    live.textContent = message;
    liveTimer = setTimeout(() => { live.textContent = ''; }, 4000);
  }, 50);
}

// Fallback for insecure contexts and older Safari, where navigator.clipboard is missing.
function legacyCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px;';
  document.body.append(area);
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* unsupported */ }
  area.remove();
  return ok;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return legacyCopy(text);
  }
}

const resetTimers = new WeakMap();

function flashLabel(button, text) {
  const target = button.querySelector('[data-copy-label]');
  if (!target) return;
  const initial = target.dataset.initial ?? (target.dataset.initial = target.textContent);
  target.textContent = text;
  clearTimeout(resetTimers.get(button));
  resetTimers.set(button, setTimeout(() => { target.textContent = initial; }, 2200));
}

document.querySelectorAll('[data-js]').forEach(el => { el.hidden = false; });

document.addEventListener('click', async event => {
  const copy = event.target.closest('[data-copy]');
  if (copy) {
    const ok = await copyText(copy.dataset.copy);
    flashLabel(copy, ok ? 'Copié' : 'Copie impossible');
    announce(ok
      ? 'Adresse e-mail copiée dans le presse-papiers.'
      : 'Copie impossible : sélectionnez l’adresse à la main.');
    copy.focus({ preventScroll: true });
    return;
  }
  // data-print on links only feeds the print stylesheet (a[data-print]::after), so the button uses data-action.
  if (event.target.closest('[data-action="print"]')) window.print();
});
