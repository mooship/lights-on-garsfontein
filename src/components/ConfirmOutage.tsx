import Users from 'lucide-solid/icons/users';
import { type Component, createSignal, Show } from 'solid-js';
import { ApiError, api } from '../lib/api';
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

const MESSAGES: Record<string, string> = {
  already_confirmed: 'You’ve already confirmed this one. Thanks!',
  rate_limited: 'Too many tries. Give it a minute.',
  no_active_outage: 'Looks like the power’s back.',
  outage_changed: 'That outage has ended. The status will update shortly.',
  turnstile_failed: 'We couldn’t check that you’re human. Please try again.',
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
  const [confirmed, setConfirmed] = createSignal(remembered(props.outageId));
  const [count, setCount] = createSignal<number | null>(null);
  const [message, setMessage] = createSignal('');
  const total = () => count() ?? props.confirmations;
  const disabled = () => busy() || confirmed();

  async function confirm() {
    if (disabled()) return;
    setBusy(true);
    setMessage('');
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
        aria-disabled={disabled()}
        onClick={confirm}
        data-testid="confirm-outage"
      >
        <Users size={18} aria-hidden="true" />
        {confirmed() ? 'Thanks for letting us know' : busy() ? 'Checking…' : 'My power’s off too'}
      </button>
      <div ref={widget} class={css.widget} />
      <p class={message() ? errorText : muted} aria-live="polite">
        <Show
          when={message()}
          fallback={
            total() === 0
              ? 'Be the first neighbour to confirm.'
              : `${total()} ${total() === 1 ? 'neighbour says theirs is' : 'neighbours say theirs is'} off too.`
          }
        >
          {message()}
        </Show>
      </p>
    </div>
  );
};
