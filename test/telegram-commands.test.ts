import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../shared/api';
import { formatDurationIn } from '../shared/format';
import { admin } from '../src/admin/copy';
import { DICTIONARIES } from '../src/i18n/index';
import { createDb } from '../worker/db/client';
import { MAX_PAUSE_MS } from '../worker/lib/grid';
import { formatAt } from '../worker/lib/telegram';
import { parsePause, runCommand } from '../worker/lib/telegram-commands';
import { insertOutage, setHeartbeat } from './helpers';

const { status, units } = DICTIONARIES.en;
const { telegram, sensor } = admin;

const run = (text: string, now = new Date()) => runCommand(text, createDb(env.DB), now);
const pausedUntil = async () =>
  (await env.DB.prepare('SELECT paused_until FROM heartbeats WHERE id = 1').first<{ paused_until: string | null }>())
    ?.paused_until ?? null;
const setPause = (until: string) =>
  env.DB.prepare('UPDATE heartbeats SET paused_until = ? WHERE id = 1').bind(until).run();

describe('parsePause', () => {
  it('reads minutes, hours and days, up to MAX_PAUSE_MS', () => {
    expect(parsePause('30m')).toBe(30 * MINUTE_MS);
    expect(parsePause('3h')).toBe(3 * HOUR_MS);
    expect(parsePause('2d')).toBe(2 * DAY_MS);
    expect(parsePause('30d')).toBe(MAX_PAUSE_MS);
  });

  it('refuses anything else', () => {
    for (const arg of ['', '3H', '3 h', '0h', '31d', '1.5h', 'h', '-3h', '3w']) expect(parsePause(arg)).toBeNull();
  });
});

describe('/status', () => {
  it('says the power is on and the sensor is reporting', async () => {
    const now = new Date();
    const lastSeen = await setHeartbeat(30);

    const { text, statusChanged } = await run('/status', now);

    expect(text).toBe([status.ON, sensor.reporting(formatAt(lastSeen, now))].join('\n'));
    expect(statusChanged).toBe(false);
  });

  it('says the power is off, since when the sensor fell silent, and who recorded the outage', async () => {
    const now = new Date();
    const lastSeen = await setHeartbeat(20 * 60);
    await insertOutage({ startTime: lastSeen });

    const { text } = await run('/status', now);

    const silentFor = formatDurationIn(now.getTime() - Date.parse(lastSeen), units, { seconds: false });
    expect(text).toBe(
      [
        status.OFF,
        sensor.silent(silentFor, formatAt(lastSeen, now)),
        telegram.outage(formatAt(lastSeen, now), admin.source.sensor),
      ].join('\n'),
    );
  });

  it('claims no more than "no outage reported" before any heartbeat', async () => {
    expect((await run('/status')).text).toBe([status.NONE, sensor.never].join('\n'));
  });

  it('claims no more than "no outage reported" while paused', async () => {
    const now = new Date();
    await setHeartbeat(30);
    const until = new Date(now.getTime() + HOUR_MS).toISOString();
    await setPause(until);

    expect((await run('/status', now)).text).toBe([status.NONE, sensor.paused(formatAt(until, now))].join('\n'));
  });

  it("ignores the bot's name after the command, as Telegram's menu sends it", async () => {
    await setHeartbeat(30);
    const now = new Date();

    expect((await run('/status@lightson_garsfontein_bot', now)).text).toBe((await run('/status', now)).text);
  });
});

describe('/pause', () => {
  it('pauses for the duration and says until when', async () => {
    const now = new Date();
    await setHeartbeat(30);
    const until = new Date(now.getTime() + 3 * HOUR_MS).toISOString();

    const reply = await run('/pause 3h', now);

    expect(reply).toEqual({ text: telegram.paused(formatAt(until, now)), statusChanged: true });
    expect(await pausedUntil()).toBe(until);
  });

  it('answers with the usage and changes nothing for a missing, malformed or too long duration', async () => {
    await setHeartbeat(30);
    for (const text of ['/pause', '/pause 31d', '/pause 3H', '/pause 3 h']) {
      expect(await run(text)).toEqual({ text: telegram.usage(MAX_PAUSE_MS / DAY_MS), statusChanged: false });
    }
    expect(await pausedUntil()).toBeNull();
  });

  it('says no sensor has reported yet before the first heartbeat', async () => {
    expect(await run('/pause 3h')).toEqual({ text: sensor.never, statusChanged: false });
  });
});

describe('/resume', () => {
  it('ends a running pause', async () => {
    const now = new Date();
    await setHeartbeat(30);
    await setPause(new Date(now.getTime() + HOUR_MS).toISOString());

    expect(await run('/resume', now)).toEqual({ text: telegram.resumed, statusChanged: true });
    expect(await pausedUntil()).toBe(now.toISOString());
  });

  it('says when nothing is paused', async () => {
    await setHeartbeat(30);

    expect(await run('/resume')).toEqual({ text: telegram.notPaused, statusChanged: false });
  });
});

describe('anything else', () => {
  it('lists the commands', async () => {
    for (const text of ['/start', '/help', 'hello']) {
      expect(await run(text)).toEqual({ text: telegram.help, statusChanged: false });
    }
    for (const command of ['/status', '/pause', '/resume']) expect(telegram.help).toContain(command);
  });
});
