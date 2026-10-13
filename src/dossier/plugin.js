// Vite plugin: pre-renders the dossier content into dossier.html so the page is
// readable (and indexable) without running any JavaScript.
//
// The data modules are plain ESM and are bundled into the Vite config, so in dev
// the server restarts when one of them changes: no stale content, no extra watcher.
import { projects, featuredProjects, periodLabel } from '../data/projects.js';
import { skills } from '../data/skills.js';
import { passions } from '../data/passions.js';
import { contact } from '../data/contact.js';
import { renderDossier, renderJsonLd } from './render.js';

const PLACEHOLDERS = {
  content: '<!--dossier:content-->',
  jsonld: '<!--dossier:jsonld-->',
};

export function dossierPrerender() {
  return {
    name: 'dossier-prerender',
    transformIndexHtml: {
      // Before Vite parses the HTML, so the injected markup goes through the same pipeline.
      order: 'pre',
      handler(html, ctx) {
        if (!ctx.path.endsWith('/dossier.html')) return html;
        for (const marker of Object.values(PLACEHOLDERS)) {
          if (!html.includes(marker)) throw new Error(`[dossier-prerender] ${marker} is missing from dossier.html`);
        }
        const data = { projects, featuredProjects, skills, passions, contact, periodLabel };
        return html
          .replace(PLACEHOLDERS.content, () => renderDossier(data))
          .replace(PLACEHOLDERS.jsonld, () => `<script type="application/ld+json">${renderJsonLd(data)}</script>`);
      },
    },
  };
}
