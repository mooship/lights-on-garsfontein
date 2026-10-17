import clsx from 'clsx';
import ArrowLeft from 'lucide-solid/icons/arrow-left';
import LogOut from 'lucide-solid/icons/log-out';
import Plus from 'lucide-solid/icons/plus';
import { type Component, createResource, createSignal, For, Match, onMount, Show, Switch } from 'solid-js';
import type { AdminOutage, AdminOutagesResponse, TimerAction } from '../../shared/api';
import { PunchClock } from '../components/PunchClock';
import type { Messages } from '../i18n/af';
import { ApiError, api } from '../lib/api';
import { formatDay, formatDuration, formatTime, fromLocalInput, outageDurationMs, toLocalInput } from '../lib/format';
import { t } from '../lib/i18n';
import { useMinute, useNow } from '../lib/now';
import { getTurnstileToken } from '../lib/turnstile';
import { button, errorText, input, label, plainList } from '../styles/ui.css';
import * as css from './Admin.css';

type ErrorCode = keyof Messages['admin']['errors'];

const isUnauthorized = (error: unknown) => error instanceof ApiError && error.status === 401;

/** The message for an ApiError or an error code; anything else is a network failure. */
function describeError(error: unknown): string {
  const code = error instanceof ApiError ? error.code : typeof error === 'string' ? error : null;
  if (code === null) return t().admin.network;
  return (t().admin.errors as Record<string, string | undefined>)[code] ?? t().admin.requestFailed(code);
}

/** Forms keep the raw error and it is described here, so the message follows a language switch. */
const FormError: Component<{ error: unknown }> = (props) => (
  <Show when={props.error !== undefined}>
    <p class={errorText} role="alert">
      {describeError(props.error)}
    </p>
  </Show>
);

/** Reports a failed dashboard action: a 401 ends the session, anything else shows through `show`. */
type OnError = (error: unknown, show: (error: unknown) => void) => void;

const LoginForm: Component<{ notice?: ErrorCode; focus: boolean; onLoggedIn: () => void }> = (props) => {
  let widget!: HTMLDivElement;
  let heading!: HTMLHeadingElement;
  // Starts with the reason the last session ended, if any.
  const [error, setError] = createSignal<unknown>(props.notice);
  const [busy, setBusy] = createSignal(false);
  onMount(() => props.focus && heading.focus());

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const username = String(form.get('username') ?? '');
    const password = String(form.get('password') ?? '');
    setBusy(true);
    setError(undefined);
    try {
      // The public status response carries the Turnstile site key.
      const { turnstileSiteKey } = await api.status();
      const token = await getTurnstileToken(widget, turnstileSiteKey, 'login');
      await api.login(username, password, token);
      props.onLoggedIn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="gg-card">
      <h2 ref={heading} class="gg-card-title" tabindex="-1">
        {t().admin.signInTitle}
      </h2>
      {/* Named form, ids and autocomplete hints so password managers recognise and fill it. */}
      <form class={css.stack} onSubmit={submit} id="admin-sign-in" name="admin-sign-in">
        <label class={label}>
          {t().admin.username}
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
          {t().admin.password}
          <input class={input} type="password" id="password" name="password" autocomplete="current-password" required />
        </label>
        <div ref={widget} />
        <FormError error={error()} />
        <button type="submit" class={button.primary} disabled={busy()}>
          {busy() ? t().admin.checking : t().admin.signIn}
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
  const [error, setError] = createSignal<unknown>();
  const [busy, setBusy] = createSignal(false);
  const titleId = () => `outage-${props.outage.id}-title`;
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
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
          {props.outage.endTime ? formatTime(props.outage.endTime) : t().admin.ongoing}
        </strong>
        <div class={css.itemMeta}>
          {formatDuration(outageDurationMs(props.outage, props.now))} · {t().admin.source[props.outage.source]} ·{' '}
          {t().admin.confirmed(props.outage.confirmations)}
          {props.outage.planned ? t().admin.plannedTag : ''}
          {props.outage.isFalsePositive ? t().admin.falsePositiveTag : ''}
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
            {t().admin.closeNow}
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
          {t().admin.falsePositive}
        </button>
        <button
          type="button"
          class={button.ghost}
          aria-describedby={titleId()}
          aria-pressed={props.outage.planned}
          disabled={busy()}
          onClick={() => run(() => api.updateOutage(props.outage.id, { isPlanned: !props.outage.planned }))}
        >
          {t().admin.planned}
        </button>
        <button
          type="button"
          class={button.ghost}
          aria-describedby={titleId()}
          disabled={busy()}
          onClick={() => confirm(t().admin.deleteConfirm) && run(() => api.deleteOutage(props.outage.id))}
        >
          {t().admin.delete}
        </button>
      </div>
      <FormError error={error()} />
    </li>
  );
};

const LogOutageForm: Component<{ onLogged: () => Promise<void>; onError: OnError }> = (props) => {
  const [error, setError] = createSignal<unknown>();
  const [saved, setSaved] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const start = fromLocalInput(String(data.get('start') ?? ''));
    const end = data.get('end') ? fromLocalInput(String(data.get('end'))) : null;
    setError(undefined);
    setSaved(false);
    if (end && Date.parse(end) <= Date.parse(start)) {
      setError('end_before_start' satisfies ErrorCode);
      return;
    }
    setBusy(true);
    try {
      await api.createOutage(start, end, data.get('planned') === 'on');
      form.reset();
      setSaved(true);
      await props.onLogged();
    } catch (e) {
      props.onError(e, setError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="gg-card">
      <h2 class="gg-card-title">{t().admin.logTitle}</h2>
      <form class={css.stack} onSubmit={submit}>
        <div class={css.formRow}>
          <label class={label}>
            {t().admin.started}
            <input
              class={input}
              type="datetime-local"
              name="start"
              required
              max={toLocalInput(new Date().toISOString())}
            />
          </label>
          <label class={label}>
            {t().admin.ended}
            <input class={input} type="datetime-local" name="end" />
          </label>
        </div>
        <label class={css.checkbox}>
          <input type="checkbox" name="planned" /> {t().admin.plannedHint}
        </label>
        <FormError error={error()} />
        <button type="submit" class={button.primary} disabled={busy()}>
          <Plus size={18} aria-hidden="true" /> {busy() ? t().admin.saving : t().admin.log}
        </button>
        <p class={css.saved} role="status">
          {saved() ? t().admin.logged : ''}
        </p>
      </form>
    </section>
  );
};

const Dashboard: Component<{
  initial: AdminOutagesResponse;
  focus: boolean;
  onLoggedOut: (notice?: ErrorCode) => void;
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
  const [error, setError] = createSignal<unknown>();
  // The last punch and its time, announced; kept as data so it follows a language switch.
  const [punched, setPunched] = createSignal<{ action: TimerAction; at: string } | null>(null);
  const open = () => outages().outages.find((o) => !o.endTime && !o.isFalsePositive) ?? null;
  const onError: OnError = (e, show) => (isUnauthorized(e) ? props.onLoggedOut('session_expired') : show(e));

  const punch = async (action: TimerAction) => {
    setBusy(true);
    setError(undefined);
    setPunched(null);
    try {
      await api.punch(action);
      setPunched({ action, at: new Date().toISOString() });
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
            {t().admin.punchClock}
          </h2>
          <button type="button" class={button.ghost} onClick={logout}>
            <LogOut size={16} aria-hidden="true" /> {t().admin.signOut}
          </button>
        </div>
        <PunchClock
          outage={open()}
          now={now()}
          busy={busy() || loading()}
          onPunchOut={() => punch('punch_out')}
          onPunchIn={() => punch('punch_in')}
        />
        <FormError error={error()} />
        <p class={css.announce} role="status">
          {(() => {
            const p = punched();
            if (!p) return '';
            const time = formatTime(p.at);
            return p.action === 'punch_out' ? t().admin.punchedOut(time) : t().admin.punchedIn(time);
          })()}
        </p>
      </section>

      <LogOutageForm onLogged={refetch} onError={onError} />

      <section class="gg-card">
        <h2 class="gg-card-title">{t().admin.outages}</h2>
        <Show when={outages().outages.length > 0} fallback={<p>{t().admin.noOutages}</p>}>
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
  const [notice, setNotice] = createSignal<ErrorCode>();
  // Focus moves to the new view's heading after signing in or out, not on first load.
  const [moved, setMoved] = createSignal(false);
  const switchView = (reason?: ErrorCode) => {
    setNotice(reason);
    setMoved(true);
    refetch();
  };

  // Reading a resource in error throws, so the error case comes first.
  return (
    <>
      <a class={css.backLink} href="/">
        <ArrowLeft size={16} aria-hidden="true" /> {t().admin.back}
      </a>
      <Switch
        fallback={
          <p class="gg-status-note" role="status">
            {t().loading}
          </p>
        }
      >
        <Match when={session.error}>
          <section class={clsx('gg-card', css.stack)}>
            <p class={errorText} role="alert">
              {t().admin.unreachable}
            </p>
            <button type="button" class={button.ghost} disabled={session.loading} onClick={() => refetch()}>
              {t().admin.retry}
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
