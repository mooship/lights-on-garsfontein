import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { type AdminOutagesResponse, MINUTE_MS } from '../shared/api';
import {
  call,
  createSession,
  getStatus,
  insertConfirmation,
  insertOutage,
  openOutageCount,
  setHeartbeat,
} from './helpers';

let cookie: string;
beforeEach(async () => {
  cookie = await createSession();
});

const post = (path: string, body: unknown) => call(path, { method: 'POST', body, cookie });
const currentStatus = async () => (await getStatus()).status;

describe('POST /api/admin/timer (punch clock)', () => {
  it('punch out opens a manual outage and punch in closes it', async () => {
    await setHeartbeat(5);
    const out = await post('/api/admin/timer', { action: 'punch_out' });
    expect(out.status).toBe(201);
    expect(await currentStatus()).toBe('OFF');

    const back = await post('/api/admin/timer', { action: 'punch_in' });
    expect(back.status).toBe(200);
    const { outage } = (await back.json()) as { outage: { endTime: string; source: string } };
    expect(outage.source).toBe('manual');
    expect(outage.endTime).toBeTruthy();
    expect(await currentStatus()).toBe('ON');
  });

  it('refuses to punch out twice or punch in with nothing open', async () => {
    expect((await post('/api/admin/timer', { action: 'punch_in' })).status).toBe(409);
    await post('/api/admin/timer', { action: 'punch_out' });
    expect((await post('/api/admin/timer', { action: 'punch_out' })).status).toBe(409);
  });

  it('validates the action', async () => {
    const res = await post('/api/admin/timer', { action: 'lunch' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'bad_request', details: expect.any(Array) });
  });

  it('opens only one outage when punch out is pressed twice at once', async () => {
    const codes = await Promise.all(
      [1, 2, 3].map(async () => (await post('/api/admin/timer', { action: 'punch_out' })).status),
    );
    expect(codes.sort()).toEqual([201, 409, 409]);
    expect(await openOutageCount()).toBe(1);
  });

  it('answers no_open_outage to the loser of two concurrent punch ins', async () => {
    await post('/api/admin/timer', { action: 'punch_out' });
    const results = await Promise.all([1, 2].map(() => post('/api/admin/timer', { action: 'punch_in' })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409);
    expect(await loser?.json()).toEqual({ error: 'no_open_outage' });
  });
});

describe('admin request checks', () => {
  it('reports malformed JSON by its own error code', async () => {
    const res = await call('/api/admin/timer', { method: 'POST', rawBody: '{nope', cookie });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_json' });
  });

  it('refuses cookie writes the browser marks as cross-site or same-site', async () => {
    for (const site of ['cross-site', 'same-site']) {
      const res = await call('/api/admin/timer', {
        method: 'POST',
        body: { action: 'punch_out' },
        cookie,
        headers: { 'Sec-Fetch-Site': site },
      });
      expect(res.status).toBe(403);
    }
    const same = await call('/api/admin/timer', {
      method: 'POST',
      body: { action: 'punch_out' },
      cookie,
      headers: { 'Sec-Fetch-Site': 'same-origin' },
    });
    expect(same.status).toBe(201);
  });

  it('refuses cookie writes whose body is not JSON (HTML forms)', async () => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded']) {
      const res = await call('/api/admin/timer', {
        method: 'POST',
        rawBody: JSON.stringify({ action: 'punch_out' }),
        cookie,
        headers: { 'Content-Type': type },
      });
      expect(res.status).toBe(415);
    }
    expect(await openOutageCount()).toBe(0);
  });

  it('exempts API-token requests from the browser checks', async () => {
    const res = await call('/api/admin/timer', {
      method: 'POST',
      rawBody: JSON.stringify({ action: 'punch_out' }),
      headers: {
        Authorization: 'Bearer test-admin-api-token',
        'Sec-Fetch-Site': 'cross-site',
        'Content-Type': 'text/plain',
      },
    });
    expect(res.status).toBe(201);
  });
});

describe('/api/admin/outages', () => {
  it('logs a manual outage', async () => {
    const res = await post('/api/admin/outages', {
      action: 'create',
      startTime: '2026-10-01T16:00:00+02:00',
      endTime: '2026-10-01T18:30:00+02:00',
    });
    expect(res.status).toBe(201);
    const list = (await (await call('/api/admin/outages', { cookie })).json()) as AdminOutagesResponse;
    expect(list.outages[0]).toMatchObject({
      startTime: '2026-10-01T14:00:00.000Z',
      endTime: '2026-10-01T16:30:00.000Z',
      source: 'manual',
      isFalsePositive: false,
      confirmations: 0,
    });
  });

  it('rejects an end time before the start time', async () => {
    const res = await post('/api/admin/outages', {
      action: 'create',
      startTime: '2026-10-01T18:00:00Z',
      endTime: '2026-10-01T16:00:00Z',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'end_before_start' });
  });

  it('rejects times more than five minutes in the future', async () => {
    const inMinutes = (n: number) => new Date(Date.now() + n * MINUTE_MS).toISOString();
    const future = await post('/api/admin/outages', { action: 'create', startTime: inMinutes(10) });
    expect(future.status).toBe(400);
    expect(await openOutageCount()).toBe(0);

    const skewed = await post('/api/admin/outages', {
      action: 'create',
      startTime: inMinutes(1),
      endTime: inMinutes(2),
    });
    expect(skewed.status).toBe(201);
    const { outage } = (await skewed.json()) as { outage: { id: number } };
    const update = await post('/api/admin/outages', { action: 'update', id: outage.id, endTime: inMinutes(60) });
    expect(update.status).toBe(400);
  });

  it('flagging an open outage as a false positive closes it', async () => {
    await setHeartbeat(5);
    const id = await insertOutage({});
    expect(await currentStatus()).toBe('OFF');
    const res = await post('/api/admin/outages', { action: 'update', id, isFalsePositive: true });
    expect(res.status).toBe(200);
    expect(await currentStatus()).toBe('ON');
  });

  it('updates the end time', async () => {
    const id = await insertOutage({ startTime: '2026-10-01T10:00:00.000Z' });
    await post('/api/admin/outages', { action: 'update', id, endTime: '2026-10-01T12:00:00Z' });
    const row = await env.DB.prepare('SELECT end_time FROM outages WHERE id = ?')
      .bind(id)
      .first<{ end_time: string }>();
    expect(row?.end_time).toBe('2026-10-01T12:00:00.000Z');
  });

  it('deletes an outage and its confirmations', async () => {
    const id = await insertOutage({});
    await insertConfirmation(id);
    expect((await post('/api/admin/outages', { action: 'delete', id })).status).toBe(200);
    const { n } = (await env.DB.prepare('SELECT COUNT(*) AS n FROM outage_confirmations').first<{ n: number }>()) ?? {};
    expect(n).toBe(0);
  });

  it('marks outages as planned and shows it publicly', async () => {
    const created = await post('/api/admin/outages', {
      action: 'create',
      startTime: '2026-10-10T08:00:00+02:00',
      endTime: '2026-10-10T12:00:00+02:00',
      isPlanned: true,
    });
    const { outage } = (await created.json()) as { outage: { id: number } };
    const status = await getStatus();
    expect(status.recent[0]).toMatchObject({ id: outage.id, planned: true });

    await post('/api/admin/outages', { action: 'update', id: outage.id, isPlanned: false });
    const list = (await (await call('/api/admin/outages', { cookie })).json()) as AdminOutagesResponse;
    expect(list.outages[0]).toMatchObject({ id: outage.id, planned: false });
  });

  it('returns 404 for unknown outages', async () => {
    expect((await post('/api/admin/outages', { action: 'delete', id: 999 })).status).toBe(404);
  });
});
