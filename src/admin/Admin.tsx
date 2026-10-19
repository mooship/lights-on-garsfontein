import ArrowLeft from 'lucide-solid/icons/arrow-left';
import LogOut from 'lucide-solid/icons/log-out';
import Plus from 'lucide-solid/icons/plus';
import {
  batch,
  type Component,
  createResource,
  createSignal,
  Index,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import {
  type AdminOutage,
  type AdminOutagesResponse,
  CREDENTIAL_MAX_LENGTH,
  outageDurationMs,
  type SensorReading,
  TIMER_ACTION,
  type TimerAction,
  TURNSTILE_ACTION,
} from '../../shared/api';
import { ERROR } from '../../shared/errors';
import { PunchClock } from '../components/PunchClock';
import { ApiError, api } from '../lib/api';
import {
  formatDay,
  formatDuration,
  formatEnd,
  formatRelativeDay,
  formatTime,
  fromLocalInput,
  toLocalInput,
} from '../lib/format';
import { t } from '../lib/i18n';
import { useMinute, useNow } from '../lib/now';
import { POLL_MS, whenVisible } from '../lib/poll';
import { getTurnstileToken, loadTurnstile } from '../lib/turnstile';
import { button, errorText, input, label, plainList } from '../styles/ui.css';
import * as css from './Admin.css';
import { type AdminErrorCode, admin } from './copy';
import { sensorState } from './sensor';

const isUnauthorized = (error: unknown) => error instanceof ApiError && error.status === 401;

/** The message for an ApiError or an error code; anything else is a network failure. */
function describeError(error: unknown): string {
  const code = error instanceof ApiError ? error.code : typeof error === 'string' ? error : null;
  if (code === null) return admin.network;
  return (admin.errors as Record<string, string | undefined>)[code] ?? admin.requestFailed(code);
}

const FormError: Component<{ error: unknown }> = (props) => (
  <Show when={props.error !== undefined}>
    <p class={errorText} role="alert">
      {describeError(props.error)}
    </p>
  </Show>
);

/** Reports a failed dashboard action: a 401 ends the session, anything else shows through `show`. */
type OnError = (error: unknown, show: (error: unknown) => void) => void;

/** Busy and error state for one form or button; a failure goes to `onError`, which by default shows it. */
function createAction({ onError = (e, show) => show(e), initialError }: { onError?: OnError; initialError?: unknown }) {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<unknown>(initialError);
  // Buttons are aria-disabled while busy, so they keep focus; this is what stops a second press.
  const run = async (fn: () => Promise<unknown>) => {
    if (busy()) return;
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      onError(e, setError);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

const LoginForm: Component<{ notice?: AdminErrorCode; focus: boolean; onLoggedIn: () => void }> = (props) => {
  let widget!: HTMLDivElement;
  let heading!: HTMLHeadingElement;
  // Starts with the reason the last session ended, if any.
  const { busy, error, run } = createAction({ initialError: props.notice });
  onMount(() => props.focus && heading.focus());

  function submit(event: SubmitEvent) {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const username = String(form.get('username') ?? '');
    const password = String(form.get('password') ?? '');
    return run(async () => {
      // The public status response carries the Turnstile site key; the script loads meanwhile.
      const [{ turnstileSiteKey }] = await Promise.all([api.status(), loadTurnstile()]);
      const token = await getTurnstileToken(widget, turnstileSiteKey, TURNSTILE_ACTION.login);
      await api.login(username, password, token);
      props.onLoggedIn();
    });
  }

  return (
    <section class="gg-card">
      <h2 ref={heading} class="gg-card-title" tabindex="-1">
        {admin.signInTitle}
      </h2>
      {/* Named form, ids and autocomplete hints so password managers recognise and fill it. */}
      <form class={css.stack} onSubmit={submit} id="admin-sign-in" name="admin-sign-in">
        <label class={label}>
          {admin.username}
          <input
            class={input}
            type="text"
            id="username"
            maxlength={CREDENTIAL_MAX_LENGTH.username}
            name="username"
            autocomplete="username"
            autocapitalize="none"
            spellcheck={false}
            required
          />
        </label>
        <label class={label}>
          {admin.password}
          <input
            class={input}
            type="password"
            id="password"
            name="password"
            autocomplete="current-password"
            maxlength={CREDENTIAL_MAX_LENGTH.password}
            required
          />
        </label>
        <div ref={widget} />
        <FormError error={error()} />
        <button type="submit" class={button.primary} aria-disabled={busy()}>
          {busy() ? admin.checking : admin.signIn}
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
  const { busy, error, run: act } = createAction({ onError: props.onError });
  const titleId = () => `outage-${props.outage.id}-title`;
  const run = (change: () => Promise<unknown>) =>
    act(async () => {
      await change();
      await props.onChange();
    });

  return (
    <li class={css.item}>
      <div classList={{ [css.flagged]: props.outage.isFalsePositive }}>
        <strong id={titleId()}>
          {formatDay(props.outage.startTime)}, {formatTime(props.outage.startTime)} –{' '}
          {props.outage.endTime ? formatEnd(props.outage.startTime, props.outage.endTime) : admin.ongoing}
        </strong>
        <div class={css.itemMeta}>
          {formatDuration(outageDurationMs(props.outage, props.now))} · {admin.source[props.outage.source]}
          {props.outage.planned ? admin.plannedTag : ''}
          {props.outage.dismissedBy === 'sensor'
            ? admin.dismissedBySensorTag
            : props.outage.isFalsePositive
              ? admin.falsePositiveTag
              : ''}
        </div>
      </div>
      <div class={css.actions}>
        <Show when={!props.outage.endTime}>
          <button
            type="button"
            class={button.ghost}
            aria-describedby={titleId()}
            aria-disabled={busy()}
            onClick={() => run(() => api.updateOutage(props.outage.id, { endTime: new Date().toISOString() }))}
          >
            {admin.closeNow}
          </button>
        </Show>
        <button
          type="button"
          class={button.ghost}
          aria-describedby={titleId()}
          aria-pressed={props.outage.isFalsePositive}
          aria-disabled={busy()}
          onClick={() =>
            run(() => api.updateOutage(props.outage.id, { isFalsePositive: !props.outage.isFalsePositive }))
          }
        >
          {admin.falsePositive}
        </button>
        <button
          type="button"
          class={button.ghost}
          aria-describedby={titleId()}
          aria-pressed={props.outage.planned}
          aria-disabled={busy()}
          onClick={() => run(() => api.updateOutage(props.outage.id, { isPlanned: !props.outage.planned }))}
        >
          {admin.planned}
        </button>
        <button
          type="button"
          class={button.ghost}
          aria-describedby={titleId()}
          aria-disabled={busy()}
          onClick={() => confirm(admin.deleteConfirm) && run(() => api.deleteOutage(props.outage.id))}
        >
          {admin.delete}
        </button>
      </div>
      <FormError error={error()} />
    </li>
  );
};

const LogOutageForm: Component<{ onLogged: () => Promise<void>; onError: OnError }> = (props) => {
  const [saved, setSaved] = createSignal(false);
  const { busy, error, run } = createAction({ onError: props.onError });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const start = fromLocalInput(String(data.get('start') ?? ''));
    const end = data.get('end') ? fromLocalInput(String(data.get('end'))) : null;
    setSaved(false);
    return run(async () => {
      if (end && Date.parse(end) <= Date.parse(start)) throw ERROR.endBeforeStart;
      await api.createOutage(start, end, data.get('planned') === 'on');
      form.reset();
      setSaved(true);
      await props.onLogged();
    });
  }

  return (
    <section class="gg-card">
      <h2 class="gg-card-title">{admin.logTitle}</h2>
      <form class={css.stack} onSubmit={submit}>
        <div class={css.formRow}>
          <label class={label}>
            {admin.started}
            <input
              class={input}
              type="datetime-local"
              name="start"
              required
              max={toLocalInput(new Date().toISOString())}
            />
          </label>
          <label class={label}>
            {admin.ended}
            <input class={input} type="datetime-local" name="end" />
          </label>
        </div>
        <label class={css.checkbox}>
          <input type="checkbox" name="planned" /> {admin.plannedHint}
        </label>
        <FormError error={error()} />
        <button type="submit" class={button.primary} aria-disabled={busy()}>
          <Plus size={18} aria-hidden="true" /> {busy() ? admin.saving : admin.log}
        </button>
        <p class={css.saved} role="status">
          {saved() ? admin.logged : ''}
        </p>
      </form>
    </section>
  );
};

const at = (iso: string, now: number) => `${formatTime(iso)} ${formatRelativeDay(iso, now)}`;

/** The sensor's state as of `asOf`, when the list last arrived, so a lost connection here never reads as a silent sensor. */
const SensorLine: Component<{ sensor: SensorReading | null; asOf: number }> = (props) => {
  const state = () => sensorState(props.sensor, props.asOf);
  return (
    <p class={css.sensor} classList={{ [css.sensorSilent]: state().kind === 'silent' }}>
      {(() => {
        const s = state();
        switch (s.kind) {
          case 'never':
            return admin.sensor.never;
          case 'paused':
            return admin.sensor.paused(at(s.until, props.asOf));
          case 'reporting':
            return admin.sensor.reporting(at(s.lastSeen, props.asOf));
          case 'silent':
            return admin.sensor.silent(formatDuration(s.forMs), at(s.since, props.asOf));
        }
      })()}
    </p>
  );
};

const Dashboard: Component<{
  initial: AdminOutagesResponse;
  focus: boolean;
  onLoggedOut: (notice?: AdminErrorCode) => void;
}> = (props) => {
  let heading!: HTMLHeadingElement;
  onMount(() => props.focus && heading.focus());
  const now = useNow(1000);
  const minute = useMinute(now);
  // Starts from the list the session check already fetched; changes refresh it.
  const [outages, setOutages] = createSignal(props.initial);
  const [loadedAt, setLoadedAt] = createSignal(Date.now());
  const [refreshFailed, setRefreshFailed] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const load = async () => {
    const data = await api.outages();
    batch(() => {
      setOutages(data);
      setLoadedAt(Date.now());
      setRefreshFailed(false);
    });
  };
  const refetch = async () => {
    setLoading(true);
    try {
      await load();
    } finally {
      setLoading(false);
    }
  };
  const [punched, setPunched] = createSignal<{ action: TimerAction; at: string } | null>(null);
  const open = () => outages().outages.find((o) => !o.endTime && !o.isFalsePositive) ?? null;
  const onError: OnError = (e, show) => (isUnauthorized(e) ? props.onLoggedOut('session_expired') : show(e));
  const { busy, error, run } = createAction({ onError });

  // Keeps the sensor line and the list current; a failure keeps the last data and says so.
  onMount(() => {
    const poll = whenVisible(() => {
      load().catch((e) => onError(e, () => setRefreshFailed(true)));
    });
    const timer = setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', poll);
    onCleanup(() => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', poll);
    });
  });

  const punch = (action: TimerAction) =>
    run(async () => {
      setPunched(null);
      await api.punch(action);
      setPunched({ action, at: new Date().toISOString() });
      await refetch();
    });

  const logout = async () => {
    // The view signs out whatever the server says; a failed call leaves a session that expires.
    await api.logout().catch(() => {});
    props.onLoggedOut();
  };

  return (
    <>
      <section class="gg-card">
        <div class={css.header}>
          <h2 ref={heading} class="gg-card-title" tabindex="-1">
            {admin.punchClock}
          </h2>
          <button type="button" class={button.ghost} onClick={logout}>
            <LogOut size={16} aria-hidden="true" /> {admin.signOut}
          </button>
        </div>
        <PunchClock
          outage={open()}
          now={now()}
          busy={busy() || loading()}
          onPunchOut={() => punch(TIMER_ACTION.punchOut)}
          onPunchIn={() => punch(TIMER_ACTION.punchIn)}
        />
        <SensorLine sensor={outages().sensor} asOf={loadedAt()} />
        <Show when={refreshFailed()}>
          <p class={css.sensor} role="alert">
            {admin.sensor.stale(formatTime(new Date(loadedAt()).toISOString()))}
          </p>
        </Show>
        <FormError error={error()} />
        <p class={css.announce} role="status">
          {(() => {
            const p = punched();
            if (!p) return '';
            const time = formatTime(p.at);
            return p.action === TIMER_ACTION.punchOut ? admin.punchedOut(time) : admin.punchedIn(time);
          })()}
        </p>
      </section>

      <LogOutageForm onLogged={refetch} onError={onError} />

      <section class="gg-card">
        <h2 class="gg-card-title">{admin.outages}</h2>
        <Show when={outages().outages.length > 0} fallback={<p>{admin.noOutages}</p>}>
          <ul class={plainList}>
            {/* Index, not For: a refetch brings new objects, and For would rebuild every row and drop the
                focus of the button just pressed. */}
            <Index each={outages().outages}>
              {(o) => <OutageRow outage={o()} now={minute()} onChange={refetch} onError={onError} />}
            </Index>
          </ul>
        </Show>
      </section>
    </>
  );
};

const Admin: Component = () => {
  // The shell's title is the public page's, in Afrikaans.
  document.title = admin.pageTitle;
  // The protected outage list doubles as the session check: null means signed out.
  const [session, { refetch }] = createResource(async () => {
    try {
      return await api.outages();
    } catch (e) {
      if (isUnauthorized(e)) return null;
      throw e;
    }
  });
  const [notice, setNotice] = createSignal<AdminErrorCode>();
  // Focus moves to the new view's heading after signing in or out, not on first load.
  const [moved, setMoved] = createSignal(false);
  const switchView = (reason?: AdminErrorCode) => {
    setNotice(reason);
    setMoved(true);
    refetch();
  };

  // Reading a resource in error throws, so the error case comes first.
  return (
    <>
      <a class={css.backLink} href="/">
        <ArrowLeft size={16} aria-hidden="true" /> {admin.back}
      </a>
      <Switch
        fallback={
          <p class="gg-status-note" role="status">
            {t().loading}
          </p>
        }
      >
        <Match when={session.error}>
          <section class={`gg-card ${css.stack}`}>
            <p class={errorText} role="alert">
              {admin.unreachable}
            </p>
            <button
              type="button"
              class={button.ghost}
              aria-disabled={session.loading}
              onClick={() => !session.loading && refetch()}
            >
              {admin.retry}
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
