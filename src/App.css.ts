import { style } from '@vanilla-extract/css';
import { vars } from './styles/theme.css';

// Red means a measured outage everywhere else on the page, so a failure to reach the server is not red.
export const error = style({ color: vars.color.text, fontWeight: 600, margin: 'auto 0' });

export const warning = style({ color: vars.color.text, fontWeight: 600 });

export const trendsWarning = style([warning, { marginTop: '0.75rem', fontSize: '0.875rem' }]);

export const failureBand = style({
  gap: '0.75rem',
  background: vars.color.card,
  color: vars.color.text,
  borderTopColor: vars.color.text,
});

export const warningRow = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: '0.75rem',
});

export const retry = style({ whiteSpace: 'nowrap' });

export const retryDetail = style({ justifyContent: 'center' });
