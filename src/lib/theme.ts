import { createSignal } from 'solid-js';
import { PAGE_BG } from '../styles/theme.css';

type Theme = keyof typeof PAGE_BG;

const STORAGE_KEY = 'theme';

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

export function setTheme(next: Theme): void {
  applyTheme(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage can be unavailable (private mode); the toggle still works for this visit.
  }
}

/** Follow OS changes while the visitor has not picked a theme themselves. */
export function watchSystemTheme(): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = (event: MediaQueryListEvent) => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {}
    if (stored) return;
    applyTheme(event.matches ? 'dark' : 'light');
  };
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
