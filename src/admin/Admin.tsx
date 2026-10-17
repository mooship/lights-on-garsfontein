import clsx from 'clsx';
import LogOut from 'lucide-solid/icons/log-out';
import Plus from 'lucide-solid/icons/plus';
import { type Component, createResource, createSignal, For, Show } from 'solid-js';
import type { AdminOutage } from '../../shared/api';
import { PunchClock } from '../components/PunchClock';
import { ApiError, api } from '../lib/api';
import { formatDay, formatDuration, formatTime, toLocalInput } from '../lib/format';
import { useNow } from '../lib/now';
import { button, errorText, input, label, smallButton } from '../styles/ui.css';
import * as css from './Admin.css';

const describeError = (error: unknown) =>
  error instanceof ApiError
    ? ({
        unauthorized: 'Wrong password.',
        rate_limited: 'Too many attempts. Wait a minute and try again.',
        outage_already_open: 'An outage is already open.',
        no_open_outage: 'There is no open outage to close.',
      }[error.code] ?? `Request failed (${error.code}).`)
    : 'Network error.';

const LoginForm: Component<{ onLoggedIn: () => void }> = (props) => {
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const password = new FormData(event.currentTarget as HTMLFormElement).get('password');
    setBusy(true);
    setError('');
    try {
      await api.login(String(password ?? ''));
      props.onLoggedIn();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="gg-card">
      <h2 class="gg-card-title">Admin sign in</h2>
      <form class={css.stack} onSubmit={submit}>
        <label class={label}>
          Password
          <input class={input} type="password" name="password" autocomplete="current-password" required />
        </label>
        <Show when={error()}>
          <p class={errorText} role="alert">
            {error()}
          </p>
        </Show>
        <button type="submit" class={button.primary} disabled={busy()}>
          Sign in
        </button>
      </form>
    </section>
  );
};

const OutageRow: Component<{ outage: AdminOutage; now: number; onChange: () => void }> = (props) => {
  const [error, setError] = createSignal('');
  const run = async (action: () => Promise<unknown>) => {
    setError('');
    try {
      await action();
      props.onChange();
    } catch (e) {
      setError(describeError(e));
    }
  };
  const end = () => (props.outage.endTime ? Date.parse(props.outage.endTime) : props.now);

  return (
    <li class={css.item}>
      <div class={clsx(props.outage.isFalsePositive && css.flagged)}>
        <strong>
          {formatDay(props.outage.startTime)}, {formatTime(props.outage.startTime)} –{' '}
          {props.outage.endTime ? formatTime(props.outage.endTime) : 'ongoing'}
        </strong>
        <div class={css.itemMeta}>
          {formatDuration(end() - Date.parse(props.outage.startTime))} · {props.outage.source} ·{' '}
          {props.outage.confirmations} confirmed
          {props.outage.isFalsePositive ? ' · false positive' : ''}
        </div>
      </div>
      <div class={css.actions}>
        <Show when={!props.outage.endTime}>
          <button
            type="button"
            class={clsx(button.ghost, smallButton)}
            onClick={() => run(() => api.updateOutage(props.outage.id, { endTime: new Date().toISOString() }))}
          >
            Close now
          </button>
        </Show>
        <button
          type="button"
          class={clsx(button.ghost, smallButton)}
          onClick={() =>
            run(() => api.updateOutage(props.outage.id, { isFalsePositive: !props.outage.isFalsePositive }))
          }
        >
          {props.outage.isFalsePositive ? 'Not a false positive' : 'False positive'}
        </button>
        <button
          type="button"
          class={clsx(button.ghost, smallButton)}
          onClick={() => confirm('Delete this outage?') && run(() => api.deleteOutage(props.outage.id))}
        >
          Delete
        </button>
      </div>
      <Show when={error()}>
        <p class={errorText}>{error()}</p>
      </Show>
    </li>
  );
};

const LogOutageForm: Component<{ onLogged: () => void }> = (props) => {
  const [error, setError] = createSignal('');

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const start = String(data.get('start') ?? '');
    const end = String(data.get('end') ?? '');
    setError('');
    try {
      await api.createOutage(new Date(start).toISOString(), end ? new Date(end).toISOString() : null);
      form.reset();
      props.onLogged();
    } catch (e) {
      setError(describeError(e));
    }
  }

  return (
    <section class="gg-card">
      <h2 class="gg-card-title">Log a past outage</h2>
      <form class={css.stack} onSubmit={submit}>
        <div class={css.formRow}>
          <label class={label}>
            Started
            <input
              class={input}
              type="datetime-local"
              name="start"
              required
              max={toLocalInput(new Date().toISOString())}
            />
          </label>
          <label class={label}>
            Ended
            <input class={input} type="datetime-local" name="end" />
          </label>
        </div>
        <Show when={error()}>
          <p class={errorText}>{error()}</p>
        </Show>
        <button type="submit" class={button.primary}>
          <Plus size={18} aria-hidden="true" /> Log outage
        </button>
      </form>
    </section>
  );
};

const Dashboard: Component<{ onLoggedOut: () => void }> = (props) => {
  const now = useNow(1000);
  const [outages, { refetch }] = createResource(() => api.outages());
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const open = () => outages.latest?.outages.find((o) => !o.endTime && !o.isFalsePositive) ?? null;

  const punch = async (action: 'punch_out' | 'punch_in') => {
    setBusy(true);
    setError('');
    try {
      await api.punch(action);
      await refetch();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await api.logout().catch(() => {});
    props.onLoggedOut();
  };

  return (
    <>
      <section class="gg-card">
        <div class={css.header}>
          <h2 class="gg-card-title">Punch clock</h2>
          <button type="button" class={clsx(button.ghost, smallButton)} onClick={logout}>
            <LogOut size={16} aria-hidden="true" /> Sign out
          </button>
        </div>
        <PunchClock
          outage={open()}
          now={now()}
          busy={busy() || outages.loading}
          onPunchOut={() => punch('punch_out')}
          onPunchIn={() => punch('punch_in')}
        />
        <Show when={error()}>
          <p class={errorText} role="alert">
            {error()}
          </p>
        </Show>
      </section>

      <LogOutageForm onLogged={refetch} />

      <section class="gg-card">
        <h2 class="gg-card-title">Outages</h2>
        <Show when={outages.latest} fallback={<p>Loading…</p>}>
          {(data) => (
            <Show when={data().outages.length > 0} fallback={<p>No outages yet.</p>}>
              <ul class={css.table}>
                <For each={data().outages}>{(o) => <OutageRow outage={o} now={now()} onChange={refetch} />}</For>
              </ul>
            </Show>
          )}
        </Show>
      </section>
    </>
  );
};

const Admin: Component = () => {
  // Probe the session by asking for the protected outage list.
  const [session, { refetch }] = createResource(async () => {
    try {
      await api.outages();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return false;
      throw e;
    }
  });

  return (
    <Show when={session() !== undefined} fallback={<p class="gg-status-loading">Loading…</p>}>
      <Show when={session()} fallback={<LoginForm onLoggedIn={refetch} />}>
        <Dashboard onLoggedOut={refetch} />
      </Show>
    </Show>
  );
};

export default Admin;
