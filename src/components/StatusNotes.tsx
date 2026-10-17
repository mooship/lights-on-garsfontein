import type { Component } from 'solid-js';
import { site } from '../../site.config';
import { t } from '../lib/i18n';

// Static rows of the status card, the same in every state. index.html renders them too (zero layout
// shift), from the same dictionaries and site.config.ts values.

/** Where the status is measured, and why a street can differ. */
export const Scope: Component = () => (
  <div>
    <p class="gg-scope">{t().scope.measured(site.landmark)}</p>
    <details class="gg-why">
      <summary>{t().scope.why}</summary>
      <p class="gg-scope">{t().scope.whyText}</p>
    </details>
  </div>
);

export const SafetyLine: Component = () => (
  <p class="gg-safety">
    {t().safety.live} <a href={site.faultReporting.url}>{t().safety.report}</a>.
  </p>
);
