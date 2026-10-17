import {
  type Component,
  createMemo,
  createResource,
  lazy,
  Match,
  onCleanup,
  onMount,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { MINUTE_MS, type StatsResponse, type StatusResponse, TRACKING_SINCE } from '../shared/api';
import * as css from './App.css';
import { ConfirmOutage } from './components/ConfirmOutage';
import { OutageHistory } from './components/OutageHistory';
import { HistorySkeleton, StatusSkeleton, TrendsCardSkeleton } from './components/Skeletons';
import { StatusBadge } from './components/StatusBadge';
import { ThemeToggle } from './components/ThemeToggle';
import { Trends } from './components/Trends';
import { api } from './lib/api';
import { formatDate, formatDuration, formatRelativeDay, formatTime, outageDurationMs } from './lib/format';
import { useNow } from './lib/now';
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

/** Uses the request started in index.tsx first, then fetches fresh data on refetch. */
function firstThen<T>(initial: Promise<T>, fetcher: () => Promise<T>): () => Promise<T> {
  let first = true;
  return () => {
    if (!first) return fetcher();
    first = false;
    return initial;
  };
}

/** The disclaimer is for the public page; the admin view doesn't need it. */
const Masthead: Component<{ notice: boolean }> = (props) => (
  <>
    <header class="gg-masthead">
      <div>
        <p class="gg-eyebrow">Ward 45 · Garsfontein, Pretoria</p>
        <h1 class="gg-title">Garsfontein Grid</h1>
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
      <a href="/privacy.html">Privacy</a>
      <a href="/api/outages.csv">Download the data (CSV)</a>
      <Show when={props.signIn}>
        <a href="/admin" rel="nofollow">
          Sign in
        </a>
      </Show>
    </nav>
    <p>Garsfontein, Pretoria · Ward 45 (DA) · Region 6, City of Tshwane · Garsfontein substation</p>
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
  // Text that only changes by the minute (or day) re-renders once a minute, not every second.
  const minute = createMemo(() => Math.floor(now() / MINUTE_MS) * MINUTE_MS);
  const [status, { refetch }] = createResource(firstThen(props.initial.status, api.status));
  const [stats, { refetch: refetchStats }] = createResource(firstThen(props.initial.stats, api.stats));

  onMount(() => {
    const timer = setInterval(whenVisible(refetch), POLL_MS);
    const statsTimer = setInterval(whenVisible(refetchStats), STATS_POLL_MS);
    const onVisible = whenVisible(refetch);
    document.addEventListener('visibilitychange', onVisible);
    onCleanup(() => {
      clearInterval(timer);
      clearInterval(statsTimer);
      document.removeEventListener('visibilitychange', onVisible);
    });
  });

  // `latest` keeps showing the previous data while a poll is in flight.
  const data = () => status.latest;
  useStatusTab(data, minute);

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
                <p class="gg-status-detail">{statusDetail(s(), minute())}</p>
                <Show when={s().status === 'OFF' && s().outage}>
                  {(outage) => <ConfirmOutage outage={outage()} siteKey={s().turnstileSiteKey} />}
                </Show>
              </>
            )}
          </Match>
          <Match when={status.error}>
            <p class={css.error}>Couldn’t reach the server. Trying again shortly…</p>
          </Match>
          <Match when={true}>
            <StatusSkeleton />
          </Match>
        </Switch>
      </section>

      <section class="gg-card" aria-labelledby="trends-heading">
        <Show when={stats.latest} fallback={<TrendsCardSkeleton />}>
          {(s) => <Trends stats={s()} now={minute()} />}
        </Show>
      </section>

      <section class="gg-card" aria-labelledby="history-heading">
        <h2 id="history-heading" class="gg-card-title">
          Recent outages
        </h2>
        <Show when={data()} fallback={<HistorySkeleton />}>
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
            <Suspense fallback={<p class="gg-status-note">Loading…</p>}>
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
