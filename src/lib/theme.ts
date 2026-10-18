import { createSignal } from 'solid-js';
import { PAGE_BG } from '../styles/theme.css';
import { readStored, STORAGE_KEYS, writeStored } from './storage';

type Theme = keyof typeof PAGE_BG;

const currentTheme = (): Theme => (document.documentElement.classList.contains('dark') ? 'dark' : 'light');

const [theme, setThemeSignal] = createSignal<Theme>(currentTheme());

export { theme };

/** Colours the phone's status bar to match the active theme, even when it differs from the OS setting. */
export function syncThemeColor(active: Theme = currentTheme()): void {
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = PAGE_BG[active];
  }
}

function applyTheme(next: Theme): void {
  document.documentElement.classList.remove('light', 'dark');
  document.documentElement.classList.add(next);
  setThemeSignal(next);
  syncThemeColor(next);
}

/** The visitor's own choice: remembered, and from then on it overrides the OS setting. */
export function setTheme(next: Theme): void {
  applyTheme(next);
  writeStored(STORAGE_KEYS.theme, next);
}

/** Follow OS changes while the visitor has not picked a theme themselves. */
export function watchSystemTheme(): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = (event: MediaQueryListEvent) => {
    if (!readStored(STORAGE_KEYS.theme)) applyTheme(event.matches ? 'dark' : 'light');
  };
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
