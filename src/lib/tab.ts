import { type Accessor, createEffect, onCleanup } from 'solid-js';
import { MINUTE_MS as MINUTE, type StatusResponse } from '../../shared/api';
import { t } from './i18n';

/** Tab-friendly duration: "3d 4u", "1u 5m", "5m" ("h" in English). */
function compactDuration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / MINUTE));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const h = t().units.h;
  if (days > 0) return `${days}d ${hours}${h}`;
  if (hours > 0) return `${hours}${h} ${minutes % 60}m`;
  return `${minutes}m`;
}

/**
 * Puts the live status in the tab title and favicon so it reads from a background tab.
 * The state comes first because browsers truncate long titles from the end. `minute` ticks once
 * a minute: a title that changes every second is distracting.
 */
export function useStatusTab(status: Accessor<StatusResponse | undefined>, minute: Accessor<number>): void {
  // Only the SVG icon swaps; favicon.ico stays as the fallback for browsers without SVG support.
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]');
  const originalTitle = document.title;
  const originalIcon = icon?.href;

  createEffect(() => {
    const s = status();
    if (!s) return;
    const duration = s.status === 'OFF' && s.since ? ` ${compactDuration(minute() - Date.parse(s.since))}` : '';
    document.title = `${t().tab[s.status]}${duration} · Lights On?`;
    if (icon) icon.href = s.status === 'ON' ? '/favicon-on.svg' : '/favicon-off.svg';
  });

  onCleanup(() => {
    document.title = originalTitle;
    if (icon && originalIcon) icon.href = originalIcon;
  });
}
