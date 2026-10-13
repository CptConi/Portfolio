// Markup for the dossier page: the text-first, WebGL-free version of the portfolio.
//
// Pure functions only (no DOM, no Node APIs): the same code pre-renders the page at
// build time and in `vite` dev (see plugin.js) and runs in a plain node script.
// Every figure on the page is computed from the data modules, never typed in.
import { techOf } from '../data/tech.js';

export const PERSON = Object.freeze({
  name: 'Nicolas Renard',
  role: 'Lead Developer Full Stack',
  org: 'Digital Factory de Guaraní',
  city: 'Bordeaux',
});

const NBSP = '\u00a0'; // no-break space

// ── Text helpers ────────────────────────────────────────────────────────────

const esc = s => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

// French typography for prose: curly apostrophes, no-break space before high
// punctuation and inside "3 000", en dash instead of " - ". Never applied to URLs.
export const typo = s => String(s)
  .replace(/'/g, '’')
  .replace(/ ([?!:;»])/g, `${NBSP}$1`)
  .replace(/« /g, `«${NBSP}`)
  .replace(/(\d) (?=\d{3}\b)/g, `$1${NBSP}`)
  .replace(/ - /g, ' – ');

const txt = s => esc(typo(s));

const word = (n, one, many) => (n < 2 ? one : many);
const plural = (n, one, many) => `${n}${NBSP}${word(n, one, many)}`;

// The data module shouts its labels in capitals (they are 3D signage); on a
// reading page they become sentence case, with a few exceptions.
const LABELS = {
  'CLOUD / DEVOPS': 'Cloud / DevOps',
  'DÉVELOPPEMENT JEUX VIDÉO': 'Développement de jeux vidéo',
};
export const label = s => LABELS[s] ?? s.charAt(0) + s.slice(1).toLowerCase();

export const slug = s => s
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

const displayUrl = u => u
  .replace(/^mailto:/, '')
  .replace(/^https?:\/\/(www\.)?/, '')
  .replace(/\/$/, '');

const isExternal = u => /^https?:/.test(u);

// "Voir sur Google Play", "Voir sur l'App Store"… falls back to the hostname.
const STORES = [
  [/(^|\.)play\.google\.com$/, 'sur Google Play'],
  [/(^|\.)apps\.apple\.com$/, "sur l'App Store"],
  [/(^|\.)itch\.io$/, 'sur itch.io'],
];
export function linkText(url) {
  let host;
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return 'Voir le lien'; }
  const store = STORES.find(([re]) => re.test(host));
  return `Voir ${store ? store[1] : host}`;
}

// Colours come from the data modules; anything that is not a hex colour is dropped
// rather than injected into a style attribute.
const safeColor = c => (/^#[0-9a-f]{3,8}$/i.test(c) ? c : null);

const techDot = name => `#${techOf(name).c.toString(16).padStart(6, '0')}`;

// ── Copy that is not in the data modules ────────────────────────────────────
// The data modules speak in the first person (they are Nicolas's voice in the 3D
// level); this page speaks about him, so these few blurbs are rewritten in the
// third person. They fall back to the data text if an entry is added later.

const PASSION_COPY = {
  'GAMING': "Il est tombé dedans petit. Pour lui, le jeu vidéo est un art au même titre que le cinéma ou la musique, et le level design comme le game design le fascinent tout particulièrement. D'où ce portfolio en forme de niveau de FPS.",
  'GUITARE': 'Pratiquée depuis près de 20 ans, avec un penchant affirmé pour le rock et le metal.',
  'CUISINE': 'Une passion découverte il y a peu. Chaleur et réconfort garantis, surtout quand on mange le résultat.',
  'DÉVELOPPEMENT JEUX VIDÉO': "À l'origine de sa passion pour le code : tout a commencé en C# avec MonoGame.",
  'CHATS': 'Compagnons de vie essentiels, experts en debugging par le regard.',
};

const CONTACT_COPY = {
  Email: 'Le plus direct : une question, une idée, un bonjour.',
  LinkedIn: 'Parcours, expériences détaillées et recommandations.',
  GitHub: 'Code source, projets et expérimentations.',
};

// ── Figures (all derived from the data) ─────────────────────────────────────

export function computeStats({ projects, skills, featured }) {
  const years = projects.map(p => +String(p.start).slice(0, 4));
  return {
    missions: projects.length,
    ongoing: projects.filter(p => p.end === null).length,
    featured: featured.length,
    technologies: new Set(skills.flatMap(s => s.items)).size,
    categories: skills.length,
    since: Math.min(...years),
  };
}

// ── Building blocks ─────────────────────────────────────────────────────────

const SECTIONS = {
  about: ['a-propos', 'À propos'],
  featured: ['missions-phares', 'Missions phares'],
  all: ['toutes-les-missions', 'Toutes les missions'],
  skills: ['competences', 'Compétences'],
  passions: ['passions', 'Passions'],
  contact: ['contact', 'Contact'],
};

function section(key, lead, body) {
  const [id, title] = SECTIONS[key];
  return `
    <section class="section" id="${id}" aria-labelledby="${id}-titre">
      <h2 id="${id}-titre">${esc(title)}</h2>${lead ? `
      <p class="lede">${txt(lead)}</p>` : ''}${body}
    </section>`;
}

// Outbound links carry the Umami attributes (the script is only injected in
// production builds, so these are inert in dev). `print` appends the address in the
// printed version, where a bare "LinkedIn" would be useless on paper.
function link({ href, text, name, from, cls = '', print = true }) {
  const external = isExternal(href);
  const attrs = [
    cls && `class="${cls}"`,
    `href="${esc(href)}"`,
    external && 'target="_blank" rel="noopener noreferrer"',
    'data-umami-event="dossier-link"',
    `data-umami-event-label="${esc(name)}"`,
    `data-umami-event-from="${from}"`,
    print && `data-print="${esc(displayUrl(href))}"`,
  ].filter(Boolean).join(' ');
  const mark = external
    ? '<span class="sr"> (s\u2019ouvre dans un nouvel onglet)</span><span aria-hidden="true" class="ext"> ↗</span>'
    : '';
  return `<a ${attrs}>${text}${mark}</a>`;
}

function copyButton(address, cls = 'btn') {
  return `<button type="button" class="${cls}" data-js hidden data-copy="${esc(address)}" data-umami-event="dossier-copy-email"><span data-copy-label>Copier</span><span class="sr"> l\u2019adresse e-mail</span></button>`;
}

function chips(items, aria) {
  const lis = items.map(name => `<li style="--dot:${techDot(name)}">${esc(name)}</li>`).join('');
  return `<ul class="chips"${aria ? ` aria-label="${esc(aria)}"` : ''}>${lis}</ul>`;
}

function periodHtml(project, periodLabel) {
  const ongoing = project.end === null;
  return `<span class="period${ongoing ? ' is-ongoing' : ''}">${txt(periodLabel(project))}</span>`;
}

// ── Sections ────────────────────────────────────────────────────────────────

function renderHeader({ contact }) {
  const links = contact.map(c => {
    const name = slug(c.name);
    const isMail = c.url.startsWith('mailto:');
    const anchor = link({
      href: c.url,
      text: esc(c.name),
      name,
      from: 'header',
      cls: `btn${isMail ? ' btn-primary' : ''}`,
    });
    return isMail
      ? `<li class="pair">${anchor}${copyButton(c.value)}</li>`
      : `<li>${anchor}</li>`;
  }).join('');

  const toc = Object.values(SECTIONS)
    .map(([id, title]) => `<li><a href="#${id}">${esc(title)}</a></li>`)
    .join('');

  return `
  <header class="masthead">
    <div class="topbar">
      <a class="btn btn-ghost" href="/" data-umami-event="dossier-to-level"><span aria-hidden="true">← </span>Retour au niveau</a>
      <button type="button" class="btn" data-js hidden data-action="print" aria-describedby="print-hint" data-umami-event="dossier-print">Imprimer / enregistrer en PDF</button>
    </div>
    <p class="kicker">Dossier — version texte</p>
    <h1>${esc(PERSON.name)}</h1>
    <p class="role">${esc(PERSON.role)}</p>
    <p class="org">${txt(PERSON.org)} <span aria-hidden="true">·</span> ${esc(PERSON.city)}</p>
    <p class="lede">${txt(`Le portfolio sans le niveau : pas de WebGL, rien à traverser, tout se lit tout de suite. Pour celles et ceux qui préfèrent lire plutôt que jouer, ou dont l'appareil préfère s'abstenir.`)}</p>
    <p class="hint" id="print-hint" data-js hidden>${txt(`Pas de CV en PDF à télécharger : « Imprimer / enregistrer en PDF » met cette page en forme A4, le navigateur s'occupe du reste.`)}</p>
    <ul class="links" aria-label="Contact et profils">${links}</ul>
    <nav class="toc" aria-label="Sections du dossier"><ul>${toc}</ul></nav>
  </header>`;
}

function renderAbout(stats) {
  const figures = [
    [stats.missions, word(stats.missions, 'mission listée', 'missions listées')],
    [stats.ongoing, word(stats.ongoing, 'mission en cours', 'missions en cours')],
    [stats.technologies, word(stats.technologies, 'technologie listée', 'technologies listées')],
    [stats.since, 'première mission listée'],
  ].map(([value, term]) => `<div class="stat"><dt>${esc(term)}</dt><dd>${value}</dd></div>`).join('');

  return section('about', null, `
      <p>${txt(`${PERSON.name} est ${PERSON.role} à la ${PERSON.org}, à ${PERSON.city}. La Digital Factory est un centre de service build et run : elle met à disposition de ses clients des squads de 1 à 4 personnes pour concevoir et développer leurs applications. Nicolas y mène des squads : conception, architecture, code, mise en production.`)}</p>
      <p>${txt(`Le terrain de jeu est surtout le web, front comme back, avec du mobile (Flutter, Ionic) et un peu de VR (Heartside). Hors des heures de bureau, il joue aux jeux vidéo et il en fabrique aussi, ce qui explique que ce site ait un niveau de FPS pour page d'accueil.`)}</p>
      <h3 class="sr">Quelques chiffres</h3>
      <dl class="stats">${figures}</dl>
      <p class="note">${txt(`Calculés à partir des données de cette page, pas arrondis à l'avantage de Nicolas.`)}</p>`);
}

function renderFeatured(featured, stats, periodLabel) {
  const cards = featured.map(p => {
    const id = `mission-${slug(p.name)}`;
    const url = p.url
      ? `\n        <p class="mission-link">${link({ href: p.url, text: txt(linkText(p.url)), name: slug(p.name), from: 'mission' })}</p>`
      : '';
    return `
      <article class="mission" id="${id}">
        <h3>${esc(p.name)}</h3>
        <p class="mission-meta">${periodHtml(p, periodLabel)}<span class="client">${txt(p.client)}</span></p>
        <p class="mission-role">${txt(p.role)}</p>
        <p class="mission-tagline">${txt(p.tagline)}</p>
        <p>${txt(p.description)}</p>
        ${chips(p.stack ?? [], 'Stack technique')}${url}
      </article>`;
  }).join('');

  const lead = `${plural(stats.featured, 'mission', 'missions')} sur ${stats.missions} ${word(stats.featured, 'a', 'ont')} un trophée dans la galerie du niveau 3D. Les autres sont plus bas, sans piédestal.`;
  return section('featured', lead, `
      <div class="missions">${cards}
      </div>`);
}

function renderLog(projects, stats, periodLabel) {
  const rows = projects.map(p => {
    const url = p.url
      ? ` ${link({ href: p.url, text: txt(linkText(p.url)), name: slug(p.name), from: 'liste' })}`
      : '';
    const detail = [p.role, (p.stack ?? []).join(', ')].filter(Boolean).map(t => `${txt(t)}.`).join(' ');
    return `
        <li class="log-row">
          <p class="log-period">${periodHtml(p, periodLabel)}</p>
          <div>
            <p class="log-title"><strong>${esc(p.name)}</strong> <span class="client">${txt(p.client)}</span></p>
            <p class="log-detail">${detail}${url}</p>
          </div>
        </li>`;
  }).join('');

  const lead = `Les ${stats.missions}, celles en cours d'abord, puis de la plus récente à la plus ancienne.`;
  return section('all', lead, `
      <ol class="log">${rows}
      </ol>`);
}

function renderSkills(skills, stats) {
  const groups = skills.map(s => `
        <div class="skill"${safeColor(s.color) ? ` style="--c:${s.color}"` : ''}>
          <h3>${esc(label(s.category))}</h3>
          ${chips(s.items)}
        </div>`).join('');

  const lead = `${plural(stats.technologies, 'technologie', 'technologies')} en ${plural(stats.categories, 'famille', 'familles')}. Les pastilles de couleur sont décoratives, pas des niveaux de maîtrise.`;
  return section('skills', lead, `
      <div class="skills">${groups}
      </div>`);
}

function renderPassions(passions) {
  const cards = passions.map(p => `
        <article class="passion">
          <h3><span class="emoji" aria-hidden="true">${esc(p.icon)}</span> ${esc(label(p.name))}</h3>
          <p>${txt(PASSION_COPY[p.name] ?? p.description)}</p>
          <ul class="chips plain">${p.details.map(d => `<li>${txt(d)}</li>`).join('')}</ul>
        </article>`).join('');

  return section('passions', `Ce que Nicolas fait quand aucune squad n'attend de livrable.`, `
      <div class="passions">${cards}
      </div>`);
}

function renderContact(contact) {
  const cards = contact.map(c => {
    const name = slug(c.name);
    const isMail = c.url.startsWith('mailto:');
    return `
        <li class="contact-card">
          <h3>${esc(c.name)}</h3>
          <p class="contact-value">${link({ href: c.url, text: esc(isMail ? c.value : displayUrl(c.url)), name, from: 'contact', print: false })}</p>
          <p class="contact-blurb">${txt(CONTACT_COPY[c.name] ?? c.description)}</p>${isMail ? `
          ${copyButton(c.value)}` : ''}
        </li>`;
  }).join('');

  return section('contact', `Envie d'échanger ? Une question sur une mission, une idée, un bug repéré dans le niveau : c'est par ici.`, `
      <ul class="contact">${cards}
      </ul>`);
}

function renderFooter(stats) {
  return `
  <footer class="foot">
    <p>${txt(`Générée depuis les mêmes données que le niveau : ${plural(stats.missions, 'mission', 'missions')}, ${plural(stats.categories, 'famille', 'familles')} de compétences, sans WebGL ni cookie.`)}</p>
    <p><a class="press-start" href="/" data-umami-event="dossier-to-level-footer"><span class="arrow" aria-hidden="true">▶</span> Press start<span class="sr">${NBSP}: retourner au niveau interactif</span></a></p>
  </footer>`;
}

/**
 * The whole <body> content of dossier.html.
 * @param {{projects: object[], skills: object[], passions: object[], contact: object[],
 *          featuredProjects?: object[], periodLabel: (p: object) => string}} data
 */
export function renderDossier(data) {
  const { projects, skills, passions, contact, periodLabel } = data;
  const featured = data.featuredProjects ?? projects.filter(p => p.featured);
  const stats = computeStats({ projects, skills, featured });

  return `<a class="skip" href="#contenu">Aller au contenu</a>
${renderHeader({ contact })}
  <main class="main" id="contenu" tabindex="-1">${renderAbout(stats)}${renderFeatured(featured, stats, periodLabel)}${renderLog(projects, stats, periodLabel)}${renderSkills(skills, stats)}${renderPassions(passions)}${renderContact(contact)}
  </main>${renderFooter(stats)}
  <p class="sr" id="dossier-status" role="status"></p>`;
}

/** schema.org ProfilePage as a JSON string, safe to inline in a <script> tag. */
export function renderJsonLd({ skills, contact }) {
  const doc = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    mainEntity: {
      '@type': 'Person',
      name: PERSON.name,
      jobTitle: PERSON.role,
      worksFor: { '@type': 'Organization', name: 'Guaraní' },
      homeLocation: {
        '@type': 'Place',
        address: { '@type': 'PostalAddress', addressLocality: PERSON.city, addressCountry: 'FR' },
      },
      knowsAbout: [...new Set(skills.flatMap(s => s.items))],
      sameAs: contact.map(c => c.url).filter(isExternal),
    },
  };
  return JSON.stringify(doc).replace(/</g, '\\u003c');
}
