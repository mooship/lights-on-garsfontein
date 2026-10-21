import { createGlobalTheme, createThemeContract } from '@vanilla-extract/css';
import { PALETTE } from './palette';

// The @font-face rules and font stacks are in base.css, which index.html links so the static
// shell has them before any JavaScript runs.

export const vars = createThemeContract({
  color: {
    bg: null,
    card: null,
    text: null,
    muted: null,
    border: null,
    inputBorder: null,
    on: null,
    onSoft: null,
    onContrast: null,
    off: null,
    offSoft: null,
    offContrast: null,
    chartOff: null,
    planned: null,
    plannedSoft: null,
    focus: null,
    shadow: null,
  },
  font: { display: null, body: null },
  radius: { card: null, pill: null, control: null },
});

const fonts = { display: 'var(--gg-font-display)', body: 'var(--gg-font-body)' };

const radius = { card: '1.25rem', pill: '999px', control: '0.75rem' };

// Light is the default so the page is themed even before the boot script runs.
createGlobalTheme(':root', vars, {
  color: { ...PALETTE.light, shadow: '0 1px 2px rgba(60, 45, 20, 0.06), 0 8px 24px rgba(60, 45, 20, 0.06)' },
  font: fonts,
  radius,
});

createGlobalTheme(':root.dark', vars, {
  color: { ...PALETTE.dark, shadow: '0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.25)' },
  font: fonts,
  radius,
});
