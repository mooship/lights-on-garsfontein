import { DAY_MS, MINUTE_MS } from '../../shared/api';
import { SERVICE_WORKER_PATH } from '../../shared/paths';
import type { Locale } from '../../site.config';
import { api } from './api';
import { readStored, STORAGE_KEYS, writeStored } from './storage';

export type PushSupport = 'supported' | 'ios-install' | 'unsupported';
export type AlertsState = 'on' | 'off' | 'blocked' | 'ios-install' | 'unsupported';

/** How long "later" hides the alerts card. */
export const ALERTS_SNOOZE_MS = 30 * DAY_MS;

/** How long after the status first loads the card may offer itself, so it never interrupts the first look. */
export const ALERTS_OFFER_DELAY_MS = MINUTE_MS / 20;

/** The alerts card waits for a return visit, so it never greets someone on their first page load. */
const MIN_VISITS = 2;

/** The parts of the browser that pushSupport reads, so Node tests can pass fakes. */
export type PushEnv = {
  window: { PushManager?: unknown; matchMedia?: (query: string) => { matches: boolean } };
  navigator: { userAgent: string; maxTouchPoints?: number; serviceWorker?: unknown; standalone?: boolean };
};

const browser = (): PushEnv => ({ window, navigator }) as unknown as PushEnv;

export function pushSupport(env: PushEnv = browser()): PushSupport {
  const { window: win, navigator: nav } = env;
  // iPadOS 13 and later reports a Mac, so a Mac with a touch screen is an iPad.
  const ios =
    /iPhone|iPad|iPod/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && (nav.maxTouchPoints ?? 0) > 1);
  const standalone = nav.standalone === true || win.matchMedia?.('(display-mode: standalone)').matches === true;
  // iOS offers push only to a site added to the home screen: until then it has no PushManager.
  if (ios && !standalone && !win.PushManager) return 'ios-install';
  return nav.serviceWorker && win.PushManager ? 'supported' : 'unsupported';
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

/** `applicationServerKey` wants bytes; the Worker serves the key as unpadded base64url. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
}

/** The same call saves a new subscription and updates the language of an existing one. */
function save(subscription: PushSubscription, locale: Locale) {
  const { endpoint, keys } = subscription.toJSON();
  return api.subscribePush({
    endpoint: endpoint ?? subscription.endpoint,
    keys: keys as { p256dh: string; auth: string },
    locale,
  });
}

/** Rejects when the key, the subscription or the save fails; the caller says so. Must run from a tap. */
export async function turnOnAlerts(locale: Locale): Promise<AlertsState> {
  // First, because a browser only shows the prompt while the tap that asked for it is recent.
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return 'blocked';
  if (permission !== 'granted') return 'off';
  const { publicKey } = await api.pushKey();
  // Repeating register() is harmless, and `ready` alone would wait for ever if the page start never registered.
  await navigator.serviceWorker.register(SERVICE_WORKER_PATH);
  const { pushManager } = await navigator.serviceWorker.ready;
  const subscription = await pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToBytes(publicKey),
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
  // 'ios-install' is offered too: the card then explains how to add the site to the home screen.
  return state === 'off' || state === 'ios-install';
}

/** Counts this page load, and registers the push worker where push can work. */
export function startPush(): void {
  writeStored(STORAGE_KEYS.visits, String((Number(readStored(STORAGE_KEYS.visits)) || 0) + 1));
  if (pushSupport() === 'supported') {
    navigator.serviceWorker.register(SERVICE_WORKER_PATH).catch(() => {
      // Without a worker alerts cannot be turned on, and turnOnAlerts reports that when asked.
    });
  }
}
