import { globalKeyframes, globalStyle } from '@vanilla-extract/css';
import { vars } from './theme.css';

// Layout classes use stable global names (gg-*) because the static loading
// skeleton in index.html renders them before any JavaScript runs. Keeping the
// skeleton and the hydrated app on the same boxes is what keeps CLS at zero.

globalStyle(':root', { colorScheme: 'light' });
globalStyle(':root.dark', { colorScheme: 'dark' });

globalStyle('*, *::before, *::after', { boxSizing: 'border-box' });

globalStyle('html', {
  WebkitTextSizeAdjust: '100%',
  textSizeAdjust: '100%',
});

globalStyle('body', {
  margin: 0,
  minHeight: '100dvh',
  background: vars.color.bg,
  color: vars.color.text,
  fontFamily: vars.font.body,
  fontSize: '1rem',
  lineHeight: 1.5,
  WebkitFontSmoothing: 'antialiased',
});

globalStyle('h1, h2, h3, p', { margin: 0 });

// No lone word on a paragraph's last line, and headings broken into even lines.
globalStyle('p', { textWrap: 'pretty' });
globalStyle('h1, h2, h3', { textWrap: 'balance' });

globalStyle('a', { color: 'inherit', textUnderlineOffset: '0.2em' });

globalStyle(':focus-visible', {
  outline: `3px solid ${vars.color.focus}`,
  outlineOffset: '2px',
});

globalStyle('button, input', { font: 'inherit', color: 'inherit' });

globalStyle('.gg-shell', {
  width: '100%',
  maxWidth: '34rem',
  margin: '0 auto',
  // Keep content clear of notches and home indicators (viewport-fit=cover in index.html).
  padding:
    'max(1.25rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) max(2.5rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left))',
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
  minHeight: '100dvh',
});

globalStyle('.gg-main', { display: 'flex', flexDirection: 'column', gap: '1rem' });

// Focused only from script (tabindex=-1, after the banner closes), so it needs no ring.
globalStyle('.gg-main:focus', { outline: 'none' });

// The eyebrow and the switches share the first row; the full brand name gets the width below.
globalStyle('.gg-masthead', {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  columnGap: '1rem',
  paddingTop: '0.5rem',
});

globalStyle('.gg-masthead .gg-title', { gridColumn: '1 / -1' });

globalStyle('.gg-eyebrow', {
  fontSize: '0.8125rem',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: vars.color.muted,
});

globalStyle('.gg-title', {
  fontFamily: vars.font.display,
  fontWeight: 700,
  fontSize: 'clamp(1.75rem, 8.5vw, 2.25rem)',
  lineHeight: 1.1,
  letterSpacing: '-0.01em',
  marginTop: '0.25rem',
});

globalStyle('.gg-card', {
  background: vars.color.card,
  border: `1px solid ${vars.color.border}`,
  borderRadius: vars.radius.card,
  boxShadow: vars.color.shadow,
  padding: '1.25rem',
});

// Sized to its content: the loading skeleton matches every state.
globalStyle('.gg-status-card', {
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
  overflow: 'hidden',
});

// Room for two lines of detail (padding + 2 × 0.9375rem × 1.5 + the border), as the last outage takes
// on a phone; a warning below it only follows a failure.
globalStyle('.gg-status-detail', {
  paddingTop: '1rem',
  borderTop: `1px solid ${vars.color.border}`,
  color: vars.color.muted,
  fontSize: '0.9375rem',
  fontVariantNumeric: 'tabular-nums',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  minHeight: 'calc(3.8125rem + 1px)',
});

globalStyle('.gg-status-warning', { fontSize: '0.8125rem' });

// The trends body reserves its loaded height, which depends on how many lines its text wraps to, so
// it steps with the width: the tallest loaded body in each range, in either language. Only text that
// wraps further on a zoomed screen, or the user-opened weekly table below it, may grow the card.
globalStyle('.gg-trends-body', {
  minHeight: '53.25rem',
  '@media': {
    'screen and (min-width: 21.25rem)': { minHeight: '49.6875rem' },
    'screen and (min-width: 26.25rem)': { minHeight: '48.875rem' },
    'screen and (min-width: 33.75rem)': { minHeight: '46.4375rem' },
  },
});

globalStyle('.gg-trends-details', { marginTop: '0.75rem', fontSize: '0.875rem' });

// A second details (how we measure) sits right under the first.
globalStyle('.gg-trends-details + .gg-trends-details', { marginTop: 0 });

// Disclosures draw their own ▸/▾: a flex summary loses the browser's marker. The marker has empty
// alt text so screen readers, which already announce expanded or collapsed, skip it.
const summaries = '.gg-trends-details > summary';

globalStyle(summaries, {
  cursor: 'pointer',
  fontWeight: 600,
  minHeight: '2.75rem',
  display: 'flex',
  alignItems: 'center',
  gap: '0.375rem',
  listStyle: 'none',
});

globalStyle('.gg-trends-details > summary::-webkit-details-marker', {
  display: 'none',
});

globalStyle('.gg-trends-details > summary::before', {
  content: '"▸" / ""',
  width: '0.75em',
  flex: 'none',
});

globalStyle('.gg-trends-details[open] > summary::before', { content: '"▾" / ""' });

globalStyle('.gg-trends-details ul', { margin: '0 0 0.5rem', paddingLeft: '1.25rem', lineHeight: 1.45 });

// One line whatever the font, so the shell and the app match; a title that wraps on a narrow screen
// wraps the same in both.
globalStyle('.gg-card-title', {
  fontFamily: vars.font.display,
  fontWeight: 600,
  fontSize: '1.25rem',
  lineHeight: 1.3,
  minHeight: '1.625rem',
  marginBottom: '0.75rem',
});

globalStyle('.gg-icon-button', {
  flex: 'none',
  width: '2.75rem',
  height: '2.75rem',
  display: 'inline-grid',
  placeItems: 'center',
  borderRadius: vars.radius.pill,
  border: `1px solid ${vars.color.border}`,
  background: vars.color.card,
  cursor: 'pointer',
});

globalStyle('.gg-masthead-actions', { flex: 'none', display: 'flex', gap: '0.5rem' });

globalStyle('.gg-lang-button', { width: 'auto', padding: '0 0.875rem', fontSize: '0.875rem', fontWeight: 600 });

globalStyle('.gg-footer', {
  fontSize: '0.875rem',
  color: vars.color.muted,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  marginTop: '0.5rem',
  paddingTop: '1rem',
  borderTop: `1px solid ${vars.color.border}`,
});

globalStyle('.gg-footer nav', { display: 'flex', flexWrap: 'wrap', gap: '0 1rem' });

globalStyle('.gg-footer nav a', {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: '2.75rem',
});

globalStyle('.gg-scope', { fontSize: '0.9375rem', lineHeight: 1.45, color: vars.color.muted });

globalStyle('.gg-safety', {
  fontSize: '0.8125rem',
  lineHeight: 1.45,
  color: vars.color.muted,
  paddingTop: '0.75rem',
  borderTop: `1px solid ${vars.color.border}`,
});

// The one action a resident may need in an outage: a 44px tap target, with negative margins so the
// line and the card keep their height.
globalStyle('.gg-safety a', { display: 'inline-block', paddingBlock: '0.8125rem', marginBlock: '-0.8125rem' });

globalStyle('.gg-sr-only', {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
});

globalStyle('*', {
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      animationDuration: '0.01ms !important',
      animationIterationCount: '1 !important',
      transitionDuration: '0.01ms !important',
    },
  },
});

globalStyle('.gg-notice', {
  padding: '0.5rem 0.75rem',
  borderRadius: vars.radius.control,
  border: `1px dashed ${vars.color.border}`,
  fontSize: '0.8125rem',
  lineHeight: 1.4,
  color: vars.color.muted,
});

globalStyle('.gg-status-note', { color: vars.color.muted, fontSize: '0.9375rem' });

globalKeyframes('gg-shimmer', { to: { transform: 'translateX(100%)' } });

globalStyle('.gg-skel', {
  display: 'block',
  position: 'relative',
  overflow: 'hidden',
  borderRadius: '0.375rem',
  background: vars.color.border,
});

globalStyle('.gg-skel::after', {
  content: '""',
  position: 'absolute',
  inset: 0,
  transform: 'translateX(-100%)',
  background: `linear-gradient(90deg, transparent, ${vars.color.card}, transparent)`,
  opacity: 0.6,
  animation: 'gg-shimmer 1.4s ease-in-out infinite',
});

// The same min-height as the status badge (components/StatusBadge.css.ts).
// The same min-height as StatusBadge's root.
globalStyle('.gg-skel-row', { display: 'flex', alignItems: 'center', gap: '1rem', minHeight: '6.35rem' });
globalStyle('.gg-skel-stack', { display: 'flex', flexDirection: 'column', gap: '0.625rem', flex: 1 });
globalStyle('.gg-skel-grid', { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' });
globalStyle('.gg-skel-list', { display: 'flex', flexDirection: 'column', gap: '1.25rem', paddingTop: '0.25rem' });

globalStyle('.gg-skel-badge', { width: '4rem', height: '4rem', borderRadius: vars.radius.pill, flex: 'none' });
globalStyle('.gg-skel-heading', { height: '1.75rem' });
globalStyle('.gg-skel-text', { height: '0.875rem' });
globalStyle('.gg-skel-tile', { height: '5.75rem', borderRadius: vars.radius.control });
globalStyle('.gg-skel-chart', { height: '11.5rem', marginTop: '1.25rem', borderRadius: vars.radius.control });
globalStyle('.gg-skel-item', { height: '2.25rem' });

globalStyle('.gg-w-30', { width: '30%' });
globalStyle('.gg-w-45', { width: '45%' });
globalStyle('.gg-w-60', { width: '60%' });
globalStyle('.gg-w-80', { width: '80%' });
