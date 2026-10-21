// The site's colours per theme, a plain module so the build scripts can import it too: theme.css.ts
// sets them as the app's variables, and scripts/build-og.ts and scripts/build-icons.ts paint with them.
// Copies that cannot import it: src/styles/privacy.css, the theme-color metas in index.html and
// public/favicon*.svg carry a note naming this file; templates/site.webmanifest is JSON and cannot.
export const PALETTE = {
  light: {
    bg: '#F6F4EF',
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
    // Announced in advance: calm, apart from the on green and the outage red. At least 6:1 on card, bg and plannedSoft.
    planned: '#2B5A8A',
    plannedSoft: '#E3ECF5',
    focus: '#8A5A12',
  },
  dark: {
    bg: '#121312',
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
    planned: '#7FB0E0',
    plannedSoft: '#1E2A36',
    focus: '#E6B566',
  },
} as const;
