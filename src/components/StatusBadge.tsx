import CalendarClock from 'lucide-solid/icons/calendar-clock';
import Zap from 'lucide-solid/icons/zap';
import ZapOff from 'lucide-solid/icons/zap-off';
import { type Component, Match, onMount, Show, Switch } from 'solid-js';
import type { PowerStatus } from '../../shared/api';
import { formatDuration } from '../lib/format';
import { t } from '../lib/i18n';
import * as motion from '../styles/motion.css';
import * as css from './StatusBadge.css';

interface StatusBadgeProps {
  status: PowerStatus;
  /** A live reading backs the status. ON without one only means no outage was reported. */
  monitored: boolean;
  /** The open outage was announced in advance; only read when OFF. */
  planned: boolean;
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
  /** How the badge looks: a planned outage is still OFF, but calm. */
  const look = (): BadgeState | 'PLANNED' => (state() === 'OFF' && props.planned ? 'PLANNED' : state());
  // Without a live reading nothing measured how long the power has been on; the status detail below
  // already describes the last outage.
  const detail = () => {
    const since = props.since;
    if (!since || state() === 'NONE') return ' ';
    return t().status.for(formatDuration(props.now - Date.parse(since)));
  };

  // The first state shown fades in with the card; only a change after that is marked.
  let mounted = false;
  onMount(() => {
    mounted = true;
  });

  return (
    <div
      class={`${css.root} ${motion.enter}`}
      data-status={state()}
      data-planned={look() === 'PLANNED' ? '' : undefined}
    >
      {/* Keyed, so a new state brings a new icon and headline text to animate. */}
      <Show when={look()} keyed>
        {(l) => (
          <div class={`${css.icon[l]} ${mounted ? motion.changedIcon : ''}`} aria-hidden="true">
            <Switch fallback={<Zap size={30} stroke-width={2.25} />}>
              <Match when={l === 'PLANNED'}>
                <CalendarClock size={30} stroke-width={2.25} />
              </Match>
              <Match when={l === 'OFF'}>
                <ZapOff size={30} stroke-width={2.25} />
                {/* The only motion that repeats: an outage nobody announced. */}
                <span class={css.ring} />
              </Match>
            </Switch>
          </div>
        )}
      </Show>
      <div>
        {/* Only the headline is live, so the ticking duration is never re-announced. It stays in place
            across a change, as a live region added afresh is not announced. */}
        <p class={`${css.headline} ${css.tone[look()]}`} role="status">
          <Show when={state()} keyed>
            {(s) => <span class={mounted ? motion.changedText : undefined}>{t().status[s]}</span>}
          </Show>
        </p>
        <p class={css.detail} data-testid="badge-detail">
          {detail()}
        </p>
      </div>
    </div>
  );
};
