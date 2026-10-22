import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { CSV_PATH, OUTAGES_PATH, STATUS_PATH } from '../shared/paths';
import { call, insertOutage } from './helpers';

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
