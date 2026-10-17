import { DAY_MS } from '../../shared/api';

const TIME_ZONE = 'Africa/Johannesburg';

/** Builds a formatter on first use: time-zone formatters are costly to create on slow phones. */
function lazyFormat(options: Intl.DateTimeFormatOptions): (date: Date) => string {
  let formatter: Intl.DateTimeFormat | undefined;
  return (date) => {
    formatter ??= new Intl.DateTimeFormat('en-ZA', options);
    return formatter.format(date);
  };
}

const dayFormat = lazyFormat({ timeZone: TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short' });
const timeFormat = lazyFormat({ timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dateFormat = lazyFormat({ timeZone: TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' });
const shortDateFormat = lazyFormat({ timeZone: 'UTC', day: 'numeric', month: 'short' });

export const formatDay = (iso: string) => dayFormat(new Date(iso));
/** "17 Oct 2026" */
export const formatDate = (iso: string) => dateFormat(new Date(iso));
/** Formats a plain YYYY-MM-DD calendar date as "19 Oct". */
export const formatCalendarDay = (ymd: string) => shortDateFormat(new Date(`${ymd}T00:00:00Z`));

/** "12.5 h" with one decimal below 100 hours. */
export function formatHours(hours: number): string {
  return `${hours >= 100 ? Math.round(hours) : Math.round(hours * 10) / 10} h`;
}
export const formatTime = (iso: string) => timeFormat(new Date(iso));

const sastDay = lazyFormat({ timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** "today", "yesterday" or "Sat, 17 Oct", judged in South African time. */
export function formatRelativeDay(iso: string, now: number): string {
  const day = sastDay(new Date(iso));
  if (day === sastDay(new Date(now))) return 'today';
  if (day === sastDay(new Date(now - DAY_MS))) return 'yesterday';
  return formatDay(iso);
}

/** "3 d 4 h", "2 h 14 min", "5 min", "40 s" */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min`;
  return `${totalSeconds} s`;
}

/** How long an outage lasted; one still in progress runs until `now`. */
export function outageDurationMs(outage: { startTime: string; endTime: string | null }, now: number): number {
  return (outage.endTime ? Date.parse(outage.endTime) : now) - Date.parse(outage.startTime);
}

/** "01:02:03" stopwatch format. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor((totalSeconds % 3600) / 60))}:${pad(totalSeconds % 60)}`;
}

/** Converts an ISO string to the value a datetime-local input expects (browser time zone). */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
