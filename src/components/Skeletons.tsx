import { type Component, For } from 'solid-js';
import { t } from '../lib/i18n';

// Loading placeholders. index.html renders the same markup statically before any
// JavaScript runs, so keep the two in step (text in both languages too): identical boxes
// mean zero layout shift.

export const StatusSkeleton: Component = () => (
  <>
    <p class="gg-sr-only">{t().status.loading}</p>
    <div class="gg-skel-row" aria-hidden="true">
      <span class="gg-skel gg-skel-badge" />
      <span class="gg-skel-stack">
        <span class="gg-skel gg-skel-heading gg-w-60" />
        <span class="gg-skel gg-skel-text gg-w-30" />
      </span>
    </div>
    <div class="gg-status-detail" aria-hidden="true">
      <span class="gg-skel gg-skel-text gg-w-80" />
      <span class="gg-skel gg-skel-text gg-w-30" />
    </div>
  </>
);

/** The whole trends card frame (same heading, id and details as Trends) with placeholder content. */
export const TrendsCardSkeleton: Component = () => (
  <>
    <div class="gg-trends-body">
      <h2 id="trends-heading" class="gg-card-title">
        {t().trends.title}
      </h2>
      <div class="gg-skel-stack" aria-hidden="true">
        <span class="gg-skel gg-skel-text gg-w-45" />
        <div class="gg-skel-grid">
          <For each={[1, 2, 3, 4]}>{() => <span class="gg-skel gg-skel-tile" />}</For>
        </div>
        <span class="gg-skel gg-skel-chart" />
      </div>
    </div>
    <details class="gg-trends-details">
      <summary>{t().trends.tableLabel}</summary>
    </details>
  </>
);

export const HistorySkeleton: Component = () => (
  <div class="gg-skel-list" aria-hidden="true">
    <For each={[1, 2, 3, 4, 5]}>{() => <span class="gg-skel gg-skel-item" />}</For>
  </div>
);
