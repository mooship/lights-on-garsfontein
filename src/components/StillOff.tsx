import { type Component, createEffect, createSignal, on, Show } from 'solid-js';
import { STILL_OFF_DEDUPE_MS } from '../../shared/api';
import { ApiError, api } from '../lib/api';
import { t } from '../lib/i18n';
import { readStored, writeStored } from '../lib/storage';
import { getTurnstileToken } from '../lib/turnstile';
import { errorText } from '../styles/ui.css';
import { widget as widgetClass } from './ConfirmOutage.css';

interface StillOffProps {
  /** Reports in the last STILL_OFF_WINDOW_MS, from the status poll. */
  reports: number;
  siteKey: string;
}

// When this browser last reported; the server also allows one report per client per STILL_OFF_DEDUPE_MS.
const STORAGE_KEY = 'still-off-at';

const reportedRecently = () => Date.now() - Number(readStored(STORAGE_KEY) ?? 0) < STILL_OFF_DEDUPE_MS;

/**
 * "Still off where you are?" while the status is ON: an anonymous report that is counted and shown,
 * but never changes the status. The markup matches StillOffPlaceholder, which the loading shell mirrors.
 */
export const StillOff: Component<StillOffProps> = (props) => {
  let widget!: HTMLDivElement;
  const [busy, setBusy] = createSignal(false);
  const [reported, setReported] = createSignal(reportedRecently());
  // The count from our own report, until the next poll brings a newer one.
  const [count, setCount] = createSignal<number | null>(null);
  createEffect(
    on(
      () => props.reports,
      () => setCount(null),
      { defer: true },
    ),
  );
  const total = () => count() ?? props.reports;
  // The error code, so the message follows a language switch.
  const [errorCode, setErrorCode] = createSignal('');
  const error = () =>
    errorCode() && ((t().stillOff.errors as Record<string, string | undefined>)[errorCode()] ?? t().confirm.unknown);
  const disabled = () => busy() || reported();

  async function report() {
    if (disabled()) return;
    setBusy(true);
    setErrorCode('');
    try {
      const token = await getTurnstileToken(widget, props.siteKey, 'still_off');
      const res = await api.stillOff(token);
      setCount(res.reports);
      setReported(true);
      writeStored(STORAGE_KEY, String(Date.now()));
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'unknown';
      if (code === 'already_reported') setReported(true);
      setErrorCode(code);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="gg-still-off">
      <button type="button" class="gg-link-button" aria-disabled={disabled()} onClick={report} data-testid="still-off">
        {busy() ? t().stillOff.busy : t().stillOff.button}
      </button>
      <div ref={widget} class={widgetClass} />
      {/* Empty (and so no height) until there is something to say. */}
      <p class={error() ? errorText : 'gg-still-off-note'} aria-live="polite">
        {error() || (reported() ? t().stillOff.done : '')}
      </p>
      <p class="gg-still-off-note">
        <Show when={total() > 0}>{t().stillOff.count(total())} </Show>
        {t().stillOff.note}
      </p>
    </div>
  );
};

/** The loading state's copy of StillOff. */
export const StillOffPlaceholder: Component = () => (
  <div class="gg-still-off">
    <button type="button" class="gg-link-button" disabled>
      {t().stillOff.button}
    </button>
    <p class="gg-still-off-note">{t().stillOff.note}</p>
  </div>
);
