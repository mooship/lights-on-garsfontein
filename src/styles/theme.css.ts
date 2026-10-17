import { createGlobalTheme, createThemeContract } from '@vanilla-extract/css';

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
    focus: null,
    shadow: null,
  },
  font: { display: null, body: null },
  radius: { card: null, pill: null, control: null },
});

const fonts = { display: 'var(--gg-font-display)', body: 'var(--gg-font-body)' };

/** Page backgrounds, also used for the phone status bar (lib/theme.ts). */
export const PAGE_BG = { light: '#F6F4EF', dark: '#121312' } as const;

const radius = { card: '1.25rem', pill: '999px', control: '0.75rem' };

// Light is the default so the page is themed even before the boot script runs.
createGlobalTheme(':root', vars, {
  color: {
    bg: PAGE_BG.light,
    card: '#FFFFFF',
    text: '#1F2120',
    muted: '#5C5850',
    border: '#E4DFD4',
    inputBorder: '#857E71',
    on: '#2D5A27',
    onSoft: '#E6EEE3',
    onContrast: '#FFFFFF',
    off: '#B33A2B',
    offSoft: '#F7E5E1',
    offContrast: '#FFFFFF',
    chartOff: '#B33A2B',
    focus: '#8A5A12',
    shadow: '0 1px 2px rgba(60, 45, 20, 0.06), 0 8px 24px rgba(60, 45, 20, 0.06)',
  },
  font: fonts,
  radius,
});

createGlobalTheme(':root.dark', vars, {
  color: {
    bg: PAGE_BG.dark,
    card: '#1C1E1C',
    text: '#F0EFEA',
    muted: '#A8A69E',
    border: '#2E312E',
    inputBorder: '#737872',
    on: '#4CAF50',
    onSoft: '#1F2E1F',
    onContrast: '#121312',
    off: '#E57373',
    offSoft: '#3A2322',
    offContrast: '#121312',
    // Validated with the dataviz palette checker against the dark card surface.
    chartOff: '#E06A66',
    focus: '#E6B566',
    shadow: '0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.25)',
  },
  font: fonts,
  radius,
});
