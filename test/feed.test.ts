import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { FEED_PATH } from '../shared/paths';
import { call, insertOutage } from './helpers';

/**
 * A small well-formedness check (workerd has no DOMParser): one root, every tag closed in order,
 * attributes quoted, and every `&` the start of an entity.
 */
function assertWellFormed(xml: string): void {
  const body = xml.replace(/^<\?xml[^?]*\?>\s*/, '');
  expect(body).not.toMatch(/&(?!(amp|lt|gt|quot|apos|#\d+);)/);
  const stack: string[] = [];
  let roots = 0;
  for (const [tag, close, name = '', attrs = '', selfClose] of body.matchAll(/<(\/?)([\w:]+)([^>]*?)(\/?)>/g)) {
    expect(attrs.replace(/\s+[\w:]+="[^"<]*"/g, '').trim(), tag).toBe('');
    if (close) expect(stack.pop(), tag).toBe(name);
    else if (!selfClose) {
      if (stack.length === 0) roots += 1;
      stack.push(name);
    }
  }
  expect(stack).toEqual([]);
  expect(roots).toBe(1);
  // Nothing outside the tags but text: no stray `<` or `>`.
  let text = body;
  for (let previous = ''; previous !== text; ) {
    previous = text;
    text = text.replace(/<[^>]*>/g, '');
  }
  expect(text).not.toMatch(/[<>]/);
}

const entries = (xml: string) => [...xml.matchAll(/<entry>[\s\S]*?<\/entry>/g)].map(([e]) => e);
const field = (entry: string | undefined, name: string) => entry?.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1];

describe('GET /feed.xml', () => {
  it('lists outages newest first as well-formed Atom, in the configured zone', async () => {
    const ended = await insertOutage({ startTime: '2026-10-17T12:05:00.000Z', endTime: '2026-10-17T14:15:00.000Z' });
    const open = await insertOutage({ startTime: '2026-10-18T06:30:00.000Z' });
    const res = await call(FEED_PATH);
    expect(res.status).toBe(200);
    const xml = await res.text();
    assertWellFormed(xml);
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(xml).toContain('<title>Lights On, Garsfontein?</title>');
    expect(xml).toContain('<link rel="alternate" type="text/html" href="https://garsfontein.example/"/>');
    const [first, second] = entries(xml);
    expect(field(first, 'title')).toBe('Outage in progress since 18 Oct 2026 08:30');
    expect(field(first, 'id')).toBe(`https://garsfontein.example/#outage-${open}`);
    expect(field(first, 'updated')).toBe('2026-10-18T06:30:00.000Z');
    expect(field(second, 'title')).toBe('Outage 17 Oct 2026 14:05 (2 h 10 min)');
    expect(field(second, 'id')).toBe(`https://garsfontein.example/#outage-${ended}`);
    expect(field(second, 'updated')).toBe('2026-10-17T14:15:00.000Z');
    // The feed's own <updated> is the latest change, the open outage's start here.
    expect(xml.split('<entry>')[0]).toContain('<updated>2026-10-18T06:30:00.000Z</updated>');
  });

  it('marks planned outages', async () => {
    await insertOutage({ startTime: '2026-10-17T12:05:00.000Z', endTime: '2026-10-17T15:05:00.000Z', isPlanned: 1 });
    expect(field(entries(await (await call(FEED_PATH)).text())[0], 'title')).toBe(
      'Planned outage 17 Oct 2026 14:05 (3 h)',
    );
  });

  it('excludes false positives and keeps the latest 20', async () => {
    await insertOutage({
      startTime: '2026-10-19T00:00:00.000Z',
      endTime: '2026-10-19T00:45:00.000Z',
      isFalsePositive: 1,
    });
    for (let day = 1; day <= 21; day++) {
      const start = `2026-11-${String(day).padStart(2, '0')}T08:00:00.000Z`;
      await insertOutage({ startTime: start, endTime: start.replace('T08', 'T09') });
    }
    const xml = await (await call(FEED_PATH)).text();
    const list = entries(xml);
    expect(list).toHaveLength(20);
    expect(field(list[0], 'title')).toBe('Outage 21 Nov 2026 10:00 (1 h)');
    expect(field(list[19], 'title')).toBe('Outage 2 Nov 2026 10:00 (1 h)');
    expect(xml).not.toContain('19 Oct 2026');
  });

  it('escapes XML', async () => {
    await insertOutage({ startTime: '2026-10-17T12:05:00.000Z', endTime: '2026-10-17T12:50:00.000Z' });
    const odd = { ...env, SITE_URL: 'https://garsfontein.example/a&b"<c>' } as Env;
    const xml = await (await call(FEED_PATH, { env: odd })).text();
    assertWellFormed(xml);
    expect(xml).toContain('href="https://garsfontein.example/a&amp;b&quot;&lt;c&gt;/"');
    expect(xml).toContain('<id>https://garsfontein.example/a&amp;b&quot;&lt;c&gt;/feed.xml</id>');
    expect(field(entries(xml)[0], 'title')).toBe('Outage 17 Oct 2026 14:05 (45 min)');
  });

  it('is a valid empty feed before any outage', async () => {
    const xml = await (await call(FEED_PATH)).text();
    assertWellFormed(xml);
    expect(entries(xml)).toEqual([]);
  });

  it('is Atom, open to any site and cached for five minutes', async () => {
    const res = await call(FEED_PATH);
    expect(res.headers.get('Content-Type')).toBe('application/atom+xml; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('answers HEAD like GET', async () => {
    const res = await call(FEED_PATH, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/atom+xml; charset=utf-8');
  });
});
