import Zap from 'lucide-solid/icons/zap';
import ZapOff from 'lucide-solid/icons/zap-off';
import { type Component, Show } from 'solid-js';
import { type AdminOutage, outageDurationMs } from '../../shared/api';
import { admin } from '../admin/copy';
import { formatClock, formatDay, formatTime } from '../lib/format';
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

export const PunchClock: Component<PunchClockProps> = (props) => {
  const elapsed = () => (props.outage ? outageDurationMs(props.outage, props.now) : 0);

  return (
    <div class={css.root}>
      <div>
        <span class="gg-sr-only">{admin.duration}</span>
        <div class={`${css.clock} ${props.outage ? css.running : css.idle}`} role="timer" data-testid="punch-clock">
          {formatClock(elapsed())}
        </div>
        <p class={css.meta}>
          {props.outage
            ? admin.offSince(
                formatDay(props.outage.startTime),
                formatTime(props.outage.startTime),
                admin.source[props.outage.source],
              )
            : admin.idle}
        </p>
      </div>
      <Show
        when={props.outage}
        fallback={
          <button type="button" class={button.off} disabled={props.busy} onClick={props.onPunchOut}>
            <ZapOff size={18} aria-hidden="true" />
            {admin.punchOut}
          </button>
        }
      >
        <button type="button" class={button.on} disabled={props.busy} onClick={props.onPunchIn}>
          <Zap size={18} aria-hidden="true" />
          {admin.punchIn}
        </button>
      </Show>
    </div>
  );
};
