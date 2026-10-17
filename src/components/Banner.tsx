import X from 'lucide-solid/icons/x';
import { type Component, createMemo, createSignal, Show } from 'solid-js';
import { MINUTE_MS } from '../../shared/api';
import { activeBanners } from '../banners';
import { locale } from '../lib/i18n';
import { useNow } from '../lib/now';
import * as css from './Banner.css';

// The banner's own chrome; its copy lives with each entry in banners.ts.
const UI = {
  af: { region: 'Kennisgewing', dismiss: 'Maak toe' },
  en: { region: 'Notice', dismiss: 'Dismiss' },
} as const;

const storageKey = (id: string) => `banner-dismissed:${id}`;

function storedDismissal(id: string): boolean {
  try {
    return localStorage.getItem(storageKey(id)) === '1';
  } catch {
    return false;
  }
}

/** The first active banner the visitor hasn't dismissed, rechecked every minute so it ends on time. */
export const SiteBanner: Component = () => {
  const now = useNow(MINUTE_MS);
  // Dismissed this visit, which also covers storage being unavailable.
  const [dismissed, setDismissed] = createSignal<ReadonlySet<string>>(new Set());
  const banner = createMemo(() => activeBanners(now()).find((b) => !dismissed().has(b.id) && !storedDismissal(b.id)));

  const dismiss = (id: string, button: HTMLElement) => {
    const hadFocus = document.activeElement === button;
    try {
      localStorage.setItem(storageKey(id), '1');
    } catch {
      // Storage can be unavailable (private mode); it stays closed for this visit.
    }
    setDismissed((ids) => new Set([...ids, id]));
    // The button is gone, so hand focus to the main content rather than dropping it on <body>.
    if (hadFocus) document.querySelector<HTMLElement>('.gg-main')?.focus({ preventScroll: true });
  };

  return (
    <Show when={banner()} keyed>
      {(b) => (
        <section class={css.root[b.tone ?? 'info']} aria-label={UI[locale()].region}>
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
            aria-label={UI[locale()].dismiss}
            title={UI[locale()].dismiss}
            onClick={(event) => dismiss(b.id, event.currentTarget)}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </section>
      )}
    </Show>
  );
};
