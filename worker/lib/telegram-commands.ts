// The owner's Telegram commands. Only the owner's chat reaches these (worker/routes/telegram.ts),
// so the replies may say how an outage was recorded.

import { DAY_MS, HOUR_MS, MINUTE_MS } from '../../shared/api';
import { formatDurationIn } from '../../shared/format';
import { admin } from '../../src/admin/copy';
import { sensorState } from '../../src/admin/sensor';
import { DICTIONARIES } from '../../src/i18n/index';
import type { Db } from '../db/client';
import { MAX_PAUSE_MS, pauseSensor, readGridState } from './grid';
import { formatAt } from './telegram';

const { telegram, sensor: sensorCopy, source: sourceCopy } = admin;
const { status: statusCopy, units } = DICTIONARIES.en;

const UNIT_MS = { m: MINUTE_MS, h: HOUR_MS, d: DAY_MS } as const;

/** A pause length such as "30m", "3h" or "2d", in ms; null unless it is above 0 and at most MAX_PAUSE_MS. */
export function parsePause(arg: string): number | null {
  const match = /^(\d+)([mhd])$/.exec(arg);
  if (!match) return null;
  const ms = Number(match[1]) * UNIT_MS[match[2] as keyof typeof UNIT_MS];
  return ms > 0 && ms <= MAX_PAUSE_MS ? ms : null;
}

/** The reply to `text`; `statusChanged` when the public status must be purged from the edge cache. */
export async function runCommand(text: string, db: Db, now: Date): Promise<{ text: string; statusChanged: boolean }> {
  const [word = '', arg = '', ...rest] = text.trim().split(/\s+/);
  // Telegram's menu sends "/status@bot_name".
  const command = word.split('@')[0];
  const reply = (replyText: string, statusChanged = false) => ({ text: replyText, statusChanged });

  if (command === '/status') return reply(await statusText(db, now));
  if (command === '/pause') {
    const ms = rest.length === 0 ? parsePause(arg) : null;
    if (ms === null) return reply(telegram.usage(MAX_PAUSE_MS / DAY_MS));
    const until = await pauseSensor(db, new Date(now.getTime() + ms).toISOString(), now);
    return until ? reply(telegram.paused(formatAt(until, now)), true) : reply(sensorCopy.never);
  }
  if (command === '/resume') {
    return (await pauseSensor(db, null, now)) ? reply(telegram.resumed, true) : reply(telegram.notPaused);
  }
  return reply(telegram.help);
}

async function statusText(db: Db, now: Date): Promise<string> {
  const { grid, heartbeat, open } = await readGridState(db, now);
  // Unless the sensor vouches for it, ON claims only that no outage has been reported.
  const lines = [grid.status === 'OFF' ? statusCopy.OFF : grid.monitored ? statusCopy.ON : statusCopy.NONE];

  const state = sensorState(heartbeat ?? null, now.getTime());
  if (state.kind === 'never') lines.push(sensorCopy.never);
  else if (state.kind === 'paused') lines.push(sensorCopy.paused(formatAt(state.until, now)));
  else if (state.kind === 'reporting') lines.push(sensorCopy.reporting(formatAt(state.lastSeen, now)));
  else if (state.kind === 'resuming') lines.push(sensorCopy.resuming(formatAt(state.since, now)));
  else {
    const silentFor = formatDurationIn(state.forMs, units, { seconds: false });
    lines.push(sensorCopy.silent(silentFor, formatAt(state.since, now)));
  }

  if (open) lines.push(telegram.outage(formatAt(open.startTime, now), sourceCopy[open.source]));
  return lines.join('\n');
}
