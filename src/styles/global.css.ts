import { globalStyle } from '@vanilla-extract/css';
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
});

globalStyle('.gg-main', { display: 'flex', flexDirection: 'column', gap: '1rem' });

globalStyle('.gg-masthead', {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '1rem',
  height: '5.5rem',
  paddingTop: '0.5rem',
});

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
  fontSize: '2.25rem',
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

globalStyle('.gg-status-card', {
  height: '19rem',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
});

globalStyle('.gg-history-card', { height: '23.5rem', overflow: 'hidden' });

// The trends body is fixed; only the user-opened weekly table below it may grow the card.
globalStyle('.gg-trends-body', { height: '32.5rem', overflow: 'hidden' });

globalStyle('.gg-trends-details', { marginTop: '0.75rem', fontSize: '0.875rem' });

globalStyle('.gg-trends-details > summary', {
  cursor: 'pointer',
  fontWeight: 600,
  height: '2.25rem',
  display: 'flex',
  alignItems: 'center',
});

globalStyle('.gg-card-title', {
  fontFamily: vars.font.display,
  fontWeight: 600,
  fontSize: '1.25rem',
  lineHeight: 1.3,
  height: '1.625rem',
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

globalStyle('.gg-status-loading', {
  fontFamily: vars.font.display,
  fontSize: '2rem',
  lineHeight: 1.15,
  fontWeight: 650,
  color: vars.color.muted,
  margin: 'auto 0',
});

globalStyle('.gg-footer', {
  fontSize: '0.875rem',
  color: vars.color.muted,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  paddingTop: '0.5rem',
});

globalStyle('.gg-footer nav', { display: 'flex', flexWrap: 'wrap', gap: '0.25rem 1rem' });

globalStyle('.gg-footer a', {
  display: 'inline-block',
  padding: '0.375rem 0',
  minHeight: '2.25rem',
});

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
  marginTop: '-0.25rem',
  padding: '0.5rem 0.75rem',
  borderRadius: vars.radius.control,
  border: `1px dashed ${vars.color.border}`,
  fontSize: '0.8125rem',
  lineHeight: 1.4,
  color: vars.color.muted,
});
