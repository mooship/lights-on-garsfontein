import clsx from 'clsx';
import { type Component, lazy, Match, onCleanup, onMount, Show, Suspense, Switch } from 'solid-js';
import { MINUTE_MS, type StatsResponse, type StatusResponse, TRACKING_SINCE } from '../shared/api';
import * as css from './App.css';
import { SiteBanner } from './components/Banner';
import { ConfirmOutage } from './components/ConfirmOutage';
import { LanguageToggle } from './components/LanguageToggle';
import { OutageHistory } from './components/OutageHistory';
import { HistorySkeleton, StatusSkeleton, TrendsCardSkeleton } from './components/Skeletons';
import { StatusBadge } from './components/StatusBadge';
import { ThemeToggle } from './components/ThemeToggle';
import { Trends } from './components/Trends';
import { api } from './lib/api';
import { formatDate, formatDuration, formatRelativeDay, formatTime, outageDurationMs } from './lib/format';
import { t } from './lib/i18n';
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
        <p class="gg-eyebrow">{t().masthead.eyebrow}</p>
        <h1 class="gg-title">Lights On?</h1>
      </div>
      <div class="gg-masthead-actions">
        <LanguageToggle />
        <ThemeToggle />
      </div>
    </header>
    <Show when={props.notice}>
      <p class="gg-notice">{t().masthead.notice}</p>
    </Show>
  </>
);

const Footer: Component<{ signIn: boolean }> = (props) => (
  <footer class="gg-footer">
    <nav aria-label={t().footer.nav}>
      <a href="/privacy">{t().footer.privacy}</a>
      <a href="/api/outages.csv">{t().footer.csv}</a>
      <Show when={props.signIn}>
        <a href="/admin" rel="nofollow">
          {t().footer.signIn}
        </a>
      </Show>
    </nav>
    <p>{t().footer.measured}</p>
    <p>{t().footer.operator}</p>
  </footer>
);

/** One line of context under the badge: when it went off, or when the last outage was. */
function statusDetail(s: StatusResponse, now: number): string {
  const m = t().status;
  if (s.status === 'OFF') {
    const start = s.since;
    if (!start) return '';
    const day = formatRelativeDay(start, now);
    return s.outage?.planned ? m.planned(formatTime(start), day) : m.wentOff(formatTime(start), day);
  }
  const last = s.recent.find((o) => o.endTime);
  if (!last?.endTime) return m.noOutages(formatDate(TRACKING_SINCE));
  const lasted = formatDuration(outageDurationMs(last, now));
  return m.lastOutage(
    formatTime(last.startTime),
    formatTime(last.endTime),
    formatRelativeDay(last.startTime, now),
    lasted,
  );
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
          {t().status.heading}
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
                    fallback={<p class="gg-status-updated">{t().status.updated(clockTime(status.updatedAt()))}</p>}
                  >
                    <p class={clsx('gg-status-updated', css.warning)} role="alert">
                      {t().status.stale(clockTime(status.updatedAt()))}
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
              {t().status.unreachable}
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
                    {t().trends.refreshFailed(clockTime(stats.updatedAt()))}
                  </p>
                </Show>
              </>
            )}
          </Match>
          <Match when={stats.error() !== undefined}>
            <h2 id="trends-heading" class="gg-card-title">
              {t().trends.title}
            </h2>
            <p class={css.warning}>{t().trends.loadFailed}</p>
          </Match>
          <Match when={true}>
            <TrendsCardSkeleton />
          </Match>
        </Switch>
      </section>

      <section class="gg-card" aria-labelledby="history-heading">
        <h2 id="history-heading" class="gg-card-title">
          {t().history.title}
        </h2>
        <Show
          when={data()}
          fallback={
            status.error() !== undefined ? <p class="gg-status-note">{t().history.failed}</p> : <HistorySkeleton />
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
      {/* tabindex lets the banner hand focus here once it closes. */}
      <main class="gg-main" tabindex="-1">
        <Show
          when={props.initial}
          fallback={
            <Suspense
              fallback={
                <p class="gg-status-note" role="status">
                  {t().loading}
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
      <Show when={props.initial}>
        <SiteBanner />
      </Show>
    </div>
  );
};
