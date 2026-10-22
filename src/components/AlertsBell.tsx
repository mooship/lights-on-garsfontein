import Bell from 'lucide-solid/icons/bell';
import BellOff from 'lucide-solid/icons/bell-off';
import BellRing from 'lucide-solid/icons/bell-ring';
import { type Component, Match, Switch } from 'solid-js';
import { t } from '../lib/i18n';
import { alerts, alertsBusy, pressBell } from './AlertsCard';
import * as css from './AlertsCard.css';

/** Its name stays the same; `title` says what a press does, and `aria-pressed` whether alerts are on. */
export const AlertsBell: Component = () => {
  const title = () => {
    const m = t().alerts.bell;
    switch (alerts()) {
      case 'on':
        return m.on;
      case 'blocked':
        return m.blocked;
      case 'ios-install':
      case 'unsupported':
        return m.install;
      default:
        return m.off;
    }
  };
  return (
    <button
      type="button"
      class={`gg-icon-button ${css.bell}`}
      aria-label={t().alerts.bell.label}
      title={title()}
      aria-pressed={alerts() === 'on'}
      aria-disabled={alertsBusy()}
      onClick={pressBell}
    >
      <Switch fallback={<Bell size={20} aria-hidden="true" />}>
        <Match when={alerts() === 'on'}>
          <BellRing size={20} aria-hidden="true" />
        </Match>
        <Match when={alerts() === 'blocked'}>
          <BellOff size={20} aria-hidden="true" />
        </Match>
      </Switch>
    </button>
  );
};
