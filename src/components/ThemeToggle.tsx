import Moon from 'lucide-solid/icons/moon';
import Sun from 'lucide-solid/icons/sun';
import { type Component, Show } from 'solid-js';
import { setTheme, theme } from '../lib/theme';

export const ThemeToggle: Component = () => {
  const next = () => (theme() === 'dark' ? 'light' : 'dark');
  return (
    <button
      type="button"
      class="gg-icon-button"
      aria-label={`Switch to ${next()} theme`}
      title={`Switch to ${next()} theme`}
      onClick={() => setTheme(next())}
    >
      <Show when={theme() === 'dark'} fallback={<Moon size={20} aria-hidden="true" />}>
        <Sun size={20} aria-hidden="true" />
      </Show>
    </button>
  );
};
