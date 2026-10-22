import { keyframes, style } from '@vanilla-extract/css';
import { SETTLE } from '../styles/motion.css';
import { vars } from '../styles/theme.css';

const slideUp = keyframes({ from: { opacity: 0, transform: 'translateY(1.5rem)' } });

// Fixed over the page, so opening or closing it moves nothing beneath (zero layout shift). The inset
// and max-width keep it inside a 320px screen and clear of the home indicator.
const floating = style({
  position: 'fixed',
  zIndex: 10,
  insetInline: 'max(0.75rem, env(safe-area-inset-left))',
  bottom: 'max(0.75rem, env(safe-area-inset-bottom))',
  marginInline: 'auto',
  background: vars.color.card,
  color: vars.color.text,
  border: `1px solid ${vars.color.border}`,
  boxShadow: vars.color.shadow,
  '@media': {
    '(prefers-reduced-motion: no-preference)': { animation: `${slideUp} 360ms ${SETTLE} backwards` },
  },
});

export const card = style([
  floating,
  {
    maxWidth: '26rem',
    maxHeight: 'calc(100dvh - 1.5rem)',
    overflowY: 'auto',
    padding: '1.25rem',
    borderRadius: vars.radius.card,
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

// The confirmation after the bell or the card changes the alerts: a small pill that fades away.
export const notice = style([
  floating,
  {
    width: 'fit-content',
    padding: '0.625rem 1rem',
    borderRadius: vars.radius.pill,
    fontSize: '0.9375rem',
    fontWeight: 600,
  },
]);

// While alerts are on the bell takes the card's blue; the attribute also outranks .gg-icon-button.
export const bell = style({
  selectors: {
    '&[aria-pressed="true"]': {
      background: vars.color.plannedSoft,
      color: vars.color.planned,
      borderColor: vars.color.planned,
    },
  },
});
