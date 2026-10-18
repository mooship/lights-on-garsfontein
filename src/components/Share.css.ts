import { globalStyle, style } from '@vanilla-extract/css';
import { vars } from '../styles/theme.css';

// On a phone the share button takes the full width and the two apps split the row below it, rather
// than one button wrapping alone; wider, all three sit in one row.
export const actions = style({
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '0.5rem',
  '@media': { '(min-width: 30rem)': { display: 'flex', flexWrap: 'wrap' } },
});

globalStyle(`${actions} > :first-child`, { gridColumn: '1 / -1' });

export const link = style({ textDecoration: 'none' });

// The live region stays in the DOM so it announces reliably; empty, it takes no room.
export const status = style({
  color: vars.color.text,
  fontWeight: 600,
  selectors: { '&:not(:empty)': { marginTop: '0.5rem' } },
});
