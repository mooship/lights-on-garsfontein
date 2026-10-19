import { type Component, lazy, Match, onCleanup, onMount, Show, Suspense, Switch } from 'solid-js';
import {
  HEARTBEAT_THRESHOLD_MS,
  MINUTE_MS,
  outageDurationMs,
  type StatsResponse,
  type StatusResponse,
  TRACKING_SINCE,
} from '../shared/api';
import { DEFAULT_LOCALE } from '../shared/locale';
import { ADMIN_PAGE_PATH, CSV_PATH, FEED_PATH, PRIVACY_PAGE_PATH } from '../shared/paths';
import { site } from '../site.config';
import * as css from './App.css';
import { bannersPending } from './banners';
import { SiteBanner } from './components/Banner';
import { LanguageToggle } from './components/LanguageToggle';
import { OutageHistory } from './components/OutageHistory';
import { Share } from './components/Share';
import { HistorySkeleton, StatusSkeleton, TrendsCardSkeleton } from './components/Skeletons';
import { StatusBadge } from './components/StatusBadge';
import { SafetyLine, Scope } from './components/StatusNotes';
import { ThemeToggle } from './components/ThemeToggle';
import { HowWeMeasure, Trends } from './components/Trends';
import { api } from './lib/api';
import { formatDate, formatDuration, formatRelativeDay, formatTime } from './lib/format';
import { locale, t } from './lib/i18n';
import { useMinute, useNow } from './lib/now';
import { createPoll, POLL_MS, STATS_POLL_MS } from './lib/poll';
import { useStatusTab } from './lib/tab';
import { syncThemeColor, watchSystemTheme } from './lib/theme';

const Admin = lazy(() => import('./admin/Admin'));

const whenVisible = (fn: () => void) => () => document.visibilityState === 'visible' && fn();

export interface InitialData {
  status: Promise<StatusResponse>;
  stats: Promise<StatsResponse>;
}

const clockTime = (ms: number) => formatTime(new Date(ms).toISOString());

/** The disclaimer and the language switch are for the public page; the admin page is always in English. */
const Masthead: Component<{ isPublic: boolean }> = (props) => (
  <>
    <header class="gg-masthead">
      <p class="gg-eyebrow">{t().masthead.eyebrow}</p>
      <div class="gg-masthead-actions">
        <Show when={props.isPublic}>
          <LanguageToggle />
        </Show>
        <ThemeToggle />
      </div>
      <h1 class="gg-title">{site.brand.full}</h1>
    </header>
    <Show when={props.isPublic}>
      <p class="gg-notice">{t().masthead.notice}</p>
    </Show>
  </>
);

// privacy.html gives each language a section with the locale as its id, the default language first.
const privacyHref = () => (locale() === DEFAULT_LOCALE ? PRIVACY_PAGE_PATH : `${PRIVACY_PAGE_PATH}#${locale()}`);

/** `isPublic` adds sharing and the sign-in link, which the admin page doesn't need. */
const Footer: Component<{ isPublic: boolean }> = (props) => (
  <footer class="gg-footer">
    <Show when={props.isPublic}>
      <Share />
    </Show>
    <nav aria-label={t().footer.nav}>
      <a href={privacyHref()}>{t().footer.privacy}</a>
      <a href={CSV_PATH}>{t().footer.csv}</a>
      <a href={FEED_PATH} type="application/atom+xml">
        {t().footer.feed}
      </a>
      <Show when={props.isPublic}>
        <a href={ADMIN_PAGE_PATH} rel="nofollow">
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
    // A tab back from the background asks for the status at once, and for the statistics only if
    // they are older than a poll would let them get.
    const onVisible = whenVisible(() => {
      status.refetch();
      if (Date.now() - stats.updatedAt() > STATS_POLL_MS) stats.refetch();
    });
    document.addEventListener('visibilitychange', onVisible);
    onCleanup(() => {
      clearInterval(timer);
      clearInterval(statsTimer);
      document.removeEventListener('visibilitychange', onVisible);
    });
  });

  // A failed poll may mean the reader's connection went down with the power, so once the last answer
  // is as old as a stale heartbeat, ON is no longer backed by a live reading.
  const outOfTouch = () => status.error() !== undefined && now() - status.updatedAt() > HEARTBEAT_THRESHOLD_MS;
  const data = () => {
    const s = status.data();
    return s && outOfTouch() ? { ...s, monitored: false } : s;
  };
  useStatusTab(data, minute);
  // The last poll failed, so the status shown may be out of date. A tab back from the background
  // is not stale: it refetches at once.
  const warning = () => (status.error() !== undefined ? t().status.stale(clockTime(status.updatedAt())) : undefined);

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
                <StatusBadge status={s().status} monitored={s().monitored} since={s().since} now={now()} />
                <Scope />
                <div class="gg-status-detail">
                  <p>{statusDetail(s(), minute())}</p>
                  {/* Only when something is wrong; the loading shell has no line for it. */}
                  <Show when={warning()}>
                    {(text) => (
                      <p class={`gg-status-warning ${css.warning}`} role="alert">
                        {text()}
                      </p>
                    )}
                  </Show>
                </div>
                <SafetyLine />
              </>
            )}
          </Match>
          <Match when={status.error() !== undefined}>
            <p class={css.error} role="alert">
              {t().status.unreachable}
            </p>
            <Scope />
            <SafetyLine />
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
            {/* The body keeps the card's reserved height, so the cards below stay put. */}
            <div class="gg-trends-body">
              <h2 id="trends-heading" class="gg-card-title">
                {t().trends.title}
              </h2>
              <p class={css.warning}>{t().trends.loadFailed}</p>
            </div>
            <HowWeMeasure />
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
  // Checked once: with every banner expired, the banner and its minute timer never mount.
  const showBanner = !!props.initial && bannersPending(Date.now());
  onMount(() => {
    syncThemeColor();
    onCleanup(watchSystemTheme());
  });

  return (
    <div class="gg-shell">
      <Masthead isPublic={!!props.initial} />
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
        {/* In the flow after the last card: index.html has nothing below it, so it shifts nothing. */}
        <Show when={showBanner}>
          <SiteBanner />
        </Show>
      </main>
      <Footer isPublic={!!props.initial} />
    </div>
  );
};
