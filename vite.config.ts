import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { build, defineConfig, type Plugin } from 'vite';
import solid from 'vite-plugin-solid';
import { localePath } from './shared/locale.ts';
import { type Locale, site } from './site.config.ts';
import { HEAD } from './src/i18n/head.ts';
import { DICTIONARIES } from './src/i18n/index.ts';
import { FONT_FILES } from './src/styles/fonts.ts';

const WORKER = 'http://localhost:8787';

const LOCALES: readonly Locale[] = site.locales;
const [DEFAULT_LOCALE] = site.locales;

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

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** `text` as the inside of a JSON string, with < escaped so it cannot close a <script>. */
const jsonString = (text: string) => JSON.stringify(text).slice(1, -1).replace(/</g, '\\u003c');

type Mode = 'html' | 'json' | 'text';

/** The value behind a placeholder name: `site.<path>` or `since.<locale>`. */
function placeholder(name: string): string | readonly string[] {
  const [scope, ...path] = name.split('.');
  if (scope === 'since' && path.length === 1) {
    const intl = (site.intlLocales as Record<string, string>)[path[0] ?? ''];
    if (!intl) throw new Error(`site-config: %${name}% names a locale that is not in site.intlLocales`);
    const format = { day: 'numeric', month: 'long', year: 'numeric', timeZone: site.timeZone } as const;
    return new Intl.DateTimeFormat(intl, format).format(new Date(site.trackingSince));
  }
  const value =
    scope === 'site'
      ? path.reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], site)
      : undefined;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value;
  throw new Error(`site-config: unknown placeholder %${name}%`);
}

/**
 * Fills %site.<path>% (a value from site.config.ts; a list is space-separated, or a JSON array
 * in JSON) and %since.<locale>% (site.trackingSince as a long date in that locale). Escaped for
 * where it lands; anything else that looks like one of these fails the build.
 */
function fill(text: string, mode: Mode, file: string): string {
  const out = text.replace(/%((?:site|since)\.[\w.-]+)%/g, (_match, name: string) => {
    const value = placeholder(name);
    if (mode === 'json') {
      return Array.isArray(value) ? JSON.stringify(value).replace(/</g, '\\u003c') : jsonString(value as string);
    }
    const plain = Array.isArray(value) ? value.join(' ') : (value as string);
    return mode === 'html' ? escapeHtml(plain) : plain;
  });
  const leftover = /%(?:site|since)\.[\w.-]*%?/.exec(out);
  if (leftover) throw new Error(`site-config: malformed placeholder ${leftover[0]} in ${file}`);
  if (mode === 'json') {
    try {
      JSON.parse(out);
    } catch (error) {
      throw new Error(`site-config: ${file} is not valid JSON once filled (a list goes outside quotes)`, {
        cause: error,
      });
    }
  }
  return out;
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
  const pageLocale = (url = '/') => LOCALES.find((locale) => localePath(locale) === url.split('?')[0]);
  return {
    name: 'locale-pages',
    transformIndexHtml: {
      order: 'pre',
      handler(html, { path, originalUrl, server }) {
        if (server && path === '/index.html') return localePage(html, pageLocale(originalUrl) ?? DEFAULT_LOCALE);
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

/**
 * Builds src/sw/sw.ts into dist/sw.js once the site is written, with the pages and assets to
 * precache and a build id hashed from their names and contents and from src/sw/. Any change to
 * the shell or the worker so changes the worker's bytes, which is what makes browsers install
 * the new one, and its cache name. A build of its own, because a service worker must be one
 * classic script: as part of the app's build it would share chunks with it.
 */
const SW_SOURCE = resolve(import.meta.dirname, 'src/sw');

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

/** A string from the dictionaries, or a message function's result for `args`. */
function message(dict: object, key: string, args: readonly string[] = []): string {
  const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], dict);
  const text = typeof value === 'function' ? (value as (...a: readonly string[]) => unknown)(...args) : value;
  if (typeof text !== 'string') throw new Error(`static-i18n: ${key} is not a string in the dictionaries`);
  return escapeHtml(text);
}

/** The values for data-i18n-args: space-separated `site.<path>` names, each a string. */
function messageArgs(names: string | undefined): string[] {
  return (names ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((name) => {
      const value = placeholder(name);
      if (typeof value !== 'string') throw new Error(`static-i18n: ${name} is not a string in site.config.ts`);
      return value;
    });
}

/**
 * Fills the index.html loading shell from the dictionaries, once per locale in site.locales;
 * base.css shows the one matching <html lang>: the page's own (localePages), or on /admin the stored one
 * (the boot script). On an empty element:
 * - data-i18n="key" fills it with a <span data-l> per locale.
 * - data-i18n-label="key" (an aria-label) repeats the whole element per locale instead,
 *   with data-i18n as its text.
 * - data-i18n-args="site.landmark ..." passes those site.config.ts values to a message that is a
 *   function, such as scope.measured.
 * - data-i18n-switch marks the language switch (src/components/LanguageToggle.tsx): each copy
 *   shows the next locale's name (`lang.next`; with two, the other one), with lang set to that
 *   locale. With one locale there is no switch.
 */
function staticI18n(): Plugin {
  const marked = /<([a-z][\w-]*)(\s[^>]*?\bdata-i18n[^>]*)>\s*<\/\1>/g;
  const attr = (attrs: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(attrs)?.[1];
  return {
    name: 'static-i18n',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const out = html.replace(marked, (_element, tag: string, attrs: string) => {
          const text = attr(attrs, 'data-i18n');
          const label = attr(attrs, 'data-i18n-label');
          const args = messageArgs(attr(attrs, 'data-i18n-args'));
          const isSwitch = /\sdata-i18n-switch\b/.test(attrs);
          if (isSwitch && LOCALES.length === 1) return '';
          const rest = attrs.replace(/\sdata-i18n(?:-label|-args)?="[^"]*"|\sdata-i18n-switch\b/g, '');
          const copies = LOCALES.map((locale, i) => {
            const dict = DICTIONARIES[locale];
            const next = LOCALES[(i + 1) % LOCALES.length] ?? locale;
            return {
              locale,
              lang: isSwitch ? next : locale,
              text: isSwitch ? message(dict, 'lang.next') : text ? message(dict, text, args) : '',
              label: label && message(dict, label),
            };
          });
          if (label) {
            return copies
              .map(
                (c) =>
                  `<${tag}${rest} data-l="${c.locale}" lang="${c.lang}" aria-label="${c.label}">${c.text}</${tag}>`,
              )
              .join('');
          }
          const spans = copies.map((c) => `<span data-l="${c.locale}" lang="${c.lang}">${c.text}</span>`).join('');
          return `<${tag}${rest}>${spans}</${tag}>`;
        });
        if (/\sdata-i18n[\w-]*[=\s>]/.test(out)) throw new Error('static-i18n: a data-i18n element is not empty');
        return out;
      },
    },
  };
}

/**
 * Replaces the marker in src/styles/base.css with the rules that show only the shell copy for
 * <html lang>, for every locale. The default locale shows unless lang is another configured one.
 * (A stylesheet, not an inline style: the CSP has style-src 'self'.)
 */
function localeVisibility(): Plugin {
  const MARKER = '/* @locale-visibility */';
  const others = LOCALES.slice(1);
  const selectors = [
    ...others.map((locale) => `html[lang="${locale}"] [data-l="${DEFAULT_LOCALE}"]`),
    ...others.map((locale) => `html:not([lang="${locale}"]) [data-l="${locale}"]`),
  ];
  const rules = selectors.length ? `${selectors.join(',\n')} {\n  display: none;\n}` : '';
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
    proxy: {
      '/api': WORKER,
      '/og.png': WORKER,
      '/sitemap.xml': WORKER,
      '/robots.txt': WORKER,
      '/feed.xml': WORKER,
    },
  },
});
