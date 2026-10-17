import type { TurnstileAction } from '../../shared/api';

// Turnstile is loaded only when a visitor taps "My power is off too" or "Still off where you
// are?", so the third-party script never weighs on page load.

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loader: Promise<TurnstileApi> | undefined;

function loadTurnstile(): Promise<TurnstileApi> {
  loader ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile_missing')));
    script.onerror = () => {
      loader = undefined;
      reject(new Error('turnstile_load_failed'));
    };
    document.head.append(script);
  });
  return loader;
}

/** Runs a Turnstile challenge in `container` and resolves with the token. */
export async function getTurnstileToken(
  container: HTMLElement,
  siteKey: string,
  action: TurnstileAction,
): Promise<string> {
  const turnstile = await loadTurnstile();
  return new Promise<string>((resolve, reject) => {
    let widgetId = '';
    const done = (fn: () => void) => {
      fn();
      queueMicrotask(() => turnstile.remove(widgetId));
    };
    widgetId = turnstile.render(container, {
      sitekey: siteKey,
      action,
      appearance: 'interaction-only',
      callback: (token: string) => done(() => resolve(token)),
      'error-callback': () => done(() => reject(new Error('turnstile_error'))),
      'expired-callback': () => done(() => reject(new Error('turnstile_expired'))),
    });
  });
}
