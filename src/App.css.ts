import { style } from '@vanilla-extract/css';
import { vars } from './styles/theme.css';

export const meta = style({
  marginTop: '1rem',
  paddingTop: '1rem',
  borderTop: `1px solid ${vars.color.border}`,
  color: vars.color.muted,
  fontSize: '0.9375rem',
  fontVariantNumeric: 'tabular-nums',
});

export const bottom = style({ marginTop: 'auto' });

export const note = style({ color: vars.color.muted, fontSize: '0.9375rem' });

export const error = style({ color: vars.color.off, fontWeight: 600, margin: 'auto 0' });
