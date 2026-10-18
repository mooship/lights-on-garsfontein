import { type Component, For, Show } from 'solid-js';
import { type OutageSummary, outageDurationMs } from '../../shared/api';
import { formatDay, formatDuration, formatTime } from '../lib/format';
import { t } from '../lib/i18n';
import { plainList } from '../styles/ui.css';
import * as css from './OutageHistory.css';

interface OutageHistoryProps {
  outages: OutageSummary[];
  now: number;
}

export const OutageHistory: Component<OutageHistoryProps> = (props) => (
  <Show when={props.outages.length > 0} fallback={<p class={css.empty}>{t().history.empty}</p>}>
    <ul class={plainList}>
      <For each={props.outages}>
        {(outage) => (
          <li class={css.row}>
            <div>
              <div class={css.primary}>{formatDay(outage.startTime)}</div>
              <div class={css.secondary}>
                {t().history.range(
                  formatTime(outage.startTime),
                  outage.endTime ? formatTime(outage.endTime) : t().history.now,
                )}
              </div>
            </div>
            <div class={css.end}>
              <div class={css.primary} classList={{ [css.ongoing]: !outage.endTime }}>
                {formatDuration(outageDurationMs(outage, props.now))}
              </div>
              <div class={css.secondary}>
                {[outage.endTime ? '' : t().history.ongoing, outage.planned ? t().history.planned : '']
                  .filter(Boolean)
                  .join(' · ') || ' '}
              </div>
            </div>
          </li>
        )}
      </For>
    </ul>
  </Show>
);
