import { globalStyle, style, styleVariants } from '@vanilla-extract/css';
import { vars } from '../styles/theme.css';

/** Width of the weekly chart's y-axis labels, shared by the SVG and the x-label row. */
export const AXIS_WIDTH = 32;

export const subtitle = style({
  marginTop: '-0.5rem',
  marginBottom: '1rem',
  minHeight: '1.25rem',
  fontSize: '0.875rem',
  color: vars.color.muted,
});

export const tiles = style({
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '0.5rem',
});

export const tile = style({
  minHeight: '5.75rem',
  padding: '0.75rem',
  borderRadius: vars.radius.control,
  background: vars.color.bg,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
});

export const tileLabel = style({ fontSize: '0.8125rem', fontWeight: 600, color: vars.color.muted, lineHeight: 1.2 });

export const tileValue = style({ fontSize: '1.625rem', fontWeight: 700, lineHeight: 1.1 });

// The units in a duration ("u", "min"), smaller than its numbers.
export const unit = style({ fontSize: '0.6em', fontWeight: 600 });

export const tileDelta = style({
  display: 'flex',
  alignItems: 'center',
  gap: '0.25rem',
  fontSize: '0.75rem',
  fontWeight: 600,
  color: vars.color.muted,
  lineHeight: 1.2,
});

const deltaIconBase = style({ flex: 'none' });

export const deltaIcon = styleVariants({
  worse: [deltaIconBase, { color: vars.color.off }],
  better: [deltaIconBase, { color: vars.color.on }],
  same: [deltaIconBase, { color: vars.color.muted }],
});

export const chartBlock = style({ marginTop: '1.25rem' });

export const chartTitle = style({ fontWeight: 600, fontSize: '0.9375rem', minHeight: '1.375rem' });

export const readout = style({
  minHeight: '1.375rem',
  fontSize: '0.875rem',
  color: vars.color.muted,
  fontVariantNumeric: 'tabular-nums',
});

export const readoutValue = style({ color: vars.color.text, fontWeight: 700 });

export const svg = style({ display: 'block', width: '100%', height: '9rem', overflow: 'visible' });

export const grid = style({ stroke: vars.color.border, strokeWidth: 1, shapeRendering: 'crispEdges' });

export const axisText = style({
  fill: vars.color.muted,
  fontSize: '11px',
  fontFamily: vars.font.body,
  fontVariantNumeric: 'tabular-nums',
});

export const bar = style({ fill: vars.color.chartOff });

export const barGroup = style({});

// The active (hovered, tapped or arrow-key selected) week stands out; the others recede.
globalStyle(`${barGroup}:not([data-active]) ${bar}`, { opacity: 0.55 });

export const activeMarker = style({ fill: vars.color.text });

export const xLabels = style({
  display: 'flex',
  justifyContent: 'space-between',
  minHeight: '1.25rem',
  paddingTop: '0.25rem',
  paddingLeft: `${AXIS_WIDTH}px`,
  fontSize: '0.75rem',
  color: vars.color.muted,
});

export const table = style({
  width: '100%',
  borderCollapse: 'collapse',
  fontVariantNumeric: 'tabular-nums',
  marginTop: '0.5rem',
});

export const th = style({
  textAlign: 'left',
  fontWeight: 600,
  color: vars.color.muted,
  padding: '0.375rem 0',
  borderBottom: `1px solid ${vars.color.border}`,
  selectors: { '&:not(:first-child)': { textAlign: 'right' } },
});

export const td = style({
  padding: '0.375rem 0',
  borderBottom: `1px solid ${vars.color.border}`,
  selectors: { '&:not(:first-child)': { textAlign: 'right' } },
});

export const download = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.25rem',
  marginTop: '0.75rem',
  minHeight: '2.75rem',
});

// Takes the chart's place at about its height (.gg-skel-chart), so the card does not look broken.
export const chartEmpty = style({
  marginTop: '1.25rem',
  minHeight: '11.5rem',
  display: 'grid',
  placeItems: 'center',
  padding: '1rem',
  textAlign: 'center',
  borderRadius: vars.radius.control,
  border: `1px dashed ${vars.color.border}`,
  color: vars.color.muted,
  fontSize: '0.9375rem',
});
