import Download from 'lucide-solid/icons/download';
import Minus from 'lucide-solid/icons/minus';
import TrendingDown from 'lucide-solid/icons/trending-down';
import TrendingUp from 'lucide-solid/icons/trending-up';
import { type Component, createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { HOUR_MS, MINUTE_MS, type StatsResponse, type WeekStats } from '../../shared/api';
import { formatCalendarDay, formatDate, formatDuration, formatHours } from '../lib/format';
import { AXIS_WIDTH } from './chart';
import { TRENDS_TABLE_LABEL, TRENDS_TITLE } from './Skeletons';
import * as css from './Trends.css';

export interface TrendsProps {
  stats: StatsResponse;
  now: number;
}

interface Delta {
  text: string;
  /** Whether the change is good news, bad news or flat. */
  tone: 'worse' | 'better' | 'same';
  direction: 'up' | 'down' | 'flat';
}

/** The change on the previous period, or null when there is nothing to compare with yet. */
function delta(
  current: number,
  previous: number | undefined,
  format: (n: number) => string,
  upIsBad: boolean,
): Delta | null {
  if (previous === undefined) return null;
  const diff = Math.round((current - previous) * 10) / 10;
  if (diff === 0) return { text: 'Same as the 30 days before', tone: 'same', direction: 'flat' };
  const up = diff > 0;
  return {
    text: `${up ? '+' : '−'}${format(Math.abs(diff))} on the 30 days before`,
    tone: up === upIsBad ? 'worse' : 'better',
    direction: up ? 'up' : 'down',
  };
}

const Tile: Component<{ label: string; value: string; delta?: Delta | null; note?: string }> = (props) => (
  <div class={css.tile}>
    <div class={css.tileLabel}>{props.label}</div>
    <div class={css.tileValue}>{props.value}</div>
    <div class={css.tileDelta}>
      <Show when={props.delta} fallback={props.note ?? ' '}>
        {(d) => (
          <>
            <span class={css.deltaIcon[d().tone]} aria-hidden="true">
              {d().direction === 'up' ? (
                <TrendingUp size={14} />
              ) : d().direction === 'down' ? (
                <TrendingDown size={14} />
              ) : (
                <Minus size={14} />
              )}
            </span>
            <span>{d().text}</span>
          </>
        )}
      </Show>
    </div>
  </div>
);

const NICE_MAXIMA = [1, 2, 4, 6, 8, 10, 12, 16, 20, 24, 30, 40, 50, 60, 80, 100, 120, 168];

function niceMax(value: number): number {
  return NICE_MAXIMA.find((n) => n >= value) ?? Math.ceil(value / 24) * 24;
}

const CHART_HEIGHT = 144;
const TOP_PAD = 6;

const WeeklyChart: Component<{ weeks: WeekStats[] }> = (props) => {
  let svg!: SVGSVGElement;
  const [width, setWidth] = createSignal(320);
  const [active, setActive] = createSignal(props.weeks.length - 1);

  onMount(() => {
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(svg);
    onCleanup(() => observer.disconnect());
  });

  const max = createMemo(() => niceMax(Math.max(1, ...props.weeks.map((w) => w.hoursOff))));
  const geometry = createMemo(() => {
    const plot = Math.max(1, width() - AXIS_WIDTH);
    const slot = plot / Math.max(1, props.weeks.length);
    const barWidth = Math.max(2, Math.min(24, slot - 2, slot * 0.7));
    return { slot, barWidth };
  });
  const y = (hours: number) => TOP_PAD + (CHART_HEIGHT - TOP_PAD) * (1 - hours / max());
  // Clamped so a refresh with fewer weeks never points past the end.
  const activeIndex = createMemo(() => Math.min(active(), props.weeks.length - 1));
  const activeWeek = () => props.weeks[activeIndex()];

  const onKey: JSX.EventHandler<SVGSVGElement, KeyboardEvent> = (event) => {
    if (event.key === 'ArrowLeft') setActive((i) => Math.max(0, i - 1));
    else if (event.key === 'ArrowRight') setActive((i) => Math.min(props.weeks.length - 1, i + 1));
    else return;
    event.preventDefault();
  };

  // The whole column slot is the hit target, not just the painted bar.
  const onPointer: JSX.EventHandler<SVGSVGElement, PointerEvent> = (event) => {
    const x = event.clientX - svg.getBoundingClientRect().left - AXIS_WIDTH;
    if (x < 0) return;
    setActive(Math.min(props.weeks.length - 1, Math.floor(x / geometry().slot)));
  };

  return (
    <div class={css.chartBlock}>
      <h3 class={css.chartTitle}>Hours without power, week by week</h3>
      <p class={css.readout} aria-live="polite">
        <Show when={activeWeek()}>
          {(w) => (
            <>
              Week of {formatCalendarDay(w().weekStart)}:{' '}
              <span class={css.readoutValue}>{formatHours(w().hoursOff)}</span> off · {w().outages}{' '}
              {w().outages === 1 ? 'outage' : 'outages'}
              {activeIndex() === props.weeks.length - 1 ? ' (so far)' : ''}
            </>
          )}
        </Show>
      </p>
      <svg
        ref={svg}
        class={css.svg}
        role="img"
        aria-label="Weekly hours without power. Use the arrow keys to read each week, or open the table below."
        tabindex="0"
        onKeyDown={onKey}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
      >
        <For each={[0, max() / 2, max()]}>
          {(tick) => (
            <>
              <line class={css.grid} x1={AXIS_WIDTH} x2={width()} y1={y(tick)} y2={y(tick)} />
              <text class={css.axisText} x={AXIS_WIDTH - 6} y={y(tick)} dy="0.32em" text-anchor="end">
                {tick === 0 ? '0' : `${tick}h`}
              </text>
            </>
          )}
        </For>
        <For each={props.weeks}>
          {(week, index) => {
            const x = () => AXIS_WIDTH + index() * geometry().slot;
            const barX = () => x() + (geometry().slot - geometry().barWidth) / 2;
            const top = () => y(week.hoursOff);
            const height = () => CHART_HEIGHT - top();
            return (
              <g class={css.barGroup} data-active={active() === index() ? '' : undefined}>
                <Show when={week.hoursOff > 0}>
                  <rect
                    data-bar
                    class={css.bar}
                    x={barX()}
                    y={top()}
                    width={geometry().barWidth}
                    height={height()}
                    rx={Math.min(4, height() / 2)}
                  />
                  {/* Square off the baseline end so only the data end is rounded. */}
                  <rect
                    data-bar
                    class={css.bar}
                    x={barX()}
                    y={Math.max(top(), CHART_HEIGHT - 4)}
                    width={geometry().barWidth}
                    height={Math.min(4, height())}
                  />
                </Show>
                <Show when={active() === index()}>
                  <rect
                    class={css.activeMarker}
                    x={barX()}
                    y={CHART_HEIGHT + 3}
                    width={geometry().barWidth}
                    height={2}
                    rx={1}
                  />
                </Show>
              </g>
            );
          }}
        </For>
      </svg>
      <div class={css.xLabels}>
        <span>{props.weeks.length > 1 && props.weeks[0] ? formatCalendarDay(props.weeks[0].weekStart) : ''}</span>
        <span>This week</span>
      </div>
    </div>
  );
};

export const Trends: Component<TrendsProps> = (props) => {
  const since = () => Date.parse(props.stats.trackingSince);
  const started = () => props.now >= since();
  const s = () => props.stats.last30;
  const prev = () => props.stats.previous30;
  const subtitle = () => {
    if (!started()) return `Tracking starts on ${formatDate(props.stats.trackingSince)}.`;
    return s().trackedHours < 30 * 24 ? `Since ${formatDate(props.stats.trackingSince)}.` : 'The last 30 days.';
  };

  return (
    <>
      <div class="gg-trends-body">
        <h2 id="trends-heading" class="gg-card-title">
          {TRENDS_TITLE}
        </h2>
        <p class={css.subtitle}>{subtitle()}</p>
        <div class={css.tiles}>
          <Tile
            label="Without power"
            value={started() ? formatHours(s().hoursOff) : '—'}
            delta={delta(s().hoursOff, prev()?.hoursOff, formatHours, true)}
          />
          <Tile
            label="Outages"
            value={started() ? String(s().outages) : '—'}
            delta={s().plannedOutages === 0 ? delta(s().outages, prev()?.outages, String, true) : null}
            note={s().plannedOutages > 0 ? `${s().plannedOutages} planned` : undefined}
          />
          <Tile label="Days affected" value={started() ? `${s().daysWithOutage} of ${s().daysTracked}` : '—'} />
          <Tile
            label="Longest outage"
            value={
              s().outages === 0
                ? '—'
                : s().longestMinutes > 0
                  ? formatDuration(s().longestMinutes * MINUTE_MS)
                  : '< 1 min'
            }
            note={s().outages > 1 ? `Average ${formatDuration((s().hoursOff / s().outages) * HOUR_MS)}` : undefined}
          />
        </div>
        <Show
          when={props.stats.weeks.length > 0}
          fallback={<p class={css.chartEmpty}>The weekly chart fills in once tracking starts.</p>}
        >
          <WeeklyChart weeks={props.stats.weeks} />
        </Show>
      </div>
      <details class="gg-trends-details">
        <summary>{TRENDS_TABLE_LABEL}</summary>
        <table class={css.table}>
          <thead>
            <tr>
              <th class={css.th} scope="col">
                Week of
              </th>
              <th class={css.th} scope="col">
                Hours off
              </th>
              <th class={css.th} scope="col">
                Outages
              </th>
            </tr>
          </thead>
          <tbody>
            <For each={[...props.stats.weeks].reverse()}>
              {(w) => (
                <tr>
                  <td class={css.td}>{formatCalendarDay(w.weekStart)}</td>
                  <td class={css.td}>{formatHours(w.hoursOff)}</td>
                  <td class={css.td}>{w.outages}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <a class={css.download} href="/api/outages.csv" download="garsfontein-grid-outages.csv">
          <Download size={14} aria-hidden="true" /> Download the full record (CSV)
        </a>
      </details>
    </>
  );
};
