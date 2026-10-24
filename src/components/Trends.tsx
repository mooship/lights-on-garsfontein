import Download from 'lucide-solid/icons/download';
import Minus from 'lucide-solid/icons/minus';
import TrendingDown from 'lucide-solid/icons/trending-down';
import TrendingUp from 'lucide-solid/icons/trending-up';
import {
  type Component,
  createMemo,
  createSignal,
  For,
  Index,
  type JSX,
  onCleanup,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { CSV_FILE_NAME, localDate, MINUTE_MS, type StatsResponse, type WeekStats } from '../../shared/api';
import { CSV_PATH } from '../../shared/paths';
import { formatCalendarDay, formatDate, formatDuration, formatHours, formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { pad2 } from '../lib/zone';
import * as motion from '../styles/motion.css';
import * as css from './Trends.css';

const { AXIS_WIDTH } = css;

/** A tile duration like the history's ("5 u 23 min"); none at all reads "0 min". */
const tileDuration = (minutes: number) => (minutes > 0 ? formatDuration(minutes * MINUTE_MS) : `0 ${t().units.min}`);
/** One outage's length: it happened, so under half a minute reads as less than one, never zero. */
const outageDuration = (minutes: number) =>
  minutes > 0 ? formatDuration(minutes * MINUTE_MS) : `< 1 ${t().units.min}`;

// Durations use `minutesOff`, to the minute like `longestMinutes`: `hoursOff` is rounded to 6 minutes, so
// one outage could disagree with itself. The charts use `hoursOff`, which they plot in hours.

/** Off time counts only inside a counted outage, so this also covers every week with time off. */
const hadOutage = (w: WeekStats) => w.outages > 0;

/** The numbers in a duration at full size and its units smaller, so "12 u 34 min" fits a phone tile. */
const DurationValue: Component<{ text: string }> = (props) => (
  <For each={props.text.split(/(\d+)/).filter(Boolean)}>
    {(part) => (/^\d+$/.test(part) ? part : <span class={css.unit}>{part}</span>)}
  </For>
);

interface TrendsProps {
  stats: StatsResponse;
  now: number;
}

interface Delta {
  text: string;
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
  if (diff === 0) return { text: t().trends.same, tone: 'same', direction: 'flat' };
  const up = diff > 0;
  return {
    text: t().trends.change(up ? '+' : '−', format(Math.abs(diff))),
    tone: up === upIsBad ? 'worse' : 'better',
    direction: up ? 'up' : 'down',
  };
}

const Tile: Component<{ label: string; value: JSX.Element; delta?: Delta | null; note?: JSX.Element }> = (props) => (
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

/** Where a week sits: the last one is still running; the first may start before the records. */
interface WeekPlace {
  current: boolean;
  /** The day records began, when that is after this week's Monday. */
  from: string | null;
}

/** " (vanaf 17 Okt.)" for a partial first week, else " (tot dusver)" for the current one. */
function weekNote(place: WeekPlace) {
  const m = t().trends;
  return place.from ? m.partial(formatCalendarDay(place.from)) : place.current ? m.soFar : '';
}

/** A bar's readout in parts, so the visible line can emphasise the value. */
interface ReadoutParts {
  lead: string;
  value: string;
  rest: string;
}

const readoutText = (p: ReadoutParts) => `${p.lead}: ${p.value} ${p.rest}`;

function weekReadout(w: WeekStats, place: WeekPlace): ReadoutParts {
  const m = t().trends;
  return {
    lead: m.weekOf(formatCalendarDay(w.weekStart)),
    value: tileDuration(w.minutesOff),
    rest: `${m.off} · ${m.outageCount(w.outages)}${weekNote(place)}`,
  };
}

const hourLabel = (hour: number) => `${pad2(hour % 24)}:00`;
/** "18:00–19:00" for the hour starting at `hour`. */
const hourRange = (hour: number) => `${hourLabel(hour)}–${hourLabel(hour + 1)}`;

/** The hour with the most minutes off, the earliest of any tie; -1 when no hour had any. */
const peakHour = (minutes: number[]) => {
  const most = Math.max(0, ...minutes);
  return most > 0 ? minutes.indexOf(most) : -1;
};

const CHART_HEIGHT = 144;
const TOP_PAD = 6;

interface BarChartProps {
  title: string;
  /** The chart's accessible name, which says how to move between bars. */
  label: string;
  /** Each bar's height in hours, and its readout. */
  bars: { hours: number; readout: ReadoutParts }[];
  /** The bar the readout starts on; -1 starts on none and shows `empty` instead. */
  initial: number;
  /** Under the first and the last bar. */
  xLabels: [string, string];
  empty?: string;
}

const BarChart: Component<BarChartProps> = (props) => {
  let svg!: SVGSVGElement;
  const [width, setWidth] = createSignal(320);
  // Read once: the readout starts on this bar, and moving away from it is up to the reader.
  const [active, setActive] = createSignal(untrack(() => props.initial));

  onMount(() => {
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(svg);
    onCleanup(() => observer.disconnect());
  });

  const max = createMemo(() => niceMax(Math.max(1, ...props.bars.map((b) => b.hours))));
  const geometry = createMemo(() => {
    const plot = Math.max(1, width() - AXIS_WIDTH);
    const slot = plot / Math.max(1, props.bars.length);
    const barWidth = Math.max(2, Math.min(24, slot - 2, slot * 0.7));
    return { slot, barWidth };
  });
  const y = (hours: number) => TOP_PAD + (CHART_HEIGHT - TOP_PAD) * (1 - hours / max());
  // Clamped so a refresh with fewer bars never points past the end.
  const activeIndex = createMemo(() => Math.min(active(), props.bars.length - 1));
  const parts = () => props.bars[activeIndex()]?.readout;
  // Announced only on keyboard moves; pointer moves would flood a screen reader.
  const [announcement, setAnnouncement] = createSignal('');

  const onKey: JSX.EventHandler<SVGSVGElement, KeyboardEvent> = (event) => {
    const last = props.bars.length - 1;
    if (event.key === 'ArrowLeft') setActive((i) => Math.max(0, Math.min(last, i) - 1));
    else if (event.key === 'ArrowRight') setActive((i) => Math.min(last, i + 1));
    else if (event.key === 'Home') setActive(0);
    else if (event.key === 'End') setActive(last);
    else return;
    event.preventDefault();
    const p = parts();
    if (p) setAnnouncement(readoutText(p));
  };

  // The whole column slot is the hit target, not just the painted bar.
  const onPointer: JSX.EventHandler<SVGSVGElement, PointerEvent> = (event) => {
    const x = event.clientX - svg.getBoundingClientRect().left - AXIS_WIDTH;
    if (x < 0) return;
    setActive(Math.min(props.bars.length - 1, Math.floor(x / geometry().slot)));
  };

  return (
    <div class={`${css.chartBlock} ${motion.enter}`}>
      <h3 class={css.chartTitle}>{props.title}</h3>
      <p class={css.readout}>
        <Show when={parts()} fallback={props.empty}>
          {(p) => (
            <>
              {p().lead}: <span class={css.readoutValue}>{p().value}</span> {p().rest}
            </>
          )}
        </Show>
      </p>
      <p class="gg-sr-only" aria-live="polite">
        {announcement()}
      </p>
      <svg
        ref={svg}
        class={css.svg}
        role="img"
        aria-label={props.label}
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
                {tick === 0 ? '0' : `${formatNumber(tick)}${t().units.h}`}
              </text>
            </>
          )}
        </For>
        {/* By position, so a refresh updates the bars in place rather than growing them again. */}
        <Index each={props.bars}>
          {(bar, index) => {
            const x = () => AXIS_WIDTH + index * geometry().slot;
            const barX = () => x() + (geometry().slot - geometry().barWidth) / 2;
            const top = () => y(bar().hours);
            const height = () => CHART_HEIGHT - top();
            return (
              <g
                class={css.barGroup}
                style={{ [css.BAR_INDEX]: index }}
                data-active={activeIndex() === index ? '' : undefined}
              >
                <Show when={bar().hours > 0}>
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
                <Show when={activeIndex() === index}>
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
        </Index>
      </svg>
      <div class={css.xLabels}>
        <span>{props.xLabels[0]}</span>
        <span>{props.xLabels[1]}</span>
      </div>
    </div>
  );
};

export const Trends: Component<TrendsProps> = (props) => {
  const since = () => Date.parse(props.stats.trackingSince);
  const started = () => props.now >= since();
  const s = () => props.stats.last30;
  // The day records began, in the same form as WeekStats.weekStart.
  const firstDay = () => localDate(since());
  const place = (index: number): WeekPlace => {
    const week = props.stats.weeks[index];
    return {
      current: index === props.stats.weeks.length - 1,
      from: index === 0 && week && week.weekStart < firstDay() ? firstDay() : null,
    };
  };
  const anyOutage = () => props.stats.weeks.some(hadOutage);
  // Memos: the charts read their bars on every pointer move, and each readout formats dates.
  const weekBars = createMemo(() =>
    props.stats.weeks.map((w, i) => ({ hours: w.hoursOff, readout: weekReadout(w, place(i)) })),
  );
  const hourBars = createMemo(() =>
    props.stats.last30ByHour.map((minutes, hour) => ({
      hours: minutes / 60,
      readout: { lead: hourRange(hour), value: tileDuration(minutes), rest: t().trends.off },
    })),
  );
  const fullWindow = () => s().trackedHours >= 30 * 24;
  const byHourTitle = () => t().trends.byHourTitle(fullWindow() ? null : formatCalendarDay(firstDay()), s().outages);
  const subtitle = () => {
    if (!started()) return t().trends.startsOn(formatDate(props.stats.trackingSince));
    const period = fullWindow() ? t().trends.last30 : t().trends.since(formatDate(props.stats.trackingSince));
    const coverage = s().coverage;
    // From whole ten-thousandths, as the API rounds them: 0.57 * 100 alone is 56.99999999999999.
    return coverage === null
      ? period
      : `${period} ${t().trends.measured(Math.floor(Math.round(coverage * 10_000) / 100))}`;
  };

  return (
    <>
      <div class="gg-trends-body">
        <h2 id="trends-heading" class="gg-card-title">
          {t().trends.title}
        </h2>
        <p class={`${css.subtitle} ${motion.enter}`}>{subtitle()}</p>
        <div class={`${css.tiles} ${motion.enter}`}>
          <Tile
            label={t().trends.withoutPower}
            value={started() ? <DurationValue text={tileDuration(s().minutesOff)} /> : '—'}
            delta={delta(s().minutesOff, props.stats.previous30?.minutesOff, tileDuration, true)}
          />
          <Tile
            label={t().trends.outages}
            value={started() ? String(s().outages) : '—'}
            delta={s().plannedOutages === 0 ? delta(s().outages, props.stats.previous30?.outages, String, true) : null}
            note={
              s().plannedOutages > 0 ? (
                <span class={css.plannedNote}>{t().trends.planned(s().plannedOutages)}</span>
              ) : undefined
            }
          />
          <Tile
            label={t().trends.daysAffected}
            value={started() ? t().trends.daysOf(s().daysWithOutage, s().daysTracked) : '—'}
          />
          <Tile
            label={t().trends.longest}
            value={s().outages === 0 ? '—' : <DurationValue text={outageDuration(s().longestMinutes)} />}
            note={s().outages > 1 ? t().trends.typically(outageDuration(s().medianMinutes ?? 0)) : undefined}
          />
        </div>
        <Show when={anyOutage()} fallback={<p class={`${css.chartEmpty} ${motion.enter}`}>{t().trends.chartEmpty}</p>}>
          <BarChart
            title={t().trends.chartTitle}
            label={t().trends.chartLabel}
            bars={weekBars()}
            initial={props.stats.weeks.findLastIndex(hadOutage)}
            xLabels={[
              props.stats.weeks.length > 1 && props.stats.weeks[0]
                ? formatCalendarDay(place(0).from ?? props.stats.weeks[0].weekStart)
                : '',
              t().trends.thisWeek,
            ]}
          />
          <BarChart
            title={byHourTitle()}
            label={t().trends.byHourLabel}
            bars={hourBars()}
            initial={peakHour(props.stats.last30ByHour)}
            xLabels={[hourLabel(0), hourLabel(23)]}
            empty={t().trends.byHourEmpty}
          />
        </Show>
      </div>
      <details class="gg-trends-details">
        <summary>{t().trends.tableLabel}</summary>
        <table class={css.table}>
          <caption class={css.caption}>{t().trends.chartTitle}</caption>
          <thead>
            <tr>
              <th class={css.th} scope="col">
                {t().trends.weekCol}
              </th>
              <th class={css.th} scope="col">
                {t().trends.hoursCol}
              </th>
              <th class={css.th} scope="col">
                {t().trends.outagesCol}
              </th>
            </tr>
          </thead>
          <tbody>
            {/* By position, so a refresh with the same figures leaves the rows as they are. */}
            <Index each={props.stats.weeks.map((w, i) => ({ w, note: weekNote(place(i)) })).reverse()}>
              {(row) => (
                <tr>
                  <td class={css.td}>
                    {formatCalendarDay(row().w.weekStart)}
                    {row().note}
                  </td>
                  <td class={css.td}>{formatHours(row().w.hoursOff)}</td>
                  <td class={css.td}>{row().w.outages}</td>
                </tr>
              )}
            </Index>
          </tbody>
        </table>
        {/* The time-of-day chart's figures, which its readout gives only one hour at a time. */}
        <Show when={peakHour(props.stats.last30ByHour) >= 0}>
          <table class={css.table}>
            <caption class={css.caption}>{byHourTitle()}</caption>
            <thead>
              <tr>
                <th class={css.th} scope="col">
                  {t().trends.hourCol}
                </th>
                <th class={css.th} scope="col">
                  {t().trends.withoutPower}
                </th>
              </tr>
            </thead>
            <tbody>
              <Index each={props.stats.last30ByHour}>
                {(minutes, hour) => (
                  <tr>
                    <td class={css.td}>{hourRange(hour)}</td>
                    <td class={css.td}>{tileDuration(minutes())}</td>
                  </tr>
                )}
              </Index>
            </tbody>
          </table>
        </Show>
        <a class={css.download} href={CSV_PATH} download={CSV_FILE_NAME}>
          <Download size={14} aria-hidden="true" /> {t().trends.download}
        </a>
      </details>
      <HowWeMeasure />
    </>
  );
};

/** How the figures are measured; shown even when they fail to load. */
export const HowWeMeasure: Component = () => (
  <details class="gg-trends-details">
    <summary>{t().trends.howTitle}</summary>
    <ul>
      <For each={t().trends.how}>{(point) => <li>{point}</li>}</For>
    </ul>
  </details>
);
