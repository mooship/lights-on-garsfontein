import clsx from 'clsx';
import { type Component, lazy, Match, onCleanup, onMount, Show, Suspense, Switch } from 'solid-js';
import { MINUTE_MS, type StatsResponse, type StatusResponse, TRACKING_SINCE } from '../shared/api';
import * as css from './App.css';
import { ConfirmOutage } from './components/ConfirmOutage';
import { OutageHistory } from './components/OutageHistory';
import { HistorySkeleton, StatusSkeleton, TRENDS_TITLE, TrendsCardSkeleton } from './components/Skeletons';
import { StatusBadge } from './components/StatusBadge';
import { ThemeToggle } from './components/ThemeToggle';
import { Trends } from './components/Trends';
import { api } from './lib/api';
import { formatDate, formatDuration, formatRelativeDay, formatTime, outageDurationMs } from './lib/format';
import { useMinute, useNow } from './lib/now';
import { createPoll } from './lib/poll';
import { useStatusTab } from './lib/tab';
import { syncThemeColor, watchSystemTheme } from './lib/theme';

const Admin = lazy(() => import('./admin/Admin'));

const POLL_MS = 30_000;
const STATS_POLL_MS = 5 * MINUTE_MS;

/** Wraps a poll so it only runs while the tab is visible. */
const whenVisible = (fn: () => void) => () => document.visibilityState === 'visible' && fn();

export interface InitialData {
  status: Promise<StatusResponse>;
  stats: Promise<StatsResponse>;
}

const clockTime = (ms: number) => formatTime(new Date(ms).toISOString());

/** The disclaimer is for the public page; the admin view doesn't need it. */
const Masthead: Component<{ notice: boolean }> = (props) => (
  <>
    <header class="gg-masthead">
      <div>
        <p class="gg-eyebrow">Garsfontein Ext. 16 · Ward 45 · Pretoria</p>
        <h1 class="gg-title">Lights On?</h1>
      </div>
      <ThemeToggle />
    </header>
    <Show when={props.notice}>
      <p class="gg-notice">Run by a Garsfontein resident. Not affiliated with the City of Tshwane or Eskom.</p>
    </Show>
  </>
);

const Footer: Component<{ signIn: boolean }> = (props) => (
  <footer class="gg-footer">
    <nav aria-label="Site">
      <a href="/privacy">Privacy</a>
      <a href="/api/outages.csv">Download the data (CSV)</a>
      <Show when={props.signIn}>
        <a href="/admin" rel="nofollow">
          Sign in
        </a>
      </Show>
    </nav>
    <p>Measured in Garsfontein Ext. 16, Pretoria · Ward 45 (DA) · Region 6, City of Tshwane · Garsfontein substation</p>
  </footer>
);

/** One line of context under the badge: when it went off, or when the last outage was. */
function statusDetail(s: StatusResponse, now: number): string {
  const on = (iso: string) => {
    const day = formatRelativeDay(iso, now);
    return day === 'today' || day === 'yesterday' ? day : `on ${day}`;
  };
  if (s.status === 'OFF') {
    const start = s.since;
    if (!start) return '';
    const when = `${formatTime(start)} ${on(start)}`;
    return s.outage?.planned ? `Planned work on the grid since ${when}.` : `Went off at ${when}.`;
  }
  const last = s.recent.find((o) => o.endTime);
  if (!last?.endTime) return `No outages since tracking began on ${formatDate(TRACKING_SINCE)}.`;
  const lasted = formatDuration(outageDurationMs(last, now));
  return `Last outage: ${formatTime(last.startTime)} to ${formatTime(last.endTime)} ${on(last.startTime)} (${lasted}).`;
}

const PublicView: Component<{ initial: InitialData }> = (props) => {
  const now = useNow(1000);
  const minute = useMinute(now);
  const status = createPoll(props.initial.status, api.status);
  const stats = createPoll(props.initial.stats, api.stats);

  onMount(() => {
    const timer = setInterval(whenVisible(status.refetch), POLL_MS);
    const statsTimer = setInterval(whenVisible(stats.refetch), STATS_POLL_MS);
    const onVisible = whenVisible(status.refetch);
    document.addEventListener('visibilitychange', onVisible);
    onCleanup(() => {
      clearInterval(timer);
      clearInterval(statsTimer);
      document.removeEventListener('visibilitychange', onVisible);
    });
  });

  // The last good data stays on screen through failed polls.
  const data = status.data;
  useStatusTab(data, minute);
  // The last poll failed, so the status shown may be out of date. (A tab back from the background
  // is not stale: it refetches at once, and "Updated HH:MM" shows the age meanwhile.)
  const stale = () => status.error() !== undefined;

  return (
    <>
      <section class="gg-card gg-status-card" aria-labelledby="status-heading">
        <h2 id="status-heading" class="gg-sr-only">
          Current status
        </h2>
        <Switch>
          <Match when={data()}>
            {(s) => (
              <>
                <StatusBadge status={s().status} since={s().since} now={now()} />
                <div class="gg-status-detail">
                  <p>{statusDetail(s(), minute())}</p>
                  <Show
                    when={stale()}
                    fallback={<p class="gg-status-updated">Updated {clockTime(status.updatedAt())}</p>}
                  >
                    <p class={clsx('gg-status-updated', css.warning)} role="alert">
                      Can’t reach the server. Showing status from {clockTime(status.updatedAt())}.
                    </p>
                  </Show>
                </div>
                {/* Keyed on the outage so a new one starts with fresh state. */}
                <Show when={s().status === 'OFF' && s().outage?.id} keyed>
                  {(id) => (
                    <ConfirmOutage
                      outageId={id}
                      confirmations={s().outage?.confirmations ?? 0}
                      siteKey={s().turnstileSiteKey}
                    />
                  )}
                </Show>
              </>
            )}
          </Match>
          <Match when={status.error() !== undefined}>
            <p class={css.error} role="alert">
              Couldn’t reach the server. Trying again shortly…
            </p>
          </Match>
          <Match when={true}>
            <StatusSkeleton />
          </Match>
        </Switch>
      </section>

      <section class="gg-card" aria-labelledby="trends-heading">
        <Switch>
          <Match when={stats.data()}>
            {(s) => (
              <>
                <Trends stats={s()} now={minute()} />
                <Show when={stats.error() !== undefined}>
                  <p class={css.trendsWarning} role="alert">
                    Couldn’t refresh the numbers. Showing them from {clockTime(stats.updatedAt())}.
                  </p>
                </Show>
              </>
            )}
          </Match>
          <Match when={stats.error() !== undefined}>
            <h2 id="trends-heading" class="gg-card-title">
              {TRENDS_TITLE}
            </h2>
            <p class={css.warning}>Couldn’t load the numbers. Trying again shortly…</p>
          </Match>
          <Match when={true}>
            <TrendsCardSkeleton />
          </Match>
        </Switch>
      </section>

      <section class="gg-card" aria-labelledby="history-heading">
        <h2 id="history-heading" class="gg-card-title">
          Recent outages
        </h2>
        <Show
          when={data()}
          fallback={
            status.error() !== undefined ? (
              <p class="gg-status-note">Couldn’t load the outage history.</p>
            ) : (
              <HistorySkeleton />
            )
          }
        >
          {(s) => <OutageHistory outages={s().recent} now={now()} />}
        </Show>
      </section>
    </>
  );
};

/** `initial` is the public page's prefetched data; without it, the admin page renders. */
export const App: Component<{ initial?: InitialData }> = (props) => {
  onMount(() => {
    syncThemeColor();
    onCleanup(watchSystemTheme());
  });

  return (
    <div class="gg-shell">
      <Masthead notice={!!props.initial} />
      <main class="gg-main">
        <Show
          when={props.initial}
          fallback={
            <Suspense
              fallback={
                <p class="gg-status-note" role="status">
                  Loading…
                </p>
              }
            >
              <Admin />
            </Suspense>
          }
        >
          {(initial) => <PublicView initial={initial()} />}
        </Show>
      </main>
      <Footer signIn={!!props.initial} />
    </div>
  );
};
