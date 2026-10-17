import clsx from 'clsx';
import Zap from 'lucide-solid/icons/zap';
import ZapOff from 'lucide-solid/icons/zap-off';
import { type Component, Show } from 'solid-js';
import type { PowerStatus } from '../../shared/api';
import { formatDuration } from '../lib/format';
import { t } from '../lib/i18n';
import * as css from './StatusBadge.css';

interface StatusBadgeProps {
  status: PowerStatus;
  /** A live reading backs the status. ON without one only means no outage was reported. */
  monitored: boolean;
  since: string | null;
  /** Current time in ms, injected so the duration ticks. */
  now: number;
}

/** ON, OFF, or NONE: ON without a live reading, shown in a neutral tone and without a duration. */
export type BadgeState = PowerStatus | 'NONE';

export const badgeState = (status: PowerStatus, monitored: boolean): BadgeState =>
  status === 'ON' && !monitored ? 'NONE' : status;

export const StatusBadge: Component<StatusBadgeProps> = (props) => {
  const state = () => badgeState(props.status, props.monitored);
  // Without a live reading nothing measured how long the power has been on.
  const duration = () =>
    state() !== 'NONE' && props.since ? formatDuration(props.now - Date.parse(props.since)) : null;

  return (
    <div class={css.root} data-status={state()}>
      <div class={css.icon[state()]} aria-hidden="true">
        <Show when={props.status === 'ON'} fallback={<ZapOff size={30} stroke-width={2.25} />}>
          <Zap size={30} stroke-width={2.25} />
        </Show>
        {/* Motion only for an outage. */}
        <Show when={props.status === 'OFF'}>
          <span class={css.ring} />
        </Show>
      </div>
      <div>
        {/* Only the headline is live, so the ticking duration is never re-announced. */}
        <p class={clsx(css.headline, css.tone[state()])} role="status">
          {t().status[state()]}
        </p>
        <p class={css.detail}>
          <Show when={duration()} fallback={state() === 'NONE' ? t().status.noLiveReading : ' '}>
            {(d) => t().status.for(d())}
          </Show>
        </p>
      </div>
    </div>
  );
};
