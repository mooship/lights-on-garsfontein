import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { ERROR } from '../shared/errors';
import { CSV_PATH, OUTAGES_PATH, PUSH_KEY_PATH, PUSH_SUBSCRIPTION_PATH, STATUS_PATH } from '../shared/paths';
import { vapidPublicKey } from '../worker/lib/webpush';
import { call, insertOutage, ORIGIN, stubLimiter } from './helpers';

describe('alert times', () => {
  it('keeps alert times out of the public views', async () => {
    const id = await insertOutage({});
    await env.DB.prepare('UPDATE outages SET off_alert_at = ? WHERE id = ?').bind(new Date().toISOString(), id).run();

    const status = await (await call(STATUS_PATH)).text();
    const outages = await (await call(OUTAGES_PATH)).text();
    const csvHeader = (await (await call(CSV_PATH)).text()).split('\n')[0];

    expect(status).not.toMatch(/alert/i);
    expect(outages).not.toMatch(/alert/i);
    expect(csvHeader).not.toMatch(/alert/i);
  });
});

const FCM = 'https://fcm.googleapis.com/fcm/send/abc';
const keys = {
  p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
};

const subscribe = (
  body: unknown = { endpoint: FCM, keys, locale: 'af' },
  options: { env?: Env; headers?: Record<string, string> } = {},
) => call(PUSH_SUBSCRIPTION_PATH, { method: 'POST', body, ...options });
const unsubscribe = (endpoint: string) => call(PUSH_SUBSCRIPTION_PATH, { method: 'DELETE', body: { endpoint } });
const rows = async () =>
  (await env.DB.prepare('SELECT endpoint, p256dh, auth, locale FROM push_subscriptions').all()).results;

describe('push subscriptions', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM push_subscriptions').run();
  });

  it('saves a subscription', async () => {
    const res = await subscribe();
    expect(res.status).toBe(204);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await rows()).toEqual([{ endpoint: FCM, ...keys, locale: 'af' }]);
  });

  it('updates rather than duplicates on re-subscribe', async () => {
    await subscribe();
    expect((await subscribe({ endpoint: FCM, keys, locale: 'en' })).status).toBe(204);
    expect(await rows()).toEqual([{ endpoint: FCM, ...keys, locale: 'en' }]);
  });

  it('refuses endpoints off the push host list', async () => {
    for (const endpoint of [
      'http://fcm.googleapis.com/x',
      'https://example.com/x',
      'https://fcm.googleapis.com.evil.com/x',
      'https://push.apple.com.evil/x',
    ]) {
      expect((await subscribe({ endpoint, keys, locale: 'en' })).status, endpoint).toBe(400);
    }
    expect(await rows()).toEqual([]);
    for (const endpoint of ['https://web.push.apple.com/x', 'https://wns2-par02p.notify.windows.com/x']) {
      expect((await subscribe({ endpoint, keys, locale: 'en' })).status, endpoint).toBe(204);
    }
  });

  it('refuses a bad body', async () => {
    const bodies = [
      { endpoint: FCM, keys: { p256dh: keys.p256dh }, locale: 'en' },
      { endpoint: FCM, keys, locale: 'fr' },
      { endpoint: `${FCM}${'a'.repeat(2048)}`, keys, locale: 'en' },
    ];
    for (const body of bodies) expect((await subscribe(body)).status).toBe(400);
    expect(await rows()).toEqual([]);
  });

  it('deletes a subscription, known or not', async () => {
    await subscribe();
    expect((await unsubscribe(FCM)).status).toBe(204);
    expect(await rows()).toEqual([]);
    expect((await unsubscribe('https://fcm.googleapis.com/fcm/send/unknown')).status).toBe(204);
  });

  it('is rate limited', async () => {
    const res = await subscribe(undefined, { env: { ...env, PUSH_LIMITER: stubLimiter() } });
    expect(res.status).toBe(429);
    expect(await rows()).toEqual([]);
  });

  it('refuses cross-site requests and sends no CORS header', async () => {
    const cross = await subscribe(undefined, { headers: { Origin: 'https://evil.example' } });
    expect(cross.status).toBe(403);
    expect(await cross.json()).toEqual({ error: ERROR.forbidden });
    expect((await subscribe(undefined, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
    expect(await rows()).toEqual([]);
    const same = await subscribe(undefined, { headers: { Origin: ORIGIN } });
    expect(same.status).toBe(204);
    expect(same.headers.has('Access-Control-Allow-Origin')).toBe(false);
  });
});

describe('push key', () => {
  const testJwk: JsonWebKey = JSON.parse(env.VAPID_PRIVATE_KEY);

  it('serves the public key, cached for a day', async () => {
    const res = await call(PUSH_KEY_PATH);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ publicKey: vapidPublicKey(testJwk) });
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
  });

  it('answers 404 not_configured when the secret is unset or unusable', async () => {
    for (const secret of [undefined, '', 'not json', '{}', JSON.stringify({ ...testJwk, y: undefined })]) {
      const res = await call(PUSH_KEY_PATH, { env: { ...env, VAPID_PRIVATE_KEY: secret } as Env });
      expect(res.status, String(secret)).toBe(404);
      expect(await res.json()).toEqual({ error: ERROR.notConfigured });
    }
  });
});
