import { type Component, createResource, lazy, Match, onCleanup, onMount, Show, Suspense, Switch } from 'solid-js';
import { type StatsResponse, type StatusResponse, TRACKING_SINCE } from '../shared/api';
import * as css from './App.css';
import { ConfirmOutage } from './components/ConfirmOutage';
import { OutageHistory } from './components/OutageHistory';
import { HistorySkeleton, STATUS_NOTE, StatusSkeleton, TrendsSkeleton } from './components/Skeletons';
import { StatusBadge } from './components/StatusBadge';
import { ThemeToggle } from './components/ThemeToggle';
import { Trends } from './components/Trends';
import { api } from './lib/api';
import { formatDate, formatRelativeDay, formatTime } from './lib/format';
import { useNow } from './lib/now';
import { useStatusTab } from './lib/tab';
import { syncThemeColor, watchSystemTheme } from './lib/theme';

const Admin = lazy(() => import('./admin/Admin'));

const POLL_MS = 30_000;
const STATS_POLL_MS = 5 * 60_000;

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

export const Masthead: Component = () => (
  <>
    <header class="gg-masthead">
      <div>
        <p class="gg-eyebrow">Ward 45 · Garsfontein, Pretoria</p>
        <h1 class="gg-title">Garsfontein Grid</h1>
      </div>
      <ThemeToggle />
    </header>
    <p class="gg-notice">Run by a Garsfontein resident. Not affiliated with the City of Tshwane or Eskom.</p>
  </>
);

const Footer: Component = () => (
  <footer class="gg-footer">
    <p>
      An open record of power cuts for homes on the Garsfontein substation, kept since {formatDate(TRACKING_SINCE)}. A
      fault on that substation usually takes out the whole area, so if it’s off here, it’s probably off for you too.
    </p>
    <nav aria-label="Site">
      <a href="/privacy.html">Privacy</a>
      <a href="/api/outages.csv">Download the data (CSV)</a>
      <a href="/api/status">Status API</a>
      <a href="/llms.txt">llms.txt</a>
      <a href="https://github.com/mooship/garsfontein-grid" rel="noopener">
        Source code
      </a>
    </nav>
  </footer>
);

/** One line of context under the badge: when it went off, or when the last outage was. */
function statusDetail(s: StatusResponse, now: number): string {
  const on = (iso: string) => {
    const day = formatRelativeDay(iso, now);
    return day === 'today' || day === 'yesterday' ? day : `on ${day}`;
  };
  if (s.status === 'OFF') {
    const start = s.outage?.startTime ?? s.since;
    return start ? `Went off at ${formatTime(start)} ${on(start)}.` : '';
  }
  const last = s.recent.find((o) => o.endTime);
  if (!last?.endTime) return `No outages since tracking began on ${formatDate(TRACKING_SINCE)}.`;
  return `Last outage: ${formatTime(last.startTime)} to ${formatTime(last.endTime)} ${on(last.startTime)}.`;
}

const PublicView: Component<{ initial: InitialData }> = (props) => {
  const now = useNow(1000);
  const [status, { refetch }] = createResource(firstThen(props.initial.status, api.status));
  const [stats, { refetch: refetchStats }] = createResource(firstThen(props.initial.stats, api.stats));

  onMount(() => {
    const timer = setInterval(() => document.visibilityState === 'visible' && refetch(), POLL_MS);
    const statsTimer = setInterval(() => document.visibilityState === 'visible' && refetchStats(), STATS_POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && refetch();
    document.addEventListener('visibilitychange', onVisible);
    onCleanup(() => {
      clearInterval(timer);
      clearInterval(statsTimer);
      document.removeEventListener('visibilitychange', onVisible);
    });
  });

  // `latest` keeps showing the previous data while a poll is in flight.
  const data = () => status.latest;
  useStatusTab(data, now);

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
                <p class="gg-status-detail">{statusDetail(s(), now())}</p>
                <Show when={s().status === 'OFF' && s().outage} fallback={<p class="gg-status-note">{STATUS_NOTE}</p>}>
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
        <Show
          when={stats.latest}
          fallback={
            <>
              <div class="gg-trends-body">
                <h2 id="trends-heading" class="gg-card-title">
                  By the numbers
                </h2>
                <TrendsSkeleton />
              </div>
              <details class="gg-trends-details">
                <summary>Show the weekly numbers</summary>
              </details>
            </>
          }
        >
          {(s) => <Trends stats={s()} now={now()} />}
        </Show>
      </section>

      <section class="gg-card gg-history-card" aria-labelledby="history-heading">
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

export const App: Component<{ initial: InitialData }> = (props) => {
  onMount(() => {
    syncThemeColor();
    onCleanup(watchSystemTheme());
  });
  const isAdmin = location.pathname.replace(/\/$/, '') === '/admin';

  return (
    <div class="gg-shell">
      <Masthead />
      <main class="gg-main">
        <Show when={isAdmin} fallback={<PublicView initial={props.initial} />}>
          <Suspense fallback={<p class="gg-status-note">Loading…</p>}>
            <Admin />
          </Suspense>
        </Show>
      </main>
      <Footer />
    </div>
  );
};
