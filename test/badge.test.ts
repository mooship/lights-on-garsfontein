import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { badgePath } from '../shared/paths';
import { type Locale, site } from '../site.config';
import { DICTIONARIES } from '../src/i18n';
import { call, heartbeat, insertOutage, requestPause, setHeartbeat, stubLimiter } from './helpers';

const badge = async (locale: Locale = 'af') => (await call(badgePath(locale))).text();

describe('GET /badge.svg', () => {
  it('serves an image other sites may embed, cached for a minute', async () => {
    const res = await call(badgePath('af'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');
    // The Worker's default, same-site, would stop other sites showing it.
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const svg = await res.text();
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain(site.brand.full);
  });

  it('reads that no outage was reported, never that the power is on, without a live reading', async () => {
    const svg = await badge();
    expect(svg).toContain(DICTIONARIES.af.status.NONE);
    expect(svg).not.toContain(DICTIONARIES.af.status.ON);
  });

  it('reads that the power is on while the sensor reports, in each language', async () => {
    await setHeartbeat(30);
    for (const locale of site.locales) expect(await badge(locale)).toContain(DICTIONARIES[locale].status.ON);
  });

  it('reads that no outage was reported while the sensor is paused', async () => {
    await setHeartbeat(30);
    expect((await requestPause(new Date(Date.now() + 60 * 60 * 1000).toISOString())).status).toBe(200);
    expect(await badge('en')).toContain(DICTIONARIES.en.status.NONE);
  });

  it('reads that the power is off during an outage, and never how it was recorded', async () => {
    await insertOutage({ source: 'manual' });
    const svg = await badge();
    expect(svg).toContain(DICTIONARIES.af.status.OFF);
    expect(svg).not.toMatch(/sensor|manual|voeler|handmatig/i);
  });

  it('shows a heartbeat straight away, not once the edge copy expires', async () => {
    expect(await badge()).toContain(DICTIONARIES.af.status.NONE);
    expect((await heartbeat()).status).toBe(200);
    expect(await badge()).toContain(DICTIONARIES.af.status.ON);
  });

  // A fixed width, so a page showing it does not shift when the status changes.
  it('keeps the same width in every state', async () => {
    // The writes below go straight to D1, which purges nothing, so each read skips the edge copy.
    const width = async () => {
      await caches.default.delete(`${env.SITE_URL}${badgePath('af')}`);
      return (await badge()).match(/^<svg [^>]*width="(\d+)"/)?.[1];
    };
    const none = await width();
    await setHeartbeat(30);
    const on = await width();
    await insertOutage({});
    const off = await width();
    expect(none).toBeDefined();
    expect([on, off]).toEqual([none, none]);
  });

  it('shares the status rate limit', async () => {
    const limiter = stubLimiter();
    expect((await call(badgePath('en'), { env: { ...env, STATUS_LIMITER: limiter } })).status).toBe(429);
    expect(limiter.limit).toHaveBeenCalledOnce();
  });
});
