import { style } from '@vanilla-extract/css';
import { vars } from '../styles/theme.css';

export const row = style({
  minHeight: '3.5rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '1rem',
  borderTop: `1px solid ${vars.color.border}`,
  fontVariantNumeric: 'tabular-nums',
  selectors: { '&:first-child': { borderTop: 'none' } },
});

export const primary = style({ fontWeight: 600, lineHeight: 1.35 });
export const secondary = style({ fontSize: '0.875rem', color: vars.color.muted, lineHeight: 1.35 });
export const end = style({ textAlign: 'right' });
export const ongoing = style({ color: vars.color.off });
export const empty = style({ color: vars.color.muted, paddingTop: '0.5rem' });
