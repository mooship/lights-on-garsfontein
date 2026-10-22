import { type Component, lazy, onCleanup, onMount, Show } from 'solid-js';
import { followLanguage, notice, offerWhenReady, open, refreshAlerts, state } from '../lib/alerts-store';
import { t } from '../lib/i18n';
import * as css from './AlertsCard.css';

// Loaded when it first opens: most visits never see it, and fixed over the page it shifts nothing.
const AlertsSheet = lazy(() => import('./AlertsSheet'));

/** Mounted once on the public page; `ready` once the status has loaded, so the card never offers itself before. */
export const AlertsCard: Component<{ ready: boolean }> = (props) => {
  onMount(() => {
    refreshAlerts();
    // Back from the browser's settings, where the permission may have changed. Support cannot change
    // that way, so a browser without push is not asked again.
    const onVisible = () => {
      const current = state();
      if (document.visibilityState === 'visible' && current !== 'unsupported' && current !== 'ios-install') {
        refreshAlerts();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    onCleanup(() => document.removeEventListener('visibilitychange', onVisible));
  });
  offerWhenReady(() => props.ready);
  followLanguage();

  return (
    // Always present, so screen readers announce what goes into it: a card that offers itself does not
    // take focus, so this is how they hear it arrive.
    <div aria-live="polite">
      <Show when={open()}>
        <AlertsSheet />
      </Show>
      <Show when={notice()}>{(key) => <p class={css.notice}>{t().alerts.card[key()]}</p>}</Show>
    </div>
  );
};
