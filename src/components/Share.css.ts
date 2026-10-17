import { style } from '@vanilla-extract/css';
import { vars } from '../styles/theme.css';

export const actions = style({ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' });

export const link = style({ textDecoration: 'none' });

// The live region stays in the DOM so it announces reliably; empty, it takes no room.
export const status = style({
  color: vars.color.text,
  fontWeight: 600,
  selectors: { '&:not(:empty)': { marginTop: '0.5rem' } },
});
