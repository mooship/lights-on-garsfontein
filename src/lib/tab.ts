import { type Accessor, createEffect, onCleanup } from 'solid-js';
import { badgeState, type StatusResponse } from '../../shared/api';
import { FAVICON_OFF_PATH, FAVICON_ON_PATH } from '../../shared/paths';
import { site } from '../../site.config';
import { formatCompactDuration } from './format';
import { t } from './i18n';

/**
 * Puts the live status in the tab title and favicon so it reads from a background tab.
 * The state comes first because browsers truncate long titles from the end. `minute` ticks once
 * a minute: a title that changes every second is distracting. Without a live reading (ON, not
 * monitored) the tab claims nothing: the brand name and the plain icon.
 */
export function useStatusTab(status: Accessor<StatusResponse | undefined>, minute: Accessor<number>): void {
  // Only the SVG icon swaps; favicon.ico stays as the fallback for browsers without SVG support.
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]');
  const originalTitle = document.title;
  const originalIcon = icon?.getAttribute('href');

  createEffect(() => {
    const s = status();
    if (!s) return;
    if (badgeState(s.status, s.monitored) === 'NONE') {
      document.title = site.brand.full;
      if (icon && originalIcon) icon.href = originalIcon;
      return;
    }
    const duration = s.status === 'OFF' && s.since ? ` ${formatCompactDuration(minute() - Date.parse(s.since))}` : '';
    document.title = `${t().tab[s.status]}${duration} · ${site.brand.short}`;
    if (icon) icon.href = s.status === 'ON' ? FAVICON_ON_PATH : FAVICON_OFF_PATH;
  });

  onCleanup(() => {
    document.title = originalTitle;
    if (icon && originalIcon) icon.href = originalIcon;
  });
}
