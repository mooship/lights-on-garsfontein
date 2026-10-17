import { style } from '@vanilla-extract/css';
import { vars } from '../styles/theme.css';

// An inline notice after the last card in <main>: in the flow, so it never covers content, and after
// everything the index.html shell renders, so appearing or closing shifts none of it.
export const root = style({
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
