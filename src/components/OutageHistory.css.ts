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
export const ongoingPlanned = style({ color: vars.color.planned });

// Inline, at the secondary line's height, so a planned row is as tall as any other.
export const plannedTag = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.25rem',
  padding: '0 0.4375rem',
  borderRadius: vars.radius.pill,
  background: vars.color.plannedSoft,
  color: vars.color.planned,
  fontWeight: 600,
});
export const empty = style({ color: vars.color.muted, paddingTop: '0.5rem' });

export const more = style({ marginTop: '0.75rem' });

export const pager = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.5rem',
  marginTop: '0.75rem',
  fontSize: '0.875rem',
  color: vars.color.muted,
  fontVariantNumeric: 'tabular-nums',
});
