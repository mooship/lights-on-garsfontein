import Zap from 'lucide-solid/icons/zap';
import ZapOff from 'lucide-solid/icons/zap-off';
import { type Component, Show } from 'solid-js';
import { type AdminOutage, outageDurationMs } from '../../shared/api';
import { admin } from '../admin/copy';
import { formatClock, formatDay, formatTime } from '../lib/format';
import { button } from '../styles/ui.css';
import * as css from './PunchClock.css';

interface PunchClockProps {
  outage: AdminOutage | null;
  now: number;
  busy?: boolean;
  onPunchOut: () => void;
  onPunchIn: () => void;
}

export const PunchClock: Component<PunchClockProps> = (props) => {
  const elapsed = () => (props.outage ? outageDurationMs(props.outage, props.now) : 0);
  // A punch swaps one button for the other, which would drop keyboard focus to the page: the new
  // button takes it when the old one was pressed.
  let pressed = false;
  const press = (punch: () => void) => {
    if (props.busy) return;
    pressed = document.activeElement instanceof HTMLButtonElement;
    punch();
  };
  const focusIfPressed = (el: HTMLButtonElement) => {
    if (!pressed) return;
    pressed = false;
    queueMicrotask(() => el.focus());
  };

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
          <button
            ref={focusIfPressed}
            type="button"
            class={button.off}
            aria-disabled={props.busy}
            onClick={() => press(props.onPunchOut)}
          >
            <ZapOff size={18} aria-hidden="true" />
            {admin.punchOut}
          </button>
        }
      >
        <button
          ref={focusIfPressed}
          type="button"
          class={button.on}
          aria-disabled={props.busy}
          onClick={() => press(props.onPunchIn)}
        >
          <Zap size={18} aria-hidden="true" />
          {admin.punchIn}
        </button>
      </Show>
    </div>
  );
};
