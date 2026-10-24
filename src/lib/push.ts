import { DAY_MS, MINUTE_MS, type PushSubscriptionBody } from '../../shared/api';
import { fromBase64Url } from '../../shared/base64url';
import { SERVICE_WORKER_PATH } from '../../shared/paths';
import type { Locale } from '../../site.config';
import { api } from './api';
import { readStoredNumber, STORAGE_KEYS, writeStored } from './storage';

export type PushSupport = 'supported' | 'ios-install' | 'unsupported';
export type AlertsState = 'on' | 'off' | 'blocked' | 'ios-install' | 'unsupported';

/** How long "later" hides the alerts card. */
export const ALERTS_SNOOZE_MS = 30 * DAY_MS;

/** How long after the status first loads the card may offer itself, so it never interrupts the first look. */
export const ALERTS_OFFER_DELAY_MS = MINUTE_MS / 20;

/** How long a confirmation stays, and the name of a card that offered itself in the live region. */
export const ALERTS_NOTICE_MS = MINUTE_MS / 15;

/** The alerts card waits for a return visit, so it never greets someone on their first page load. */
const MIN_VISITS = 2;

export function pushSupport(): PushSupport {
  const { userAgent, maxTouchPoints } = navigator;
  const hasPush = 'PushManager' in window;
  // iPadOS 13 and later reports a Mac, so a Mac with a touch screen is an iPad.
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  // `standalone` is Safari's own flag for a site opened from the home screen.
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  // iOS offers push only to a site added to the home screen: until then it has no PushManager.
  if (ios && !standalone && !hasPush) return 'ios-install';
  return 'serviceWorker' in navigator && hasPush ? 'supported' : 'unsupported';
}

/** The registration, or undefined when the worker was never registered. Only call when push is supported. */
const registration = () => navigator.serviceWorker.getRegistration();

async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'supported') return null;
  return (await (await registration())?.pushManager.getSubscription()) ?? null;
}

export async function alertsState(): Promise<AlertsState> {
  const support = pushSupport();
  if (support !== 'supported') return support;
  if (Notification.permission === 'denied') return 'blocked';
  return (await currentSubscription()) ? 'on' : 'off';
}

/** The same call saves a new subscription and updates the language of an existing one. */
function save(subscription: PushSubscription, locale: Locale) {
  const keys = subscription.toJSON().keys as PushSubscriptionBody['keys'];
  return api.subscribePush({ endpoint: subscription.endpoint, keys, locale });
}

/** Rejects when the key, the subscription or the save fails; the caller says so. Must run from a tap. */
export async function turnOnAlerts(locale: Locale): Promise<AlertsState> {
  // First, because a browser only shows the prompt while the tap that asked for it is recent.
  const asked = Notification.requestPermission();
  // Fetched and registered while the prompt is open; registering again is harmless, and `ready`
  // waits for ever if the worker was never registered.
  const prepared = Promise.all([api.pushKey(), navigator.serviceWorker.register(SERVICE_WORKER_PATH)]);
  prepared.catch(() => {
    // Awaited below; this only stops an unhandled rejection when the visitor says no first.
  });
  const permission = await asked;
  if (permission === 'denied') return 'blocked';
  if (permission !== 'granted') return 'off';
  const [{ publicKey }] = await prepared;
  const { pushManager } = await navigator.serviceWorker.ready;
  const subscription = await pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: fromBase64Url(publicKey),
  });
  try {
    await save(subscription, locale);
  } catch (error) {
    // Left in place it would read as "on" while the Worker has nothing to send to.
    await subscription.unsubscribe();
    throw error;
  }
  return 'on';
}

/** The Worker forgets the endpoint first: if that fails the browser keeps it and the state stays "on". */
export async function turnOffAlerts(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await api.unsubscribePush(subscription.endpoint);
  await subscription.unsubscribe();
}

/** Keeps the language of the alerts in step with the page's; does nothing without a subscription. */
export async function resaveAlerts(locale: Locale): Promise<void> {
  const subscription = await currentSubscription();
  if (subscription) await save(subscription, locale);
}

/** Whether the card can turn alerts on, or explain how to: 'ios-install' gets home-screen steps. */
export const canOffer = (state: AlertsState | undefined) => state === 'off' || state === 'ios-install';

export function shouldOfferCard(input: {
  visits: number;
  snoozedUntil: number | null;
  declined: boolean;
  state: AlertsState;
  now: number;
}): boolean {
  const { visits, snoozedUntil, declined, state, now } = input;
  if (visits < MIN_VISITS || declined) return false;
  if (snoozedUntil !== null && snoozedUntil > now) return false;
  return canOffer(state);
}

/**
 * Counts this page load. The worker is registered only when alerts are turned on: a browser
 * re-checks a registered worker on its own as pages load, so a subscriber's stays up to date.
 */
export function countVisit(): void {
  writeStored(STORAGE_KEYS.visits, String((readStoredNumber(STORAGE_KEYS.visits) ?? 0) + 1));
}
