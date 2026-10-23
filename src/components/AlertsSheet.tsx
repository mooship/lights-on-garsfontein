import BellRing from 'lucide-solid/icons/bell-ring';
import { type Component, createSignal, For, Match, onCleanup, onMount, Show, Switch } from 'solid-js';
import { busy, CARD_ID, closeCard, offering, state, takesFocus, turnOn } from '../lib/alerts-store';
import { privacyHref, t } from '../lib/i18n';
import { button } from '../styles/ui.css';
import * as css from './AlertsSheet.css';

/** The alerts card itself, mounted while it is open. */
export const AlertsSheet: Component = () => {
  const [failed, setFailed] = createSignal(false);
  const m = () => t().alerts.card;
  let heading!: HTMLHeadingElement;

  // Escape puts off a card that offered something, and otherwise just closes it.
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') closeCard(offering() ? 'notNow' : 'close');
  };
  onMount(() => {
    if (takesFocus()) heading.focus({ preventScroll: true });
    document.addEventListener('keydown', onKey);
  });
  onCleanup(() => document.removeEventListener('keydown', onKey));

  async function onTurnOn() {
    if (busy()) return;
    setFailed(false);
    setFailed(!(await turnOn()));
  }

  return (
    <section id={CARD_ID} class={`gg-card ${css.card}`} role="dialog" aria-labelledby="alerts-heading">
      <div class={css.header}>
        <span class={css.icon}>
          <BellRing size={22} aria-hidden="true" />
        </span>
        <h2 id="alerts-heading" class={css.heading} tabindex="-1" ref={heading}>
          {m().heading}
        </h2>
      </div>
      <Switch>
        <Match when={state() === 'blocked'}>
          <p class={css.text}>{m().blockedHelp}</p>
        </Match>
        <Match when={state() === 'unsupported'}>
          <p class={css.text}>{m().unsupported}</p>
        </Match>
        <Match when={true}>
          <p class={css.text}>{m().body}</p>
          <Show when={state() === 'ios-install'}>
            <p class={css.text}>{m().iosIntro}</p>
            <ol class={css.steps}>
              <For each={m().iosSteps}>
                {(step) => (
                  <li>
                    <For each={step.split(m().iosMenuItem)}>
                      {(part, i) => (
                        <>
                          {i() > 0 && <span lang="en">{m().iosMenuItem}</span>}
                          {part}
                        </>
                      )}
                    </For>
                  </li>
                )}
              </For>
            </ol>
          </Show>
        </Match>
      </Switch>
      <p class={css.scope}>
        {m().scope}
        <Show when={offering()}>
          {' '}
          <a class={css.link} href={privacyHref()}>
            {m().privacy}
          </a>
        </Show>
      </p>
      <p class={css.failed} aria-live="polite">
        {failed() ? m().failed : ''}
      </p>
      <div class={css.actions}>
        <Show
          when={offering()}
          fallback={
            <button type="button" class={`${button.ghost} ${css.wide}`} onClick={() => closeCard('close')}>
              {m().close}
            </button>
          }
        >
          {/* An iPhone outside the home screen cannot turn alerts on, so it gets the steps instead. */}
          <Show when={state() === 'off'}>
            <button type="button" class={`${button.primary} ${css.wide}`} aria-disabled={busy()} onClick={onTurnOn}>
              {m().turnOn}
            </button>
          </Show>
          <button type="button" class={button.ghost} onClick={() => closeCard('notNow')}>
            {m().notNow}
          </button>
          <button type="button" class={button.ghost} onClick={() => closeCard('noThanks')}>
            {m().noThanks}
          </button>
        </Show>
      </div>
    </section>
  );
};
