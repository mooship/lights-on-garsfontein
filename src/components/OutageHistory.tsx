import { type Component, For, Show } from 'solid-js';
import type { OutageSummary } from '../../shared/api';
import { formatDay, formatDuration, formatTime } from '../lib/format';
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
          const end = () => (outage.endTime ? Date.parse(outage.endTime) : props.now);
          return (
            <li class={css.row}>
              <div>
                <div class={css.primary}>{formatDay(outage.startTime)}</div>
                <div class={css.secondary}>
                  {formatTime(outage.startTime)} – {outage.endTime ? formatTime(outage.endTime) : 'now'}
                </div>
              </div>
              <div class={css.end}>
                <div class={outage.endTime ? css.primary : `${css.primary} ${css.ongoing}`}>
                  {formatDuration(end() - Date.parse(outage.startTime))}
                </div>
                <div class={css.secondary}>
                  {outage.source === 'sensor' ? 'Sensor' : 'Logged'}
                  {outage.confirmations > 0 ? ` · ${outage.confirmations} confirmed` : ''}
                </div>
              </div>
            </li>
          );
        }}
      </For>
    </ul>
  </Show>
);
