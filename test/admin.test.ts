import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AdminOutagesResponse, StatusResponse } from '../shared/api';
import { call, insertOutage, login, setHeartbeat } from './helpers';

let cookie: string;
beforeEach(async () => {
  cookie = await login();
});

const post = (path: string, body: unknown) => call(path, { method: 'POST', body, cookie });
const currentStatus = async () => ((await (await call('/api/status')).json()) as StatusResponse).status;

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
    expect((await post('/api/admin/timer', { action: 'lunch' })).status).toBe(400);
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
    await env.DB.prepare('INSERT INTO outage_confirmations (outage_id, created_at, client_hash) VALUES (?, ?, ?)')
      .bind(id, new Date().toISOString(), 'abc')
      .run();
    expect((await post('/api/admin/outages', { action: 'delete', id })).status).toBe(200);
    const { n } = (await env.DB.prepare('SELECT COUNT(*) AS n FROM outage_confirmations').first<{ n: number }>()) ?? {};
    expect(n).toBe(0);
  });

  it('marks outages as planned and shows it publicly', async () => {
    const created = await post('/api/admin/outages', {
      action: 'create',
      startTime: '2026-10-18T08:00:00+02:00',
      endTime: '2026-10-18T12:00:00+02:00',
      isPlanned: true,
    });
    const { outage } = (await created.json()) as { outage: { id: number } };
    const status = (await (await call('/api/status')).json()) as StatusResponse;
    expect(status.recent[0]).toMatchObject({ id: outage.id, planned: true });

    await post('/api/admin/outages', { action: 'update', id: outage.id, isPlanned: false });
    const list = (await (await call('/api/admin/outages', { cookie })).json()) as AdminOutagesResponse;
    expect(list.outages[0]).toMatchObject({ id: outage.id, planned: false });
  });

  it('returns 404 for unknown outages', async () => {
    expect((await post('/api/admin/outages', { action: 'delete', id: 999 })).status).toBe(404);
  });
});
