import { keyframes, style, styleVariants } from '@vanilla-extract/css';
import { vars } from '../styles/theme.css';

// The same min-height as .gg-skel-row (global.css.ts): an ON or OFF headline wrapped to two lines on a
// phone, with the duration under it (2 × 2rem × 1.15 + 0.25rem + 1.5rem), or a NONE headline of up to
// three lines, fits in it, so every state keeps the loading shell's height.
export const root = style({
  display: 'flex',
  alignItems: 'center',
  gap: '1rem',
  minHeight: '6.35rem',
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
  // No live reading: neutral, so it never reads as a measured "on".
  NONE: [iconBase, { background: vars.color.bg, color: vars.color.muted, border: `1px solid ${vars.color.border}` }],
});

// Only rendered for OFF.
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
  textWrap: 'balance',
});

export const tone = styleVariants({
  ON: { color: vars.color.on },
  OFF: { color: vars.color.off },
  // The longer, neutral headline is smaller so it fits beside the icon on a phone.
  NONE: { color: vars.color.text, fontSize: '1.25rem' },
});

export const detail = style({
  marginTop: '0.25rem',
  color: vars.color.muted,
  fontVariantNumeric: 'tabular-nums',
  // NONE has no duration; without the empty line its headline centres on the icon.
  selectors: { [`${root}[data-status="NONE"] &`]: { display: 'none' } },
});
