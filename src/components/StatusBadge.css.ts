import { keyframes, style, styleVariants } from '@vanilla-extract/css';
import { vars } from '../styles/theme.css';

export const root = style({
  display: 'flex',
  alignItems: 'center',
  gap: '1rem',
});

const pulse = keyframes({
  '0%': { transform: 'scale(1)', opacity: 0.55 },
  '100%': { transform: 'scale(1.6)', opacity: 0 },
});

const iconBase = style({
  position: 'relative',
  flex: 'none',
  width: '4rem',
  height: '4rem',
  borderRadius: vars.radius.pill,
  display: 'grid',
  placeItems: 'center',
});

export const icon = styleVariants({
  ON: [iconBase, { background: vars.color.onSoft, color: vars.color.on }],
  OFF: [iconBase, { background: vars.color.offSoft, color: vars.color.off }],
});

export const ring = style({
  position: 'absolute',
  inset: 0,
  borderRadius: 'inherit',
  border: '2px solid currentColor',
  animation: `${pulse} 2.4s ease-out infinite`,
  pointerEvents: 'none',
});

export const headline = style({
  fontFamily: vars.font.display,
  fontSize: '2rem',
  lineHeight: 1.15,
  fontWeight: 650,
});

export const tone = styleVariants({
  ON: { color: vars.color.on },
  OFF: { color: vars.color.off },
});

export const detail = style({
  marginTop: '0.25rem',
  color: vars.color.muted,
  fontVariantNumeric: 'tabular-nums',
});
