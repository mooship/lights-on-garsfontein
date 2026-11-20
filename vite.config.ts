import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { cloudflare } from '@cloudflare/vite-plugin';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { defineConfig, type Plugin } from 'vite';
import solid from 'vite-plugin-solid';
import { fill, fillLocalePage, fillSiteHtml, fillStaticI18n, localeVisibilityCss } from './build/html.ts';
import { DEFAULT_LOCALE, LOCALES, localePath, pageLocale } from './shared/locale.ts';
import { ADMIN_PAGE_PATH, SECURITY_TXT_PATH, SERVICE_WORKER_PATH } from './shared/paths.ts';
import { FONT_FILES } from './src/styles/fonts.ts';

/**
 * The Fontsource woff2 files are bundled into /assets/ with a hash. This preloads both on
 * index.html so font-display: optional can use them on first paint.
 */
function hashedFonts(): Plugin {
  const names = Object.values(FONT_FILES).map((file) => basename(file));
  return {
    name: 'hashed-fonts',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, { path, bundle }) {
        if (path !== '/index.html') return;
        return names.map((name) => {
          const font = Object.values(bundle ?? {}).find((file) => file.type === 'asset' && file.names.includes(name));
          if (!font) throw new Error(`hashed-fonts: ${name} was not emitted`);
          return {
            tag: 'link',
            attrs: { rel: 'preload', as: 'font', type: 'font/woff2', crossorigin: true, href: `/${font.fileName}` },
            injectTo: 'head' as const,
          };
        });
      },
    },
  };
}

/** Files generated from templates/ at the site root; `dev`: `npm run dev` serves it too. */
const GENERATED = {
  '/site.webmanifest': { mode: 'json', type: 'application/manifest+json', dev: true },
  '/llms.txt': { mode: 'text', type: 'text/plain; charset=utf-8', dev: true },
  [SECURITY_TXT_PATH]: { mode: 'text', type: 'text/plain; charset=utf-8', dev: true },
  [SERVICE_WORKER_PATH]: { mode: 'js', type: 'text/javascript; charset=utf-8', dev: true },
} as const;

const generated = (url: keyof typeof GENERATED) =>
  fill(readFileSync(resolve(import.meta.dirname, `templates${url}`), 'utf8'), GENERATED[url].mode, `templates${url}`);

/**
 * Deployment identity from site.config.ts: fills the placeholders (see `fill`) in index.html
 * and privacy.html, with JSON escaping inside JSON-LD, and builds the GENERATED files from
 * templates/ (emitted in the build, and served in dev where marked).
 */
function siteConfig(): Plugin {
  return {
    name: 'site-config',
    transformIndexHtml: {
      order: 'pre',
      handler: (html, { path }) => fillSiteHtml(html, path),
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0] ?? '';
        if (!Object.hasOwn(GENERATED, path)) return next();
        const url = path as keyof typeof GENERATED;
        if (!GENERATED[url].dev) return next();
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

/**
 * One index.html per language page (shared/locale.ts): the build root for the default locale and
 * <code>/index.html for each other, with that page's lang, head copy (src/i18n/head.ts),
 * canonical and hreflang links. Each is a copy of the one built page, so they share every asset
 * (Vite's URLs are absolute, /assets/…). The dev server fills the page for the URL it serves.
 */
function localePages(): Plugin {
  let serving = false;
  return {
    name: 'locale-pages',
    configResolved(config) {
      serving = config.command === 'serve';
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, { path, originalUrl }) {
        if (!serving) return;
        const url = new URL(originalUrl ?? path, 'http://localhost');
        return fillLocalePage(html, pageLocale(url.searchParams.get('__page') ?? url.pathname) ?? DEFAULT_LOCALE);
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
          const source = fillLocalePage(html, locale);
          if (locale === DEFAULT_LOCALE) {
            index.source = source;
            // Unknown paths get 404.html, so the admin page needs a file of its own; the boot script
            // makes it English. data-page keeps the public page's wide layout (src/styles/global.css.ts) off
            // the copy of its shell, which the admin app replaces once it loads.
            this.emitFile({
              type: 'asset',
              fileName: `${ADMIN_PAGE_PATH.slice(1)}.html`,
              source: source.replace('<html ', '<html data-page="admin" '),
            });
          } else this.emitFile({ type: 'asset', fileName: `${localePath(locale).slice(1)}index.html`, source });
        }
      },
    },
  };
}

/**
 * Fills the index.html loading shell from the dictionaries, once per locale in site.locales
 * (fillStaticI18n in build/html.ts); base.css shows the one matching <html lang>: the page's own
 * (localePages), or on /admin English (the boot script).
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

/** Vanilla Extract only needs its CSS transform in the client environment. */
function clearWorkerExternals(): Plugin {
  return {
    name: 'clear-worker-externals',
    enforce: 'pre',
    configResolved(config) {
      config.ssr.external = [];
      const worker = config.environments.ssr;
      if (worker) worker.resolve.external = [];
    },
  };
}

function clientOnly(plugin: Plugin): Plugin {
  const apply = plugin.applyToEnvironment;
  return {
    ...plugin,
    applyToEnvironment(environment) {
      return environment.name === 'client' ? (apply?.(environment) ?? true) : false;
    },
  };
}

function pageInWorkerDev(plugin: Plugin): Plugin {
  return {
    ...plugin,
    applyToEnvironment(environment) {
      return environment.config.command === 'serve' || environment.name === 'client';
    },
  };
}

export default defineConfig({
  plugins: [
    clearWorkerExternals(),
    cloudflare({ experimental: { headersAndRedirectsDevModeSupport: true } }),
    solid(),
    ...vanillaExtractPlugin().map(clientOnly),
    clientOnly(localeVisibility()),
    pageInWorkerDev(siteConfig()),
    pageInWorkerDev(staticI18n()),
    clientOnly(hashedFonts()),
    pageInWorkerDev(localePages()),
  ],
  build: {
    target: 'es2022',
    outDir: 'dist',
    modulePreload: { polyfill: false },
  },
  environments: {
    client: {
      build: {
        rolldownOptions: {
          // privacy.html is served at /privacy (Workers assets html_handling) and 404.html for every
          // unknown path. The other language pages and admin.html are copies of index.html (localePages).
          input: {
            index: resolve(import.meta.dirname, 'index.html'),
            privacy: resolve(import.meta.dirname, 'privacy.html'),
            notFound: resolve(import.meta.dirname, '404.html'),
          },
        },
      },
    },
  },
});
