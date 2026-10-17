import { style } from '@vanilla-extract/css';
import { vars } from './styles/theme.css';

export const error = style({ color: vars.color.off, fontWeight: 600, margin: 'auto 0' });

export const warning = style({ color: vars.color.off, fontWeight: 600 });

export const trendsWarning = style([warning, { marginTop: '0.75rem', fontSize: '0.875rem' }]);
