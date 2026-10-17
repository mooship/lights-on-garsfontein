import X from 'lucide-solid/icons/x';
import { type Component, createMemo, createSignal, Show } from 'solid-js';
import { MINUTE_MS } from '../../shared/api';
import { activeBanners } from '../banners';
import { locale, t } from '../lib/i18n';
import { useNow } from '../lib/now';
import { isFlagged, setFlag } from '../lib/storage';
import * as css from './Banner.css';

const storageKey = (id: string) => `banner-dismissed:${id}`;

/** The first active banner the visitor hasn't dismissed, rechecked every minute so it ends on time. */
export const SiteBanner: Component = () => {
  const now = useNow(MINUTE_MS);
  // Dismissed this visit, which also covers storage being unavailable.
  const [dismissed, setDismissed] = createSignal<ReadonlySet<string>>(new Set());
  const banner = createMemo(() =>
    activeBanners(now()).find((b) => !dismissed().has(b.id) && !isFlagged(storageKey(b.id))),
  );

  const dismiss = (id: string, button: HTMLElement) => {
    const hadFocus = document.activeElement === button;
    setFlag(storageKey(id));
    setDismissed((ids) => new Set([...ids, id]));
    // The button is gone, so hand focus to the main content rather than dropping it on <body>.
    if (hadFocus) document.querySelector<HTMLElement>('.gg-main')?.focus({ preventScroll: true });
  };

  return (
    <Show when={banner()} keyed>
      {(b) => (
        <section class={css.root} aria-label={t().banner.region}>
          <div class={css.body}>
            <p>{b.text[locale()]}</p>
            <Show when={b.link}>
              {(link) => (
                <a class={css.link} href={link().href}>
                  {link().label[locale()]}
                </a>
              )}
            </Show>
          </div>
          <button
            type="button"
            class={css.close}
            aria-label={t().banner.dismiss}
            title={t().banner.dismiss}
            onClick={(event) => dismiss(b.id, event.currentTarget)}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </section>
      )}
    </Show>
  );
};
