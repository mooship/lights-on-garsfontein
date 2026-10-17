import Users from 'lucide-solid/icons/users';
import { type Component, createSignal, Show } from 'solid-js';
import type { OutageSummary } from '../../shared/api';
import { ApiError, api } from '../lib/api';
import { getTurnstileToken } from '../lib/turnstile';
import { button, errorText, muted } from '../styles/ui.css';
import * as css from './ConfirmOutage.css';

export interface ConfirmOutageProps {
  outage: OutageSummary;
  siteKey: string;
}

const MESSAGES: Record<string, string> = {
  already_confirmed: 'You have already confirmed this outage. Thank you.',
  rate_limited: 'Too many attempts. Please wait a minute.',
  no_active_outage: 'The power seems to be back on.',
  turnstile_failed: 'We could not verify you are human. Please try again.',
};

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
  const [confirmed, setConfirmed] = createSignal(remembered(props.outage.id));
  const [count, setCount] = createSignal<number | null>(null);
  const [message, setMessage] = createSignal('');
  const total = () => count() ?? props.outage.confirmations;

  async function confirm() {
    setBusy(true);
    setMessage('');
    try {
      const token = await getTurnstileToken(widget, props.siteKey);
      const res = await api.confirm(token);
      setCount(res.confirmations);
      setConfirmed(true);
      try {
        localStorage.setItem(storageKey(props.outage.id), '1');
      } catch {}
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'unknown';
      if (code === 'already_confirmed') setConfirmed(true);
      setMessage(MESSAGES[code] ?? 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class={css.root}>
      <button
        type="button"
        class={button.off}
        disabled={busy() || confirmed()}
        onClick={confirm}
        data-testid="confirm-outage"
      >
        <Users size={18} aria-hidden="true" />
        {confirmed() ? 'Thanks for confirming' : busy() ? 'Checking…' : 'My power is off too'}
      </button>
      <div ref={widget} class={css.widget} />
      <p class={message() ? errorText : muted} aria-live="polite">
        <Show
          when={message()}
          fallback={<>{total() === 1 ? '1 neighbour has' : `${total()} neighbours have`} confirmed</>}
        >
          {message()}
        </Show>
      </p>
    </div>
  );
};
