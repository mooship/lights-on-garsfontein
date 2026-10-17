import { style } from '@vanilla-extract/css';
import { vars } from '../styles/theme.css';

export const stack = style({ display: 'flex', flexDirection: 'column', gap: '0.875rem' });

export const header = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' });

// Side by side when there is room, stacked on phones (iOS date-time inputs need ~15rem).
export const formRow = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 15rem), 1fr))',
  gap: '0.75rem',
});

export const table = style({ listStyle: 'none', margin: 0, padding: 0 });

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

export const checkbox = style({
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  fontSize: '0.9375rem',
  minHeight: '2.75rem',
  cursor: 'pointer',
});
