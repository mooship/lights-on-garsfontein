import Users from 'lucide-solid/icons/users';
import { type Component, createSignal, Show } from 'solid-js';
import { ApiError, api } from '../lib/api';
import { t } from '../lib/i18n';
import { getTurnstileToken } from '../lib/turnstile';
import { button, errorText, muted } from '../styles/ui.css';
import * as css from './ConfirmOutage.css';

/** Render it keyed on `outageId` so a new outage starts afresh. */
interface ConfirmOutageProps {
  outageId: number;
  /** The latest count from the status poll. */
  confirmations: number;
  siteKey: string;
}

const storageKey = (id: number) => `confirmed:${id}`;

function remembered(id: number): boolean {
  try {
    return localStorage.getItem(storageKey(id)) === '1';
  } catch {
    return false;
  }
}

export const ConfirmOutage: Component<ConfirmOutageProps> = (props) => {
  let widget!: HTMLDivElement;
  const [busy, setBusy] = createSignal(false);
  const [confirmed, setConfirmed] = createSignal(remembered(props.outageId));
  const [count, setCount] = createSignal<number | null>(null);
  // The error code, so the message follows a language switch.
  const [errorCode, setErrorCode] = createSignal('');
  const message = () => errorCode() && (t().confirm.errors[errorCode()] ?? t().confirm.unknown);
  const total = () => count() ?? props.confirmations;
  const disabled = () => busy() || confirmed();

  async function confirm() {
    if (disabled()) return;
    setBusy(true);
    setErrorCode('');
    try {
      const token = await getTurnstileToken(widget, props.siteKey, 'confirm');
      const res = await api.confirm(token, props.outageId);
      setCount(res.confirmations);
      setConfirmed(true);
      try {
        localStorage.setItem(storageKey(props.outageId), '1');
      } catch {}
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'unknown';
      if (code === 'already_confirmed') setConfirmed(true);
      setErrorCode(code);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class={css.root}>
      <button
        type="button"
        class={button.off}
        aria-disabled={disabled()}
        onClick={confirm}
        data-testid="confirm-outage"
      >
        <Users size={18} aria-hidden="true" />
        {confirmed() ? t().confirm.done : busy() ? t().confirm.busy : t().confirm.button}
      </button>
      <div ref={widget} class={css.widget} />
      <p class={message() ? errorText : muted} aria-live="polite">
        <Show when={message()} fallback={total() === 0 ? t().confirm.first : t().confirm.count(total())}>
          {message()}
        </Show>
      </p>
    </div>
  );
};
