import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { type AdminOutagesResponse, HOUR_MS, MINUTE_MS, OUTAGE_ACTION, TIMER_ACTION } from '../shared/api';
import { ERROR } from '../shared/errors';
import { ADMIN_OUTAGES_PATH, TIMER_PATH } from '../shared/paths';
import { call, createSession, getStatus, insertOutage, openOutageCount, setHeartbeat, setPausedUntil } from './helpers';

let cookie: string;
beforeEach(async () => {
  cookie = await createSession();
});

const post = (path: string, body: unknown) => call(path, { method: 'POST', body, cookie });
const currentStatus = async () => (await getStatus()).status;

describe('POST /api/admin/timer (punch clock)', () => {
  it('punch out opens a manual outage and punch in closes it', async () => {
    await setHeartbeat(5);
    const out = await post(TIMER_PATH, { action: TIMER_ACTION.punchOut });
    expect(out.status).toBe(201);
    expect(await currentStatus()).toBe('OFF');

    const back = await post(TIMER_PATH, { action: TIMER_ACTION.punchIn });
    expect(back.status).toBe(200);
    const { outage } = (await back.json()) as { outage: { endTime: string; source: string } };
    expect(outage.source).toBe('manual');
    expect(outage.endTime).toBeTruthy();
    expect(await currentStatus()).toBe('ON');
  });

  it('refuses to punch out twice or punch in with nothing open', async () => {
    expect((await post(TIMER_PATH, { action: TIMER_ACTION.punchIn })).status).toBe(409);
    await post(TIMER_PATH, { action: TIMER_ACTION.punchOut });
    expect((await post(TIMER_PATH, { action: TIMER_ACTION.punchOut })).status).toBe(409);
  });

  it('validates the action', async () => {
    const res = await post(TIMER_PATH, { action: 'lunch' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: ERROR.badRequest, details: expect.any(Array) });
  });

  it('opens only one outage when punch out is pressed twice at once', async () => {
    const codes = await Promise.all(
      [1, 2, 3].map(async () => (await post(TIMER_PATH, { action: TIMER_ACTION.punchOut })).status),
    );
    expect(codes.sort()).toEqual([201, 409, 409]);
    expect(await openOutageCount()).toBe(1);
  });

  it('answers no_open_outage to the loser of two concurrent punch ins', async () => {
    await post(TIMER_PATH, { action: TIMER_ACTION.punchOut });
    const results = await Promise.all([1, 2].map(() => post(TIMER_PATH, { action: TIMER_ACTION.punchIn })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409);
    expect(await loser?.json()).toEqual({ error: ERROR.noOpenOutage });
  });
});

describe('admin request checks', () => {
  it('reports malformed JSON by its own error code', async () => {
    const res = await call(TIMER_PATH, { method: 'POST', rawBody: '{nope', cookie });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: ERROR.invalidJson });
  });

  it('refuses cookie writes from another origin, or the browser marks as cross-site or same-site', async () => {
    const refused: Record<string, string>[] = [
      { Origin: 'https://evil.example' },
      { 'Sec-Fetch-Site': 'cross-site' },
      { 'Sec-Fetch-Site': 'same-site' },
    ];
    for (const headers of refused) {
      const res = await call(TIMER_PATH, { method: 'POST', body: { action: TIMER_ACTION.punchOut }, cookie, headers });
      expect(res.status, JSON.stringify(headers)).toBe(403);
    }
    const same = await call(TIMER_PATH, {
      method: 'POST',
      body: { action: TIMER_ACTION.punchOut },
      cookie,
      headers: { 'Sec-Fetch-Site': 'same-origin' },
    });
    expect(same.status).toBe(201);
  });

  it('refuses cookie writes whose body is not JSON (HTML forms)', async () => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded']) {
      const res = await call(TIMER_PATH, {
        method: 'POST',
        rawBody: JSON.stringify({ action: TIMER_ACTION.punchOut }),
        cookie,
        headers: { 'Content-Type': type },
      });
      expect(res.status).toBe(415);
    }
    expect(await openOutageCount()).toBe(0);
  });

  it('exempts API-token requests from the browser checks', async () => {
    const res = await call(TIMER_PATH, {
      method: 'POST',
      rawBody: JSON.stringify({ action: TIMER_ACTION.punchOut }),
      headers: {
        Authorization: `Bearer ${env.ADMIN_API_TOKEN}`,
        'Sec-Fetch-Site': 'cross-site',
        'Content-Type': 'text/plain',
      },
    });
    expect(res.status).toBe(201);
  });
});

describe(ADMIN_OUTAGES_PATH, () => {
  // Only one outage is open at a time: punch in and a heartbeat close "the" open outage, and a second
  // would keep the status OFF after the power came back.
  it('refuses to log an outage with no end while another is open', async () => {
    await insertOutage({ startTime: '2026-10-10T10:00:00Z' });
    const res = await post(ADMIN_OUTAGES_PATH, { action: OUTAGE_ACTION.create, startTime: '2026-10-12T10:00:00Z' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: ERROR.outageAlreadyOpen });
    expect(await openOutageCount()).toBe(1);
  });

  it('refuses to reopen an outage while another is open, but lets the open one be edited', async () => {
    const closed = await insertOutage({ startTime: '2026-10-01T10:00:00Z', endTime: '2026-10-01T11:00:00Z' });
    const open = await insertOutage({ startTime: '2026-10-12T10:00:00Z' });
    const reopen = await post(ADMIN_OUTAGES_PATH, { action: OUTAGE_ACTION.update, id: closed, endTime: null });
    expect(reopen.status).toBe(409);
    expect(await reopen.json()).toEqual({ error: ERROR.outageAlreadyOpen });
    const planned = await post(ADMIN_OUTAGES_PATH, { action: OUTAGE_ACTION.update, id: open, isPlanned: true });
    expect(planned.status).toBe(200);
    expect(await openOutageCount()).toBe(1);
  });

  it('closes an open outage marked a false positive, even when asked to leave its end empty', async () => {
    const id = await insertOutage({ startTime: '2026-10-12T10:00:00Z' });
    const res = await post(ADMIN_OUTAGES_PATH, {
      action: OUTAGE_ACTION.update,
      id,
      isFalsePositive: true,
      endTime: null,
    });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare('SELECT end_time FROM outages WHERE id = ?')
      .bind(id)
      .first<{ end_time: string | null }>();
    expect(row?.end_time).not.toBeNull();
  });

  it('refuses fields it does not know, rather than reporting an edit it ignored', async () => {
    const id = await insertOutage({ startTime: '2026-10-01T10:00:00Z', endTime: '2026-10-01T11:00:00Z' });
    for (const body of [
      { action: OUTAGE_ACTION.update, id, startTime: '2026-09-01T00:00:00Z' },
      {
        action: OUTAGE_ACTION.create,
        startTime: '2026-10-02T10:00:00Z',
        endTime: '2026-10-02T11:00:00Z',
        source: 'sensor',
      },
    ]) {
      const res = await post(ADMIN_OUTAGES_PATH, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await post(TIMER_PATH, { action: TIMER_ACTION.punchOut, at: 'now' })).status).toBe(400);
  });

  it('logs a manual outage', async () => {
    const res = await post(ADMIN_OUTAGES_PATH, {
      action: OUTAGE_ACTION.create,
      startTime: '2026-10-01T16:00:00+02:00',
      endTime: '2026-10-01T18:30:00+02:00',
    });
    expect(res.status).toBe(201);
    const list = (await (await call(ADMIN_OUTAGES_PATH, { cookie })).json()) as AdminOutagesResponse;
    expect(list.outages[0]).toMatchObject({
      startTime: '2026-10-01T14:00:00.000Z',
      endTime: '2026-10-01T16:30:00.000Z',
      source: 'manual',
      isFalsePositive: false,
    });
    expect(list.outages[0]).not.toHaveProperty('confirmations');
  });

  it('rejects an end time before the start time', async () => {
    const res = await post(ADMIN_OUTAGES_PATH, {
      action: OUTAGE_ACTION.create,
      startTime: '2026-10-01T18:00:00Z',
      endTime: '2026-10-01T16:00:00Z',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: ERROR.endBeforeStart });
  });

  it('refuses an edit that would end an outage before it started, and leaves it as it was', async () => {
    const id = await insertOutage({ startTime: '2026-10-01T18:00:00Z', endTime: '2026-10-01T20:00:00Z' });
    const res = await post(ADMIN_OUTAGES_PATH, { action: OUTAGE_ACTION.update, id, endTime: '2026-10-01T16:00:00Z' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: ERROR.endBeforeStart });
    const row = await env.DB.prepare('SELECT end_time FROM outages WHERE id = ?')
      .bind(id)
      .first<{ end_time: string }>();
    expect(Date.parse(row?.end_time ?? '')).toBe(Date.parse('2026-10-01T20:00:00Z'));
  });

  it('rejects times more than five minutes in the future', async () => {
    const inMinutes = (n: number) => new Date(Date.now() + n * MINUTE_MS).toISOString();
    const future = await post(ADMIN_OUTAGES_PATH, { action: OUTAGE_ACTION.create, startTime: inMinutes(10) });
    expect(future.status).toBe(400);
    expect(await openOutageCount()).toBe(0);

    const skewed = await post(ADMIN_OUTAGES_PATH, {
      action: OUTAGE_ACTION.create,
      startTime: inMinutes(1),
      endTime: inMinutes(2),
    });
    expect(skewed.status).toBe(201);
    const { outage } = (await skewed.json()) as { outage: { id: number } };
    const update = await post(ADMIN_OUTAGES_PATH, {
      action: OUTAGE_ACTION.update,
      id: outage.id,
      endTime: inMinutes(60),
    });
    expect(update.status).toBe(400);
  });

  it('flagging an open outage as a false positive closes it', async () => {
    await setHeartbeat(5);
    const id = await insertOutage({});
    expect(await currentStatus()).toBe('OFF');
    const res = await post(ADMIN_OUTAGES_PATH, { action: OUTAGE_ACTION.update, id, isFalsePositive: true });
    expect(res.status).toBe(200);
    expect(await currentStatus()).toBe('ON');
  });

  it('records that the admin dismissed an outage, lists it, and clears it when restored', async () => {
    const id = await insertOutage({ startTime: '2026-10-01T10:00:00.000Z', endTime: '2026-10-01T11:00:00.000Z' });
    const listed = async () => {
      const res = await call(ADMIN_OUTAGES_PATH, { cookie });
      const { outages } = (await res.json()) as AdminOutagesResponse;
      return outages.find((o) => o.id === id)?.dismissedBy;
    };
    expect(await listed()).toBeNull();
    await post(ADMIN_OUTAGES_PATH, { action: OUTAGE_ACTION.update, id, isFalsePositive: true });
    expect(await listed()).toBe('admin');
    await post(ADMIN_OUTAGES_PATH, { action: OUTAGE_ACTION.update, id, isFalsePositive: false });
    expect(await listed()).toBeNull();
  });

  it('reports the sensor: null before its first heartbeat, then its last heartbeat and pause', async () => {
    const sensor = async () =>
      ((await (await call(ADMIN_OUTAGES_PATH, { cookie })).json()) as AdminOutagesResponse).sensor;
    expect(await sensor()).toBeNull();
    const lastSeen = await setHeartbeat(30);
    expect(await sensor()).toEqual({ lastSeen, pausedUntil: null });
    const until = new Date(Date.now() + HOUR_MS).toISOString();
    await setPausedUntil(until);
    expect(await sensor()).toEqual({ lastSeen, pausedUntil: until });
  });

  it('updates the end time', async () => {
    const id = await insertOutage({ startTime: '2026-10-01T10:00:00.000Z' });
    await post(ADMIN_OUTAGES_PATH, { action: OUTAGE_ACTION.update, id, endTime: '2026-10-01T12:00:00Z' });
    const row = await env.DB.prepare('SELECT end_time FROM outages WHERE id = ?')
      .bind(id)
      .first<{ end_time: string }>();
    expect(row?.end_time).toBe('2026-10-01T12:00:00.000Z');
  });

  it('deletes an outage', async () => {
    const id = await insertOutage({});
    expect((await post(ADMIN_OUTAGES_PATH, { action: OUTAGE_ACTION.delete, id })).status).toBe(200);
    const { n } = (await env.DB.prepare('SELECT COUNT(*) AS n FROM outages').first<{ n: number }>()) ?? {};
    expect(n).toBe(0);
  });

  it('marks outages as planned and shows it publicly', async () => {
    const created = await post(ADMIN_OUTAGES_PATH, {
      action: OUTAGE_ACTION.create,
      startTime: '2026-10-10T08:00:00+02:00',
      endTime: '2026-10-10T12:00:00+02:00',
      isPlanned: true,
    });
    const { outage } = (await created.json()) as { outage: { id: number } };
    const status = await getStatus();
    expect(status.recent[0]).toMatchObject({ id: outage.id, planned: true });

    await post(ADMIN_OUTAGES_PATH, { action: OUTAGE_ACTION.update, id: outage.id, isPlanned: false });
    const list = (await (await call(ADMIN_OUTAGES_PATH, { cookie })).json()) as AdminOutagesResponse;
    expect(list.outages[0]).toMatchObject({ id: outage.id, planned: false });
  });

  it('returns 404 for unknown outages', async () => {
    expect((await post(ADMIN_OUTAGES_PATH, { action: OUTAGE_ACTION.delete, id: 999 })).status).toBe(404);
  });
});
