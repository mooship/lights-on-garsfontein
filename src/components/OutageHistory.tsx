import { type Component, For, Show } from 'solid-js';
import type { OutageSummary } from '../../shared/api';
import { formatDay, formatDuration, formatTime, outageDurationMs } from '../lib/format';
import * as css from './OutageHistory.css';

export interface OutageHistoryProps {
  outages: OutageSummary[];
  now: number;
}

export const OutageHistory: Component<OutageHistoryProps> = (props) => (
  <Show when={props.outages.length > 0} fallback={<p class={css.empty}>No outages recorded yet.</p>}>
    <ul class={css.list}>
      <For each={props.outages}>
        {(outage) => {
          return (
            <li class={css.row}>
              <div>
                <div class={css.primary}>{formatDay(outage.startTime)}</div>
                <div class={css.secondary}>
                  {formatTime(outage.startTime)} to {outage.endTime ? formatTime(outage.endTime) : 'now'}
                </div>
              </div>
              <div class={css.end}>
                <div class={outage.endTime ? css.primary : `${css.primary} ${css.ongoing}`}>
                  {formatDuration(outageDurationMs(outage, props.now))}
                </div>
                <div class={css.secondary}>
                  {[
                    outage.endTime ? '' : 'Ongoing',
                    outage.planned ? 'Planned work' : '',
                    outage.confirmations ? `${outage.confirmations} confirmed` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ') || ' '}
                </div>
              </div>
            </li>
          );
        }}
      </For>
    </ul>
  </Show>
);
