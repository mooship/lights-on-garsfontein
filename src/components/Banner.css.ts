import { style } from '@vanilla-extract/css';
import { vars } from '../styles/theme.css';

// The banner is the shell's last child and sticks to the bottom of the viewport. Sticky rather
// than fixed: it takes its own height at the end of the page, so it never covers the footer, and
// nothing renders after it, so appearing or closing cannot shift content (index.html has no banner).
export const root = style({
  position: 'sticky',
  bottom: 'max(0.75rem, env(safe-area-inset-bottom))',
  zIndex: 1,
  // A short page still puts it at the bottom of the screen (the shell is at least 100dvh).
  marginTop: 'auto',
  display: 'flex',
  alignItems: 'flex-start',
  gap: '0.5rem',
  padding: '0.75rem 0.5rem 0.5rem 1rem',
  borderRadius: vars.radius.card,
  border: '1px solid',
  boxShadow: vars.color.shadow,
  background: vars.color.card,
  borderColor: vars.color.inputBorder,
  color: vars.color.text,
  fontSize: '0.9375rem',
  lineHeight: 1.45,
});

export const body = style({ flex: 1, minWidth: 0, paddingTop: '0.125rem' });

export const link = style({
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: '2.75rem',
  fontWeight: 650,
});

export const close = style({
  flex: 'none',
  width: '2.75rem',
  height: '2.75rem',
  marginTop: '-0.25rem',
  display: 'inline-grid',
  placeItems: 'center',
  borderRadius: vars.radius.pill,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
});
