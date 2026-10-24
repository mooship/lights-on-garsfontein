// The owner's private Telegram alerts: one chat, set by the TELEGRAM_* secrets, never residents.
// They follow the push claims (worker/lib/alerts.ts), so both always tell the same story.

import { outageDurationMs } from '../../shared/api';
import { formatLasted, formatTimeOfDay } from '../../shared/format';
import { site } from '../../site.config';
import { admin } from '../../src/admin/copy';
import { DICTIONARIES } from '../../src/i18n/index';
import { createDb } from '../db/client';
import type { Outage } from '../db/schema';
import { type AlertKind, loadDueOutage, retryAlert, type TelegramAlert } from './alerts';
import { errorName, FETCH_TIMEOUT_MS, isTransient } from './http';

export const TELEGRAM_HOST = 'api.telegram.org';

const { telegram } = admin;
// The owner copy is English, like /admin.
const INTL_LOCALE = site.intlLocales.en;
const dayFormat = new Intl.DateTimeFormat(INTL_LOCALE, { timeZone: site.timeZone, day: 'numeric', month: 'short' });

/** Both secrets set; either one empty or missing turns the alerts off. */
export const telegramConfigured = (env: Env): boolean => Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);

/** "14:05", or "22 Oct 14:05" when that is not the day of `now`: a retried message can arrive a day late. */
export function formatAt(iso: string, now: Date): string {
  const time = formatTimeOfDay(iso, INTL_LOCALE);
  const day = dayFormat.format(new Date(iso));
  return day === dayFormat.format(now) ? time : `${day} ${time}`;
}

/** The message for `outage`, sent at `now`; an `on` message needs a closed outage. */
export function telegramText(
  kind: AlertKind,
  outage: Pick<Outage, 'startTime' | 'endTime' | 'isPlanned' | 'source'>,
  now: Date,
): string {
  const start = formatAt(outage.startTime, now);
  if (kind === 'off') return (outage.isPlanned ? telegram.planned : '') + telegram.off[outage.source](start);
  if (kind === 'dismissed') {
    return outage.source === 'sensor' && outage.endTime
      ? telegram.dismissed.sensor(start, formatAt(outage.endTime, now))
      : telegram.dismissed.plain;
  }
  if (!outage.endTime) throw new Error('An on message needs an outage that has ended');
  const lasted = formatLasted(outageDurationMs(outage, 0), DICTIONARIES.en.units);
  return telegram.on(formatAt(outage.endTime, now), lasted);
}

/** A sendMessage body for the owner's chat; link previews off, as no message needs one. */
export const telegramMessage = (chatId: unknown, text: string) => ({
  chat_id: chatId,
  text,
  link_preview_options: { is_disabled: true },
});

/**
 * Sends one alert to the owner. A 429, a 5xx or a failed fetch goes back on the queue, waiting longer
 * each time, until PUSH_MAX_ATTEMPTS; any other error is ours (a wrong token or chat), so it is dropped.
 * Logs never include the token, which is part of the URL.
 */
export async function deliverTelegramAlert(alert: TelegramAlert, env: Env, now: Date): Promise<void> {
  if (!telegramConfigured(env)) return;
  const outage = await loadDueOutage(createDb(env.DB), alert);
  if (!outage) return;

  let status: number;
  try {
    const response = await fetch(`https://${TELEGRAM_HOST}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      body: JSON.stringify(telegramMessage(env.TELEGRAM_CHAT_ID, telegramText(alert.kind, outage, now))),
    });
    status = response.status;
    if (response.ok) return;
    if (!isTransient(status)) {
      // A body that is not JSON still leaves the status to log.
      const { description } = await response.json<{ description?: string }>().catch(() => ({ description: '' }));
      console.warn(`Dropped a Telegram alert: Telegram answered ${status} (${description})`);
      return;
    }
  } catch (error) {
    console.warn(`Telegram send failed: ${errorName(error)}`);
  }

  if (!(await retryAlert(env.PUSH_QUEUE, alert))) {
    console.warn(`Gave up on a Telegram alert after ${alert.attempt} attempts`);
  }
}
