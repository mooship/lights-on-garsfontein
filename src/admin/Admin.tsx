import clsx from 'clsx';
import ArrowLeft from 'lucide-solid/icons/arrow-left';
import LogOut from 'lucide-solid/icons/log-out';
import Plus from 'lucide-solid/icons/plus';
import { type Component, createMemo, createResource, createSignal, For, Show } from 'solid-js';
import { type AdminOutage, type AdminOutagesResponse, MINUTE_MS } from '../../shared/api';
import { PunchClock } from '../components/PunchClock';
import { ApiError, api } from '../lib/api';
import { formatDay, formatDuration, formatTime, outageDurationMs, toLocalInput } from '../lib/format';
import { useNow } from '../lib/now';
import { getTurnstileToken } from '../lib/turnstile';
import { button, errorText, input, label, smallButton } from '../styles/ui.css';
import * as css from './Admin.css';

/** Error line under a form or row; role="alert" so screen readers announce it. */
const FormError: Component<{ message: string }> = (props) => (
  <Show when={props.message}>
    <p class={errorText} role="alert">
      {props.message}
    </p>
  </Show>
);

const describeError = (error: unknown) =>
  error instanceof ApiError
    ? ({
        unauthorized: 'Wrong username or password.',
        rate_limited: 'Too many attempts. Wait a minute and try again.',
        turnstile_failed: 'The bot check failed. Please try again.',
        outage_already_open: 'An outage is already open.',
        no_open_outage: 'There is no open outage to close.',
      }[error.code] ?? `Request failed (${error.code}).`)
    : 'Network error.';

const LoginForm: Component<{ onLoggedIn: () => void }> = (props) => {
  let widget!: HTMLDivElement;
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const username = String(form.get('username') ?? '');
    const password = String(form.get('password') ?? '');
    setBusy(true);
    setError('');
    try {
      // The public status response carries the Turnstile site key.
      const { turnstileSiteKey } = await api.status();
      const token = await getTurnstileToken(widget, turnstileSiteKey, 'login');
      await api.login(username, password, token);
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
      {/* Named form, ids and autocomplete hints so password managers recognise and fill it. */}
      <form class={css.stack} onSubmit={submit} id="admin-sign-in" name="admin-sign-in">
        <label class={label}>
          Username
          <input
            class={input}
            type="text"
            id="username"
            name="username"
            autocomplete="username"
            autocapitalize="none"
            spellcheck={false}
            required
          />
        </label>
        <label class={label}>
          Password
          <input class={input} type="password" id="password" name="password" autocomplete="current-password" required />
        </label>
        <div ref={widget} />
        <FormError message={error()} />
        <button type="submit" class={button.primary} disabled={busy()}>
          {busy() ? 'Checking…' : 'Sign in'}
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

  return (
    <li class={css.item}>
      <div class={clsx(props.outage.isFalsePositive && css.flagged)}>
        <strong>
          {formatDay(props.outage.startTime)}, {formatTime(props.outage.startTime)} –{' '}
          {props.outage.endTime ? formatTime(props.outage.endTime) : 'ongoing'}
        </strong>
        <div class={css.itemMeta}>
          {formatDuration(outageDurationMs(props.outage, props.now))} · {props.outage.source} ·{' '}
          {props.outage.confirmations} confirmed
          {props.outage.planned ? ' · planned' : ''}
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
          aria-pressed={props.outage.planned}
          onClick={() => run(() => api.updateOutage(props.outage.id, { isPlanned: !props.outage.planned }))}
        >
          {props.outage.planned ? 'Not planned' : 'Planned'}
        </button>
        <button
          type="button"
          class={clsx(button.ghost, smallButton)}
          onClick={() => confirm('Delete this outage?') && run(() => api.deleteOutage(props.outage.id))}
        >
          Delete
        </button>
      </div>
      <FormError message={error()} />
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
      await api.createOutage(
        new Date(start).toISOString(),
        end ? new Date(end).toISOString() : null,
        data.get('planned') === 'on',
      );
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
        <label class={css.checkbox}>
          <input type="checkbox" name="planned" /> Planned (announced maintenance or upgrades)
        </label>
        <FormError message={error()} />
        <button type="submit" class={button.primary}>
          <Plus size={18} aria-hidden="true" /> Log outage
        </button>
      </form>
    </section>
  );
};

const Dashboard: Component<{ initial: AdminOutagesResponse; onLoggedOut: () => void }> = (props) => {
  const now = useNow(1000);
  const minute = createMemo(() => Math.floor(now() / MINUTE_MS) * MINUTE_MS);
  // Starts from the list the session check already fetched; changes refresh it.
  const [outages, setOutages] = createSignal(props.initial);
  const [loading, setLoading] = createSignal(false);
  const refetch = async () => {
    setLoading(true);
    try {
      setOutages(await api.outages());
    } finally {
      setLoading(false);
    }
  };
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const open = () => outages().outages.find((o) => !o.endTime && !o.isFalsePositive) ?? null;

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
          busy={busy() || loading()}
          onPunchOut={() => punch('punch_out')}
          onPunchIn={() => punch('punch_in')}
        />
        <FormError message={error()} />
      </section>

      <LogOutageForm onLogged={refetch} />

      <section class="gg-card">
        <h2 class="gg-card-title">Outages</h2>
        <Show when={outages().outages.length > 0} fallback={<p>No outages yet.</p>}>
          <ul class={css.table}>
            <For each={outages().outages}>{(o) => <OutageRow outage={o} now={minute()} onChange={refetch} />}</For>
          </ul>
        </Show>
      </section>
    </>
  );
};

const Admin: Component = () => {
  // The protected outage list doubles as the session check: null means signed out.
  const [session, { refetch }] = createResource(async () => {
    try {
      return await api.outages();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return null;
      throw e;
    }
  });

  return (
    <>
      <a class={css.backLink} href="/">
        <ArrowLeft size={16} aria-hidden="true" /> Public page
      </a>
      <Show when={session() !== undefined} fallback={<p class="gg-status-note">Loading…</p>}>
        <Show when={session()} fallback={<LoginForm onLoggedIn={refetch} />}>
          {(data) => <Dashboard initial={data()} onLoggedOut={refetch} />}
        </Show>
      </Show>
    </>
  );
};

export default Admin;
