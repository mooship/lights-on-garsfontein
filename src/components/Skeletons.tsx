import { type Component, For } from 'solid-js';

// Loading placeholders. index.html renders the same markup statically before any
// JavaScript runs, so keep the two in step: identical boxes mean zero layout shift.

export const STATUS_NOTE = 'If the power goes off, you can report it here so neighbours know it’s not just them.';
export const TRENDS_TITLE = 'By the numbers';
export const TRENDS_TABLE_LABEL = 'Show the weekly numbers';

export const StatusSkeleton: Component = () => (
  <>
    <p class="gg-sr-only">Loading the current status…</p>
    <div class="gg-skel-row" aria-hidden="true">
      <span class="gg-skel gg-skel-badge" />
      <span class="gg-skel-stack">
        <span class="gg-skel gg-skel-heading gg-w-60" />
        <span class="gg-skel gg-skel-text gg-w-30" />
      </span>
    </div>
    <div class="gg-status-detail" aria-hidden="true">
      <span class="gg-skel gg-skel-text gg-w-80" />
    </div>
    <p class="gg-status-note">{STATUS_NOTE}</p>
  </>
);

/** The whole trends card frame (same heading, id and details as Trends) with placeholder content. */
export const TrendsCardSkeleton: Component = () => (
  <>
    <div class="gg-trends-body">
      <h2 id="trends-heading" class="gg-card-title">
        {TRENDS_TITLE}
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
      <summary>{TRENDS_TABLE_LABEL}</summary>
    </details>
  </>
);

export const HistorySkeleton: Component = () => (
  <div class="gg-skel-list" aria-hidden="true">
    <For each={[1, 2, 3, 4, 5]}>{() => <span class="gg-skel gg-skel-item" />}</For>
  </div>
);
