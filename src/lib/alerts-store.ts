// The alerts' state, shared by the bell and the card (src/components/): the bell opens the card and
// shows what the card turned on.

import { createEffect, createSignal, on, onCleanup } from 'solid-js';
import { locale } from './i18n';
import {
  ALERTS_NOTICE_MS,
  ALERTS_OFFER_DELAY_MS,
  ALERTS_SNOOZE_MS,
  type AlertsState,
  alertsState,
  resaveAlerts,
  shouldOfferCard,
  turnOffAlerts,
  turnOnAlerts,
} from './push';
import { readStored, readStoredNumber, STORAGE_KEYS, writeStored } from './storage';

/** Undefined until the browser has been asked. */
const [state, setState] = createSignal<AlertsState>();
const [busy, setBusy] = createSignal(false);
const [open, setOpen] = createSignal(false);
type Notice = 'turnedOn' | 'turnedOff' | 'failed';
// A key, so the message follows a language switch.
const [notice, setNotice] = createSignal<Notice | null>(null);
// Whether the live region names a card that just offered itself (src/components/AlertsCard.tsx).
const [announcing, setAnnouncing] = createSignal(false);

export { announcing, busy, notice, open, state };

/** The open card's id, so closing it can tell whether it held focus. */
export const CARD_ID = 'alerts-card';

let noticeTimer: ReturnType<typeof setTimeout> | undefined;
function say(key: Notice) {
  clearTimeout(noticeTimer);
  setNotice(key);
  noticeTimer = setTimeout(() => setNotice(null), ALERTS_NOTICE_MS);
}

let announceTimer: ReturnType<typeof setTimeout> | undefined;
function announce(on: boolean) {
  clearTimeout(announceTimer);
  setAnnouncing(on);
  if (on) announceTimer = setTimeout(() => setAnnouncing(false), ALERTS_NOTICE_MS);
}

export async function refreshAlerts(): Promise<AlertsState> {
  // A browser that cannot say still lets the visitor try; turning on reports any failure.
  const next = await alertsState().catch((): AlertsState => 'off');
  setState(next);
  return next;
}

/** Where focus goes back to once the card closes. */
let returnFocus: HTMLElement | null = null;
/** Only a card the visitor asked for takes focus: one that offers itself would interrupt keyboard and screen reader users. */
let focusOnOpen = false;
export const takesFocus = () => focusOnOpen;
/** Set once the visitor turns alerts off, so the card does not offer them again on the same visit. */
let offerWithdrawn = false;

function openCard(byVisitor: boolean) {
  if (open()) return;
  const active = document.activeElement;
  returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
  focusOnOpen = byVisitor;
  setOpen(true);
  announce(!byVisitor);
}

/** Whether the card offers alerts, rather than only explaining why they cannot be turned on. */
export const offering = () => state() === 'off' || state() === 'ios-install';

type Choice = 'notNow' | 'noThanks' | 'close';

export function closeCard(choice: Choice) {
  if (choice === 'notNow') writeStored(STORAGE_KEYS.alertsSnoozedUntil, String(Date.now() + ALERTS_SNOOZE_MS));
  if (choice === 'noThanks') writeStored(STORAGE_KEYS.alertsDeclined, '1');
  const hadFocus = document.getElementById(CARD_ID)?.contains(document.activeElement);
  setOpen(false);
  announce(false);
  if (!hadFocus) return;
  // Opened by itself while nothing had focus: the main content takes it rather than <body>.
  const target = returnFocus?.isConnected ? returnFocus : document.querySelector<HTMLElement>('.gg-main');
  target?.focus({ preventScroll: true });
}

/** The bell: closes the card if open, turns alerts off if on, else opens it; closing an offer counts as Not now. */
export async function pressBell() {
  if (busy()) return;
  if (open()) return closeCard(offering() ? 'notNow' : 'close');
  const current = state() ?? (await refreshAlerts());
  if (current !== 'on') return openCard(true);
  offerWithdrawn = true;
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

/** The card's main action; resolves false when turning on failed, which the card then says. */
export async function turnOn(): Promise<boolean> {
  setBusy(true);
  try {
    const next = await turnOnAlerts(locale());
    setState(next);
    if (next === 'on') {
      closeCard('close');
      say('turnedOn');
    }
    return true;
  } catch {
    return false;
  } finally {
    setBusy(false);
  }
}

/** Once `ready` turns true, offers the card after ALERTS_OFFER_DELAY_MS, as shouldOfferCard allows. */
export function offerWhenReady(ready: () => boolean): void {
  let offerTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(offerTimer));
  createEffect(
    on(ready, (isReady) => {
      if (!isReady || offerTimer) return;
      offerTimer = setTimeout(async () => {
        if (offerWithdrawn) return;
        const offer = shouldOfferCard({
          visits: readStoredNumber(STORAGE_KEYS.visits) ?? 0,
          snoozedUntil: readStoredNumber(STORAGE_KEYS.alertsSnoozedUntil),
          declined: readStored(STORAGE_KEYS.alertsDeclined) !== null,
          state: state() ?? (await refreshAlerts()),
          now: Date.now(),
        });
        if (offer && !offerWithdrawn) openCard(false);
      }, ALERTS_OFFER_DELAY_MS);
    }),
  );
}

/** Keeps the alerts' language in step with the page's; only the public page, which has alerts, calls it. */
export function followLanguage(): void {
  createEffect(
    on(
      locale,
      (next) =>
        resaveAlerts(next).catch(() => {
          // The alerts keep their earlier language; the next switch or turning them on saves it again.
        }),
      { defer: true },
    ),
  );
}
