import clsx from 'clsx';
import Zap from 'lucide-solid/icons/zap';
import ZapOff from 'lucide-solid/icons/zap-off';
import type { Component } from 'solid-js';
import type { AdminOutage } from '../../shared/api';
import { formatClock, formatDay, formatTime } from '../lib/format';
import { button } from '../styles/ui.css';
import * as css from './PunchClock.css';

export interface PunchClockProps {
  /** The currently open outage, if any. */
  outage: AdminOutage | null;
  now: number;
  busy?: boolean;
  onPunchOut: () => void;
  onPunchIn: () => void;
}

/** Admin punch clock: punch out when the power goes off, punch in when it is back. */
export const PunchClock: Component<PunchClockProps> = (props) => {
  const elapsed = () => (props.outage ? props.now - Date.parse(props.outage.startTime) : 0);

  return (
    <div class={css.root}>
      <div>
        <div
          class={clsx(css.clock, props.outage ? css.running : css.idle)}
          role="timer"
          aria-label={props.outage ? 'Outage duration' : 'No outage running'}
          data-testid="punch-clock"
        >
          {formatClock(elapsed())}
        </div>
        <p class={css.meta}>
          {props.outage
            ? `Off since ${formatDay(props.outage.startTime)}, ${formatTime(props.outage.startTime)} (${props.outage.source})`
            : 'No outage running.'}
        </p>
      </div>
      <div class={css.actions}>
        <button
          type="button"
          class={button.off}
          disabled={props.busy || props.outage !== null}
          onClick={() => props.onPunchOut()}
        >
          <ZapOff size={18} aria-hidden="true" />
          Punch out
        </button>
        <button
          type="button"
          class={button.on}
          disabled={props.busy || props.outage === null}
          onClick={() => props.onPunchIn()}
        >
          <Zap size={18} aria-hidden="true" />
          Punch in
        </button>
      </div>
    </div>
  );
};
