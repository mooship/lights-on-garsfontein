import { style } from '@vanilla-extract/css';
import { vars } from '../styles/theme.css';
import { floating } from './AlertsCard.css';

// The surface is .gg-card's. The max-width and max-height keep the card inside a small screen; it
// scrolls rather than overflow.
export const card = style([
  floating,
  {
    maxWidth: '26rem',
    maxHeight: 'calc(100dvh - 1.5rem)',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
]);

export const header = style({ display: 'flex', alignItems: 'center', gap: '0.75rem' });

// Calm blue: information, never the red of an outage or the green of a measured "on".
export const icon = style({
  flex: 'none',
  width: '2.75rem',
  height: '2.75rem',
  display: 'grid',
  placeItems: 'center',
  borderRadius: vars.radius.pill,
  background: vars.color.plannedSoft,
  color: vars.color.planned,
});

export const heading = style({
  fontFamily: vars.font.display,
  fontWeight: 650,
  fontSize: '1.25rem',
  lineHeight: 1.3,
  selectors: { '&:focus': { outline: 'none' } },
});

export const text = style({ fontSize: '0.9375rem', lineHeight: 1.45 });

export const scope = style({ fontSize: '0.8125rem', lineHeight: 1.45, color: vars.color.muted });

// The padding and negative margin make a 44px tap target without changing the line's height. The
// underline is the global anchor style's.
export const link = style({
  color: 'inherit',
  display: 'inline-block',
  paddingBlock: '0.8125rem',
  marginBlock: '-0.8125rem',
});

export const steps = style({ margin: 0, paddingLeft: '1.25rem', fontSize: '0.9375rem', lineHeight: 1.45 });

// The live region stays in the card so it announces reliably; empty, it gives back its gap.
export const failed = style({
  fontSize: '0.875rem',
  fontWeight: 600,
  selectors: { '&:empty': { marginTop: '-0.75rem' } },
});

export const actions = style({
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '0.5rem',
  marginTop: '0.25rem',
});

// The main action takes the full width above the two quiet ones.
export const wide = style({ gridColumn: '1 / -1' });
