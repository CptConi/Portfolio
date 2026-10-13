import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { dossierPrerender } from './src/dossier/plugin.js';

// Privacy-first analytics (self-hosted Umami, no cookies). Both values are public.
// Injected at build time only, and never into Vercel preview deployments, so
// `npm run dev` and preview URLs do not pollute the stats.
const UMAMI = {
  src: 'https://stats.loot-lurker.com/script.js',
  websiteId: 'cba872c9-d06b-4bd4-bf5a-772ddf8eee04',
};

// The public domain is not decided yet: Open Graph needs an absolute URL, so it is
// derived from Vercel's system variable when present (production builds), and the
// og:url / og:image absolute form is simply skipped otherwise.
const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
const origin = host ? `https://${host}` : null;

// Runs once per HTML entry (index.html and dossier.html): og:url and canonical
// follow the page they are injected into.
const siteMeta = () => ({
  name: 'site-meta',
  apply: 'build',
  transformIndexHtml(_html, ctx) {
    // Link scrapers need absolute URLs: without a known origin, emit no preview tags at all.
    if (!origin) return [];
    const pageUrl = `${origin}${ctx.path.replace(/index\.html$/, '')}`;
    const tags = [
      { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' }, injectTo: 'head' },
      { tag: 'meta', attrs: { property: 'og:image', content: `${origin}/thumbnail-meta.jpg` }, injectTo: 'head' },
    ];
    tags.push({ tag: 'meta', attrs: { property: 'og:url', content: pageUrl }, injectTo: 'head' });
    tags.push({ tag: 'link', attrs: { rel: 'canonical', href: pageUrl }, injectTo: 'head' });
    return tags;
  },
});

const umami = () => ({
  name: 'umami-analytics',
  apply: 'build',
  transformIndexHtml: () => process.env.VERCEL_ENV === 'preview'
    ? []
    : [{
        tag: 'script',
        attrs: { defer: true, src: UMAMI.src, 'data-website-id': UMAMI.websiteId },
        injectTo: 'head',
      }],
});

export default defineConfig({
  server: { port: 3000 },
  plugins: [dossierPrerender(), siteMeta(), umami()],
  build: {
    // With two entries the preload polyfill would become a shared chunk that both pages
    // fetch; neither page has any other chunk to preload, so it is not needed.
    modulePreload: { polyfill: false },
    rollupOptions: {
      // Two pages: the 3D level, and the text-only dossier (no three.js in its bundle).
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        dossier: fileURLToPath(new URL('./dossier.html', import.meta.url)),
      },
    },
  },
});
