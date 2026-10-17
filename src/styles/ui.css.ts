import { style, styleVariants } from '@vanilla-extract/css';
import { vars } from './theme.css';

const buttonBase = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.5rem',
  minHeight: '2.875rem',
  padding: '0 1.125rem',
  borderRadius: vars.radius.control,
  border: '1px solid transparent',
  fontWeight: 650,
  fontSize: '1rem',
  cursor: 'pointer',
  transition: 'transform 120ms ease, filter 120ms ease',
  selectors: {
    '&:active:not(:disabled)': { transform: 'translateY(1px)' },
    '&:hover:not(:disabled)': { filter: 'brightness(1.06)' },
    '&:disabled': { opacity: 0.6, cursor: 'not-allowed' },
  },
});

export const button = styleVariants({
  primary: [buttonBase, { background: vars.color.text, color: vars.color.bg }],
  on: [buttonBase, { background: vars.color.on, color: vars.color.onContrast }],
  off: [buttonBase, { background: vars.color.off, color: vars.color.offContrast }],
  ghost: [buttonBase, { background: 'transparent', borderColor: vars.color.border, color: vars.color.text }],
});

export const smallButton = style({ minHeight: '2.25rem', padding: '0 0.75rem', fontSize: '0.875rem' });

export const input = style({
  width: '100%',
  minHeight: '2.875rem',
  padding: '0 0.875rem',
  borderRadius: vars.radius.control,
  border: `1px solid ${vars.color.border}`,
  background: vars.color.bg,
});

export const label = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '0.375rem',
  fontSize: '0.875rem',
  fontWeight: 600,
});

export const muted = style({ color: vars.color.muted });

export const errorText = style({ color: vars.color.off, fontSize: '0.875rem', fontWeight: 600 });
