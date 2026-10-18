import { describe, expect, it } from 'vitest';
import { rateLimitKey, refuseCrossSite } from '../worker/lib/http';
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
    refuseCrossSite(new Request(`${ORIGIN}/api/contact`, { method: 'POST', headers, body }));

  it('accepts JSON with parameters, and a request the user typed or bookmarked', () => {
    expect(post({ 'Content-Type': 'application/json; charset=utf-8' }, '{}')).toBeNull();
    expect(post({ 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'none' }, '{}')).toBeNull();
  });

  it('refuses a body sent without a Content-Type', () => {
    // A byte body, unlike a string one, gets no Content-Type from the Request constructor.
    const request = new Request(`${ORIGIN}/api/contact`, { method: 'POST', body: new Uint8Array([123, 125]) });
    expect(request.headers.get('Content-Type')).toBeNull();
    expect(refuseCrossSite(request)?.status).toBe(415);
  });
});
