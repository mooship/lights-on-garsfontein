import { basename, resolve } from 'node:path';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { defineConfig, type Plugin } from 'vite';
import solid from 'vite-plugin-solid';
import { af } from './src/i18n/af.ts';
import { en } from './src/i18n/en.ts';
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

const LOCALES = { af, en };

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function message(dict: object, key: string): string {
  const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], dict);
  if (typeof value !== 'string') throw new Error(`static-i18n: ${key} is not a string in the dictionaries`);
  return escapeHtml(value);
}

/**
 * Fills the index.html loading shell from the dictionaries, in both languages; base.css shows
 * the one matching <html lang>, which the boot script sets. On an empty element:
 * - data-i18n="key" fills it with a <span data-l> per language.
 * - data-i18n-label="key" (an aria-label) repeats the whole element per language instead,
 *   with data-i18n as its text.
 * - data-i18n-switch marks the language switch (src/components/LanguageToggle.tsx): each copy
 *   shows the other language's code, with lang set to that language.
 */
function staticI18n(): Plugin {
  const marked = /<([a-z][\w-]*)(\s[^>]*?\bdata-i18n[^>]*)>\s*<\/\1>/g;
  const attr = (attrs: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(attrs)?.[1];
  const locales = Object.keys(LOCALES);
  return {
    name: 'static-i18n',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const out = html.replace(marked, (_element, tag: string, attrs: string) => {
          const text = attr(attrs, 'data-i18n');
          const label = attr(attrs, 'data-i18n-label');
          const isSwitch = /\sdata-i18n-switch\b/.test(attrs);
          const rest = attrs.replace(/\sdata-i18n(?:-label)?="[^"]*"|\sdata-i18n-switch\b/g, '');
          const copies = Object.entries(LOCALES).map(([locale, dict]) => {
            const other = locales.find((l) => l !== locale) ?? locale;
            return {
              locale,
              lang: isSwitch ? other : locale,
              text: isSwitch ? other.toUpperCase() : text ? message(dict, text) : '',
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

export default defineConfig({
  plugins: [solid(), vanillaExtractPlugin(), staticI18n(), hashedFonts()],
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
