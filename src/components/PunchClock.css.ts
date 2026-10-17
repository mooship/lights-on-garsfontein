import { style } from '@vanilla-extract/css';
import { vars } from '../styles/theme.css';

export const root = style({ display: 'flex', flexDirection: 'column', gap: '1rem' });

export const clock = style({
  fontFamily: vars.font.body,
  fontVariantNumeric: 'tabular-nums',
  fontSize: '2.75rem',
  fontWeight: 700,
  letterSpacing: '0.02em',
  lineHeight: 1,
});

export const running = style({ color: vars.color.off });
export const idle = style({ color: vars.color.muted });

export const meta = style({ color: vars.color.muted, fontSize: '0.9375rem', minHeight: '1.5rem' });

export const actions = style({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' });
