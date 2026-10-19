import { style } from '@vanilla-extract/css';
import { vars } from '../styles/theme.css';

export const stack = style({ display: 'flex', flexDirection: 'column', gap: '0.875rem' });

export const header = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' });

export const backLink = style({
  alignSelf: 'flex-start',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.375rem',
  minHeight: '2.75rem',
  fontWeight: 600,
  textDecoration: 'none',
});

// Side by side when there is room, stacked on phones (iOS date-time inputs need ~15rem).
export const formRow = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 15rem), 1fr))',
  gap: '0.75rem',
});

export const item = style({
  padding: '0.75rem 0',
  borderTop: `1px solid ${vars.color.border}`,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  fontVariantNumeric: 'tabular-nums',
  selectors: { '&:first-child': { borderTop: 'none' } },
});

export const itemMeta = style({ fontSize: '0.875rem', color: vars.color.muted });

export const flagged = style({ opacity: 0.55, textDecoration: 'line-through' });

export const actions = style({ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' });

// The live region stays in the DOM so it announces reliably; while empty it gives back the stack gap.
export const saved = style({
  fontSize: '0.875rem',
  color: vars.color.muted,
  selectors: { '&:empty': { marginTop: '-0.875rem' } },
});

// The punch announcement: a live region that stays in the DOM; empty, it takes no room.
export const announce = style({
  fontSize: '0.875rem',
  fontWeight: 600,
  selectors: { '&:not(:empty)': { marginTop: '0.75rem' } },
});

export const sensor = style({ marginTop: '0.75rem', fontSize: '0.875rem', color: vars.color.muted });

// Red, as the public page shows OFF while the sensor is silent.
export const sensorSilent = style({ color: vars.color.off, fontWeight: 600 });

export const checkbox = style({
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  fontSize: '0.9375rem',
  minHeight: '2.75rem',
  cursor: 'pointer',
});
