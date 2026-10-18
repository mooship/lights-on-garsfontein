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
  /** When the current state began: for ON, when the last outage ended; null with none on record. */
  since: string | null;
  /** Current time in ms, injected so the duration ticks. */
  now: number;
}

/** ON, OFF, or NONE: ON without a live reading, shown in a neutral tone and without a duration. */
type BadgeState = PowerStatus | 'NONE';

export const badgeState = (status: PowerStatus, monitored: boolean): BadgeState =>
  status === 'ON' && !monitored ? 'NONE' : status;

export const StatusBadge: Component<StatusBadgeProps> = (props) => {
  const state = () => badgeState(props.status, props.monitored);
  // Without a live reading nothing measured how long the power has been on; the status detail below
  // already describes the last outage.
  const detail = () => {
    const since = props.since;
    if (!since || state() === 'NONE') return ' ';
    return t().status.for(formatDuration(props.now - Date.parse(since)));
  };

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
        <p class={`${css.headline} ${css.tone[state()]}`} role="status">
          {t().status[state()]}
        </p>
        <p class={css.detail} data-testid="badge-detail">
          {detail()}
        </p>
      </div>
    </div>
  );
};
