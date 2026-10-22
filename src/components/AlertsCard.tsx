import BellRing from 'lucide-solid/icons/bell-ring';
import { type Component, createEffect, createSignal, For, Match, on, onCleanup, onMount, Show, Switch } from 'solid-js';
import { MINUTE_MS } from '../../shared/api';
import { locale, t } from '../lib/i18n';
import {
  ALERTS_OFFER_DELAY_MS,
  ALERTS_SNOOZE_MS,
  type AlertsState,
  alertsState,
  shouldOfferCard,
  turnOffAlerts,
  turnOnAlerts,
} from '../lib/push';
import { readStored, STORAGE_KEYS, writeStored } from '../lib/storage';
import { button } from '../styles/ui.css';
import * as css from './AlertsCard.css';

// The bell (AlertsBell.tsx) and the card share this state: the bell opens the card and shows what
// the card turned on.

/** Undefined until the browser has been asked. */
const [state, setState] = createSignal<AlertsState>();
const [open, setOpen] = createSignal(false);
const [busy, setBusy] = createSignal(false);
type Notice = 'turnedOn' | 'turnedOff' | 'failed';
// A key, so the message follows a language switch.
const [notice, setNotice] = createSignal<Notice | null>(null);

export { busy as alertsBusy, state as alerts };

/** How long a confirmation stays. */
const NOTICE_MS = MINUTE_MS / 15;

let noticeTimer: ReturnType<typeof setTimeout> | undefined;
function say(key: Notice) {
  clearTimeout(noticeTimer);
  setNotice(key);
  noticeTimer = setTimeout(() => setNotice(null), NOTICE_MS);
}

export async function refreshAlerts(): Promise<AlertsState> {
  // A browser that cannot say still lets the visitor try; turning on reports any failure.
  const next = await alertsState().catch((): AlertsState => 'off');
  setState(next);
  return next;
}

/** Where focus goes back to once the card closes. */
let returnFocus: HTMLElement | null = null;

function openCard() {
  if (open()) return;
  const active = document.activeElement;
  returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
  setOpen(true);
}

type Choice = 'notNow' | 'noThanks' | 'close';

function closeCard(choice: Choice) {
  if (choice === 'notNow') writeStored(STORAGE_KEYS.alertsSnoozedUntil, String(Date.now() + ALERTS_SNOOZE_MS));
  if (choice === 'noThanks') writeStored(STORAGE_KEYS.alertsDeclined, '1');
  const hadFocus = document.querySelector(`.${css.card}`)?.contains(document.activeElement);
  setOpen(false);
  if (!hadFocus) return;
  // Opened by itself while nothing had focus: the main content takes it rather than <body>.
  const target = returnFocus?.isConnected ? returnFocus : document.querySelector<HTMLElement>('.gg-main');
  target?.focus({ preventScroll: true });
}

/** The bell: turns alerts off when they are on, and otherwise opens the card in the form that fits. */
export async function pressBell() {
  if (busy()) return;
  const current = state() ?? (await refreshAlerts());
  if (current !== 'on') return openCard();
  setBusy(true);
  try {
    await turnOffAlerts();
    setState('off');
    say('turnedOff');
  } catch {
    say('failed');
  } finally {
    setBusy(false);
  }
}

/** The card itself, mounted while it is open. */
const Sheet: Component = () => {
  const [failed, setFailed] = createSignal(false);
  const m = () => t().alerts.card;
  const offering = () => state() === 'off' || state() === 'ios-install';
  let heading!: HTMLHeadingElement;

  // Escape puts off a card that offered something, and otherwise just closes it.
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') closeCard(offering() ? 'notNow' : 'close');
  };
  onMount(() => {
    heading.focus({ preventScroll: true });
    document.addEventListener('keydown', onKey);
  });
  onCleanup(() => document.removeEventListener('keydown', onKey));

  async function turnOn() {
    if (busy()) return;
    setFailed(false);
    setBusy(true);
    try {
      const next = await turnOnAlerts(locale());
      setState(next);
      if (next === 'on') {
        closeCard('close');
        say('turnedOn');
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class={css.card} role="dialog" aria-labelledby="alerts-heading">
      <div class={css.header}>
        <span class={css.icon}>
          <BellRing size={22} aria-hidden="true" />
        </span>
        <h2 id="alerts-heading" class={css.heading} tabindex="-1" ref={heading}>
          {m().heading}
        </h2>
      </div>
      <Switch>
        <Match when={state() === 'blocked'}>
          <p class={css.text}>{m().blockedHelp}</p>
        </Match>
        <Match when={state() === 'unsupported'}>
          <p class={css.text}>{m().unsupported}</p>
        </Match>
        <Match when={true}>
          <p class={css.text}>{m().body}</p>
          <Show when={state() === 'ios-install'}>
            <p class={css.text}>{m().iosIntro}</p>
            <ol class={css.steps}>
              <For each={m().iosSteps}>{(step) => <li>{step}</li>}</For>
            </ol>
          </Show>
        </Match>
      </Switch>
      <p class={css.scope}>{m().scope}</p>
      <p class={css.failed} aria-live="polite">
        {failed() ? m().failed : ''}
      </p>
      <div class={css.actions}>
        <Show
          when={offering()}
          fallback={
            <button type="button" class={`${button.ghost} ${css.wide}`} onClick={() => closeCard('close')}>
              {m().close}
            </button>
          }
        >
          {/* An iPhone outside the home screen cannot turn alerts on, so it gets the steps instead. */}
          <Show when={state() === 'off'}>
            <button type="button" class={`${button.primary} ${css.wide}`} aria-disabled={busy()} onClick={turnOn}>
              {m().turnOn}
            </button>
          </Show>
          <button type="button" class={button.ghost} onClick={() => closeCard('notNow')}>
            {m().notNow}
          </button>
          <button type="button" class={button.ghost} onClick={() => closeCard('noThanks')}>
            {m().noThanks}
          </button>
        </Show>
      </div>
    </section>
  );
};

/**
 * Mounted once on the public page. `ready` once the status has loaded: the card never offers itself
 * while the page is still arriving, only ALERTS_OFFER_DELAY_MS after, and only as shouldOfferCard allows.
 */
export const AlertsCard: Component<{ ready: boolean }> = (props) => {
  let offerTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    refreshAlerts();
    // Back from the browser's settings, where the permission may have changed.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshAlerts();
    };
    document.addEventListener('visibilitychange', onVisible);
    onCleanup(() => {
      clearTimeout(offerTimer);
      document.removeEventListener('visibilitychange', onVisible);
    });
  });

  createEffect(
    on(
      () => props.ready,
      (ready) => {
        if (!ready || offerTimer) return;
        offerTimer = setTimeout(async () => {
          const offer = shouldOfferCard({
            visits: Number(readStored(STORAGE_KEYS.visits)) || 0,
            snoozedUntil: Number(readStored(STORAGE_KEYS.alertsSnoozedUntil)) || null,
            declined: readStored(STORAGE_KEYS.alertsDeclined) !== null,
            state: state() ?? (await refreshAlerts()),
            now: Date.now(),
          });
          if (offer) openCard();
        }, ALERTS_OFFER_DELAY_MS);
      },
    ),
  );

  return (
    <>
      <Show when={open()}>
        <Sheet />
      </Show>
      {/* Always present, so screen readers announce what goes into it. */}
      <div aria-live="polite">
        <Show when={notice()}>{(key) => <p class={css.notice}>{t().alerts.card[key()]}</p>}</Show>
      </div>
    </>
  );
};
