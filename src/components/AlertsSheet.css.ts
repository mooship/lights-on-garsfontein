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
    // Outranks .gg-card's hairline: the card floats, so a heavier rule stands in for a shadow.
    selectors: { '&.gg-card': { border: `2px solid ${vars.color.text}` } },
  },
]);

export const heading = style({
  fontWeight: 700,
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
