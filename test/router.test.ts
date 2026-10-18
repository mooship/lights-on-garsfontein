import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { ERROR } from '../shared/errors';
import { json } from '../worker/lib/http';
import { dispatch, type Route } from '../worker/lib/router';
import { ORIGIN } from './helpers';

describe('edge cache', () => {
  it('stores only successful responses', async () => {
    const get = (handler: Route['handler']) =>
      dispatch({ handler, edgeCache: 60 }, new Request(`${ORIGIN}/edge-cache-test`), env);
    expect((await get(() => json({ error: 'unavailable' }, 503))).status).toBe(503);
    expect(await (await get(() => json({ n: 1 }))).json()).toEqual({ n: 1 });
    expect(await (await get(() => json({ n: 2 }))).json()).toEqual({ n: 1 });
  });
});

describe('cross-site guard', () => {
  const send = (method: string, headers: Record<string, string> = {}) =>
    dispatch(
      { handler: () => json({ ok: true }) },
      new Request(`${ORIGIN}/guard-test`, { method, headers: { Origin: 'https://evil.example', ...headers } }),
      env,
    );

  it('refuses every cross-site write by default', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await send(method);
      expect(res.status, method).toBe(403);
      expect(await res.json()).toEqual({ error: ERROR.forbidden });
    }
  });

  it('lets reads and bearer-token requests through', async () => {
    for (const method of ['GET', 'HEAD']) expect((await send(method)).status, method).toBe(200);
    expect((await send('POST', { Authorization: 'Bearer anything' })).status).toBe(200);
  });
});
