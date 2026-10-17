import clsx from 'clsx';
import Zap from 'lucide-solid/icons/zap';
import ZapOff from 'lucide-solid/icons/zap-off';
import { type Component, Show } from 'solid-js';
import type { PowerStatus } from '../../shared/api';
import { formatDuration } from '../lib/format';
import * as css from './StatusBadge.css';

interface StatusBadgeProps {
  status: PowerStatus;
  since: string | null;
  /** Current time in ms, injected so the duration ticks. */
  now: number;
}

const HEADLINES: Record<PowerStatus, string> = {
  ON: 'Power is on',
  OFF: 'Power is off',
};

export const StatusBadge: Component<StatusBadgeProps> = (props) => {
  const duration = () => (props.since ? formatDuration(props.now - Date.parse(props.since)) : null);

  return (
    <div class={css.root} data-status={props.status}>
      <div class={css.icon[props.status]} aria-hidden="true">
        <Show when={props.status === 'ON'} fallback={<ZapOff size={30} stroke-width={2.25} />}>
          <Zap size={30} stroke-width={2.25} />
        </Show>
        <span class={css.ring} />
      </div>
      <div>
        {/* Only the headline is live, so the ticking duration is never re-announced. */}
        <p class={clsx(css.headline, css.tone[props.status])} role="status">
          {HEADLINES[props.status]}
        </p>
        <p class={css.detail}>
          <Show when={duration()} fallback={' '}>
            {(d) => <>for {d()}</>}
          </Show>
        </p>
      </div>
    </div>
  );
};
