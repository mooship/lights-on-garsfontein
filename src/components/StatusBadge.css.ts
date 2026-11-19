import { style, styleVariants } from '@vanilla-extract/css';
import { vars } from '../styles/theme.css';

// The band's box (.gg-band in the global styles) is shared with the loading row; this is its colour. White
// on the state colour in light, the page's dark ink on it in dark. NONE has no reading behind it, so it
// stays neutral and never reads as a measured "on".
export const band = styleVariants({
  ON: { background: vars.color.on, color: vars.color.onContrast, borderTopColor: vars.color.on },
  OFF: { background: vars.color.off, color: vars.color.offContrast, borderTopColor: vars.color.off },
  // Announced in advance: the planned violet, so it never reads as the outage red.
  PLANNED: { background: vars.color.planned, color: vars.color.onContrast, borderTopColor: vars.color.planned },
  NONE: { background: vars.color.card, color: vars.color.text, borderTopColor: vars.color.text },
});

// The headline is the answer the page exists to give, so it is the largest type on it. Its size is set
// here and inherited, so the icon can be one line tall (1.15em) whatever the width.
export const head = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: '0.75rem',
  fontSize: '2.25rem',
  // The longer, neutral headline is smaller so it fits in three lines on a phone.
  selectors: { '[data-status="NONE"] &': { fontSize: '1.75rem' } },
});

// On the headline's first line, so the icon centres on it.
export const icon = style({
  flex: 'none',
  display: 'grid',
  placeItems: 'center',
  height: '1.15em',
});

export const headline = style({
  fontFamily: vars.font.display,
  fontSize: 'inherit',
  lineHeight: 1.15,
  fontWeight: 600,
  textWrap: 'balance',
});

export const detail = style({
  marginTop: '0.25rem',
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
  // NONE has no duration; without the empty line its headline centres in the band.
  selectors: { '[data-status="NONE"] > &': { display: 'none' } },
});
