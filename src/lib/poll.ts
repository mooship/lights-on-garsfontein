import { type Accessor, batch, createSignal } from 'solid-js';
import { MINUTE_MS } from '../../shared/api';

/**
 * How often a visible public page asks for the status: no faster than it can change, as the sensor
 * reports and the cron checks once a minute. Gentle on readers' batteries and data. The admin
 * dashboard reloads its outage list as often; README "Admin" states it, so change them together.
 */
export const POLL_MS = MINUTE_MS;
/** How often it asks for the statistics; trends.loadFailed in src/i18n promises a retry in a few minutes. */
export const STATS_POLL_MS = 5 * MINUTE_MS;

/** `fn`, run only while the page is visible, so a background tab asks for nothing. */
export const whenVisible = (fn: () => void) => () => document.visibilityState === 'visible' && fn();

interface Poll<T> {
  /** The last successful response; kept through later failures. */
  data: Accessor<T | undefined>;
  /** The latest failure, cleared by the next success. */
  error: Accessor<unknown>;
  /** When `data` last arrived (Date.now() ms); 0 until it first does. */
  updatedAt: Accessor<number>;
  refetch: () => void;
}

/**
 * Polled data that never throws on read, unlike a Solid resource in error. Starts from `initial`
 * (the request index.tsx already sent) and ignores responses that arrive out of order.
 */
export function createPoll<T>(initial: Promise<T>, fetcher: () => Promise<T>): Poll<T> {
  const [data, setData] = createSignal<T>();
  const [error, setError] = createSignal<unknown>();
  const [updatedAt, setUpdatedAt] = createSignal(0);
  let latest = 0;
  const load = (request: Promise<T>) => {
    const id = ++latest;
    request.then(
      (value) =>
        id === latest &&
        batch(() => {
          setData(() => value);
          setError(undefined);
          setUpdatedAt(Date.now());
        }),
      (e) => id === latest && setError(() => e ?? new Error('failed')),
    );
  };
  load(initial);
  return { data, error, updatedAt, refetch: () => load(fetcher()) };
}
