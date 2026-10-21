import { globalStyle, style, styleVariants } from '@vanilla-extract/css';
import { vars } from './theme.css';

// aria-disabled buttons keep focus (a disabled one drops it), so they look and act disabled too.
const enabled = ':not(:disabled):not([aria-disabled="true"])';

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
  transition: 'transform 120ms ease, filter 120ms ease, background-color 150ms ease',
  selectors: {
    [`&:active${enabled}`]: { transform: 'translateY(1px)' },
    [`&:hover${enabled}`]: { filter: 'brightness(1.06)' },
    '&:disabled, &[aria-disabled="true"]': { opacity: 0.6, cursor: 'not-allowed' },
  },
});

export const button = styleVariants({
  primary: [buttonBase, { background: vars.color.text, color: vars.color.bg }],
  on: [buttonBase, { background: vars.color.on, color: vars.color.onContrast }],
  off: [buttonBase, { background: vars.color.off, color: vars.color.offContrast }],
  // The smaller secondary button, still a 44px touch target.
  ghost: [
    buttonBase,
    {
      background: 'transparent',
      borderColor: vars.color.inputBorder,
      color: vars.color.text,
      minHeight: '2.75rem',
      padding: '0 0.75rem',
      fontSize: '0.875rem',
      // Brightness does nothing to a transparent button, so it takes the page colour instead.
      selectors: { [`&:hover${enabled}`]: { background: vars.color.bg } },
    },
  ],
});

export const input = style({
  display: 'block',
  width: '100%',
  minWidth: 0,
  // iOS gives date and time inputs a fixed intrinsic width and its own pill styling.
  appearance: 'none',
  WebkitAppearance: 'none',
  textAlign: 'left',
  minHeight: '2.875rem',
  padding: '0 0.875rem',
  borderRadius: vars.radius.control,
  border: `1px solid ${vars.color.inputBorder}`,
  background: vars.color.bg,
});

export const label = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '0.375rem',
  fontSize: '0.875rem',
  fontWeight: 600,
});

export const plainList = style({ listStyle: 'none', margin: 0, padding: 0 });

export const errorText = style({ color: vars.color.off, fontSize: '0.875rem', fontWeight: 600 });

// iOS centres the picked date and time inside the field; align it like other inputs.
globalStyle(`${input}::-webkit-date-and-time-value`, { textAlign: 'left' });
