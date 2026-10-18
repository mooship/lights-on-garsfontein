import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { build, defineConfig, type Plugin } from 'vite';
import solid from 'vite-plugin-solid';
import { escapeHtml, fill, fillStaticI18n, jsonString, localeVisibilityCss } from './build/html.ts';
import { DEFAULT_LOCALE, LOCALES, localePath, pageLocale } from './shared/locale.ts';
import { API_PREFIX, WORKER_PAGES } from './shared/paths.ts';
import { type Locale, site } from './site.config.ts';
import { HEAD } from './src/i18n/head.ts';
import { FONT_FILES } from './src/styles/fonts.ts';

const WORKER = 'http://localhost:8787';

/**
 * The Fontsource woff2 files are bundled into /assets/ with a hash. This preloads the body
 * font on index.html so font-display: optional can use it on first paint.
 */
function hashedFonts(): Plugin {
  const name = basename(FONT_FILES.body);
  return {
    name: 'hashed-fonts',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, { path, bundle }) {
        if (path !== '/index.html') return;
        const font = Object.values(bundle ?? {}).find((file) => file.type === 'asset' && file.names.includes(name));
        if (!font) throw new Error(`hashed-fonts: ${name} was not emitted`);
        return [
          {
            tag: 'link',
            attrs: { rel: 'preload', as: 'font', type: 'font/woff2', crossorigin: true, href: `/${font.fileName}` },
            injectTo: 'head',
          },
        ];
      },
    },
  };
}

/** Files generated from templates/ at the site root. */
const GENERATED = {
  '/site.webmanifest': { mode: 'json', type: 'application/manifest+json' },
  '/llms.txt': { mode: 'text', type: 'text/plain; charset=utf-8' },
} as const;

const generated = (url: keyof typeof GENERATED) =>
  fill(readFileSync(resolve(import.meta.dirname, `templates${url}`), 'utf8'), GENERATED[url].mode, `templates${url}`);

/**
 * Deployment identity from site.config.ts: fills the placeholders (see `fill`) in index.html
 * and privacy.html, with JSON escaping inside JSON-LD, and builds /site.webmanifest and
 * /llms.txt from templates/ (emitted in the build, served in dev).
 */
function siteConfig(): Plugin {
  const jsonLd = /(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/g;
  return {
    name: 'site-config',
    transformIndexHtml: {
      order: 'pre',
      handler(html, { path }) {
        const parts = html.split(jsonLd);
        // split() with three groups: [html, open, json, close, html, ...]
        return parts.map((part, i) => fill(part, i % 4 === 2 ? 'json' : 'html', path)).join('');
      },
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0];
        if (url !== '/site.webmanifest' && url !== '/llms.txt') return next();
        res.setHeader('Content-Type', GENERATED[url].type);
        res.end(generated(url));
      });
    },
    generateBundle() {
      for (const url of Object.keys(GENERATED) as (keyof typeof GENERATED)[]) {
        this.emitFile({ type: 'asset', fileName: url.slice(1), source: generated(url) });
      }
    },
  };
}

const ogLocale = (locale: Locale) => site.intlLocales[locale].replace('-', '_');

/** index.html with its %page.<key>% placeholders filled for `locale`'s page. */
function localePage(html: string, locale: Locale): string {
  const head = (key: keyof (typeof HEAD)[Locale]) => fill(HEAD[locale][key], 'text', 'src/i18n/head.ts');
  const url = (l: Locale) => escapeHtml(`${site.url}${localePath(l)}`);
  const alternate = (hreflang: string, l: Locale) => `<link rel="alternate" hreflang="${hreflang}" href="${url(l)}" />`;
  const values: Record<string, string> = {
    lang: locale,
    url: url(locale),
    title: escapeHtml(head('title')),
    description: escapeHtml(head('description')),
    ogDescription: escapeHtml(head('ogDescription')),
    imageAlt: escapeHtml(head('imageAlt')),
    serviceDescription: jsonString(head('serviceDescription')),
    alternates: [...LOCALES.map((l) => alternate(l, l)), alternate('x-default', DEFAULT_LOCALE)].join('\n    '),
    ogLocales: [locale, ...LOCALES.filter((l) => l !== locale)]
      .map((l, i) => `<meta property="og:locale${i ? ':alternate' : ''}" content="${ogLocale(l)}" />`)
      .join('\n    '),
  };
  return html.replace(/%page\.(\w+)%/g, (match, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`locale-pages: unknown placeholder ${match} in index.html`);
    return value;
  });
}

/**
 * One index.html per language page (shared/locale.ts): dist/index.html for the default locale and
 * dist/<code>/index.html for each other, with that page's lang, head copy (src/i18n/head.ts),
 * canonical and hreflang links. Each is a copy of the one built page, so they share every asset
 * (Vite's URLs are absolute, /assets/…). The dev server fills the page for the URL it serves.
 */
function localePages(): Plugin {
  return {
    name: 'locale-pages',
    transformIndexHtml: {
      order: 'pre',
      handler(html, { path, originalUrl, server }) {
        if (server && path === '/index.html')
          return localePage(html, pageLocale(originalUrl?.split('?')[0] ?? '/') ?? DEFAULT_LOCALE);
      },
    },
    generateBundle: {
      // After Vite has put the finished HTML in the bundle.
      order: 'post',
      handler(_options, bundle) {
        const index = bundle['index.html'];
        if (index?.type !== 'asset') throw new Error('locale-pages: index.html is not in the bundle');
        const html = String(index.source);
        for (const locale of LOCALES) {
          const source = localePage(html, locale);
          if (locale === DEFAULT_LOCALE) index.source = source;
          else this.emitFile({ type: 'asset', fileName: `${localePath(locale).slice(1)}index.html`, source });
        }
      },
    },
  };
}

const SW_SOURCE = resolve(import.meta.dirname, 'src/sw');

/**
 * Builds src/sw/sw.ts into dist/sw.js once the site is written, with the pages and assets to
 * precache and a build id hashed from them and from src/sw/. A change to either changes the
 * worker's bytes (which is what makes browsers install it) and its cache name. A separate build,
 * because a service worker must be one classic script; inside the app's build it would share chunks.
 */
function serviceWorker(): Plugin {
  let outDir = '';
  const url = (fileName: string) => `/${fileName.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '')}`;
  return {
    name: 'service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    async writeBundle(_options, bundle) {
      const files = Object.values(bundle)
        .filter(({ fileName }) => fileName.endsWith('.html') || fileName.startsWith('assets/'))
        .sort((a, b) => a.fileName.localeCompare(b.fileName));
      const hash = createHash('sha256');
      for (const file of files)
        hash.update(`${file.fileName}\0`).update(file.type === 'chunk' ? file.code : file.source);
      for (const name of readdirSync(SW_SOURCE).sort()) {
        hash.update(`src/sw/${name}\0`).update(readFileSync(resolve(SW_SOURCE, name)));
      }
      const pages = files.filter(({ fileName }) => fileName.endsWith('.html')).map(({ fileName }) => url(fileName));
      // Every asset, lazy chunks included, so this build's pages never need the network for one.
      const assets = files
        .filter(({ fileName }) => fileName.startsWith('assets/'))
        .map(({ fileName }) => url(fileName));
      await build({
        configFile: false,
        logLevel: 'warn',
        publicDir: false,
        define: {
          __BUILD_ID__: JSON.stringify(hash.digest('hex').slice(0, 16)),
          __PAGES__: JSON.stringify(pages),
          __ASSETS__: JSON.stringify(assets),
        },
        build: {
          outDir,
          emptyOutDir: false,
          target: 'es2022',
          lib: {
            entry: resolve(SW_SOURCE, 'sw.ts'),
            formats: ['iife'],
            name: 'sw',
            fileName: () => 'sw.js',
          },
        },
      });
    },
  };
}

/**
 * Fills the index.html loading shell from the dictionaries, once per locale in site.locales
 * (fillStaticI18n in build/html.ts); base.css shows the one matching <html lang>: the page's own
 * (localePages), or on /admin the stored one (the boot script).
 */
function staticI18n(): Plugin {
  return { name: 'static-i18n', transformIndexHtml: { order: 'pre', handler: fillStaticI18n } };
}

/**
 * Replaces the marker in src/styles/base.css with the rules that show only the shell copy for
 * <html lang> (localeVisibilityCss in build/html.ts). A stylesheet, not an inline style: the CSP
 * has style-src 'self'.
 */
function localeVisibility(): Plugin {
  const MARKER = '/* @locale-visibility */';
  const rules = localeVisibilityCss();
  return {
    name: 'locale-visibility',
    enforce: 'pre',
    transform(code, id) {
      if (!id.split('?')[0]?.endsWith('/src/styles/base.css')) return;
      if (!code.includes(MARKER)) throw new Error(`locale-visibility: ${MARKER} is missing from base.css`);
      return { code: code.replace(MARKER, rules), map: null };
    },
  };
}

export default defineConfig({
  plugins: [
    solid(),
    vanillaExtractPlugin(),
    localeVisibility(),
    siteConfig(),
    staticI18n(),
    hashedFonts(),
    localePages(),
    serviceWorker(),
  ],
  build: {
    target: 'es2022',
    outDir: 'dist',
    modulePreload: { polyfill: false },
    rolldownOptions: {
      // privacy.html is served at /privacy (Workers assets html_handling). The other language
      // pages are copies of index.html (localePages).
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        privacy: resolve(import.meta.dirname, 'privacy.html'),
      },
    },
  },
  server: {
    // `npm run dev` serves the UI; run `npm run dev:worker` alongside for the API.
    proxy: Object.fromEntries([API_PREFIX, ...WORKER_PAGES].map((path) => [path, WORKER])),
  },
});
