import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { localePath } from '../../shared/locale';
import { PRIVACY_PAGE_PATH } from '../../shared/paths';
import { site } from '../../site.config';

// Checks on the output of `npm run build`. Only in CI (which builds first) or with CHECK_DIST=1, so a
// stale local dist/ cannot fail a push.
const DIST = resolve(import.meta.dirname, '../../dist');
const read = (file: string) => readFileSync(resolve(DIST, file), 'utf8');
const exists = (file: string) => existsSync(resolve(DIST, file));

/** Removes `pattern` until nothing changes, so one removal cannot leave a new match behind. */
function stripRepeatedly(text: string, pattern: RegExp): string {
  for (let previous = ''; previous !== text; ) {
    previous = text;
    text = text.replace(pattern, '');
  }
  return text;
}

/** dist/index.html for the default locale, dist/<code>/index.html for the others. */
const LOCALE_PAGES = site.locales.map((locale) => ({ locale, file: `${localePath(locale).slice(1)}index.html` }));
const HTML = [...LOCALE_PAGES.map((p) => p.file), 'privacy.html'];

/** The URLs sw.js precaches: its install handler, run against a stand-in Cache API. */
async function precached(): Promise<string[]> {
  const listeners: Record<string, (event: unknown) => void> = {};
  let urls: string[] = [];
  const cache = {
    addAll: async (entries: (string | { url: string })[]) => {
      urls = entries.map((entry) => (typeof entry === 'string' ? entry : entry.url));
    },
    match: async () => undefined,
  };
  vm.runInNewContext(read('sw.js'), {
    self: { addEventListener: (type: string, listener: (event: unknown) => void) => (listeners[type] = listener) },
    caches: { open: async () => cache, delete: async () => true },
    Request: class {
      constructor(readonly url: string) {}
    },
  });
  let installed: Promise<unknown> = Promise.resolve();
  listeners.install?.({ waitUntil: (promise: Promise<unknown>) => (installed = promise) });
  // With nothing in the stand-in cache, the check after addAll fails; the list is all this needs.
  await installed.catch(() => {});
  return urls;
}

const fileFor = (url: string) =>
  url.endsWith('/') ? `${url.slice(1)}index.html` : url.startsWith('/assets/') ? url.slice(1) : `${url.slice(1)}.html`;

describe.runIf(process.env.CI || process.env.CHECK_DIST)('the built site', () => {
  it('allows every inline script by a hash in _headers', () => {
    // The build's copy of public/_headers, so a build older than the source cannot fail this.
    const headers = read('_headers');
    for (const file of HTML) {
      const scripts = [...read(file).matchAll(/<script>([\s\S]*?)<\/script\s*>/gi)].map((m) => m[1] ?? '');
      expect(scripts.length, file).toBeGreaterThan(0);
      for (const script of scripts) {
        const hash = createHash('sha256').update(script).digest('base64');
        expect(headers, file).toContain(`'sha256-${hash}'`);
      }
    }
  });

  it('builds each language page with its lang and every language’s shell copy', () => {
    for (const { locale, file } of LOCALE_PAGES) {
      const html = read(file);
      expect(html, file).toContain(`<html lang="${locale}"`);
      for (const other of site.locales) expect(html, `${file} ${other}`).toContain(`data-l="${other}"`);
    }
  });

  it('leaves no placeholder unfilled', () => {
    for (const file of [...HTML, 'site.webmanifest', 'llms.txt']) {
      // index.html's own comment names the placeholders.
      const text = stripRepeatedly(read(file), /<!--[\s\S]*?-->/g);
      expect(text, file).not.toMatch(/%(?:site|since|page)\./);
    }
  });

  it('preloads a font that is in the build', () => {
    for (const { file } of LOCALE_PAGES) {
      const href = /<link rel="preload" as="font"[^>]*href="\/([^"]+)"/.exec(read(file))?.[1];
      expect(href, file).toMatch(/^assets\/.+\.woff2$/);
      expect(exists(href ?? ''), href).toBe(true);
    }
  });

  it('precaches the language pages, the privacy page and every asset, all of them in the build', async () => {
    const urls = await precached();
    expect(urls).toEqual(expect.arrayContaining([...site.locales.map(localePath), PRIVACY_PAGE_PATH]));
    for (const url of urls) expect(exists(fileFor(url)), url).toBe(true);
    const assets = readdirSync(resolve(DIST, 'assets')).map((name) => `/assets/${name}`);
    expect(urls.filter((url) => url.startsWith('/assets/')).sort()).toEqual(assets.sort());
  });
});
