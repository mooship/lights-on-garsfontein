import CalendarClock from 'lucide-solid/icons/calendar-clock';
import { batch, type Component, createEffect, createMemo, createSignal, For, on, Show } from 'solid-js';
import { type OutageSummary, outageDurationMs, RECENT_LIMIT } from '../../shared/api';
import { api } from '../lib/api';
import { formatDay, formatDuration, formatEnd, formatTime } from '../lib/format';
import { t } from '../lib/i18n';
import { pageOf } from '../lib/pages';
import * as motion from '../styles/motion.css';
import { button, plainList } from '../styles/ui.css';
import * as css from './OutageHistory.css';

/** `markArrivals`: an outage a later poll adds slides in; off for pages, where every row is new. */
const OutageList: Component<{ outages: OutageSummary[]; now: number; markArrivals?: boolean }> = (props) => {
  let listed: ReadonlySet<number> | undefined;
  const arrived = createMemo(() => {
    const ids = props.outages.map((o) => o.id);
    const before = listed;
    listed = new Set(ids);
    return new Set(before && props.markArrivals ? ids.filter((id) => !before.has(id)) : []);
  });
  return (
    <Show when={props.outages.length > 0} fallback={<p class={`${css.empty} ${motion.enter}`}>{t().history.empty}</p>}>
      <ul class={`${plainList} ${motion.enter}`}>
        <For each={props.outages}>
          {(outage) => (
            <li class={css.row} classList={{ [motion.enter]: arrived().has(outage.id) }}>
              <div>
                <div class={css.primary}>{formatDay(outage.startTime)}</div>
                <div class={css.secondary}>
                  {t().history.range(
                    formatTime(outage.startTime),
                    outage.endTime ? formatEnd(outage.startTime, outage.endTime) : t().history.now,
                  )}
                </div>
              </div>
              <div class={css.end}>
                <div
                  class={css.primary}
                  classList={{
                    [css.ongoing]: !outage.endTime && !outage.planned,
                    [css.ongoingPlanned]: !outage.endTime && outage.planned,
                  }}
                >
                  {/* Only an open outage reads the clock, so closed rows do not re-render every tick. */}
                  {formatDuration(outageDurationMs(outage, outage.endTime ? 0 : props.now))}
                </div>
                <div class={css.secondary}>
                  {outage.endTime ? '' : t().history.ongoing}
                  {!outage.endTime && outage.planned ? ' · ' : ''}
                  <Show when={outage.planned} fallback={outage.endTime ? ' ' : ''}>
                    <span class={css.plannedTag}>
                      <CalendarClock size={12} stroke-width={2.5} aria-hidden="true" />
                      {t().history.planned}
                    </span>
                  </Show>
                </div>
              </div>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
};

interface OutageHistoryProps {
  /** StatusResponse.recent. */
  recent: OutageSummary[];
  now: number;
  /** Every outage, in pages, instead of the recent ones; the card's heading follows it. */
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}

/** The recent outages and, on request, every outage in pages. */
export const OutageHistory: Component<OutageHistoryProps> = (props) => {
  let showAll: HTMLButtonElement | undefined;
  let pager: HTMLElement | undefined;
  const [all, setAll] = createSignal<OutageSummary[]>([]);
  const [page, setPage] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  // Bumped by every load and by closing the list, so an answer that comes later is ignored.
  let latest = 0;

  /** `opening`: the reader asked for the list, so the focus follows it once it shows. */
  const load = (opening: boolean) => {
    const id = ++latest;
    setLoading(true);
    api.allOutages().then(
      ({ outages }) => {
        if (id !== latest) return;
        batch(() => {
          setAll(outages);
          setLoading(false);
          setFailed(false);
          props.onExpandedChange(true);
        });
        // The button pressed is gone, so the focus would drop to the page.
        if (opening) pager?.focus();
      },
      () =>
        id === latest &&
        batch(() => {
          setLoading(false);
          setFailed(true);
        }),
    );
  };

  // The status poll brings the recent outages; when one starts, ends or changes, so has the full list.
  // A memo, so a poll with the same outages leaves the list alone.
  const recentKey = createMemo(() => props.recent.map((o) => `${o.id}:${o.endTime}:${o.planned}`).join());
  createEffect(on(recentKey, () => props.expanded && load(false), { defer: true }));

  const current = () => pageOf(all(), page());
  const turn = (to: number) => to >= 0 && to < current().count && setPage(to);
  const collapse = () => {
    latest++;
    batch(() => {
      setPage(0);
      setLoading(false);
      setFailed(false);
      props.onExpandedChange(false);
    });
    // The button the reader came from takes the focus back, as the pager it was in is gone.
    queueMicrotask(() => showAll?.focus());
  };
  const failure = () => (
    <Show when={failed()}>
      <p class={css.empty} role="alert">
        {t().history.failed}
      </p>
    </Show>
  );

  return (
    <Show
      when={props.expanded}
      fallback={
        <>
          <OutageList outages={props.recent} now={props.now} markArrivals />
          {failure()}
          {/* A full recent list may not be all of them. */}
          <Show when={props.recent.length >= RECENT_LIMIT}>
            <button
              ref={showAll}
              type="button"
              class={`${button.ghost} ${css.more}`}
              aria-disabled={loading()}
              onClick={() => !loading() && load(true)}
            >
              {loading() ? t().loading : t().history.showAll}
            </button>
          </Show>
        </>
      }
    >
      <OutageList outages={current().items} now={props.now} />
      {/* A failed reload keeps the last list, and says so. */}
      {failure()}
      <nav ref={pager} class={css.pager} aria-label={t().history.pages} tabindex="-1">
        <button
          type="button"
          class={button.ghost}
          aria-disabled={current().index === 0}
          onClick={() => turn(current().index - 1)}
        >
          {t().history.newer}
        </button>
        <p role="status">{t().history.page(current().index + 1, current().count)}</p>
        <button
          type="button"
          class={button.ghost}
          aria-disabled={current().index === current().count - 1}
          onClick={() => turn(current().index + 1)}
        >
          {t().history.older}
        </button>
      </nav>
      <button type="button" class={`${button.ghost} ${css.more}`} onClick={collapse}>
        {t().history.showRecent}
      </button>
    </Show>
  );
};
