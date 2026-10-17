const TIME_ZONE = 'Africa/Johannesburg';

const dayFormat = new Intl.DateTimeFormat('en-ZA', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const timeFormat = new Intl.DateTimeFormat('en-ZA', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const dateFormat = new Intl.DateTimeFormat('en-ZA', {
  timeZone: TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const shortDateFormat = new Intl.DateTimeFormat('en-ZA', { timeZone: 'UTC', day: 'numeric', month: 'short' });

export const formatDay = (iso: string) => dayFormat.format(new Date(iso));
/** "18 Oct 2026" */
export const formatDate = (iso: string) => dateFormat.format(new Date(iso));
/** Formats a plain YYYY-MM-DD calendar date as "19 Oct". */
export const formatCalendarDay = (ymd: string) => shortDateFormat.format(new Date(`${ymd}T00:00:00Z`));

/** "12.5 h" with one decimal below 100 hours. */
export function formatHours(hours: number): string {
  return `${hours >= 100 ? Math.round(hours) : Math.round(hours * 10) / 10} h`;
}
export const formatTime = (iso: string) => timeFormat.format(new Date(iso));

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
