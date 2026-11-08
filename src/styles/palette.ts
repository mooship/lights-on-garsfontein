// The site's colours per theme, a plain module so the build scripts can import it too: theme.css.ts
// sets them as the app's variables, and scripts/build-og.ts and scripts/build-icons.ts paint with them.
// Copies that cannot import it: src/styles/privacy.css, the theme-color metas in index.html and
// public/favicon*.svg carry a note naming this file; templates/site.webmanifest is JSON and cannot.
// A grey board with paper panels, like a notice at the substation gate. Every text pair passes WCAG AA;
// the inputBorder and the chart bars (at 0.7 opacity) keep 3:1 on the card.
export const PALETTE = {
  light: {
    bg: '#ECEEEA',
    card: '#FAFAF7',
    text: '#1B1D1F',
    muted: '#53595E',
    border: '#B9BEB8',
    inputBorder: '#6E7470',
    on: '#1E6B3C',
    onSoft: '#DCEBE0',
    onContrast: '#FFFFFF',
    off: '#B0281E',
    offSoft: '#F5DEDA',
    offContrast: '#FFFFFF',
    chartOff: '#B0281E',
    // Announced in advance: violet, apart from the on green and the outage red. At least 6:1 on card, bg and plannedSoft.
    planned: '#5B3F8C',
    plannedSoft: '#E8E2F2',
    focus: '#8F5300',
  },
  dark: {
    bg: '#141619',
    card: '#1D2024',
    text: '#ECEEEA',
    muted: '#A2A9A6',
    border: '#4A5050',
    inputBorder: '#7D8582',
    on: '#5CC27E',
    onSoft: '#1B3324',
    onContrast: '#141619',
    off: '#F07A6E',
    offSoft: '#3E2321',
    offContrast: '#141619',
    chartOff: '#F07A6E',
    planned: '#B9A0E8',
    plannedSoft: '#2B2540',
    focus: '#F2B84B',
  },
} as const;
