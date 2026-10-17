import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { defineConfig, type HtmlTagDescriptor, type Plugin } from 'vite';
import solid from 'vite-plugin-solid';
import { type Locale, site } from './site.config.ts';
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
      const json = Array.isArray(value) ? JSON.stringify(value) : JSON.stringify(value).slice(1, -1);
      return json.replace(/</g, '\\u003c');
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
 * and privacy.html, with JSON escaping inside JSON-LD, adds the og:locale tags, and builds
 * /site.webmanifest and /llms.txt from templates/ (emitted in the build, served in dev).
 */
function siteConfig(): Plugin {
  const ogLocale = (locale: Locale) => site.intlLocales[locale].replace('-', '_');
  const jsonLd = /(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/g;
  return {
    name: 'site-config',
    transformIndexHtml: {
      order: 'pre',
      handler(html, { path }) {
        const parts = html.split(jsonLd);
        // split() with three groups: [html, open, json, close, html, ...]
        const out = parts.map((part, i) => fill(part, i % 4 === 2 ? 'json' : 'html', path)).join('');
        if (path !== '/index.html') return out;
        const tags: HtmlTagDescriptor[] = LOCALES.map((locale, i) => ({
          tag: 'meta',
          attrs: { property: i === 0 ? 'og:locale' : 'og:locale:alternate', content: ogLocale(locale) },
          injectTo: 'head',
        }));
        return { html: out, tags };
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

function message(dict: object, key: string): string {
  const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], dict);
  if (typeof value !== 'string') throw new Error(`static-i18n: ${key} is not a string in the dictionaries`);
  return escapeHtml(value);
}

/**
 * Fills the index.html loading shell from the dictionaries, once per locale in site.locales;
 * base.css shows the one matching <html lang>, which the boot script sets. On an empty element:
 * - data-i18n="key" fills it with a <span data-l> per locale.
 * - data-i18n-label="key" (an aria-label) repeats the whole element per locale instead,
 *   with data-i18n as its text.
 * - data-i18n-switch marks the language switch (src/components/LanguageToggle.tsx): each copy
 *   shows the next locale's code (with two, the other one), with lang set to that locale. With
 *   one locale there is no switch.
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
          const isSwitch = /\sdata-i18n-switch\b/.test(attrs);
          if (isSwitch && LOCALES.length === 1) return '';
          const rest = attrs.replace(/\sdata-i18n(?:-label)?="[^"]*"|\sdata-i18n-switch\b/g, '');
          const copies = LOCALES.map((locale, i) => {
            const dict = DICTIONARIES[locale];
            const next = LOCALES[(i + 1) % LOCALES.length] ?? locale;
            return {
              locale,
              lang: isSwitch ? next : locale,
              text: isSwitch ? next.toUpperCase() : text ? message(dict, text) : '',
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
  plugins: [solid(), vanillaExtractPlugin(), localeVisibility(), siteConfig(), staticI18n(), hashedFonts()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    modulePreload: { polyfill: false },
    rolldownOptions: {
      // privacy.html is served at /privacy (Workers assets html_handling).
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
    },
  },
});
