import { type Component, createResource, lazy, Match, onCleanup, onMount, Show, Suspense, Switch } from 'solid-js';
import { type StatsResponse, type StatusResponse, TRACKING_SINCE } from '../shared/api';
import * as css from './App.css';
import { ConfirmOutage } from './components/ConfirmOutage';
import { OutageHistory } from './components/OutageHistory';
import { StatusBadge } from './components/StatusBadge';
import { ThemeToggle } from './components/ThemeToggle';
import { Trends } from './components/Trends';
import { api } from './lib/api';
import { formatDate, formatDuration } from './lib/format';
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
    <p class="gg-notice">A volunteer project. Not affiliated with the City of Tshwane, Eskom or any government body.</p>
  </>
);

const Footer: Component = () => (
  <footer class="gg-footer">
    <p>
      A community record of how often Ward 45 loses power, kept so we can see whether things are getting better or
      worse. Tracking since {formatDate(TRACKING_SINCE)}. Outages are logged by hand for now; a mains-powered sensor
      that checks in every minute will take over once it is installed.
    </p>
    <nav aria-label="Site">
      <a href="/privacy.html">Privacy</a>
      <a href="/api/status">Status API</a>
      <a href="/api/outages.csv">Outage data (CSV)</a>
      <a href="/llms.txt">llms.txt</a>
      <a href="https://github.com/mooship/garsfontein-grid" rel="noopener">
        Source (GPL-3.0)
      </a>
    </nav>
  </footer>
);

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
                <p class={css.meta}>
                  {s().mode === 'sensor' && s().lastSeen
                    ? `Sensor last checked in ${formatDuration(now() - Date.parse(s().lastSeen as string))} ago`
                    : 'Reported by hand by a Ward 45 resident until our sensor is installed.'}
                </p>
                <div class={css.bottom}>
                  <Show
                    when={s().status === 'OFF' && s().outage}
                    fallback={
                      <p class={css.note}>
                        When the power goes off, neighbours can confirm it here to help everyone see how widespread it
                        is.
                      </p>
                    }
                  >
                    {(outage) => <ConfirmOutage outage={outage()} siteKey={s().turnstileSiteKey} />}
                  </Show>
                </div>
              </>
            )}
          </Match>
          <Match when={status.error}>
            <p class={css.error}>Could not reach the grid monitor. Retrying…</p>
          </Match>
          <Match when={true}>
            <p class="gg-status-loading">Checking the grid status…</p>
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
                  How bad is it?
                </h2>
              </div>
              <details class="gg-trends-details">
                <summary>Show weekly table</summary>
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
        <Show when={data()}>{(s) => <OutageHistory outages={s().recent} now={now()} />}</Show>
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
          <Suspense fallback={<p class="gg-status-loading">Loading…</p>}>
            <Admin />
          </Suspense>
        </Show>
      </main>
      <Footer />
    </div>
  );
};
