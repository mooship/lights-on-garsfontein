import clsx from 'clsx';
import ArrowLeft from 'lucide-solid/icons/arrow-left';
import LogOut from 'lucide-solid/icons/log-out';
import Plus from 'lucide-solid/icons/plus';
import { type Component, createResource, createSignal, For, Match, onMount, Show, Switch } from 'solid-js';
import type { AdminOutage, AdminOutagesResponse, TimerAction } from '../../shared/api';
import { PunchClock } from '../components/PunchClock';
import { ApiError, api } from '../lib/api';
import { formatDay, formatDuration, formatTime, fromLocalInput, outageDurationMs, toLocalInput } from '../lib/format';
import { useMinute, useNow } from '../lib/now';
import { getTurnstileToken } from '../lib/turnstile';
import { button, errorText, input, label, plainList } from '../styles/ui.css';
import * as css from './Admin.css';

/** Error line under a form or row; role="alert" so screen readers announce it. */
const FormError: Component<{ message: string }> = (props) => (
  <Show when={props.message}>
    <p class={errorText} role="alert">
      {props.message}
    </p>
  </Show>
);

const SESSION_EXPIRED = 'Your session expired. Sign in again.';

const isUnauthorized = (error: unknown) => error instanceof ApiError && error.status === 401;

const describeError = (error: unknown) =>
  error instanceof ApiError
    ? ({
        unauthorized: 'Wrong username or password.',
        rate_limited: 'Too many attempts. Wait a minute and try again.',
        turnstile_failed: 'The bot check failed. Please try again.',
        outage_already_open: 'An outage is already open.',
        no_open_outage: 'There is no open outage to close.',
        end_before_start: 'The end must be after the start.',
        invalid_json: 'The request was garbled. Reload the page and try again.',
        bad_request: 'Check the times and try again. They can’t be in the future.',
        not_found: 'That outage no longer exists. Reload the page.',
      }[error.code] ?? `Request failed (${error.code}).`)
    : 'Network error.';

/** Reports a failed dashboard action: a 401 ends the session, anything else shows through `show`. */
type OnError = (error: unknown, show: (message: string) => void) => void;

const LoginForm: Component<{ notice: string; focus: boolean; onLoggedIn: () => void }> = (props) => {
  let widget!: HTMLDivElement;
  let heading!: HTMLHeadingElement;
  // Starts with the reason the last session ended, if any.
  const [error, setError] = createSignal(props.notice);
  const [busy, setBusy] = createSignal(false);
  onMount(() => props.focus && heading.focus());

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
      <h2 ref={heading} class="gg-card-title" tabindex="-1">
        Admin sign in
      </h2>
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

const OutageRow: Component<{
  outage: AdminOutage;
  now: number;
  onChange: () => Promise<void>;
  onError: OnError;
}> = (props) => {
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const titleId = () => `outage-${props.outage.id}-title`;
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      await props.onChange();
    } catch (e) {
      props.onError(e, setError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li class={css.item}>
      <div class={clsx(props.outage.isFalsePositive && css.flagged)}>
        <strong id={titleId()}>
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
            class={button.ghost}
            aria-describedby={titleId()}
            disabled={busy()}
            onClick={() => run(() => api.updateOutage(props.outage.id, { endTime: new Date().toISOString() }))}
          >
            Close now
          </button>
        </Show>
        <button
          type="button"
          class={button.ghost}
          aria-describedby={titleId()}
          aria-pressed={props.outage.isFalsePositive}
          disabled={busy()}
          onClick={() =>
            run(() => api.updateOutage(props.outage.id, { isFalsePositive: !props.outage.isFalsePositive }))
          }
        >
          False positive
        </button>
        <button
          type="button"
          class={button.ghost}
          aria-describedby={titleId()}
          aria-pressed={props.outage.planned}
          disabled={busy()}
          onClick={() => run(() => api.updateOutage(props.outage.id, { isPlanned: !props.outage.planned }))}
        >
          Planned
        </button>
        <button
          type="button"
          class={button.ghost}
          aria-describedby={titleId()}
          disabled={busy()}
          onClick={() => confirm('Delete this outage?') && run(() => api.deleteOutage(props.outage.id))}
        >
          Delete
        </button>
      </div>
      <FormError message={error()} />
    </li>
  );
};

const LogOutageForm: Component<{ onLogged: () => Promise<void>; onError: OnError }> = (props) => {
  const [error, setError] = createSignal('');
  const [saved, setSaved] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const start = fromLocalInput(String(data.get('start') ?? ''));
    const end = data.get('end') ? fromLocalInput(String(data.get('end'))) : null;
    setError('');
    setSaved('');
    if (end && Date.parse(end) <= Date.parse(start)) {
      setError('The end must be after the start.');
      return;
    }
    setBusy(true);
    try {
      await api.createOutage(start, end, data.get('planned') === 'on');
      form.reset();
      setSaved('Outage logged.');
      await props.onLogged();
    } catch (e) {
      props.onError(e, setError);
    } finally {
      setBusy(false);
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
        <button type="submit" class={button.primary} disabled={busy()}>
          <Plus size={18} aria-hidden="true" /> {busy() ? 'Saving…' : 'Log outage'}
        </button>
        <p class={css.saved} role="status">
          {saved()}
        </p>
      </form>
    </section>
  );
};

const Dashboard: Component<{
  initial: AdminOutagesResponse;
  focus: boolean;
  onLoggedOut: (notice?: string) => void;
}> = (props) => {
  let heading!: HTMLHeadingElement;
  onMount(() => props.focus && heading.focus());
  const now = useNow(1000);
  const minute = useMinute(now);
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
  const onError: OnError = (e, show) =>
    isUnauthorized(e) ? props.onLoggedOut(SESSION_EXPIRED) : show(describeError(e));

  const punch = async (action: TimerAction) => {
    setBusy(true);
    setError('');
    try {
      await api.punch(action);
      await refetch();
    } catch (e) {
      onError(e, setError);
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
          <h2 ref={heading} class="gg-card-title" tabindex="-1">
            Punch clock
          </h2>
          <button type="button" class={button.ghost} onClick={logout}>
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

      <LogOutageForm onLogged={refetch} onError={onError} />

      <section class="gg-card">
        <h2 class="gg-card-title">Outages</h2>
        <Show when={outages().outages.length > 0} fallback={<p>No outages yet.</p>}>
          <ul class={plainList}>
            <For each={outages().outages}>
              {(o) => <OutageRow outage={o} now={minute()} onChange={refetch} onError={onError} />}
            </For>
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
      if (isUnauthorized(e)) return null;
      throw e;
    }
  });
  const [notice, setNotice] = createSignal('');
  // Focus moves to the new view's heading after signing in or out, not on first load.
  const [moved, setMoved] = createSignal(false);
  const switchView = (message = '') => {
    setNotice(message);
    setMoved(true);
    refetch();
  };

  // Reading a resource in error throws, so the error case comes first.
  return (
    <>
      <a class={css.backLink} href="/">
        <ArrowLeft size={16} aria-hidden="true" /> Public page
      </a>
      <Switch
        fallback={
          <p class="gg-status-note" role="status">
            Loading…
          </p>
        }
      >
        <Match when={session.error}>
          <section class={clsx('gg-card', css.stack)}>
            <p class={errorText} role="alert">
              Couldn’t reach the server.
            </p>
            <button type="button" class={button.ghost} disabled={session.loading} onClick={() => refetch()}>
              Try again
            </button>
          </section>
        </Match>
        <Match when={session() === null}>
          <LoginForm notice={notice()} focus={moved()} onLoggedIn={() => switchView()} />
        </Match>
        <Match when={session()}>
          {(data) => <Dashboard initial={data()} focus={moved()} onLoggedOut={switchView} />}
        </Match>
      </Switch>
    </>
  );
};

export default Admin;
