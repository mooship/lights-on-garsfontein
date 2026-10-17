import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
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
