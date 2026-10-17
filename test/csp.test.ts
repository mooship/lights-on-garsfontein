import { describe, expect, it } from 'vitest';
import index from '../index.html?raw';
import privacy from '../privacy.html?raw';
import headers from '../public/_headers?raw';

async function inlineScriptHashes(html: string): Promise<string[]> {
  // Inline scripts only (no attributes); JSON-LD and module scripts are not covered by the hash.
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script[^>]*>/gi)].map((m) => m[1] ?? '');
  return Promise.all(
    scripts.map(async (body) => {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
      return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
    }),
  );
}

describe('Content-Security-Policy', () => {
  it('allows exactly the inline theme boot script on every page', async () => {
    for (const html of [index, privacy]) {
      const hashes = await inlineScriptHashes(html);
      expect(hashes).toHaveLength(1);
      expect(headers).toContain(hashes[0]);
    }
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
