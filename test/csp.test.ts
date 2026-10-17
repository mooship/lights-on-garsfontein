import { describe, expect, it } from 'vitest';
import index from '../index.html?raw';
import privacy from '../privacy.html?raw';
import headers from '../public/_headers?raw';

// Inline scripts only (no attributes); JSON-LD and module scripts are not covered by the hash.
const inlineScripts = (html: string) =>
  [...html.matchAll(/<script>([\s\S]*?)<\/script[^>]*>/gi)].map((m) => m[1] ?? '');

async function sha256(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
}

describe('Content-Security-Policy', () => {
  it('allows exactly the inline theme boot script on every page', async () => {
    for (const html of [index, privacy]) {
      const scripts = inlineScripts(html);
      expect(scripts).toHaveLength(1);
      expect(headers).toContain(await sha256(scripts[0] ?? ''));
    }
  });

  it('keeps the boot scripts static, so the source hash is the built one', () => {
    // vite.config.ts fills %site.…%, %since.…% and %page.…% placeholders; the page's language and
    // the locale list reach the script through <html lang> and <html data-locales> instead.
    for (const html of [index, privacy]) {
      for (const script of inlineScripts(html)) expect(script).not.toMatch(/%(?:site|since|page)\./);
    }
    expect(index).toMatch(/<html lang="%page\.lang%" data-locales="%site\.locales%">/);
  });

  it('only allows Turnstile and Cloudflare Web Analytics as third parties', () => {
    const csp = headers.match(/Content-Security-Policy: (.*)/)?.[1] ?? '';
    const hosts = [...csp.matchAll(/https:\/\/[^\s;]+/g)].map((m) => m[0]);
    expect(new Set(hosts)).toEqual(
      new Set([
        'https://challenges.cloudflare.com',
        'https://static.cloudflareinsights.com',
        'https://cloudflareinsights.com',
      ]),
    );
  });
});
