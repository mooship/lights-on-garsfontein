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
  },
  font: { display: null, body: null },
  radius: { card: null, control: null },
});

const fonts = { display: 'var(--gg-font-display)', body: 'var(--gg-font-body)' };

// Square, printed-notice corners. Nothing casts a shadow: panels stand apart by surface and a rule.
const radius = { card: '2px', control: '4px' };

// Light is the default so the page is themed even before the boot script runs.
createGlobalTheme(':root', vars, {
  color: PALETTE.light,
  font: fonts,
  radius,
});

createGlobalTheme(':root.dark', vars, {
  color: PALETTE.dark,
  font: fonts,
  radius,
});
