import { style } from '@vanilla-extract/css';
import { vars } from '../styles/theme.css';

export const root = style({ display: 'flex', flexDirection: 'column', gap: '0.5rem' });

export const helper = style({ fontSize: '0.9375rem', lineHeight: 1.45, color: vars.color.muted });

export const widget = style({ selectors: { '&:empty': { display: 'none' } } });
