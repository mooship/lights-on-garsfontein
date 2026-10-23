import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { ERROR } from '../shared/errors';
import { json } from '../worker/lib/http';
import { dispatch, type Route } from '../worker/lib/router';
import { ORIGIN } from './helpers';

/** Dispatches, then waits for the work it left running, as the runtime would before the next request. */
async function run(route: Route, request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await dispatch(route, request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe('edge cache', () => {
  it('stores only successful responses', async () => {
    const get = (handler: Route['handler']) =>
      run({ handler, edgeCache: 60 }, new Request(`${ORIGIN}/edge-cache-test`));
    expect((await get(() => json({ error: 'unavailable' }, 503))).status).toBe(503);
    expect(await (await get(() => json({ n: 1 }))).json()).toEqual({ n: 1 });
    expect(await (await get(() => json({ n: 2 }))).json()).toEqual({ n: 1 });
  });

  it('answers a miss without waiting for the copy to be stored', async () => {
    const stored: Promise<unknown>[] = [];
    const ctx = createExecutionContext();
    const waitUntil = vi.spyOn(ctx, 'waitUntil').mockImplementation((promise) => void stored.push(promise));
    const request = new Request(`${ORIGIN}/edge-cache-wait-test`);

    await dispatch({ handler: () => json({ n: 1 }), edgeCache: 60 }, request, env, ctx);

    expect(waitUntil).toHaveBeenCalledOnce();
    await Promise.all(stored);
    expect(await caches.default.match(request)).toBeDefined();
  });
});

describe('cross-site guard', () => {
  const send = (method: string, headers: Record<string, string> = {}, route: Partial<Route> = {}) =>
    run(
      { handler: () => json({ ok: true }), ...route },
      new Request(`${ORIGIN}/guard-test`, { method, headers: { Origin: 'https://evil.example', ...headers } }),
    );

  it('refuses every cross-site write by default', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await send(method);
      expect(res.status, method).toBe(403);
      expect(await res.json()).toEqual({ error: ERROR.forbidden });
    }
  });

  it('lets reads through, and bearer requests to a route that checks the token', async () => {
    for (const method of ['GET', 'HEAD']) expect((await send(method)).status, method).toBe(200);
    const bearer = { Authorization: 'Bearer anything' };
    expect((await send('POST', bearer, { authorize: async () => null })).status).toBe(200);
    // A route that never checks a bearer token is not exempted by sending one.
    expect((await send('POST', bearer)).status).toBe(403);
  });
});
