import clsx from 'clsx';
import Zap from 'lucide-solid/icons/zap';
import ZapOff from 'lucide-solid/icons/zap-off';
import { type Component, Show } from 'solid-js';
import type { AdminOutage } from '../../shared/api';
import { formatClock, formatDay, formatTime, outageDurationMs } from '../lib/format';
import { t } from '../lib/i18n';
import { button } from '../styles/ui.css';
import * as css from './PunchClock.css';

interface PunchClockProps {
  /** The currently open outage, if any. */
  outage: AdminOutage | null;
  now: number;
  busy?: boolean;
  onPunchOut: () => void;
  onPunchIn: () => void;
}

/** Admin punch clock: punch out when the power goes off, punch in when it is back. */
export const PunchClock: Component<PunchClockProps> = (props) => {
  const elapsed = () => (props.outage ? outageDurationMs(props.outage, props.now) : 0);

  return (
    <div class={css.root}>
      <div>
        <span class="gg-sr-only">{t().admin.duration}</span>
        <div class={clsx(css.clock, props.outage ? css.running : css.idle)} role="timer" data-testid="punch-clock">
          {formatClock(elapsed())}
        </div>
        <p class={css.meta}>
          {props.outage
            ? t().admin.offSince(
                formatDay(props.outage.startTime),
                formatTime(props.outage.startTime),
                t().admin.source[props.outage.source],
              )
            : t().admin.idle}
        </p>
      </div>
      {/* Only the action that applies now, full width. */}
      <Show
        when={props.outage}
        fallback={
          <button type="button" class={button.off} disabled={props.busy} onClick={props.onPunchOut}>
            <ZapOff size={18} aria-hidden="true" />
            {t().admin.punchOut}
          </button>
        }
      >
        <button type="button" class={button.on} disabled={props.busy} onClick={props.onPunchIn}>
          <Zap size={18} aria-hidden="true" />
          {t().admin.punchIn}
        </button>
      </Show>
    </div>
  );
};
