// The admin page is always in English, whatever language the visitor chose for the public page:
// the boot script in index.html sets <html lang="en"> on ADMIN_PAGE_PATH (shared/paths.ts), so the
// shared masthead and footer follow. Unlike public copy, it names how an outage was recorded.

import type { ERROR, ErrorCode } from '../../shared/errors.ts';
import { site } from '../../site.config.ts';

/**
 * API error codes without a message of their own, shown as `requestFailed(code)`: refusals the
 * app's own requests never trigger, the contact form's code, and server faults.
 */
type Unexplained =
  | typeof ERROR.forbidden
  | typeof ERROR.unsupportedMediaType
  | typeof ERROR.notConfigured
  | typeof ERROR.internal;

/** Every other API error code, and the admin page's own `session_expired`, needs a message. */
export type AdminErrorCode = Exclude<ErrorCode, Unexplained> | 'session_expired';

export const admin = {
  back: 'Public page',
  unreachable: 'Unable to reach the server.',
  retry: 'Try again',
  errors: {
    unauthorized: 'Incorrect username or password.',
    rate_limited: 'Too many attempts. Please wait a minute and try again.',
    turnstile_failed: 'The security check failed. Please try again.',
    outage_already_open: 'An outage is already open.',
    no_open_outage: 'There is no open outage to close.',
    alert_sent:
      'Subscribers were alerted to this outage and have not yet had the follow-up. Mark it a false positive instead.',
    end_before_start: 'The end must be after the start.',
    invalid_json: 'The request could not be read. Reload the page and try again.',
    bad_request: 'Check the times and try again. Times cannot be in the future.',
    not_found: 'That outage no longer exists. Reload the page.',
    session_expired: 'Your session has expired. Please sign in again.',
  } satisfies Record<AdminErrorCode, string>,
  requestFailed: (code: string) => `Request failed (${code}).`,
  network: 'Network error.',
  pageTitle: `Admin · ${site.brand.full}`,
  signInTitle: 'Admin sign-in',
  username: 'Username',
  password: 'Password',
  checking: 'Checking…',
  signIn: 'Sign in',
  signOut: 'Sign out',
  ongoing: 'ongoing',
  source: { sensor: 'sensor', manual: 'manual' },
  plannedTag: ' · planned',
  falsePositiveTag: ' · false positive',
  // The sensor reconnected and reported it had power throughout: a lost connection, not an outage.
  dismissedBySensorTag: ' · false positive (the sensor had power throughout)',
  closeNow: 'Close now',
  falsePositive: 'False positive',
  planned: 'Planned',
  delete: 'Delete',
  deleteConfirm: 'Delete this outage?',
  logged: 'Outage logged.',
  logTitle: 'Log a past outage',
  started: 'Started',
  ended: 'Ended',
  plannedHint: 'Planned (announced in advance, e.g. maintenance or upgrades)',
  saving: 'Saving…',
  log: 'Log outage',
  punchClock: 'Punch clock',
  outages: 'Outages',
  noOutages: 'No outages recorded.',
  duration: 'Outage duration',
  offSince: (day: string, time: string, source: string) => `Off since ${day}, ${time} (${source})`,
  idle: 'No outage in progress.',
  punchOut: 'Punch out',
  punchIn: 'Punch in',
  punchedOut: (time: string) => `Punched out at ${time}`,
  punchedIn: (time: string) => `Punched in at ${time}`,
  sensor: {
    never: 'No sensor has reported yet.',
    reporting: (at: string) => `Sensor reporting. Last heard at ${at}.`,
    paused: (until: string) => `Sensor paused until ${until}.`,
    resuming: (since: string) => `Pause ended at ${since}. Waiting for the sensor.`,
    silent: (duration: string, since: string) => `Sensor silent for ${duration}, since ${since}.`,
    stale: (time: string) => `Unable to refresh. Showing the sensor as at ${time}.`,
  },
  // The owner's private Telegram alerts (worker/lib/telegram.ts). A silent sensor can mean a power
  // cut or a lost connection, so its off message claims no more than that.
  telegram: {
    off: {
      sensor: (since: string) => `No reading from home since ${since}. The power may be off.`,
      manual: (since: string) => `Power off at home since ${since}.`,
    },
    planned: 'Planned outage. ',
    on: (at: string, lasted: string) => `Power is back on at home since ${at}, after ${lasted}.`,
    dismissed: {
      sensor: (from: string, to: string) =>
        `False alarm: the power stayed on. The sensor was offline from ${from} to ${to}.`,
      plain: 'False alarm: the power stayed on.',
    },
    // The owner's commands (worker/lib/telegram-commands.ts).
    help: [
      'Commands:',
      '/status: the power and the sensor now',
      '/pause 3h: pause the sensor (30m, 3h, 2d)',
      '/resume: end a pause',
    ].join('\n'),
    usage: (maxDays: number) => `Use /pause with a duration such as 30m, 3h or 2d, up to ${maxDays} days.`,
    paused: (until: string) => `Sensor paused until ${until}.`,
    resumed: 'Pause ended.',
    notPaused: 'Nothing is paused.',
    outage: (since: string, source: string) => `Outage open since ${since} (${source}).`,
  },
};
