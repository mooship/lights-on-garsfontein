import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ERROR } from '../shared/errors';
import { CONTACT_PATH } from '../shared/paths';
import { MAX_BODY_BYTES, parseBody, rateLimitKey, refuseCrossSite } from '../worker/lib/http';
import { ORIGIN } from './helpers';

describe('rateLimitKey', () => {
  it('keeps IPv4 addresses and groups IPv6 by /64', () => {
    expect(rateLimitKey('196.25.1.9')).toBe('196.25.1.9');
    expect(rateLimitKey('2001:db8:abcd:12:1:2:3:4')).toBe('2001:db8:abcd:12::/64');
    expect(rateLimitKey('2001:DB8:ABCD:0012::9')).toBe('2001:db8:abcd:12::/64');
    expect(rateLimitKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
  });
});

describe('refuseCrossSite', () => {
  const post = (headers: Record<string, string>, body?: BodyInit) =>
    refuseCrossSite(new Request(`${ORIGIN}${CONTACT_PATH}`, { method: 'POST', headers, body }));

  it('accepts JSON with parameters, and a request the user typed or bookmarked', () => {
    expect(post({ 'Content-Type': 'application/json; charset=utf-8' }, '{}')).toBeNull();
    expect(post({ 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'none' }, '{}')).toBeNull();
  });

  it('refuses a body sent without a Content-Type', () => {
    // A byte body, unlike a string one, gets no Content-Type from the Request constructor.
    const request = new Request(`${ORIGIN}${CONTACT_PATH}`, { method: 'POST', body: new Uint8Array([123, 125]) });
    expect(request.headers.get('Content-Type')).toBeNull();
    expect(refuseCrossSite(request)?.status).toBe(415);
  });
});

describe('parseBody', () => {
  const schema = z.object({ text: z.string() });
  const parse = (body: BodyInit) =>
    parseBody(new Request(`${ORIGIN}${CONTACT_PATH}`, { method: 'POST', body }), schema);
  const atSize = (bytes: number) => JSON.stringify({ text: 'x'.repeat(bytes - '{"text":""}'.length) });
  /** Sends `text` in two chunks with no Content-Length, as a chunked upload does. */
  const chunked = (text: string) => {
    const bytes = new TextEncoder().encode(text);
    const half = Math.floor(bytes.length / 2);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, half));
        controller.enqueue(bytes.slice(half));
        controller.close();
      },
    });
  };

  it('reads a body up to MAX_BODY_BYTES, with or without a Content-Length', async () => {
    expect(await parse(atSize(MAX_BODY_BYTES))).toEqual({ data: { text: expect.any(String) } });
    expect(await parse(chunked(atSize(MAX_BODY_BYTES)))).toEqual({ data: { text: expect.any(String) } });
  });

  it('refuses a larger body with 413, with or without a Content-Length', async () => {
    for (const body of [atSize(MAX_BODY_BYTES + 1), chunked(atSize(MAX_BODY_BYTES + 1))]) {
      const parsed = await parse(body);
      if (!('response' in parsed)) throw new Error('expected a refusal');
      expect(parsed.response.status).toBe(413);
      expect(await parsed.response.json()).toEqual({ error: ERROR.payloadTooLarge });
    }
  });
});
