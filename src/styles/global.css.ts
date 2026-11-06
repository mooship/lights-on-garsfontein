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

// The underline is softer at rest and firms up under the pointer.
globalStyle('a', {
  color: 'inherit',
  textUnderlineOffset: '0.2em',
  textDecorationColor: 'color-mix(in srgb, currentColor 60%, transparent)',
  transition: 'text-decoration-color 150ms ease',
});

globalStyle('a:hover', { textDecorationColor: 'currentColor' });

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
    'max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) max(3rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left))',
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
  minHeight: '100dvh',
});

globalStyle('.gg-main', { display: 'flex', flexDirection: 'column', gap: '1rem' });

// Focused only from script (tabindex=-1, after the banner closes), so it needs no ring.
globalStyle('.gg-main:focus', { outline: 'none' });

// Off screen until a keyboard user tabs to it; absolute, so the shell and the app keep the same boxes.
globalStyle('.gg-skip', {
  position: 'absolute',
  insetBlockStart: '0.5rem',
  insetInlineStart: '0.5rem',
  zIndex: 10,
  padding: '0.75rem 1rem',
  background: vars.color.card,
  color: vars.color.text,
  border: `2px solid ${vars.color.text}`,
  transform: 'translateY(-200%)',
});
globalStyle('.gg-skip:focus', { transform: 'none' });

// The eyebrow and the switches share the first row; the full brand name gets the width below.
globalStyle('.gg-masthead', {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  columnGap: '1rem',
  paddingTop: '0.5rem',
});

globalStyle('.gg-masthead .gg-title', { gridColumn: '1 / -1' });

globalStyle('.gg-eyebrow', { fontWeight: 600, color: vars.color.muted });

globalStyle('.gg-title', {
  fontWeight: 800,
  fontSize: 'clamp(1.75rem, 8.5vw, 2.25rem)',
  lineHeight: 1.1,
  letterSpacing: '-0.02em',
  marginTop: '0.25rem',
});

globalStyle('.gg-card', {
  background: vars.color.card,
  border: `1px solid ${vars.color.border}`,
  borderRadius: vars.radius.card,
  padding: '1rem',
});

// The status band heads the status card, edge to edge across it, in the state's colour
// (src/components/StatusBadge.css.ts). The loading row (.gg-skel-row) takes the same box, so every state
// keeps the shell's height: an ON or OFF headline wrapped to two lines on a phone with the duration under
// it (2 × 2rem × 1.15 + 0.25rem + 1.5rem = 6.35rem), or a NONE headline of up to three lines, fits.
globalStyle('.gg-band', {
  margin: '-1rem -1rem 0',
  padding: '1rem',
  borderTopWidth: '3px',
  borderTopStyle: 'solid',
  minHeight: 'calc(6.35rem + 2rem + 3px)',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
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
  minHeight: '51.625rem',
  '@media': {
    'screen and (min-width: 21.25rem)': { minHeight: '50.96875rem' },
    'screen and (min-width: 33.75rem)': { minHeight: '48.46875rem' },
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
  gap: '0.5rem',
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
  fontWeight: 700,
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
  borderRadius: vars.radius.control,
  border: `1px solid ${vars.color.inputBorder}`,
  background: vars.color.card,
  cursor: 'pointer',
  transition: 'background-color 150ms ease, border-color 150ms ease, transform 120ms ease',
});

globalStyle('.gg-icon-button:hover', { background: vars.color.bg, borderColor: vars.color.text });
globalStyle('.gg-icon-button:active', { transform: 'translateY(1px)' });

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

// A warning label: a strip on the board's grey with the hazard amber as its left rule.
globalStyle('.gg-safety', {
  fontSize: '0.875rem',
  lineHeight: 1.45,
  padding: '0.5rem 0.75rem',
  background: vars.color.bg,
  borderLeft: `4px solid ${vars.color.focus}`,
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

// The pseudo-elements too: the skeleton's shimmer is one. Delays go as well, or a staggered entrance
// would leave its later parts hidden for a moment.
globalStyle('*, *::before, *::after', {
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      animationDuration: '0.01ms !important',
      animationDelay: '0s !important',
      animationIterationCount: '1 !important',
      transitionDuration: '0.01ms !important',
      transitionDelay: '0s !important',
    },
  },
});

globalStyle('.gg-notice', {
  paddingLeft: '0.75rem',
  borderLeft: `2px solid ${vars.color.border}`,
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
  borderRadius: vars.radius.card,
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

// The status band while loading (.gg-band has its box).
globalStyle('.gg-skel-row', { borderTopColor: vars.color.border });
globalStyle('.gg-skel-stack', { display: 'flex', flexDirection: 'column', gap: '0.625rem', flex: 1 });
globalStyle('.gg-skel-row > .gg-skel-stack', { flex: 'none' });
globalStyle('.gg-skel-grid', { display: 'flex', flexDirection: 'column', gap: '0.5rem' });
globalStyle('.gg-skel-list', { display: 'flex', flexDirection: 'column', gap: '1.25rem', paddingTop: '0.25rem' });

globalStyle('.gg-skel-heading', { height: '1.75rem' });
globalStyle('.gg-skel-text', { height: '0.875rem' });
globalStyle('.gg-skel-tile', { height: '3rem' });
globalStyle('.gg-skel-chart', { height: '11.5rem', marginTop: '1.25rem' });
globalStyle('.gg-skel-item', { height: '2.25rem' });

globalStyle('.gg-w-30', { width: '30%' });
globalStyle('.gg-w-45', { width: '45%' });
globalStyle('.gg-w-60', { width: '60%' });
globalStyle('.gg-w-80', { width: '80%' });
