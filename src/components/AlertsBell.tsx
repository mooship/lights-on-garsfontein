import Bell from 'lucide-solid/icons/bell';
import BellOff from 'lucide-solid/icons/bell-off';
import BellRing from 'lucide-solid/icons/bell-ring';
import { type Component, Match, Switch } from 'solid-js';
import { busy, pressBell, state } from '../lib/alerts-store';
import { t } from '../lib/i18n';
import type { AlertsState } from '../lib/push';
import * as css from './AlertsCard.css';

/** Which `alerts.bell` title says what a press does in each state. */
const TITLE: Record<AlertsState, 'on' | 'off' | 'blocked' | 'install'> = {
  on: 'on',
  off: 'off',
  blocked: 'blocked',
  'ios-install': 'install',
  unsupported: 'install',
};

/** Its name stays the same; `title` says what a press does, and `aria-pressed` whether alerts are on. */
export const AlertsBell: Component = () => (
  <button
    type="button"
    class={`gg-icon-button ${css.bell}`}
    aria-label={t().alerts.bell.label}
    title={t().alerts.bell[TITLE[state() ?? 'off']]}
    aria-pressed={state() === 'on'}
    aria-disabled={busy()}
    onClick={pressBell}
  >
    <Switch fallback={<Bell size={20} aria-hidden="true" />}>
      <Match when={state() === 'on'}>
        <BellRing size={20} aria-hidden="true" />
      </Match>
      <Match when={state() === 'blocked'}>
        <BellOff size={20} aria-hidden="true" />
      </Match>
    </Switch>
  </button>
);
