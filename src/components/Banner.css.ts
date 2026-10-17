import { globalStyle, style } from '@vanilla-extract/css';
import { vars } from '../styles/theme.css';

// The banner is the shell's last child and sticks to the bottom of the viewport. Sticky rather
// than fixed: it takes its own height at the end of the page, so it never covers the footer, and
// nothing renders after it, so appearing or closing cannot shift content (index.html has no banner).
const base = style({
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
  fontSize: '0.9375rem',
  lineHeight: 1.45,
});

const info = style([
  base,
  { background: vars.color.card, borderColor: vars.color.inputBorder, color: vars.color.text },
]);

// Inverted for more urgent notices; the focus ring switches to the page colour to stay visible.
const notice = style([base, { background: vars.color.text, borderColor: vars.color.text, color: vars.color.bg }]);
globalStyle(`${notice} :focus-visible`, { outlineColor: vars.color.bg });

export const root = { info, notice } as const;

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
