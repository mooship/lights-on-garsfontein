import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { localePath } from '../../shared/locale';
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
const HTML = [...LOCALE_PAGES.map((p) => p.file), 'privacy.html', '404.html', 'admin.html'];

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

  it('serves a /sw.js that clears old caches, shows pushes and never answers requests', () => {
    const sw = read('sw.js');
    expect(sw).toContain('caches.delete');
    expect(sw).toContain('showNotification');
    expect(sw).not.toContain('unregister');
    // No fetch handler: every request goes to the network, so a stale status is never served as live.
    expect(sw).not.toMatch(/addEventListener\(\s*['"]fetch/);
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

  // sw.js only receives pushes (above); the app never registers a service worker.
  it('never registers a service worker', () => {
    const scripts = readdirSync(resolve(DIST, 'assets')).filter((name) => name.endsWith('.js'));
    expect(scripts.length).toBeGreaterThan(0);
    for (const name of scripts) expect(read(`assets/${name}`), name).not.toContain('serviceWorker');
  });
});
