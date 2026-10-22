import { keyframes, style } from '@vanilla-extract/css';
import { SETTLE } from '../styles/motion.css';
import { vars } from '../styles/theme.css';

const slideUp = keyframes({ from: { opacity: 0, transform: 'translateY(1.5rem)' } });

// The card and the confirmation float over the page, so opening or closing them moves nothing beneath
// (zero layout shift). The inset keeps them inside a 320px screen and clear of the home indicator.
export const floating = style({
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
